-- ============================================================================
-- LIFTED pgTAP Test Suite 08: Final Gate Integrity, Direct Mutation Hardening,
-- Deletion Prohibition, Revocation Boundary & Session Verification
-- File: supabase/tests/database/08_final_gate_integrity.sql
-- ============================================================================

BEGIN;
SELECT plan(18);

-- 1. Function Existence Checks
SELECT has_function('app_security', 'validate_active_session', 'validate_active_session function should exist');
SELECT has_function('app_security', 'is_request_device_revoked', 'is_request_device_revoked function should exist');
SELECT has_function('app_security', 'prevent_direct_physical_delete', 'prevent_direct_physical_delete function should exist');
SELECT has_function('app_security', 'sync_pull_records', 'sync_pull_records function should exist');

-- 2. Setup Test User & Records
DO $$
DECLARE
    v_u1 UUID := '55555555-5555-5555-5555-555555555555';
BEGIN
    INSERT INTO auth.users (id, email)
    VALUES (v_u1, 'gate_user1@lifted.app')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.sync_metadata (
        user_id, device_id, device_platform, client_app_version,
        device_token_hash, is_revoked, updated_at
    ) VALUES (
        v_u1, 'gate-dev-revoked', 'ios'::public.platform_type, '1.0.0',
        encode(extensions.digest(convert_to('token-revoked-12345678', 'UTF8'), 'sha256'), 'hex'),
        true, now()
    ) ON CONFLICT (user_id, device_id) DO UPDATE SET is_revoked = true;

    INSERT INTO public.user_account_keys (user_id, key_version, wrapped_aek)
    VALUES (v_u1, 1, '{"v": 1, "ct": "wrapped_aek_bytes"}'::jsonb)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.private_journals (
        user_id, client_record_id, encrypted_envelope, sync_revision, client_updated_at
    ) VALUES (
        v_u1, 'gate-journal-1', '{"ct": "ct_1"}'::jsonb, 1, 1730000000000
    ) ON CONFLICT (user_id, client_record_id) DO NOTHING;

    INSERT INTO public.prayer_requests (
        user_id, client_record_id, encrypted_payload, sync_revision, client_updated_at
    ) VALUES (
        v_u1, 'gate-prayer-1', '{"ct": "ct_p1"}'::jsonb, 1, 1730000000000
    ) ON CONFLICT (user_id, client_record_id) DO NOTHING;

    INSERT INTO public.mood_checkins (
        user_id, client_record_id, encrypted_payload, sync_revision, checkin_timestamp
    ) VALUES (
        v_u1, 'gate-mood-1', '{"ct": "ct_m1"}'::jsonb, 1, 1730000000000
    ) ON CONFLICT (user_id, client_record_id) DO NOTHING;
END $$;

-- Switch to Authenticated User
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated"}';

-- 3. Direct Physical DELETE Prohibition (Error 55000: DIRECT_DELETE_PROHIBITED)
SELECT throws_ok(
    $$ DELETE FROM public.private_journals WHERE client_record_id = 'gate-journal-1' $$,
    '55000',
    NULL,
    'Direct physical DELETE on private_journals is strictly prohibited'
);

SELECT throws_ok(
    $$ DELETE FROM public.prayer_requests WHERE client_record_id = 'gate-prayer-1' $$,
    '55000',
    NULL,
    'Direct physical DELETE on prayer_requests is strictly prohibited'
);

SELECT throws_ok(
    $$ DELETE FROM public.mood_checkins WHERE client_record_id = 'gate-mood-1' $$,
    '55000',
    NULL,
    'Direct physical DELETE on mood_checkins is strictly prohibited'
);

-- 4. Direct REST Concurrency & Revision Bypass Protections
-- Equal-revision overwrite attempt is strictly rejected with P0002
SELECT throws_ok(
    $$ UPDATE public.private_journals
       SET sync_revision = 1, encrypted_envelope = '{"ct": "equal_overwrite"}'::jsonb
       WHERE client_record_id = 'gate-journal-1' $$,
    'P0002',
    NULL,
    'Direct UPDATE with equal revision is rejected with CONFLICT_EQUAL_REVISION (P0002)'
);

-- Stale revision update attempt is strictly rejected with P0002
SELECT throws_ok(
    $$ UPDATE public.private_journals
       SET sync_revision = 0, encrypted_envelope = '{"ct": "stale_overwrite"}'::jsonb
       WHERE client_record_id = 'gate-journal-1' $$,
    'P0002',
    NULL,
    'Direct UPDATE with stale revision is rejected with CONFLICT_STALE_REVISION (P0002)'
);

-- Arbitrary revision jump attempt (> current + 1) is strictly rejected with P0002
SELECT throws_ok(
    $$ UPDATE public.private_journals
       SET sync_revision = 999999, encrypted_envelope = '{"ct": "jump_overwrite"}'::jsonb
       WHERE client_record_id = 'gate-journal-1' $$,
    'P0002',
    NULL,
    'Direct UPDATE with arbitrary revision jump is rejected with CONFLICT_ARBITRARY_REVISION (P0002)'
);

-- Monotonic +1 increment succeeds
UPDATE public.private_journals
SET sync_revision = 2, encrypted_envelope = '{"ct": "valid_monotonic_2"}'::jsonb
WHERE client_record_id = 'gate-journal-1';

SELECT is(
    (SELECT sync_revision FROM public.private_journals WHERE client_record_id = 'gate-journal-1'),
    2::bigint,
    'Direct UPDATE with exact monotonic +1 revision succeeds'
);

-- 5. Dedicated Sync RPC: Server-Authoritative Revision Assignment
-- Client passes high revision 50; server authoritatively assigns current + 1 = 3!
SELECT is(
    (app_security.sync_upsert_journal(
        'gate-journal-1',
        '{"ct": "ct_rpc_authoritative"}'::jsonb,
        50::bigint, -- client attempted jump to 50
        'idem-authoritative-1',
        1730000002000::bigint
    ) ->> 'sync_revision')::bigint,
    3::bigint,
    'sync_upsert_journal authoritatively assigns server revision (current + 1 = 3)'
);

SELECT is(
    (SELECT sync_revision FROM public.private_journals WHERE client_record_id = 'gate-journal-1'),
    3::bigint,
    'Database stored revision is authoritatively set to 3'
);

-- 6. Read Boundary: Device Revocation Enforcement via RLS & RPC
-- Set x-device-id header to the revoked device
SET LOCAL "request.headers" = '{"x-device-id": "gate-dev-revoked"}';

SELECT is_empty(
    'SELECT * FROM public.user_account_keys WHERE user_id = ''55555555-5555-5555-5555-555555555555''',
    'Revoked device CANNOT read user_account_keys via PostgREST RLS'
);

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_record_id = ''gate-journal-1''',
    'Revoked device CANNOT read private_journals via PostgREST RLS'
);

SELECT is(
    (app_security.sync_pull_records('journal', 0, 'gate-dev-revoked', 'token-revoked-12345678') ->> 'status'),
    'REJECTED_DEVICE_REVOKED',
    'sync_pull_records RPC strictly rejects revoked device'
);

-- 7. Session Revocation Verification
-- Set a non-existent / revoked session_id in JWT claims
SET LOCAL "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555555555", "role": "authenticated", "session_id": "00000000-0000-0000-0000-000000000000"}';

SELECT is(
    app_security.validate_active_session(),
    false,
    'validate_active_session returns false when session_id does not exist in auth.sessions'
);

SELECT throws_ok(
    $$ SELECT app_security.sync_upsert_journal('gate-journal-1', '{"ct":"test"}'::jsonb, 4::bigint, 'idem-rev-session', 1000) $$,
    '28000',
    NULL,
    'sync_upsert_journal throws SESSION_REVOKED (28000) when active session is invalid or revoked'
);

SELECT * FROM finish();
ROLLBACK;
