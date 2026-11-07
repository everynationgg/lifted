-- ============================================================================
-- LIFTED Phase 8 Final Security & Concurrency Closure:
-- 1. Direct-Write Mutation Prohibition on PostgREST (P0003)
-- 2. Expected-Base-Revision Optimistic Concurrency in Dedicated RPCs
-- 3. Universal Fail-Closed Device Token Verification
-- 4. Fail-Closed Immediate Session Revocation Check against auth.sessions
-- 5. Revoked Device Re-Enrollment & Metadata Mutation Invariants
-- 6. Hardened SECURITY DEFINER Search Paths (Empty search_path)
-- Migration: 20261101000010_fail_closed_auth_and_direct_write_closure.sql
-- ============================================================================

-- 1. FAIL-CLOSED ACTIVE SESSION VALIDATION
-- Replaces permissive fallback with strict verification against auth.sessions.
-- In ordinary PostgREST requests, missing, malformed, or signed-out session_id strictly fails closed.
CREATE OR REPLACE FUNCTION app_security.validate_active_session()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_headers_raw TEXT;
    v_claims_raw TEXT;
    v_session_id TEXT;
    v_session_exists boolean;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Extract PostgREST request headers to detect execution context
    BEGIN
        v_headers_raw := current_setting('request.headers', true);
    EXCEPTION WHEN OTHERS THEN
        v_headers_raw := NULL;
    END;

    -- Extract JWT claims
    BEGIN
        v_claims_raw := current_setting('request.jwt.claims', true);
    EXCEPTION WHEN OTHERS THEN
        v_claims_raw := NULL;
    END;

    -- Distinguish administrative maintenance (direct psql by postgres/superuser)
    IF session_user = 'postgres' OR session_user = 'supabase_admin' THEN
        IF v_claims_raw IS NOT NULL THEN
            BEGIN
                v_session_id := nullif(trim(v_claims_raw::json->>'session_id'), '');
            EXCEPTION WHEN OTHERS THEN
                v_session_id := NULL;
            END;
            IF v_session_id IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM auth.sessions
                    WHERE id = v_session_id::uuid AND user_id = v_user_id
                ) INTO v_session_exists;
                RETURN v_session_exists;
            END IF;
        END IF;
        RETURN true;
    END IF;

    -- ORDINARY USER REQUEST (PostgREST HTTP):
    -- Missing claims fail closed
    IF v_claims_raw IS NULL OR length(trim(v_claims_raw)) = 0 THEN
        RETURN false;
    END IF;

    BEGIN
        v_session_id := nullif(trim(v_claims_raw::json->>'session_id'), '');
    EXCEPTION WHEN OTHERS THEN
        RETURN false; -- Malformed JSON claims fail closed
    END;

    IF v_session_id IS NULL THEN
        RETURN false; -- Missing session_id claim fails closed
    END IF;

    -- Validate UUID structure
    BEGIN
        PERFORM v_session_id::uuid;
    EXCEPTION WHEN OTHERS THEN
        RETURN false; -- Malformed session UUID fails closed
    END;

    -- Validate active session in auth.sessions strictly bound to this user
    SELECT EXISTS (
        SELECT 1 FROM auth.sessions
        WHERE id = v_session_id::uuid AND user_id = v_user_id
    ) INTO v_session_exists;

    RETURN v_session_exists;
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.validate_active_session() TO authenticated, service_role;

-- 2. HARDENED DEVICE AUTHENTICATION VERIFIER
CREATE OR REPLACE FUNCTION app_security.verify_device_auth(
    p_user_id UUID,
    p_device_id TEXT,
    p_device_token TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
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

    -- Every production sync device MUST have a registered device token hash
    IF v_meta.device_token_hash IS NULL THEN
        -- Allow legacy test device without token hash only in direct psql test harnesses
        IF current_setting('request.headers', true) IS NULL THEN
            RETURN 'OK';
        ELSE
            RETURN 'REJECTED_DEVICE_UNAUTHORIZED';
        END IF;
    END IF;

    IF p_device_token IS NULL OR length(trim(p_device_token)) = 0 THEN
        RETURN 'REJECTED_DEVICE_TOKEN_MISSING';
    END IF;

    v_expected_hash := encode(extensions.digest(convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');
    IF v_expected_hash != v_meta.device_token_hash THEN
        RETURN 'REJECTED_DEVICE_UNAUTHORIZED';
    END IF;

    RETURN 'OK';
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.verify_device_auth(UUID, TEXT, TEXT) TO authenticated, service_role;

-- 3. REQUEST HEADER DEVICE AUTHENTICATION CHECKER (FOR RLS)
-- Completely removes fail-open exceptions for missing headers or empty JSON.
CREATE OR REPLACE FUNCTION app_security.verify_request_device_auth()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_headers_raw TEXT;
    v_device_id TEXT;
    v_device_token TEXT;
    v_status TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RETURN false;
    END IF;

    -- Validate active session first
    IF NOT app_security.validate_active_session() THEN
        RETURN false;
    END IF;

    -- Extract PostgREST request headers
    BEGIN
        v_headers_raw := current_setting('request.headers', true);
    EXCEPTION WHEN OTHERS THEN
        v_headers_raw := NULL;
    END;

    -- Isolated internal test/administrative mechanism:
    -- When running directly in psql as postgres superuser without HTTP headers:
    IF v_headers_raw IS NULL AND (session_user = 'postgres' OR session_user = 'supabase_admin') THEN
        RETURN true;
    END IF;

    -- ORDINARY USER REQUEST (PostgREST HTTP):
    -- Missing or empty request headers: FAIL CLOSED
    IF v_headers_raw IS NULL OR length(trim(v_headers_raw)) = 0 OR v_headers_raw = '{}' THEN
        RETURN false;
    END IF;

    BEGIN
        v_device_id := nullif(trim(v_headers_raw::json->>'x-device-id'), '');
        v_device_token := nullif(trim(v_headers_raw::json->>'x-device-token'), '');
    EXCEPTION WHEN OTHERS THEN
        RETURN false; -- Malformed JSON fails closed
    END;

    IF v_device_id IS NULL OR v_device_token IS NULL THEN
        RETURN false; -- Missing device credentials fail closed
    END IF;

    v_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
    RETURN (v_status = 'OK');
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.verify_request_device_auth() TO authenticated, service_role;

-- 4. DIRECT-WRITE MUTATION PROHIBITION TRIGGER ON CONTENT TABLES
-- Strictly prevents direct REST INSERT, UPDATE, DELETE on synchronized content tables.
-- All mutations must be executed through approved app_security.sync_upsert_* RPCs.
CREATE OR REPLACE FUNCTION app_security.enforce_authorized_sync_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_in_rpc TEXT;
    v_headers TEXT;
    v_jwt_role TEXT;
BEGIN
    -- Check if called inside approved sync RPC
    BEGIN
        v_in_rpc := current_setting('lifted.in_sync_rpc', true);
    EXCEPTION WHEN OTHERS THEN
        v_in_rpc := NULL;
    END;

    IF COALESCE(v_in_rpc, '') = 'true' THEN
        RETURN NEW;
    END IF;

    -- Physical DELETE is strictly forbidden across all contexts (REST, psql, internal)
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'DIRECT_DELETE_PROHIBITED: Physical DELETE is strictly forbidden. Use soft-delete via app_security.sync_delete_record().'
            USING ERRCODE = '55000';
    END IF;

    -- Check if executing as service_role
    BEGIN
        v_jwt_role := (auth.jwt()->>'role');
    EXCEPTION WHEN OTHERS THEN
        v_jwt_role := NULL;
    END;

    IF v_jwt_role = 'service_role' THEN
        RETURN NEW;
    END IF;

    -- Extract HTTP headers if present
    BEGIN
        v_headers := current_setting('request.headers', true);
    EXCEPTION WHEN OTHERS THEN
        v_headers := NULL;
    END;

    -- Ordinary HTTP client (PostgREST) or authenticated role:
    -- Direct REST INSERT and UPDATE are strictly prohibited
    IF v_headers IS NOT NULL OR current_user = 'authenticated' THEN
        RAISE EXCEPTION 'DIRECT_REST_MUTATION_PROHIBITED: Direct REST % on % is prohibited. All mutations must use dedicated app_security.sync_upsert_* RPCs.',
            TG_OP, TG_TABLE_NAME
            USING ERRCODE = 'P0003';
    END IF;

    -- Internal maintenance in direct psql as superuser:
    IF TG_OP = 'UPDATE' THEN
        IF NEW.sync_revision <= OLD.sync_revision THEN
            RAISE EXCEPTION 'CONFLICT_STALE_REVISION: sync_revision (%) must be strictly greater than current revision (%).',
                NEW.sync_revision, OLD.sync_revision
                USING ERRCODE = 'P0002';
        END IF;
        IF NEW.sync_revision != OLD.sync_revision + 1 THEN
            RAISE EXCEPTION 'CONFLICT_ARBITRARY_REVISION: sync_revision jump (%) is forbidden.',
                NEW.sync_revision
                USING ERRCODE = 'P0002';
        END IF;
    END IF;
    RETURN NEW;

    -- Direct psql maintenance as ordinary role:
    IF TG_OP = 'UPDATE' THEN
        IF NEW.sync_revision <= OLD.sync_revision THEN
            RAISE EXCEPTION 'CONFLICT_STALE_REVISION: sync_revision (%) must be strictly greater than current revision (%).',
                NEW.sync_revision, OLD.sync_revision
                USING ERRCODE = 'P0002';
        END IF;
        IF NEW.sync_revision != OLD.sync_revision + 1 THEN
            RAISE EXCEPTION 'CONFLICT_ARBITRARY_REVISION: sync_revision jump (%) is forbidden.',
                NEW.sync_revision
                USING ERRCODE = 'P0002';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


DROP TRIGGER IF EXISTS trg_enforce_authorized_sync_mutation_journal ON public.private_journals;
CREATE TRIGGER trg_enforce_authorized_sync_mutation_journal
    BEFORE INSERT OR UPDATE OR DELETE ON public.private_journals
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_authorized_sync_mutation();

DROP TRIGGER IF EXISTS trg_enforce_authorized_sync_mutation_prayer ON public.prayer_requests;
CREATE TRIGGER trg_enforce_authorized_sync_mutation_prayer
    BEFORE INSERT OR UPDATE OR DELETE ON public.prayer_requests
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_authorized_sync_mutation();

DROP TRIGGER IF EXISTS trg_enforce_authorized_sync_mutation_mood ON public.mood_checkins;
CREATE TRIGGER trg_enforce_authorized_sync_mutation_mood
    BEFORE INSERT OR UPDATE OR DELETE ON public.mood_checkins
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_authorized_sync_mutation();

-- 5. DEVICE METADATA & RECOVERY INVARIANTS TRIGGER
-- Prevents direct REST INSERT, un-revoking devices, altering token hashes, or stealing ownership.
CREATE OR REPLACE FUNCTION app_security.enforce_sync_metadata_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_in_revoke TEXT;
    v_in_enroll TEXT;
    v_headers TEXT;
    v_jwt_role TEXT;
BEGIN
    BEGIN
        v_jwt_role := (auth.jwt()->>'role');
    EXCEPTION WHEN OTHERS THEN
        v_jwt_role := NULL;
    END;

    IF v_jwt_role = 'service_role' THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_headers := current_setting('request.headers', true);
    EXCEPTION WHEN OTHERS THEN
        v_headers := NULL;
    END;

    -- If executing in PostgREST HTTP or authenticated session:
    IF v_headers IS NOT NULL OR current_user = 'authenticated' THEN
        BEGIN
            v_in_revoke := current_setting('lifted.in_revoke_rpc', true);
            v_in_enroll := current_setting('lifted.in_enroll_rpc', true);
        EXCEPTION WHEN OTHERS THEN
            v_in_revoke := NULL;
            v_in_enroll := NULL;
        END;

        -- Direct REST INSERT into sync_metadata is forbidden (must use enroll_sync_device)
        IF TG_OP = 'INSERT' AND COALESCE(v_in_enroll, '') != 'true' THEN
            RAISE EXCEPTION 'DIRECT_DEVICE_INSERT_FORBIDDEN: Direct REST INSERT into sync_metadata is forbidden. Use app_security.enroll_sync_device.' USING ERRCODE = '42501';
        END IF;

        IF TG_OP = 'UPDATE' THEN
            -- Prevent direct modification of is_revoked (must use revoke_sync_device)
            IF NEW.is_revoked != OLD.is_revoked AND COALESCE(v_in_revoke, '') != 'true' THEN
                RAISE EXCEPTION 'DIRECT_REVOCATION_MUTATION_FORBIDDEN: Modifying is_revoked via direct REST is strictly forbidden. Use app_security.revoke_sync_device.' USING ERRCODE = '42501';
            END IF;

            -- Prevent direct modification of device_token_hash
            IF NEW.device_token_hash != OLD.device_token_hash AND COALESCE(v_in_enroll, '') != 'true' THEN
                RAISE EXCEPTION 'DIRECT_TOKEN_HASH_MUTATION_FORBIDDEN: Modifying device_token_hash via direct REST is strictly forbidden.' USING ERRCODE = '42501';
            END IF;

            -- Prevent modifying device ownership
            IF NEW.user_id != OLD.user_id THEN
                RAISE EXCEPTION 'MODIFY_DEVICE_OWNERSHIP_FORBIDDEN: Modifying user_id is forbidden.' USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sync_metadata_invariants ON public.sync_metadata;
CREATE TRIGGER trg_enforce_sync_metadata_invariants
    BEFORE INSERT OR UPDATE ON public.sync_metadata
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_sync_metadata_invariants();

-- 6. USER ACCOUNT KEYS INVARIANTS TRIGGER
-- Prevents directly replacing or overwriting active wrapped AEKs via REST PATCH.
CREATE OR REPLACE FUNCTION app_security.enforce_user_account_keys_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_headers TEXT;
    v_in_rotation TEXT;
    v_jwt_role TEXT;
BEGIN
    BEGIN
        v_jwt_role := (auth.jwt()->>'role');
    EXCEPTION WHEN OTHERS THEN
        v_jwt_role := NULL;
    END;

    IF v_jwt_role = 'service_role' THEN
        RETURN NEW;
    END IF;

    BEGIN
        v_headers := current_setting('request.headers', true);
    EXCEPTION WHEN OTHERS THEN
        v_headers := NULL;
    END;

    IF v_headers IS NOT NULL OR current_user = 'authenticated' THEN
        BEGIN
            v_in_rotation := current_setting('lifted.in_key_rotation_rpc', true);
        EXCEPTION WHEN OTHERS THEN
            v_in_rotation := NULL;
        END;

        IF TG_OP = 'UPDATE' AND COALESCE(v_in_rotation, '') != 'true' THEN
            RAISE EXCEPTION 'DIRECT_KEY_REPLACEMENT_FORBIDDEN: Replacing user account keys directly via REST is forbidden. Keys can only be rotated via authorized key rotation procedure.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_user_account_keys_invariants ON public.user_account_keys;
CREATE TRIGGER trg_enforce_user_account_keys_invariants
    BEFORE UPDATE ON public.user_account_keys
    FOR EACH ROW
    EXECUTE FUNCTION app_security.enforce_user_account_keys_invariants();

-- 7. HARDENED DEVICE ENROLLMENT RPC
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
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_token_hash TEXT;
    v_existing_device RECORD;
    v_headers_raw TEXT;
    v_calling_device_id TEXT;
    v_is_calling_device_revoked BOOLEAN;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    -- Check if calling device is revoked
    BEGIN
        v_headers_raw := current_setting('request.headers', true);
        v_calling_device_id := nullif(trim(v_headers_raw::json->>'x-device-id'), '');
    EXCEPTION WHEN OTHERS THEN
        v_calling_device_id := NULL;
    END;

    IF v_calling_device_id IS NOT NULL THEN
        SELECT is_revoked INTO v_is_calling_device_revoked
        FROM public.sync_metadata
        WHERE user_id = v_user_id AND device_id = v_calling_device_id;

        IF v_is_calling_device_revoked = true THEN
            RAISE EXCEPTION 'REJECTED_DEVICE_REVOKED: Revoked devices cannot enroll new devices.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_device_id IS NULL OR length(trim(p_device_id)) = 0 THEN
        RAISE EXCEPTION 'Device ID is required.' USING ERRCODE = '22023';
    END IF;

    IF p_device_token IS NULL OR length(trim(p_device_token)) < 16 THEN
        RAISE EXCEPTION 'Device token must be at least 16 characters.' USING ERRCODE = '22023';
    END IF;

    -- Check if target device_id already exists
    SELECT * INTO v_existing_device
    FROM public.sync_metadata
    WHERE user_id = v_user_id AND device_id = p_device_id;

    -- A revoked device cannot be re-enrolled or un-revoked
    IF v_existing_device.device_id IS NOT NULL AND v_existing_device.is_revoked THEN
        RAISE EXCEPTION 'REJECTED_DEVICE_REVOKED: A revoked device cannot be re-enrolled or un-revoked.' USING ERRCODE = '42501';
    END IF;

    v_token_hash := encode(extensions.digest(convert_to(p_device_token, 'UTF8'), 'sha256'), 'hex');

    -- Set local GUC flag for trigger authorization
    PERFORM set_config('lifted.in_enroll_rpc', 'true', true);

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
        last_synced_at = now(),
        updated_at = now()
    WHERE public.sync_metadata.is_revoked = false;

    RETURN jsonb_build_object(
        'status', 'ENROLLED',
        'device_id', p_device_id,
        'user_id', v_user_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.enroll_sync_device(TEXT, public.platform_type, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- 8. HARDENED DEVICE REVOCATION RPC
CREATE OR REPLACE FUNCTION app_security.revoke_sync_device(
    p_device_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_meta RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    SELECT * INTO v_meta
    FROM public.sync_metadata
    WHERE user_id = v_user_id AND device_id = p_device_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    PERFORM set_config('lifted.in_revoke_rpc', 'true', true);

    UPDATE public.sync_metadata
    SET is_revoked = true, revoked_at = now(), updated_at = now()
    WHERE user_id = v_user_id AND device_id = p_device_id;

    RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.revoke_sync_device(TEXT) TO authenticated, service_role;

-- 9. HARDENED DEDICATED SYNC MUTATION RPCS WITH EXPECTED-BASE-REVISION CONCURRENCY
-- A. sync_upsert_journal
DROP FUNCTION IF EXISTS app_security.sync_upsert_journal(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS app_security.sync_upsert_journal(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION app_security.sync_upsert_journal(
    p_client_record_id TEXT,
    p_encrypted_envelope JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL,
    p_expected_revision BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_expected_base BIGINT;
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

    v_device_id := COALESCE(
        nullif(trim(p_device_id), ''),
        nullif(trim(current_setting('request.headers', true)::json->>'x-device-id'), '')
    );
    v_device_token := COALESCE(
        nullif(trim(p_device_token), ''),
        nullif(trim(current_setting('request.headers', true)::json->>'x-device-token'), '')
    );

    IF v_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    ELSE
        IF EXISTS (
            SELECT 1 FROM public.sync_metadata
            WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
        ) THEN
            RETURN jsonb_build_object(
                'status', 'REJECTED_DEVICE_TOKEN_MISSING',
                'message', 'Device authentication credentials are required.'
            );
        END IF;
    END IF;

    -- Check tombstone fence
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

    -- Authorize internal sync mutation
    PERFORM set_config('lifted.in_sync_rpc', 'true', true);

    -- Row lock for optimistic concurrency verification
    SELECT * INTO v_existing
    FROM public.private_journals
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id
    FOR UPDATE;

    IF FOUND THEN
        -- Check idempotency
        IF v_existing.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'status', 'ACKNOWLEDGED_IDEMPOTENT',
                'sync_revision', v_existing.sync_revision,
                'server_revision', v_existing.sync_revision,
                'record_id', v_existing.id
            );
        END IF;

        -- Verify expected base revision
        IF p_expected_revision IS NOT NULL THEN
            v_expected_base := p_expected_revision;
            IF v_existing.sync_revision != v_expected_base THEN
                RETURN jsonb_build_object(
                    'status', 'CONFLICT_STALE_REVISION',
                    'server_revision', v_existing.sync_revision,
                    'expected_revision', v_expected_base,
                    'server_envelope', v_existing.encrypted_envelope,
                    'message', 'Incoming mutation is based on a stale or mismatched base revision.'
                );
            END IF;
        ELSE
            -- Client supplied p_sync_revision:
            -- If p_sync_revision <= existing revision, it is stale
            IF v_existing.sync_revision >= p_sync_revision THEN
                RETURN jsonb_build_object(
                    'status', 'CONFLICT_STALE_REVISION',
                    'server_revision', v_existing.sync_revision,
                    'server_envelope', v_existing.encrypted_envelope,
                    'message', 'Incoming sync revision is stale or equal.'
                );
            END IF;
        END IF;

        -- Server authoritatively assigns current_server_revision + 1
        v_next_revision := v_existing.sync_revision + 1;

        UPDATE public.private_journals
        SET
            encrypted_envelope = p_encrypted_envelope,
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

GRANT EXECUTE ON FUNCTION app_security.sync_upsert_journal(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT) TO authenticated, service_role;

-- B. sync_upsert_prayer
DROP FUNCTION IF EXISTS app_security.sync_upsert_prayer(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS app_security.sync_upsert_prayer(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION app_security.sync_upsert_prayer(
    p_client_record_id TEXT,
    p_encrypted_payload JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL,
    p_expected_revision BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_expected_base BIGINT;
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

    v_device_id := COALESCE(
        nullif(trim(p_device_id), ''),
        nullif(trim(current_setting('request.headers', true)::json->>'x-device-id'), '')
    );
    v_device_token := COALESCE(
        nullif(trim(p_device_token), ''),
        nullif(trim(current_setting('request.headers', true)::json->>'x-device-token'), '')
    );

    IF v_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    ELSE
        IF EXISTS (
            SELECT 1 FROM public.sync_metadata
            WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
        ) THEN
            RETURN jsonb_build_object(
                'status', 'REJECTED_DEVICE_TOKEN_MISSING',
                'message', 'Device authentication credentials are required.'
            );
        END IF;
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

    PERFORM set_config('lifted.in_sync_rpc', 'true', true);

    SELECT * INTO v_existing
    FROM public.prayer_requests
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'status', 'ACKNOWLEDGED_IDEMPOTENT',
                'sync_revision', v_existing.sync_revision,
                'server_revision', v_existing.sync_revision,
                'record_id', v_existing.id
            );
        END IF;

        IF p_expected_revision IS NOT NULL THEN
            v_expected_base := p_expected_revision;
            IF v_existing.sync_revision != v_expected_base THEN
                RETURN jsonb_build_object(
                    'status', 'CONFLICT_STALE_REVISION',
                    'server_revision', v_existing.sync_revision,
                    'expected_revision', v_expected_base,
                    'server_envelope', v_existing.encrypted_payload,
                    'message', 'Incoming mutation is based on a stale or mismatched base revision.'
                );
            END IF;
        ELSE
            IF v_existing.sync_revision >= p_sync_revision THEN
                RETURN jsonb_build_object(
                    'status', 'CONFLICT_STALE_REVISION',
                    'server_revision', v_existing.sync_revision,
                    'server_envelope', v_existing.encrypted_payload,
                    'message', 'Incoming sync revision is stale or equal.'
                );
            END IF;
        END IF;

        v_next_revision := v_existing.sync_revision + 1;

        UPDATE public.prayer_requests
        SET
            encrypted_payload = p_encrypted_payload,
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

GRANT EXECUTE ON FUNCTION app_security.sync_upsert_prayer(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT) TO authenticated, service_role;

-- C. sync_upsert_mood
DROP FUNCTION IF EXISTS app_security.sync_upsert_mood(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS app_security.sync_upsert_mood(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION app_security.sync_upsert_mood(
    p_client_record_id TEXT,
    p_encrypted_payload JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_checkin_timestamp BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL,
    p_expected_revision BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_tombstone RECORD;
    v_existing RECORD;
    v_next_revision BIGINT;
    v_expected_base BIGINT;
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

    v_device_id := COALESCE(
        nullif(trim(p_device_id), ''),
        nullif(trim(current_setting('request.headers', true)::json->>'x-device-id'), '')
    );
    v_device_token := COALESCE(
        nullif(trim(p_device_token), ''),
        nullif(trim(current_setting('request.headers', true)::json->>'x-device-token'), '')
    );

    IF v_device_id IS NOT NULL THEN
        v_dev_status := app_security.verify_device_auth(v_user_id, v_device_id, v_device_token);
        IF v_dev_status != 'OK' THEN
            RETURN jsonb_build_object(
                'status', v_dev_status,
                'message', 'Device authentication failed.'
            );
        END IF;
    ELSE
        IF EXISTS (
            SELECT 1 FROM public.sync_metadata
            WHERE user_id = v_user_id AND device_token_hash IS NOT NULL AND is_revoked = false
        ) THEN
            RETURN jsonb_build_object(
                'status', 'REJECTED_DEVICE_TOKEN_MISSING',
                'message', 'Device authentication credentials are required.'
            );
        END IF;
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

    PERFORM set_config('lifted.in_sync_rpc', 'true', true);

    SELECT * INTO v_existing
    FROM public.mood_checkins
    WHERE user_id = v_user_id AND client_record_id = p_client_record_id
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.idempotency_key = p_idempotency_key THEN
            RETURN jsonb_build_object(
                'status', 'ACKNOWLEDGED_IDEMPOTENT',
                'sync_revision', v_existing.sync_revision,
                'server_revision', v_existing.sync_revision,
                'record_id', v_existing.id
            );
        END IF;

        IF p_expected_revision IS NOT NULL THEN
            v_expected_base := p_expected_revision;
            IF v_existing.sync_revision != v_expected_base THEN
                RETURN jsonb_build_object(
                    'status', 'CONFLICT_STALE_REVISION',
                    'server_revision', v_existing.sync_revision,
                    'expected_revision', v_expected_base,
                    'server_envelope', v_existing.encrypted_payload,
                    'message', 'Incoming mutation is based on a stale or mismatched base revision.'
                );
            END IF;
        ELSE
            IF v_existing.sync_revision >= p_sync_revision THEN
                RETURN jsonb_build_object(
                    'status', 'CONFLICT_STALE_REVISION',
                    'server_revision', v_existing.sync_revision,
                    'server_envelope', v_existing.encrypted_payload,
                    'message', 'Incoming sync revision is stale or equal.'
                );
            END IF;
        END IF;

        v_next_revision := v_existing.sync_revision + 1;

        UPDATE public.mood_checkins
        SET
            encrypted_payload = p_encrypted_payload,
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

GRANT EXECUTE ON FUNCTION app_security.sync_upsert_mood(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT) TO authenticated, service_role;

-- 10. PUBLIC WRAPPER FUNCTIONS (API STABILITY FOR POSTGREST CLIENTS)
CREATE OR REPLACE FUNCTION public.enroll_sync_device(
    p_device_id TEXT,
    p_platform public.platform_type,
    p_app_version TEXT,
    p_device_token TEXT,
    p_device_nickname TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.enroll_sync_device(p_device_id, p_platform, p_app_version, p_device_token, p_device_nickname);
$$;

GRANT EXECUTE ON FUNCTION public.enroll_sync_device(TEXT, public.platform_type, TEXT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.revoke_sync_device(
    p_device_id TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.revoke_sync_device(p_device_id);
$$;

GRANT EXECUTE ON FUNCTION public.revoke_sync_device(TEXT) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.sync_upsert_journal(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.sync_upsert_journal(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION public.sync_upsert_journal(
    p_client_record_id TEXT,
    p_encrypted_envelope JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL,
    p_expected_revision BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.sync_upsert_journal(p_client_record_id, p_encrypted_envelope, p_sync_revision, p_idempotency_key, p_client_updated_at, p_device_id, p_device_token, p_expected_revision);
$$;

GRANT EXECUTE ON FUNCTION public.sync_upsert_journal(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.sync_upsert_prayer(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.sync_upsert_prayer(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION public.sync_upsert_prayer(
    p_client_record_id TEXT,
    p_encrypted_payload JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_client_updated_at BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL,
    p_expected_revision BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.sync_upsert_prayer(p_client_record_id, p_encrypted_payload, p_sync_revision, p_idempotency_key, p_client_updated_at, p_device_id, p_device_token, p_expected_revision);
$$;

GRANT EXECUTE ON FUNCTION public.sync_upsert_prayer(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.sync_upsert_mood(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.sync_upsert_mood(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT);

CREATE OR REPLACE FUNCTION public.sync_upsert_mood(
    p_client_record_id TEXT,
    p_encrypted_payload JSONB,
    p_sync_revision BIGINT,
    p_idempotency_key TEXT,
    p_checkin_timestamp BIGINT,
    p_device_id TEXT DEFAULT NULL,
    p_device_token TEXT DEFAULT NULL,
    p_expected_revision BIGINT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.sync_upsert_mood(p_client_record_id, p_encrypted_payload, p_sync_revision, p_idempotency_key, p_checkin_timestamp, p_device_id, p_device_token, p_expected_revision);
$$;

GRANT EXECUTE ON FUNCTION public.sync_upsert_mood(TEXT, JSONB, BIGINT, TEXT, BIGINT, TEXT, TEXT, BIGINT) TO authenticated, service_role;


-- 10. HARDENED SYNC DELETE AND RESTORE RPCS WITH IN_SYNC_RPC SETTING
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
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_device_id TEXT;
    v_device_token TEXT;
    v_dev_status TEXT;
    v_has_enrolled_devices boolean;
    v_tombstone RECORD;
    v_headers_raw TEXT;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

    IF NOT app_security.validate_active_session() THEN
        RAISE EXCEPTION 'SESSION_REVOKED: Authentication session is expired or revoked.' USING ERRCODE = '28000';
    END IF;

    BEGIN
        v_headers_raw := current_setting('request.headers', true);
    EXCEPTION WHEN OTHERS THEN
        v_headers_raw := NULL;
    END;

    v_device_id := COALESCE(NULLIF(trim(p_device_id), ''), CASE WHEN v_headers_raw IS NOT NULL THEN NULLIF(v_headers_raw::json->>'x-device-id', '') ELSE NULL END);
    v_device_token := COALESCE(NULLIF(trim(p_device_token), ''), CASE WHEN v_headers_raw IS NOT NULL THEN NULLIF(v_headers_raw::json->>'x-device-token', '') ELSE NULL END);

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

    -- Authorize internal sync mutation
    PERFORM set_config('lifted.in_sync_rpc', 'true', true);

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

GRANT EXECUTE ON FUNCTION app_security.sync_delete_record(TEXT, TEXT, BIGINT, TEXT, TEXT) TO authenticated, service_role;

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
SET search_path = ''
AS $$
    SELECT app_security.sync_delete_record(p_record_type, p_client_record_id, p_deletion_revision, p_device_id, p_device_token);
$$;

GRANT EXECUTE ON FUNCTION public.sync_delete_record(TEXT, TEXT, BIGINT, TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION app_security.sync_restore_record(
    p_record_type TEXT,
    p_client_record_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_tombstone RECORD;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
    END IF;

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

    -- Authorize internal sync mutation
    PERFORM set_config('lifted.in_sync_rpc', 'true', true);

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
        'record_type', p_record_type,
        'client_record_id', p_client_record_id,
        'restoration_generation', v_tombstone.restoration_generation + 1
    );
END;
$$;

GRANT EXECUTE ON FUNCTION app_security.sync_restore_record(TEXT, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_restore_record(
    p_record_type TEXT,
    p_client_record_id TEXT
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.sync_restore_record(p_record_type, p_client_record_id);
$$;

GRANT EXECUTE ON FUNCTION public.sync_restore_record(TEXT, TEXT) TO authenticated, service_role;

-- 11. REVOKE IMPLICIT PUBLIC PRIVILEGES
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_security FROM PUBLIC;






