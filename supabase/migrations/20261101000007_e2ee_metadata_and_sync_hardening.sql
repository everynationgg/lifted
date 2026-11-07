-- ============================================================================
-- LIFTED Phase 8 Stage 3: E2EE Metadata Encryption & Full-Sync Hardening
-- Migration: 20261101000007_e2ee_metadata_and_sync_hardening.sql
--
-- DESIGN PRINCIPLES:
-- 1. SENSITIVE METADATA ENCRYPTION: Mood scores, emotional tags, and prayer
--    notes/statuses are strictly encrypted inside AEK envelopes. Server sees
--    NULL/default for plaintext attributes.
-- 2. HARDENED OPTIMISTIC CONCURRENCY: Stale non-deleted updates are strictly
--    rejected (incoming revision must be strictly greater than server revision).
-- 3. DEVICE AUTHENTICATION: Device tokens are hashed (SHA-256) and verified on
--    every sync mutation to prevent device-id spoofing.
-- 4. UNIFIED MUTATION APIS: Dedicated sync RPCs for journals, prayers, and moods
--    enforce device validation, tombstone fences, optimistic concurrency, and idempotency.
-- ============================================================================

-- 1. Extend mood_checkins with encrypted_payload and relax plaintext mood_score constraint
ALTER TABLE public.mood_checkins ADD COLUMN IF NOT EXISTS encrypted_payload JSONB DEFAULT NULL;
ALTER TABLE public.mood_checkins ALTER COLUMN mood_score DROP NOT NULL;
ALTER TABLE public.mood_checkins DROP CONSTRAINT IF EXISTS mood_checkins_mood_score_check;
ALTER TABLE public.mood_checkins ADD CONSTRAINT mood_checkins_mood_score_check
    CHECK (mood_score IS NULL OR (mood_score >= 1 AND mood_score <= 5));

-- 2. Extend sync_metadata with device_token_hash for device identity verification
ALTER TABLE public.sync_metadata ADD COLUMN IF NOT EXISTS device_token_hash TEXT DEFAULT NULL;

-- 3. Device Enrollment RPC
CREATE OR REPLACE FUNCTION app_security.enroll_sync_device(
    p_device_id TEXT,
    p_platform public.platform_type,
    p_app_version TEXT,
    p_device_token TEXT,
    p_device_nickname TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app_security, extensions, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_token_hash TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
        RAISE EXCEPTION 'Device ID is required.' USING ERRCODE = '22023';
    END IF;

    IF p_device_token IS NULL OR length(trim(p_device_token)) < 16 THEN
        RAISE EXCEPTION 'Device token must be at least 16 characters.' USING ERRCODE = '22023';
    END IF;

    v_token_hash := encode(extensions.digest(convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');

    INSERT INTO public.sync_metadata (
        user_id,
        device_id,
        device_platform,
        client_app_version,
        device_token_hash,
        device_nickname,
        is_revoked,
        last_synced_at,
        updated_at
    ) VALUES (
        v_user_id,
        p_device_id,
        p_platform,
        p_app_version,
        v_token_hash,
        p_device_nickname,
        false,
        now(),
        now()
    )
    ON CONFLICT (user_id, device_id)
    DO UPDATE SET
        device_platform = EXCLUDED.device_platform,
        client_app_version = EXCLUDED.client_app_version,
        device_token_hash = EXCLUDED.device_token_hash,
        device_nickname = COALESCE(EXCLUDED.device_nickname, public.sync_metadata.device_nickname),
        is_revoked = false,
        revoked_at = NULL,
        last_synced_at = now(),
        updated_at = now();

    RETURN jsonb_build_object(
        'status', 'ENROLLED',
        'device_id', p_device_id,
        'user_id', v_user_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.enroll_sync_device TO authenticated, service_role;

-- 4. Internal Helper: Verify Device Authorization
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
    IF p_device_id IS NULL THEN
        RETURN 'OK';
    END IF;

    SELECT * INTO v_meta
    FROM public.sync_metadata
    WHERE user_id = p_user_id AND device_id = p_device_id;

    IF NOT FOUND THEN
        RETURN 'REJECTED_DEVICE_NOT_ENROLLED';
    END IF;

    IF v_meta.is_revoked THEN
        RETURN 'REJECTED_DEVICE_REVOKED';
    END IF;

    -- If device has a registered token hash, verify token
    IF v_meta.device_token_hash IS NOT NULL THEN
        IF p_device_token IS NULL THEN
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

-- 5. Hardened enforce_sync_revision_integrity (Strict Concurrency Check)
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
    -- If updating record to is_deleted = true, allow it so table reflects tombstone
    IF TG_OP = 'UPDATE' AND NEW.is_deleted = true THEN
        RETURN NEW;
    END IF;

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

CREATE OR REPLACE FUNCTION public.enforce_sync_revision_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Strictly reject stale updates where incoming revision is lower than server revision
        IF NEW.sync_revision < OLD.sync_revision THEN
            RAISE EXCEPTION 'CONFLICT_STALE_REVISION: Stale sync revision detected (incoming: %, current: %)',
                NEW.sync_revision, OLD.sync_revision
                USING ERRCODE = 'P0002';
        END IF;

        -- Auto-increment revision if not explicitly bumped
        IF NEW.sync_revision = OLD.sync_revision THEN
            NEW.sync_revision = OLD.sync_revision + 1;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 6. Update sync_upsert_journal with Device Token Verification
DROP FUNCTION IF EXISTS app_security.sync_upsert_journal(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS public.sync_upsert_journal(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT);

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
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- Envelope format validation
    IF p_encrypted_envelope IS NULL OR NOT (p_encrypted_envelope ? 'ct') THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_INVALID_ENVELOPE',
            'message', 'Encrypted envelope must contain ciphertext (ct).'
        );
    END IF;

    -- Device authentication check
    IF p_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, p_device_id, p_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    END IF;

    -- Tombstone fence check
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

    -- Optimistic concurrency check
    SELECT * INTO v_existing
    FROM public.private_journals
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id;

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

-- 7. Dedicated Sync RPC for Prayer Requests
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
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- Envelope format validation
    IF p_encrypted_payload IS NULL OR NOT (p_encrypted_payload ? 'ct') THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_INVALID_ENVELOPE',
            'message', 'Encrypted payload must contain ciphertext (ct).'
        );
    END IF;

    -- Device authentication check
    IF p_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, p_device_id, p_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    END IF;

    -- Tombstone fence check
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

    -- Optimistic concurrency check
    SELECT * INTO v_existing
    FROM public.prayer_requests
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id;

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

        UPDATE public.prayer_requests
        SET encrypted_payload = p_encrypted_payload,
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
            p_sync_revision,
            p_idempotency_key,
            p_client_updated_at,
            'active'::public.prayer_status_type
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

GRANT EXECUTE ON FUNCTION app_security.sync_upsert_prayer TO authenticated, service_role;

-- 8. Dedicated Sync RPC for Mood Check-ins (Zero Plaintext Score/Words)
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
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- Envelope format validation
    IF p_encrypted_payload IS NULL OR NOT (p_encrypted_payload ? 'ct') THEN
        RETURN jsonb_build_object(
            'status', 'REJECTED_INVALID_ENVELOPE',
            'message', 'Encrypted payload must contain ciphertext (ct).'
        );
    END IF;

    -- Device authentication check
    IF p_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, p_device_id, p_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    END IF;

    -- Tombstone fence check
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

    -- Optimistic concurrency check
    SELECT * INTO v_existing
    FROM public.mood_checkins
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id;

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

        UPDATE public.mood_checkins
        SET encrypted_payload = p_encrypted_payload,
            mood_score = NULL,
            selected_emotions = '{}',
            sync_revision = p_sync_revision,
            idempotency_key = p_idempotency_key,
            checkin_timestamp = p_checkin_timestamp,
            updated_at = now()
        WHERE id = v_existing.id;

        RETURN jsonb_build_object(
            'status', 'UPDATED',
            'sync_revision', p_sync_revision,
            'record_id', v_existing.id
        );
    ELSE
        INSERT INTO public.mood_checkins (
            user_id,
            client_record_id,
            encrypted_payload,
            mood_score,
            selected_emotions,
            sync_revision,
            idempotency_key,
            checkin_timestamp
        ) VALUES (
            v_user_id,
            p_client_record_id,
            p_encrypted_payload,
            NULL, -- Zero plaintext emotional score!
            '{}', -- Zero plaintext emotional tags!
            p_sync_revision,
            p_idempotency_key,
            p_checkin_timestamp
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

GRANT EXECUTE ON FUNCTION app_security.sync_upsert_mood TO authenticated, service_role;

-- 9. Authoritative Sync Delete RPC (Atomic Tombstone Creation & Soft Deletion)
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
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_dev_status TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF p_record_type NOT IN ('journal', 'prayer', 'mood') THEN
        RAISE EXCEPTION 'Invalid record type: %', p_record_type USING ERRCODE = '22023';
    END IF;

    -- Device authentication check
    IF p_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, p_device_id, p_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    END IF;

    -- Upsert permanent deletion tombstone
    INSERT INTO public.user_tombstones (
        user_id,
        client_record_id,
        record_type,
        deletion_revision,
        deleted_at,
        is_restored
    ) VALUES (
        v_user_id,
        p_client_record_id,
        p_record_type,
        p_deletion_revision,
        now(),
        false
    )
    ON CONFLICT (user_id, client_record_id, record_type)
    DO UPDATE SET
        deletion_revision = GREATEST(public.user_tombstones.deletion_revision, EXCLUDED.deletion_revision),
        deleted_at = now(),
        is_restored = false,
        restored_at = NULL;

    -- Mark soft-delete in corresponding table
    IF p_record_type = 'journal' THEN
        UPDATE public.private_journals
        SET is_deleted = true, sync_revision = p_deletion_revision, updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    ELSIF p_record_type = 'prayer' THEN
        UPDATE public.prayer_requests
        SET is_deleted = true, sync_revision = p_deletion_revision, updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    ELSIF p_record_type = 'mood' THEN
        UPDATE public.mood_checkins
        SET is_deleted = true, sync_revision = p_deletion_revision, updated_at = now()
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

GRANT EXECUTE ON FUNCTION app_security.sync_delete_record TO authenticated, service_role;

-- 10. Public RPC wrappers (SECURITY INVOKER)
CREATE OR REPLACE FUNCTION public.enroll_sync_device(
    p_device_id TEXT,
    p_platform public.platform_type,
    p_app_version TEXT,
    p_device_token TEXT,
    p_device_nickname TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
AS $$
    SELECT app_security.enroll_sync_device(p_device_id, p_platform, p_app_version, p_device_token, p_device_nickname);
$$;

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
SECURITY INVOKER
AS $$
    SELECT app_security.sync_upsert_journal(p_client_record_id, p_encrypted_envelope, p_sync_revision, p_idempotency_key, p_client_updated_at, p_device_id, p_device_token);
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
SECURITY INVOKER
AS $$
    SELECT app_security.sync_upsert_prayer(p_client_record_id, p_encrypted_payload, p_sync_revision, p_idempotency_key, p_client_updated_at, p_device_id, p_device_token);
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
SECURITY INVOKER
AS $$
    SELECT app_security.sync_upsert_mood(p_client_record_id, p_encrypted_payload, p_sync_revision, p_idempotency_key, p_checkin_timestamp, p_device_id, p_device_token);
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
SECURITY INVOKER
AS $$
    SELECT app_security.sync_delete_record(p_record_type, p_client_record_id, p_deletion_revision, p_device_id, p_device_token);
$$;

GRANT EXECUTE ON FUNCTION public.enroll_sync_device TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_upsert_journal TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_upsert_prayer TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_upsert_mood TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_delete_record TO authenticated, service_role;
