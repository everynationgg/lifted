-- ============================================================================
-- LIFTED Phase 8 Stage 2: Cross-Device Sync Contracts, AEK Escrow & Deletion Fences
-- Migration: 20261101000006_sync_contracts_and_aek.sql
--
-- DESIGN PRINCIPLES:
-- 1. ZERO PLAINTEXT RECOVERY KEYS: Server stores ONLY wrapped AEK envelopes.
-- 2. DEVICE REGISTRATION & REVOCATION: Explicit tracking of enrolled and revoked devices.
-- 3. SERVER-AUTHORITATIVE DELETION FENCE: Permanent tombstones prevent stale offline updates
--    from resurrecting deleted records regardless of client revision or future timestamps.
-- 4. NO DIRECT BYPASS: BEFORE INSERT/UPDATE triggers prevent direct REST writes
--    from resurrecting deleted records.
-- 5. AUTHORIZED RESTORE: Resurrecting deleted records requires explicit sync_restore_record RPC.
-- 6. LEAST PRIVILEGE: Row Level Security restricts users strictly to their own data.
--    Tombstone UPDATE/DELETE revoked from authenticated clients.
-- ============================================================================

-- 1. Account Encryption Key (AEK) Escrow Table
CREATE TABLE IF NOT EXISTS public.user_account_keys (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    key_version INTEGER NOT NULL DEFAULT 1,
    wrapped_aek JSONB NOT NULL,
    kdf_algorithm TEXT NOT NULL DEFAULT 'HKDF-SHA256' CHECK (kdf_algorithm IN ('HKDF-SHA256', 'PBKDF2-SHA256')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

ALTER TABLE public.user_account_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_account_keys_select_own" ON public.user_account_keys;
CREATE POLICY "user_account_keys_select_own"
    ON public.user_account_keys
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_account_keys_insert_own" ON public.user_account_keys;
CREATE POLICY "user_account_keys_insert_own"
    ON public.user_account_keys
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_account_keys_update_own" ON public.user_account_keys;
CREATE POLICY "user_account_keys_update_own"
    ON public.user_account_keys
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

REVOKE ALL ON public.user_account_keys FROM PUBLIC;
REVOKE ALL ON public.user_account_keys FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.user_account_keys TO authenticated;
GRANT ALL ON public.user_account_keys TO service_role;

-- 2. Extend sync_metadata with Device Revocation & Nickname
DO $$ BEGIN
    ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS is_revoked BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ DEFAULT NULL;
    ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS device_nickname TEXT DEFAULT NULL;
EXCEPTION
    WHEN duplicate_column THEN null;
END $$;

-- 3. Server-Authoritative Deletion Tombstones Table (Durable, Zero-Time Expiration)
CREATE TABLE IF NOT EXISTS public.user_tombstones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_record_id TEXT NOT NULL,
    record_type TEXT NOT NULL CHECK (record_type IN ('journal', 'prayer', 'mood')),
    deletion_revision BIGINT NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    acknowledged_devices TEXT[] NOT NULL DEFAULT '{}',
    is_restored BOOLEAN NOT NULL DEFAULT false,
    restored_at TIMESTAMPTZ DEFAULT NULL,
    restoration_generation BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_user_tombstone_record UNIQUE (user_id, client_record_id, record_type)
);

CREATE INDEX IF NOT EXISTS idx_user_tombstones_active
    ON public.user_tombstones (user_id, record_type, client_record_id)
    WHERE is_restored = false;

ALTER TABLE public.user_tombstones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_tombstones_select_own" ON public.user_tombstones;
CREATE POLICY "user_tombstones_select_own"
    ON public.user_tombstones
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_tombstones_insert_own" ON public.user_tombstones;
CREATE POLICY "user_tombstones_insert_own"
    ON public.user_tombstones
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_tombstones_update_own" ON public.user_tombstones;

-- Disallow authenticated users from directly UPDATE or DELETE on tombstones
-- Restorations must pass through authorized sync_restore_record function!
REVOKE ALL ON public.user_tombstones FROM PUBLIC;
REVOKE ALL ON public.user_tombstones FROM anon;
REVOKE ALL ON public.user_tombstones FROM authenticated;
GRANT SELECT, INSERT ON public.user_tombstones TO authenticated;
GRANT ALL ON public.user_tombstones TO service_role;

-- 4. Server-Enforced Trigger: Block Direct REST Writes Against Deleted Records
CREATE OR REPLACE FUNCTION app_security.enforce_sync_tombstone_fence()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_record_type TEXT;
    v_client_rec_id TEXT;
    v_tombstone RECORD;
BEGIN
    v_record_type := CASE TG_TABLE_NAME
        WHEN 'private_journals' THEN 'journal'
        WHEN 'prayer_requests' THEN 'prayer'
        WHEN 'mood_checkins' THEN 'mood'
        ELSE 'unknown'
    END;

    v_client_rec_id := NEW.client_record_id;

    -- Check if active tombstone exists
    SELECT * INTO v_tombstone
    FROM public.user_tombstones
    WHERE user_id = NEW.user_id
      AND client_record_id = v_client_rec_id
      AND record_type = v_record_type
      AND is_restored = false;

    IF FOUND THEN
        RAISE EXCEPTION 'TOMBSTONE_FENCE_VIOLATION: Record % has been deleted on the server. Direct writes or stale updates cannot resurrect deleted records without an authorized restore.', v_client_rec_id
            USING ERRCODE = 'P0001';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_private_journals_tombstone_fence ON public.private_journals;
CREATE TRIGGER trg_private_journals_tombstone_fence
    BEFORE INSERT OR UPDATE ON public.private_journals
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_sync_tombstone_fence();

DROP TRIGGER IF EXISTS trg_prayer_requests_tombstone_fence ON public.prayer_requests;
CREATE TRIGGER trg_prayer_requests_tombstone_fence
    BEFORE INSERT OR UPDATE ON public.prayer_requests
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_sync_tombstone_fence();

DROP TRIGGER IF EXISTS trg_mood_checkins_tombstone_fence ON public.mood_checkins;
CREATE TRIGGER trg_mood_checkins_tombstone_fence
    BEFORE INSERT OR UPDATE ON public.mood_checkins
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_sync_tombstone_fence();

-- 5. Server-Authoritative Deletion Fence RPC
CREATE OR REPLACE FUNCTION app_security.sync_upsert_journal(
    p_client_record_id TEXT,
    p_encrypted_envelope JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tombstone RECORD;
    v_existing RECORD;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- 1. Check if device is revoked
    IF p_device_id IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.sync_metadata
            WHERE user_id = v_user_id AND device_id = p_device_id AND is_revoked = true
        ) THEN
            RETURN jsonb_build_object(
                'status', 'REJECTED_DEVICE_REVOKED',
                'message', 'Device has been revoked. Sync rejected.'
            );
        END IF;
    END IF;

    -- 2. DELETION FENCE CHECK: Active tombstone permanently rejects standard sync updates
    -- Future timestamps or high revisions cannot resurrect deleted records!
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

    -- 3. OPTIMISTIC CONCURRENCY CHECK
    SELECT * INTO v_existing
    FROM public.private_journals
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id;

    IF FOUND THEN
        -- Replay protection via idempotency key
        IF v_existing.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'status', 'ACKNOWLEDGED_IDEMPOTENT',
                'sync_revision', v_existing.sync_revision,
                'record_id', v_existing.id
            );
        END IF;

        -- Conflict detection if server revision is strictly greater
        IF v_existing.sync_revision > p_sync_revision THEN
            RETURN jsonb_build_object(
                'status', 'CONFLICT_STALE_REVISION',
                'server_revision', v_existing.sync_revision,
                'client_revision', p_sync_revision,
                'server_envelope', v_existing.encrypted_envelope
            );
        END IF;

        -- Update record
        UPDATE public.private_journals
        SET encrypted_envelope = p_encrypted_envelope,
            sync_revision = p_sync_revision,
            idempotency_key = p_idempotency_key,
            client_updated_at = p_client_updated_at,
            updated_at = now()
        WHERE id = v_existing.id;

        RETURN jsonb_build_object(
            'status', 'UPDATED',
            'sync_revision', p_sync_revision,
            'record_id', v_existing.id
        );
    ELSE
        -- Insert new record
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
            p_sync_revision,
            p_idempotency_key,
            p_client_updated_at
        )
        RETURNING jsonb_build_object(
            'status', 'INSERTED',
            'sync_revision', p_sync_revision,
            'record_id', id
        ) INTO v_result;

        RETURN v_result;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.sync_upsert_journal TO authenticated, service_role;

-- 6. Authorized Restoration RPC
CREATE OR REPLACE FUNCTION app_security.sync_restore_record(
    p_record_type TEXT,
    p_client_record_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_tombstone RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_tombstone
    FROM public.user_tombstones
    WHERE user_id = v_user_id
      AND client_record_id = p_client_record_id
      AND record_type = p_record_type
      AND is_restored = false;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'status', 'RECORD_NOT_DELETED',
            'message', 'No active deletion tombstone found for this record.'
        );
    END IF;

    -- Mark tombstone as restored and increment generation
    UPDATE public.user_tombstones
    SET is_restored = true,
        restored_at = now(),
        restoration_generation = restoration_generation + 1
    WHERE id = v_tombstone.id;

    -- If soft-deleted in table, mark is_deleted = false
    IF p_record_type = 'journal' THEN
        UPDATE public.private_journals
        SET is_deleted = false, updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    ELSIF p_record_type = 'prayer' THEN
        UPDATE public.prayer_requests
        SET is_deleted = false, updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    ELSIF p_record_type = 'mood' THEN
        UPDATE public.mood_checkins
        SET is_deleted = false, updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    END IF;

    RETURN jsonb_build_object(
        'status', 'RESTORED',
        'restoration_generation', v_tombstone.restoration_generation + 1,
        'client_record_id', p_client_record_id,
        'record_type', p_record_type
    );
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.sync_restore_record TO authenticated, service_role;

-- 7. Device Revocation RPC
CREATE OR REPLACE FUNCTION app_security.revoke_sync_device(
    p_device_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    UPDATE public.sync_metadata
    SET is_revoked = true,
        revoked_at = now(),
        updated_at = now()
    WHERE user_id = v_user_id AND device_id = p_device_id;

    RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.revoke_sync_device TO authenticated, service_role;

-- 8. Public RPC wrappers (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.sync_upsert_journal(
    p_client_record_id TEXT,
    p_encrypted_envelope JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
AS $$
    SELECT app_security.sync_upsert_journal(p_client_record_id, p_encrypted_envelope, p_sync_revision, p_idempotency_key, p_client_updated_at, p_device_id);
$$;

CREATE OR REPLACE FUNCTION public.sync_restore_record(
    p_record_type TEXT,
    p_client_record_id TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
AS $$
    SELECT app_security.sync_restore_record(p_record_type, p_client_record_id);
$$;

CREATE OR REPLACE FUNCTION public.revoke_sync_device(
    p_device_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
AS $$
    SELECT app_security.revoke_sync_device(p_device_id);
$$;

GRANT EXECUTE ON FUNCTION public.sync_upsert_journal TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_restore_record TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_sync_device TO authenticated, service_role;
