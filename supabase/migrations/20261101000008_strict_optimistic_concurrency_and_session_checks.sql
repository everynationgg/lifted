-- ============================================================================
-- LIFTED Phase 8 Final Gate: Authoritative Optimistic Concurrency,
-- Direct Mutation Hardening, Deletion Prohibition & Session Revocation
-- Migration: 20261101000008_strict_optimistic_concurrency_and_session_checks.sql
-- ============================================================================

-- 1. Helper: Validate Active GoTrue Session (Immediate Session Revocation)
CREATE OR REPLACE FUNCTION app_security.validate_active_session()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = auth, pg_temp
AS $$
DECLARE
    v_session_id TEXT;
    v_user_id UUID;
    v_active boolean;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Extract session_id from JWT claims if present
    BEGIN
        v_session_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'session_id', '');
    EXCEPTION WHEN OTHERS THEN
        v_session_id := NULL;
    END;

    -- If JWT was issued with session_id, verify it exists in auth.sessions and not expired
    IF v_session_id IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM auth.sessions
            WHERE id = v_session_id::uuid
              AND user_id = v_user_id
              AND (not_after IS NULL OR not_after > now())
        ) INTO v_active;
        RETURN v_active;
    END IF;

    -- In synthetic tests or service_role without session_id, session is considered valid
    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.validate_active_session TO authenticated, service_role;

-- 2. Helper: Check if Requesting Device is Revoked (Enforces Revocation on Download/Read Boundary)
CREATE OR REPLACE FUNCTION app_security.is_request_device_revoked()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app_security, pg_temp
AS $$
DECLARE
    v_device_id TEXT;
    v_user_id UUID;
    v_revoked boolean;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    BEGIN
        v_device_id := NULLIF(current_setting('request.headers', true)::json->>'x-device-id', '');
    EXCEPTION WHEN OTHERS THEN
        v_device_id := NULL;
    END;

    IF v_device_id IS NOT NULL THEN
        SELECT is_revoked INTO v_revoked
        FROM public.sync_metadata
        WHERE user_id = v_user_id AND device_id = v_device_id;

        IF FOUND AND v_revoked = true THEN
            RETURN true;
        END IF;
    END IF;

    RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.is_request_device_revoked TO authenticated, service_role;

-- 3. Update RLS Policies to Enforce Device Revocation & Active Session on Reads
DROP POLICY IF EXISTS "user_account_keys_select_own" ON public.user_account_keys;
DROP POLICY IF EXISTS user_account_keys_select_own ON public.user_account_keys;
CREATE POLICY "user_account_keys_select_own" ON public.user_account_keys
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
    );

DROP POLICY IF EXISTS "private_journals_select_own" ON public.private_journals;
DROP POLICY IF EXISTS journals_select_own ON public.private_journals;
CREATE POLICY "private_journals_select_own" ON public.private_journals
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
    );

DROP POLICY IF EXISTS "prayer_requests_select_own" ON public.prayer_requests;
DROP POLICY IF EXISTS prayer_select_own ON public.prayer_requests;
CREATE POLICY "prayer_requests_select_own" ON public.prayer_requests
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
    );

DROP POLICY IF EXISTS "mood_checkins_select_own" ON public.mood_checkins;
DROP POLICY IF EXISTS mood_select_own ON public.mood_checkins;
CREATE POLICY "mood_checkins_select_own" ON public.mood_checkins
    FOR SELECT
    USING (
        auth.uid() = user_id
        AND app_security.validate_active_session()
        AND NOT app_security.is_request_device_revoked()
    );

-- 4. Direct Physical DELETE Prohibition Trigger
CREATE OR REPLACE FUNCTION app_security.prevent_direct_physical_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RAISE EXCEPTION 'DIRECT_DELETE_PROHIBITED: Direct physical deletion of synchronized records is forbidden. Use app_security.sync_delete_record() to guarantee deletion fences and audit tombstones.'
        USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_direct_delete_journals ON public.private_journals;
CREATE TRIGGER trg_prevent_direct_delete_journals
    BEFORE DELETE ON public.private_journals
    FOR EACH ROW
    EXECUTE FUNCTION app_security.prevent_direct_physical_delete();

DROP TRIGGER IF EXISTS trg_prevent_direct_delete_prayers ON public.prayer_requests;
CREATE TRIGGER trg_prevent_direct_delete_prayers
    BEFORE DELETE ON public.prayer_requests
    FOR EACH ROW
    EXECUTE FUNCTION app_security.prevent_direct_physical_delete();

DROP TRIGGER IF EXISTS trg_prevent_direct_delete_moods ON public.mood_checkins;
CREATE TRIGGER trg_prevent_direct_delete_moods
    BEFORE DELETE ON public.mood_checkins
    FOR EACH ROW
    EXECUTE FUNCTION app_security.prevent_direct_physical_delete();

-- 5. Trigger Ordering: Tombstone Fence Trigger (trg_01) MUST fire BEFORE Revision Integrity Trigger (trg_02)
DROP TRIGGER IF EXISTS trg_private_journals_tombstone_fence ON public.private_journals;
DROP TRIGGER IF EXISTS trg_01_private_journals_tombstone_fence ON public.private_journals;
CREATE TRIGGER trg_01_private_journals_tombstone_fence
    BEFORE INSERT OR UPDATE ON public.private_journals
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_sync_tombstone_fence();

DROP TRIGGER IF EXISTS trg_prayer_requests_tombstone_fence ON public.prayer_requests;
DROP TRIGGER IF EXISTS trg_01_prayer_requests_tombstone_fence ON public.prayer_requests;
CREATE TRIGGER trg_01_prayer_requests_tombstone_fence
    BEFORE INSERT OR UPDATE ON public.prayer_requests
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_sync_tombstone_fence();

DROP TRIGGER IF EXISTS trg_mood_checkins_tombstone_fence ON public.mood_checkins;
DROP TRIGGER IF EXISTS trg_01_mood_checkins_tombstone_fence ON public.mood_checkins;
CREATE TRIGGER trg_01_mood_checkins_tombstone_fence
    BEFORE INSERT OR UPDATE ON public.mood_checkins
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_sync_tombstone_fence();

-- 6. Strict Server-Authoritative Concurrency Trigger for Direct Updates (trg_02)
CREATE OR REPLACE FUNCTION public.enforce_sync_revision_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- If soft-deleting where is_deleted changes to true, allow
        IF NEW.is_deleted = true AND OLD.is_deleted = false THEN
            RETURN NEW;
        END IF;

        -- Strictly reject equal-revision overwrite attempts
        IF NEW.sync_revision = OLD.sync_revision THEN
            RAISE EXCEPTION 'CONFLICT_EQUAL_REVISION: Direct update cannot overwrite content at the same sync revision (%)',
                OLD.sync_revision
                USING ERRCODE = 'P0002';
        END IF;

        -- Strictly reject stale updates
        IF NEW.sync_revision < OLD.sync_revision THEN
            RAISE EXCEPTION 'CONFLICT_STALE_REVISION: Stale sync revision detected (incoming: %, current: %)',
                NEW.sync_revision, OLD.sync_revision
                USING ERRCODE = 'P0002';
        END IF;

        -- Strictly reject arbitrary revision jumps (> OLD.sync_revision + 1)
        IF NEW.sync_revision > OLD.sync_revision + 1 THEN
            RAISE EXCEPTION 'CONFLICT_ARBITRARY_REVISION: Direct update cannot skip revisions (incoming: %, current: %, expected: %)',
                NEW.sync_revision, OLD.sync_revision, (OLD.sync_revision + 1)
                USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_private_journals_revision ON public.private_journals;
DROP TRIGGER IF EXISTS trg_02_private_journals_revision ON public.private_journals;
CREATE TRIGGER trg_02_private_journals_revision
    BEFORE UPDATE ON public.private_journals
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_sync_revision_integrity();

DROP TRIGGER IF EXISTS on_prayer_requests_revision ON public.prayer_requests;
DROP TRIGGER IF EXISTS trg_02_prayer_requests_revision ON public.prayer_requests;
CREATE TRIGGER trg_02_prayer_requests_revision
    BEFORE UPDATE ON public.prayer_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_sync_revision_integrity();

DROP TRIGGER IF EXISTS on_mood_checkins_revision ON public.mood_checkins;
DROP TRIGGER IF EXISTS trg_02_mood_checkins_revision ON public.mood_checkins;
CREATE TRIGGER trg_02_mood_checkins_revision
    BEFORE UPDATE ON public.mood_checkins
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_sync_revision_integrity();

-- 7. Hardened Dedicated Sync RPC: sync_upsert_journal
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
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- Session revocation check
    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
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

    -- Concurrency serialization via FOR UPDATE
    SELECT * INTO v_existing
    FROM public.private_journals
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id
    FOR UPDATE;

    IF FOUND THEN
        -- Idempotent retry check
        IF v_existing.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'status', 'ACKNOWLEDGED_IDEMPOTENT',
                'sync_revision', v_existing.sync_revision,
                'record_id', v_existing.id
            );
        END IF;

        -- Optimistic concurrency check (client must not be stale)
        IF v_existing.sync_revision >= p_sync_revision THEN
            RETURN jsonb_build_object(
                'status', 'CONFLICT_STALE_REVISION',
                'server_revision', v_existing.sync_revision,
                'client_revision', p_sync_revision,
                'server_envelope', v_existing.encrypted_envelope
            );
        END IF;

        -- Server authoritatively advances revision by exactly 1
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
        -- Authoritative initial revision is 1
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

-- 8. Hardened Dedicated Sync RPC: sync_upsert_prayer
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
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- Session revocation check
    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
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

    -- Concurrency serialization via FOR UPDATE
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

-- 9. Hardened Dedicated Sync RPC: sync_upsert_mood
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
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_result JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- Session revocation check
    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
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

    -- Concurrency serialization via FOR UPDATE
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
            mood_score = NULL,
            selected_emotions = '{}',
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
            mood_score,
            selected_emotions,
            sync_revision,
            idempotency_key,
            checkin_timestamp
        ) VALUES (
            v_user_id,
            p_client_record_id,
            p_encrypted_payload,
            NULL, -- Zero plaintext score
            '{}', -- Zero plaintext emotion tags
            v_next_revision,
            p_idempotency_key,
            p_checkin_timestamp
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

-- 10. Hardened sync_delete_record with Session & Device Validation
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
    v_dev_status TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    -- Session revocation check
    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
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

-- 11. Hardened sync_restore_record with Monotonic Revision Increment
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

    -- Session revocation check
    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    -- Find active tombstone
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

    -- Un-delete in table and increment sync_revision by exactly 1
    IF p_record_type = 'journal' THEN
        UPDATE public.private_journals
        SET is_deleted = false, sync_revision = sync_revision + 1, updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    ELSIF p_record_type = 'prayer' THEN
        UPDATE public.prayer_requests
        SET is_deleted = false, sync_revision = sync_revision + 1, updated_at = now()
        WHERE user_id = v_user_id AND client_record_id = p_client_record_id;
    ELSIF p_record_type = 'mood' THEN
        UPDATE public.mood_checkins
        SET is_deleted = false, sync_revision = sync_revision + 1, updated_at = now()
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

-- 12. Dedicated Pull RPC with Device Revocation & Active Session Check
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
    v_dev_status TEXT;
    v_records JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    IF p_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, p_device_id, p_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    END IF;

    IF p_record_type = 'journal' THEN
        SELECT jsonb_agg(to_jsonb(j)) INTO v_records
        FROM (
            SELECT id, client_record_id, encrypted_envelope, sync_revision, client_updated_at, is_deleted, created_at, updated_at
            FROM public.private_journals
            WHERE user_id = v_user_id AND sync_revision > p_since_revision
            ORDER BY sync_revision ASC
        ) j;
    ELSIF p_record_type = 'prayer' THEN
        SELECT jsonb_agg(to_jsonb(p)) INTO v_records
        FROM (
            SELECT id, client_record_id, encrypted_payload, sync_revision, client_updated_at, is_deleted, created_at, updated_at
            FROM public.prayer_requests
            WHERE user_id = v_user_id AND sync_revision > p_since_revision
            ORDER BY sync_revision ASC
        ) p;
    ELSIF p_record_type = 'mood' THEN
        SELECT jsonb_agg(to_jsonb(m)) INTO v_records
        FROM (
            SELECT id, client_record_id, encrypted_payload, sync_revision, checkin_timestamp, is_deleted, created_at, updated_at
            FROM public.mood_checkins
            WHERE user_id = v_user_id AND sync_revision > p_since_revision
            ORDER BY sync_revision ASC
        ) m;
    ELSE
        RAISE EXCEPTION 'Invalid record type: %', p_record_type USING ERRCODE = '22023';
    END IF;

    RETURN jsonb_build_object(
        'status', 'OK',
        'record_type', p_record_type,
        'records', COALESCE(v_records, '[]'::jsonb)
    );
END;
$$;

-- 13. Public RPC wrappers (SECURITY INVOKER)
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

CREATE OR REPLACE FUNCTION public.sync_pull_records(
    p_record_type TEXT,
    p_since_revision BIGINT DEFAULT 0,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
AS $$
    SELECT app_security.sync_pull_records(p_record_type, p_since_revision, p_device_id, p_device_token);
$$;

GRANT EXECUTE ON FUNCTION public.sync_restore_record TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_pull_records TO authenticated, service_role;
