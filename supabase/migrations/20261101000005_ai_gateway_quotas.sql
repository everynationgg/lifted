-- ============================================================================
-- LIFTED Phase 7: AI Gateway Quota Management, Server-Side Consent & Spending Protection
-- Migration: 20261101000005_ai_gateway_quotas.sql
--
-- DESIGN PRINCIPLES:
-- 1. STRICT PRIVACY: Stores non-content usage metadata ONLY (user_id, window, counts).
--    NEVER stores user messages, prompts, model responses, moods, or personal data.
-- 2. SERVER-ENFORCED CONSENT: Authoritative consent records in PostgreSQL.
--    Client-supplied booleans are never trusted by the server gateway.
-- 3. GLOBAL SPENDING CEILING: Protects against runaway multi-user API costs.
-- 4. ATOMIC CONCURRENCY: Enforces burst (5/min) and daily (30/day) limits atomically.
-- 5. LEAST PRIVILEGE: Ordinary clients cannot manipulate quotas. Modifiable only
--    via hardened SECURITY DEFINER RPCs in private schema app_security by service_role.
-- 6. FAIL-CLOSED ARCHITECTURE: Database is the authoritative rate and consent verifier.
-- ============================================================================

-- 1. Server-Side User AI Consent Table
CREATE TABLE IF NOT EXISTS public.user_ai_consents (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    consent_version TEXT NOT NULL,
    consented_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    revoked_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.user_ai_consents ENABLE ROW LEVEL SECURITY;

-- RLS: Authenticated users can view and manage their own consent record
CREATE POLICY "user_ai_consents_select_own"
    ON public.user_ai_consents
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "user_ai_consents_insert_own"
    ON public.user_ai_consents
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "user_ai_consents_update_own"
    ON public.user_ai_consents
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE ON public.user_ai_consents TO authenticated;
GRANT ALL ON public.user_ai_consents TO service_role;

-- 2. AI Usage Quotas Table (Non-content metadata only)
CREATE TABLE IF NOT EXISTS public.ai_usage_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    window_type TEXT NOT NULL CHECK (window_type IN ('minute', 'day')),
    window_start TIMESTAMPTZ NOT NULL,
    request_count INT NOT NULL DEFAULT 1,
    estimated_tokens INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_ai_user_window UNIQUE (user_id, window_type, window_start)
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_user_window
    ON public.ai_usage_quotas (user_id, window_type, window_start);

CREATE INDEX IF NOT EXISTS idx_ai_usage_global_window
    ON public.ai_usage_quotas (window_type, window_start);

ALTER TABLE public.ai_usage_quotas ENABLE ROW LEVEL SECURITY;

-- Authenticated users can only read their own usage metrics
CREATE POLICY "ai_usage_quotas_select_own"
    ON public.ai_usage_quotas
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

REVOKE INSERT, UPDATE, DELETE ON public.ai_usage_quotas FROM anon, authenticated;
GRANT SELECT ON public.ai_usage_quotas TO authenticated;
GRANT ALL ON public.ai_usage_quotas TO service_role;

-- 3. Idempotency Ledger Table (Prevents rapid duplicate executions)
CREATE TABLE IF NOT EXISTS public.ai_request_idempotency (
    idempotency_key TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    response_payload JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.ai_request_idempotency ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_request_idempotency FROM anon, authenticated;
GRANT ALL ON public.ai_request_idempotency TO service_role;

-- 4. Server-Side Consent Verification Functions in app_security
CREATE OR REPLACE FUNCTION app_security.check_user_ai_consent(
    p_user_id UUID,
    p_required_version TEXT DEFAULT 'v1.0'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_consented BOOLEAN := FALSE;
BEGIN
    SELECT (revoked_at IS NULL AND consent_version = p_required_version)
    INTO v_consented
    FROM public.user_ai_consents
    WHERE user_id = p_user_id;

    RETURN COALESCE(v_consented, FALSE);
END;
$$;

CREATE OR REPLACE FUNCTION app_security.record_user_ai_consent(
    p_user_id UUID,
    p_version TEXT DEFAULT 'v1.0'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.user_ai_consents (user_id, consent_version, consented_at, revoked_at, updated_at)
    VALUES (p_user_id, p_version, pg_catalog.now(), NULL, pg_catalog.now())
    ON CONFLICT (user_id)
    DO UPDATE SET
        consent_version = p_version,
        consented_at = pg_catalog.now(),
        revoked_at = NULL,
        updated_at = pg_catalog.now();
END;
$$;

CREATE OR REPLACE FUNCTION app_security.revoke_user_ai_consent(
    p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    UPDATE public.user_ai_consents
    SET revoked_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE user_id = p_user_id;
END;
$$;

-- 5. Atomic Rate Limit, Quota & Global Spending Evaluator
CREATE OR REPLACE FUNCTION app_security.check_and_increment_ai_quota(
    p_user_id UUID,
    p_max_per_minute INT DEFAULT 5,
    p_max_per_day INT DEFAULT 30,
    p_tokens INT DEFAULT 0,
    p_global_daily_ceiling INT DEFAULT 1000
)
RETURNS TABLE (
    allowed BOOLEAN,
    rejection_reason TEXT,
    minute_count INT,
    day_count INT,
    global_day_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_minute_start TIMESTAMPTZ := pg_catalog.date_trunc('minute', pg_catalog.now());
    v_day_start TIMESTAMPTZ := pg_catalog.date_trunc('day', pg_catalog.now());
    v_current_minute_count INT := 0;
    v_current_day_count INT := 0;
    v_current_global_day_count INT := 0;
BEGIN
    -- 1. Check Global Daily Usage / Cost Ceiling across all users
    v_current_global_day_count := COALESCE((
        SELECT pg_catalog.sum(request_count)
        FROM public.ai_usage_quotas
        WHERE window_type = 'day'
          AND window_start = v_day_start
    ), 0);

    -- 2. Fetch User Minute and Day Counters
    v_current_minute_count := COALESCE((
        SELECT request_count
        FROM public.ai_usage_quotas
        WHERE user_id = p_user_id
          AND window_type = 'minute'
          AND window_start = v_minute_start
    ), 0);

    v_current_day_count := COALESCE((
        SELECT request_count
        FROM public.ai_usage_quotas
        WHERE user_id = p_user_id
          AND window_type = 'day'
          AND window_start = v_day_start
    ), 0);

    -- 3. Evaluate Thresholds
    IF v_current_global_day_count >= p_global_daily_ceiling THEN
        RETURN QUERY SELECT FALSE, 'GLOBAL_CEILING_EXCEEDED'::TEXT, v_current_minute_count, v_current_day_count, v_current_global_day_count;
        RETURN;
    END IF;

    IF v_current_minute_count >= p_max_per_minute THEN
        RETURN QUERY SELECT FALSE, 'BURST_LIMIT_EXCEEDED'::TEXT, v_current_minute_count, v_current_day_count, v_current_global_day_count;
        RETURN;
    END IF;

    IF v_current_day_count >= p_max_per_day THEN
        RETURN QUERY SELECT FALSE, 'DAILY_QUOTA_EXCEEDED'::TEXT, v_current_minute_count, v_current_day_count, v_current_global_day_count;
        RETURN;
    END IF;

    IF v_current_day_count >= p_max_per_day THEN
        RETURN QUERY SELECT FALSE, 'DAILY_QUOTA_EXCEEDED'::TEXT, v_current_minute_count, v_current_day_count, v_current_global_day_count;
        RETURN;
    END IF;

    -- 4. Atomically Upsert Minute Counter
    INSERT INTO public.ai_usage_quotas (user_id, window_type, window_start, request_count, estimated_tokens)
    VALUES (p_user_id, 'minute', v_minute_start, 1, p_tokens)
    ON CONFLICT (user_id, window_type, window_start)
    DO UPDATE SET 
        request_count = public.ai_usage_quotas.request_count + 1,
        estimated_tokens = public.ai_usage_quotas.estimated_tokens + p_tokens,
        updated_at = pg_catalog.now();

    -- 5. Atomically Upsert Day Counter
    INSERT INTO public.ai_usage_quotas (user_id, window_type, window_start, request_count, estimated_tokens)
    VALUES (p_user_id, 'day', v_day_start, 1, p_tokens)
    ON CONFLICT (user_id, window_type, window_start)
    DO UPDATE SET 
        request_count = public.ai_usage_quotas.request_count + 1,
        estimated_tokens = public.ai_usage_quotas.estimated_tokens + p_tokens,
        updated_at = pg_catalog.now();

    RETURN QUERY SELECT TRUE, 'ALLOWED'::TEXT, v_current_minute_count + 1, v_current_day_count + 1, v_current_global_day_count + 1;
END;
$$;

-- 6. Pruning Routines
CREATE OR REPLACE FUNCTION app_security.prune_expired_ai_quotas()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_deleted_quotas INT;
    v_deleted_idempotency INT;
BEGIN
    DELETE FROM public.ai_usage_quotas
    WHERE window_start < (pg_catalog.now() - INTERVAL '7 days');
    GET DIAGNOSTICS v_deleted_quotas = ROW_COUNT;

    DELETE FROM public.ai_request_idempotency
    WHERE created_at < (pg_catalog.now() - INTERVAL '1 hour');
    GET DIAGNOSTICS v_deleted_idempotency = ROW_COUNT;

    RETURN v_deleted_quotas + v_deleted_idempotency;
END;
$$;

-- 7. Public PostgREST RPC Wrappers (Least Privilege & Zero Client Spoofing)
-- Authenticated users record/revoke their OWN consent using auth.uid()
CREATE OR REPLACE FUNCTION public.record_user_ai_consent(
    p_version TEXT DEFAULT 'v1.0'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to record AI consent';
    END IF;

    PERFORM app_security.record_user_ai_consent(v_uid, p_version);
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_user_ai_consent()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
BEGIN
    v_uid := auth.uid();
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Authentication required to revoke AI consent';
    END IF;

    PERFORM app_security.revoke_user_ai_consent(v_uid);
    RETURN TRUE;
END;
$$;

-- Service Role Edge Function RPCs (Authoritative verification & quota evaluation)
CREATE OR REPLACE FUNCTION public.check_user_ai_consent(
    p_user_id UUID,
    p_required_version TEXT DEFAULT 'v1.0'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN app_security.check_user_ai_consent(p_user_id, p_required_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_and_increment_ai_quota(
    p_user_id UUID,
    p_max_per_minute INT DEFAULT 5,
    p_max_per_day INT DEFAULT 30,
    p_tokens INT DEFAULT 0,
    p_global_daily_ceiling INT DEFAULT 1000
)
RETURNS TABLE (
    allowed BOOLEAN,
    rejection_reason TEXT,
    minute_count INT,
    day_count INT,
    global_day_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN QUERY SELECT * FROM app_security.check_and_increment_ai_quota(
        p_user_id,
        p_max_per_minute,
        p_max_per_day,
        p_tokens,
        p_global_daily_ceiling
    );
END;
$$;

-- 8. Privileges Lockdown
-- Private app_security functions
REVOKE ALL ON FUNCTION app_security.check_user_ai_consent(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_security.check_user_ai_consent(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.check_user_ai_consent(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION app_security.record_user_ai_consent(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_security.record_user_ai_consent(UUID, TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.record_user_ai_consent(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION app_security.revoke_user_ai_consent(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_security.revoke_user_ai_consent(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.revoke_user_ai_consent(UUID) TO service_role;

REVOKE ALL ON FUNCTION app_security.check_and_increment_ai_quota(UUID, INT, INT, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_security.check_and_increment_ai_quota(UUID, INT, INT, INT, INT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.check_and_increment_ai_quota(UUID, INT, INT, INT, INT) TO service_role;

REVOKE ALL ON FUNCTION app_security.prune_expired_ai_quotas() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_security.prune_expired_ai_quotas() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.prune_expired_ai_quotas() TO service_role;

-- Public RPC wrappers: Authenticated users can only record/revoke their own consent
REVOKE ALL ON FUNCTION public.record_user_ai_consent(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_user_ai_consent(TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.revoke_user_ai_consent() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_user_ai_consent() TO authenticated, service_role;

-- Public checking/quota RPCs: Restricted strictly to service_role (Edge Function)
REVOKE ALL ON FUNCTION public.check_user_ai_consent(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_user_ai_consent(UUID, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.check_and_increment_ai_quota(UUID, INT, INT, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_ai_quota(UUID, INT, INT, INT, INT) TO service_role;
