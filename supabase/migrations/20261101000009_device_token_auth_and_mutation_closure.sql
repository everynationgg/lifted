-- ============================================================================
-- LIFTED Phase 8 Final Security Acceptance:
-- 1. Cryptographic Device Secret Verification on All Read & RPC Paths
-- 2. Device Impersonation Closure (Fail Closed on Missing/Fake/Mismatched Tokens)
-- 3. Strict Server-Authoritative Optimistic Concurrency & Idempotency
-- Migration: 20261101000009_device_token_auth_and_mutation_closure.sql
-- ============================================================================

-- 1. TABLE GRANTS LEAST-PRIVILEGE AUDIT & PRESERVATION
-- Preserve verified table grants required by contract tests:
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_journals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prayer_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mood_checkins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_metadata TO authenticated;
GRANT SELECT, INSERT ON public.user_tombstones TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.user_account_keys TO authenticated;

GRANT ALL ON public.private_journals TO service_role;
GRANT ALL ON public.prayer_requests TO service_role;
GRANT ALL ON public.mood_checkins TO service_role;
GRANT ALL ON public.sync_metadata TO service_role;
GRANT ALL ON public.user_tombstones TO service_role;
GRANT ALL ON public.user_account_keys TO service_role;

-- 2. HARDENED DEVICE AUTHENTICATION VERIFIER
DROP FUNCTION IF EXISTS app_security.verify_device_auth(UUID, TEXT, TEXT);
CREATE OR REPLACE FUNCTION app_security.verify_device_auth(
    p_user_id UUID,
    p_device_id TEXT,
    p_device_token TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
DECLARE
    v_meta RECORD;
    v_expected_hash TEXT;
BEGIN
    IF p_user_id IS NULL THEN
        RETURN 'REJECTED_UNAUTHENTICATED';
    END IF;

    IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
        RETURN 'REJECTED_DEVICE_ID_MISSING';
    END IF;

    -- Look up device registration in sync_metadata for this specific authenticated user
    SELECT * INTO v_meta
    FROM public.sync_metadata
    WHERE user_id = p_user_id AND device_id = p_device_id;

    IF NOT FOUND THEN
        RETURN 'REJECTED_DEVICE_NOT_ENROLLED';
    END IF;

    -- If revoked, fail closed immediately
    IF v_meta.is_revoked THEN
        RETURN 'REJECTED_DEVICE_REVOKED';
    END IF;

    -- If device has a registered token hash, token is strictly required and must match
    IF v_meta.device_token_hash IS NOT NULL THEN
        IF p_device_token IS NULL OR length(trim(p_device_token)) = 0 THEN
            RETURN 'REJECTED_DEVICE_TOKEN_MISSING';
        END IF;

        v_expected_hash := encode(extensions.digest(convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');
        IF v_expected_hash != v_meta.device_token_hash THEN
            RETURN 'REJECTED_DEVICE_UNAUTHORIZED';
        END IF;
    END IF;

    RETURN 'OK';
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.verify_device_auth(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 3. REQUEST HEADER DEVICE AUTHENTICATION CHECKER (FOR RLS)
-- Extracts x-device-id and x-device-token headers from the incoming HTTP request.
-- When running in PostgREST HTTP environment:
-- If the account has enrolled devices in sync_metadata, possession of the matching device token
-- is strictly mandatory. Fails closed on missing, fake, revoked, or mismatched tokens.
CREATE OR REPLACE FUNCTION app_security.verify_request_device_auth()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_headers_raw TEXT;
    v_device_id TEXT;
    v_device_token TEXT;
    v_has_enrolled_devices boolean;
    v_status TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Check if request came through PostgREST (request.headers is non-null)
    BEGIN
        v_headers_raw := current_setting('request.headers', true);
    EXCEPTION WHEN OTHERS THEN
        v_headers_raw := NULL;
    END;

    -- If running in direct internal psql without PostgREST headers, allow internal database operations
    IF v_headers_raw IS NULL THEN
        RETURN true;
    END IF;

    -- Running in PostgREST HTTP environment: extract device headers
    BEGIN
        v_device_id := NULLIF(v_headers_raw::json->>'x-device-id', '');
        v_device_token := NULLIF(v_headers_raw::json->>'x-device-token', '');
    EXCEPTION WHEN OTHERS THEN
        v_device_id := NULL;
        v_device_token := NULL;
    END;

    -- Check if user has enrolled any sync devices with active token hashes
    SELECT EXISTS (
        SELECT 1 FROM public.sync_metadata
        WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
    ) INTO v_has_enrolled_devices;

    -- If user has enrolled sync devices, cryptographic device proof is strictly mandatory
    IF v_has_enrolled_devices THEN
        IF v_device_id IS NULL OR v_device_token IS NULL THEN
            RETURN false; -- Missing headers fail closed
        END IF;

        v_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        RETURN (v_status = 'OK');
    END IF;

    -- If only revoked devices or no token hashes enrolled, check revocation if device_id supplied
    IF v_device_id IS NOT NULL THEN
        v_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        RETURN (v_status = 'OK');
    END IF;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.verify_request_device_auth() TO authenticated, service_role;

-- 4. HARDEN RLS POLICIES FOR DIRECT READ PATHS
DROP POLICY IF EXISTS "private_journals_select_own" ON public.private_journals;
DROP POLICY IF EXISTS journals_select_own ON public.private_journals;
CREATE POLICY "private_journals_select_own" ON public.private_journals
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    );

DROP POLICY IF EXISTS "prayer_requests_select_own" ON public.prayer_requests;
DROP POLICY IF EXISTS prayer_select_own ON public.prayer_requests;
CREATE POLICY "prayer_requests_select_own" ON public.prayer_requests
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    );

DROP POLICY IF EXISTS "mood_checkins_select_own" ON public.mood_checkins;
DROP POLICY IF EXISTS mood_select_own ON public.mood_checkins;
CREATE POLICY "mood_checkins_select_own" ON public.mood_checkins
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    );

DROP POLICY IF EXISTS "user_tombstones_select_own" ON public.user_tombstones;
CREATE POLICY "user_tombstones_select_own" ON public.user_tombstones
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    );

DROP POLICY IF EXISTS "sync_metadata_select_own" ON public.sync_metadata;
CREATE POLICY "sync_metadata_select_own" ON public.sync_metadata
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    );

DROP POLICY IF EXISTS "user_account_keys_select_own" ON public.user_account_keys;
CREATE POLICY "user_account_keys_select_own" ON public.user_account_keys
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    );

DROP POLICY IF EXISTS "user_account_keys_insert_own" ON public.user_account_keys;
CREATE POLICY "user_account_keys_insert_own" ON public.user_account_keys
    FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    );

DROP POLICY IF EXISTS "user_account_keys_update_own" ON public.user_account_keys;
CREATE POLICY "user_account_keys_update_own" ON public.user_account_keys
    FOR UPDATE
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    )
    WITH CHECK (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
        AND app_security.verify_request_device_auth()
    );

-- 5. HARDENED DEDICATED SYNC MUTATION RPCS

-- A. sync_upsert_journal
CREATE OR REPLACE FUNCTION app_security.sync_upsert_journal(
    p_client_record_id TEXT,
    p_encrypted_envelope JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_has_enrolled_devices boolean;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    IF p_encrypted_envelope IS NULL OR NOT (p_encrypted_envelope ? 'ct') THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_INVALID_ENVELOPE',
            'message', 'Encrypted envelope must contain ciphertext (ct).'
        );
    END IF;

    v_device_id := COALESCE(NULLIF(trim(p_device_id), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-id', ''));
    v_device_token := COALESCE(NULLIF(trim(p_device_token), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-token', ''));

    SELECT EXISTS (
        SELECT 1 FROM public.sync_metadata
        WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
    ) INTO v_has_enrolled_devices;

    IF v_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    ELSIF v_has_enrolled_devices THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_DEVICE_TOKEN_MISSING',
            'message', 'Device authentication credentials are required.'
        );
    END IF;

    SELECT * INTO v_tombstone
    FROM public.user_tombstones
    WHERE user_id = v_user_id
      AND client_record_id = p_client_record_id
      AND record_type = 'journal'
      AND is_restored = false;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_TOMBSTONE',
            'message', 'Record is deleted on the server. Standard sync cannot resurrect deleted records.',
            'deletion_revision', v_tombstone.deletion_revision,
            'restoration_generation', v_tombstone.restoration_generation
        );
    END IF;

    SELECT * INTO v_existing
    FROM public.private_journals
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'status', 'ACKNOWLEDGED_IDEMPOTENT',
                'sync_revision', v_existing.sync_revision,
                'record_id', v_existing.id
            );
        END IF;

        IF v_existing.sync_revision >= p_sync_revision THEN
            RETURN jsonb_build_object(
                'status', 'CONFLICT_STALE_REVISION',
                'server_revision', v_existing.sync_revision,
                'client_revision', p_sync_revision,
                'server_envelope', v_existing.encrypted_envelope
            );
        END IF;

        v_next_revision := v_existing.sync_revision + 1;

        UPDATE public.private_journals
        SET encrypted_envelope = p_encrypted_envelope,
            sync_revision = v_next_revision,
            idempotency_key = p_idempotency_key,
            client_updated_at = p_client_updated_at,
            updated_at = now()
        WHERE id = v_existing.id;

        RETURN jsonb_build_object(
            'status', 'UPDATED',
            'sync_revision', v_next_revision,
            'server_revision', v_next_revision,
            'record_id', v_existing.id
        );
    ELSE
        v_next_revision := 1;

        INSERT INTO public.private_journals (
            user_id,
            client_record_id,
            encrypted_envelope,
            sync_revision,
            idempotency_key,
            client_updated_at
        ) VALUES (
            v_user_id,
            p_client_record_id,
            p_encrypted_envelope,
            v_next_revision,
            p_idempotency_key,
            p_client_updated_at
        )
        RETURNING jsonb_build_object(
            'status', 'INSERTED',
            'sync_revision', v_next_revision,
            'server_revision', v_next_revision,
            'record_id', id
        ) INTO v_result;

        RETURN v_result;
    END IF;
END;
$$;

-- B. sync_upsert_prayer
CREATE OR REPLACE FUNCTION app_security.sync_upsert_prayer(
    p_client_record_id TEXT,
    p_encrypted_payload JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_has_enrolled_devices boolean;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    IF p_encrypted_payload IS NULL OR NOT (p_encrypted_payload ? 'ct') THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_INVALID_ENVELOPE',
            'message', 'Encrypted payload must contain ciphertext (ct).'
        );
    END IF;

    v_device_id := COALESCE(NULLIF(trim(p_device_id), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-id', ''));
    v_device_token := COALESCE(NULLIF(trim(p_device_token), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-token', ''));

    SELECT EXISTS (
        SELECT 1 FROM public.sync_metadata
        WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
    ) INTO v_has_enrolled_devices;

    IF v_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    ELSIF v_has_enrolled_devices THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_DEVICE_TOKEN_MISSING',
            'message', 'Device authentication credentials are required.'
        );
    END IF;

    SELECT * INTO v_tombstone
    FROM public.user_tombstones
    WHERE user_id = v_user_id
      AND client_record_id = p_client_record_id
      AND record_type = 'prayer'
      AND is_restored = false;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_TOMBSTONE',
            'message', 'Record is deleted on the server. Standard sync cannot resurrect deleted records.',
            'deletion_revision', v_tombstone.deletion_revision,
            'restoration_generation', v_tombstone.restoration_generation
        );
    END IF;

    SELECT * INTO v_existing
    FROM public.prayer_requests
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'status', 'ACKNOWLEDGED_IDEMPOTENT',
                'sync_revision', v_existing.sync_revision,
                'record_id', v_existing.id
            );
        END IF;

        IF v_existing.sync_revision >= p_sync_revision THEN
            RETURN jsonb_build_object(
                'status', 'CONFLICT_STALE_REVISION',
                'server_revision', v_existing.sync_revision,
                'client_revision', p_sync_revision,
                'server_envelope', v_existing.encrypted_payload
            );
        END IF;

        v_next_revision := v_existing.sync_revision + 1;

        UPDATE public.prayer_requests
        SET encrypted_payload = p_encrypted_payload,
            sync_revision = v_next_revision,
            idempotency_key = p_idempotency_key,
            client_updated_at = p_client_updated_at,
            updated_at = now()
        WHERE id = v_existing.id;

        RETURN jsonb_build_object(
            'status', 'UPDATED',
            'sync_revision', v_next_revision,
            'server_revision', v_next_revision,
            'record_id', v_existing.id
        );
    ELSE
        v_next_revision := 1;

        INSERT INTO public.prayer_requests (
            user_id,
            client_record_id,
            encrypted_payload,
            sync_revision,
            idempotency_key,
            client_updated_at,
            prayer_status
        ) VALUES (
            v_user_id,
            p_client_record_id,
            p_encrypted_payload,
            v_next_revision,
            p_idempotency_key,
            p_client_updated_at,
            'active'::public.prayer_status_type
        )
        RETURNING jsonb_build_object(
            'status', 'INSERTED',
            'sync_revision', v_next_revision,
            'server_revision', v_next_revision,
            'record_id', id
        ) INTO v_result;

        RETURN v_result;
    END IF;
END;
$$;

-- C. sync_upsert_mood
CREATE OR REPLACE FUNCTION app_security.sync_upsert_mood(
    p_client_record_id TEXT,
    p_encrypted_payload JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_checkin_timestamp BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_has_enrolled_devices boolean;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    IF p_encrypted_payload IS NULL OR NOT (p_encrypted_payload ? 'ct') THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_INVALID_ENVELOPE',
            'message', 'Encrypted payload must contain ciphertext (ct).'
        );
    END IF;

    v_device_id := COALESCE(NULLIF(trim(p_device_id), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-id', ''));
    v_device_token := COALESCE(NULLIF(trim(p_device_token), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-token', ''));

    SELECT EXISTS (
        SELECT 1 FROM public.sync_metadata
        WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
    ) INTO v_has_enrolled_devices;

    IF v_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    ELSIF v_has_enrolled_devices THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_DEVICE_TOKEN_MISSING',
            'message', 'Device authentication credentials are required.'
        );
    END IF;

    SELECT * INTO v_tombstone
    FROM public.user_tombstones
    WHERE user_id = v_user_id
      AND client_record_id = p_client_record_id
      AND record_type = 'mood'
      AND is_restored = false;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_TOMBSTONE',
            'message', 'Record is deleted on the server. Standard sync cannot resurrect deleted records.',
            'deletion_revision', v_tombstone.deletion_revision,
            'restoration_generation', v_tombstone.restoration_generation
        );
    END IF;

    SELECT * INTO v_existing
    FROM public.mood_checkins
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'status', 'ACKNOWLEDGED_IDEMPOTENT',
                'sync_revision', v_existing.sync_revision,
                'record_id', v_existing.id
            );
        END IF;

        IF v_existing.sync_revision >= p_sync_revision THEN
            RETURN jsonb_build_object(
                'status', 'CONFLICT_STALE_REVISION',
                'server_revision', v_existing.sync_revision,
                'client_revision', p_sync_revision,
                'server_envelope', v_existing.encrypted_payload
            );
        END IF;

        v_next_revision := v_existing.sync_revision + 1;

        UPDATE public.mood_checkins
        SET encrypted_payload = p_encrypted_payload,
            sync_revision = v_next_revision,
            idempotency_key = p_idempotency_key,
            checkin_timestamp = p_checkin_timestamp,
            updated_at = now()
        WHERE id = v_existing.id;

        RETURN jsonb_build_object(
            'status', 'UPDATED',
            'sync_revision', v_next_revision,
            'server_revision', v_next_revision,
            'record_id', v_existing.id
        );
    ELSE
        v_next_revision := 1;

        INSERT INTO public.mood_checkins (
            user_id,
            client_record_id,
            encrypted_payload,
            sync_revision,
            idempotency_key,
            checkin_timestamp,
            mood_score,
            selected_emotions
        ) VALUES (
            v_user_id,
            p_client_record_id,
            p_encrypted_payload,
            v_next_revision,
            p_idempotency_key,
            p_checkin_timestamp,
            NULL,
            '{}'::TEXT[]
        )
        RETURNING jsonb_build_object(
            'status', 'INSERTED',
            'sync_revision', v_next_revision,
            'server_revision', v_next_revision,
            'record_id', id
        ) INTO v_result;

        RETURN v_result;
    END IF;
END;
$$;

-- D. sync_delete_record
CREATE OR REPLACE FUNCTION app_security.sync_delete_record(
    p_record_type TEXT,
    p_client_record_id TEXT,
    p_deletion_revision BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_has_enrolled_devices boolean;
    v_tombstone RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    v_device_id := COALESCE(NULLIF(trim(p_device_id), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-id', ''));
    v_device_token := COALESCE(NULLIF(trim(p_device_token), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-token', ''));

    SELECT EXISTS (
        SELECT 1 FROM public.sync_metadata
        WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
    ) INTO v_has_enrolled_devices;

    IF v_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    ELSIF v_has_enrolled_devices THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_DEVICE_TOKEN_MISSING',
            'message', 'Device authentication credentials are required.'
        );
    END IF;

    IF p_record_type NOT IN ('journal', 'prayer', 'mood') THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_INVALID_TYPE',
            'message', 'Record type must be journal, prayer, or mood.'
        );
    END IF;

    -- Check if already tombstoned
    SELECT * INTO v_tombstone
    FROM public.user_tombstones
    WHERE user_id = v_user_id
      AND client_record_id = p_client_record_id
      AND record_type = p_record_type
      AND is_restored = false;

    IF FOUND THEN
        RETURN jsonb_build_object(
            'status', 'ALREADY_DELETED',
            'deletion_revision', v_tombstone.deletion_revision,
            'restoration_generation', v_tombstone.restoration_generation
        );
    END IF;

    -- Upsert active tombstone
    INSERT INTO public.user_tombstones (
        user_id,
        client_record_id,
        record_type,
        deletion_revision,
        is_restored
    ) VALUES (
        v_user_id,
        p_client_record_id,
        p_record_type,
        p_deletion_revision,
        false
    )
    ON CONFLICT (user_id, client_record_id, record_type)
    DO UPDATE SET
        deletion_revision = GREATEST(public.user_tombstones.deletion_revision, EXCLUDED.deletion_revision),
        is_restored = false,
        restored_at = NULL,
        deleted_at = now();

    -- Mark is_deleted = true on underlying table
    IF p_record_type = 'journal' THEN
        UPDATE public.private_journals
        SET is_deleted = true, sync_revision = GREATEST(sync_revision + 1, p_deletion_revision), updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    ELSIF p_record_type = 'prayer' THEN
        UPDATE public.prayer_requests
        SET is_deleted = true, sync_revision = GREATEST(sync_revision + 1, p_deletion_revision), updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    ELSIF p_record_type = 'mood' THEN
        UPDATE public.mood_checkins
        SET is_deleted = true, sync_revision = GREATEST(sync_revision + 1, p_deletion_revision), updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    END IF;

    RETURN jsonb_build_object(
        'status', 'DELETED',
        'record_type', p_record_type,
        'client_record_id', p_client_record_id,
        'deletion_revision', p_deletion_revision
    );
END;
$$;

-- E. sync_pull_records
CREATE OR REPLACE FUNCTION app_security.sync_pull_records(
    p_record_type TEXT,
    p_since_revision BIGINT DEFAULT 0,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_has_enrolled_devices boolean;
    v_records JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    v_device_id := COALESCE(NULLIF(trim(p_device_id), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-id', ''));
    v_device_token := COALESCE(NULLIF(trim(p_device_token), ''), NULLIF(current_setting('request.headers', true)::json->>'x-device-token', ''));

    SELECT EXISTS (
        SELECT 1 FROM public.sync_metadata
        WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
    ) INTO v_has_enrolled_devices;

    IF v_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    ELSIF v_has_enrolled_devices THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_DEVICE_TOKEN_MISSING',
            'message', 'Device authentication credentials are required.'
        );
    END IF;

    IF p_record_type = 'journal' THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(j.*)), '[]'::jsonb) INTO v_records
        FROM (
            SELECT client_record_id, encrypted_envelope, sync_revision, is_deleted, client_updated_at, created_at, updated_at
            FROM public.private_journals
            WHERE user_id = v_user_id AND sync_revision > p_since_revision
            ORDER BY sync_revision ASC
        ) j;
    ELSIF p_record_type = 'prayer' THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(p.*)), '[]'::jsonb) INTO v_records
        FROM (
            SELECT client_record_id, encrypted_payload, sync_revision, is_deleted, client_updated_at, created_at, updated_at
            FROM public.prayer_requests
            WHERE user_id = v_user_id AND sync_revision > p_since_revision
            ORDER BY sync_revision ASC
        ) p;
    ELSIF p_record_type = 'mood' THEN
        SELECT COALESCE(jsonb_agg(to_jsonb(m.*)), '[]'::jsonb) INTO v_records
        FROM (
            SELECT client_record_id, encrypted_payload, sync_revision, is_deleted, checkin_timestamp, created_at, updated_at
            FROM public.mood_checkins
            WHERE user_id = v_user_id AND sync_revision > p_since_revision
            ORDER BY sync_revision ASC
        ) m;
    ELSE
        RETURN jsonb_build_object(
            'status', 'REJECTED_INVALID_TYPE',
            'message', 'Record type must be journal, prayer, or mood.'
        );
    END IF;

    RETURN jsonb_build_object(
        'status', 'OK',
        'record_type', p_record_type,
        'records', v_records
    );
END;
$$;

-- Expose RPCs to public schema aliases for PostgREST
CREATE OR REPLACE FUNCTION public.sync_upsert_journal(
    p_client_record_id TEXT,
    p_encrypted_envelope JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
    SELECT app_security.sync_upsert_journal(
        p_client_record_id,
        p_encrypted_envelope,
        p_sync_revision,
        p_idempotency_key,
        p_client_updated_at,
        p_device_id,
        p_device_token
    );
$$;

CREATE OR REPLACE FUNCTION public.sync_upsert_prayer(
    p_client_record_id TEXT,
    p_encrypted_payload JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
    SELECT app_security.sync_upsert_prayer(
        p_client_record_id,
        p_encrypted_payload,
        p_sync_revision,
        p_idempotency_key,
        p_client_updated_at,
        p_device_id,
        p_device_token
    );
$$;

CREATE OR REPLACE FUNCTION public.sync_upsert_mood(
    p_client_record_id TEXT,
    p_encrypted_payload JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_checkin_timestamp BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
    SELECT app_security.sync_upsert_mood(
        p_client_record_id,
        p_encrypted_payload,
        p_sync_revision,
        p_idempotency_key,
        p_checkin_timestamp,
        p_device_id,
        p_device_token
    );
$$;

CREATE OR REPLACE FUNCTION public.sync_delete_record(
    p_record_type TEXT,
    p_client_record_id TEXT,
    p_deletion_revision BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
    SELECT app_security.sync_delete_record(
        p_record_type,
        p_client_record_id,
        p_deletion_revision,
        p_device_id,
        p_device_token
    );
$$;

CREATE OR REPLACE FUNCTION public.sync_pull_records(
    p_record_type TEXT,
    p_since_revision BIGINT DEFAULT 0,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
    SELECT app_security.sync_pull_records(
        p_record_type,
        p_since_revision,
        p_device_id,
        p_device_token
    );
$$;

-- Grant EXECUTE permissions to authenticated and service_role
GRANT EXECUTE ON FUNCTION app_security.sync_upsert_journal TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.sync_upsert_prayer TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.sync_upsert_mood TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.sync_delete_record TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.sync_pull_records TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.sync_upsert_journal TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_upsert_prayer TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_upsert_mood TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_delete_record TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_pull_records TO authenticated, service_role;
