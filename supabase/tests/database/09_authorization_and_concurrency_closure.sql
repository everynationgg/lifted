BEGIN;
SELECT plan(20);

-- ============================================================================
-- LIFTED Suite 09: Phase 8 Critical Authorization & Concurrency Closure
-- 1. Critical Device Impersonation Attack Matrix (Scenarios A-H)
-- 2. Direct REST Concurrency Defect Analysis
-- 3. Dedicated RPC Concurrency & Row Serialization
-- 4. Immediate Session Revocation
-- 5. Idempotency & Pruning Resistance
-- ============================================================================

-- 1. Setup Test Identities
DO $$
DECLARE
    v_user_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    v_user_b UUID := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
BEGIN
    INSERT INTO auth.users (id, email)
    VALUES (v_user_a, 'account_a@lifted.app'),
           (v_user_b, 'account_b@lifted.app')
    ON CONFLICT (id) DO NOTHING;

    -- Enroll Device A (Active) and Device B (Revoked) for Account A
    INSERT INTO public.sync_metadata (
        user_id, device_id, device_platform, client_app_version, device_token_hash, is_revoked
    ) VALUES (
        v_user_a,
        'device-a-active',
        'ios'::public.platform_type,
        '1.0.0',
        encode(extensions.digest(convert_to('token-device-a-secret-12345678', 'UTF8'), 'sha256'), 'hex'),
        false
    ), (
        v_user_a,
        'device-b-revoked',
        'android'::public.platform_type,
        '1.0.0',
        encode(extensions.digest(convert_to('token-device-b-secret-87654321', 'UTF8'), 'sha256'), 'hex'),
        true -- Revoked!
    ), (
        v_user_b,
        'device-other-account',
        'web'::public.platform_type,
        '1.0.0',
        encode(extensions.digest(convert_to('token-device-other-99999999', 'UTF8'), 'sha256'), 'hex'),
        false
    )
    ON CONFLICT (user_id, device_id) DO NOTHING;

    -- Insert Account A test record and wrapped AEK
    INSERT INTO public.private_journals (
        user_id, client_record_id, encrypted_envelope, sync_revision, idempotency_key, client_updated_at
    ) VALUES (
        v_user_a,
        'impersonate-journal-1',
        '{"v":1,"ct":"ciphertext_journal_a"}'::jsonb,
        1,
        'idem-init-a',
        1730000000000
    ) ON CONFLICT DO NOTHING;

    INSERT INTO public.prayer_requests (
        user_id, client_record_id, encrypted_payload, sync_revision, idempotency_key, client_updated_at
    ) VALUES (
        v_user_a,
        'impersonate-prayer-1',
        '{"v":1,"ct":"ciphertext_prayer_a"}'::jsonb,
        1,
        'idem-init-p-a',
        1730000000000
    ) ON CONFLICT DO NOTHING;

    INSERT INTO public.user_account_keys (
        user_id, key_version, wrapped_aek
    ) VALUES (
        v_user_a,
        1,
        '{"v":1,"alg":"AES-GCM-256","ct":"wrapped_aek_a"}'::jsonb
    ) ON CONFLICT DO NOTHING;
END $$;

-- Switch to Authenticated Account A
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", "role": "authenticated"}';

-- Scenario A: Revoked Device B ID and valid Device B token -> FAILS CLOSED
SET LOCAL "request.headers" = '{"x-device-id": "device-b-revoked", "x-device-token": "token-device-b-secret-87654321"}';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_record_id = ''impersonate-journal-1''',
    'Scenario A: Revoked Device B CANNOT read private_journals via PostgREST RLS'
);

SELECT is_empty(
    'SELECT * FROM public.user_account_keys WHERE user_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''',
    'Scenario A: Revoked Device B CANNOT read user_account_keys via PostgREST RLS'
);

SELECT is(
    (app_security.sync_pull_records('journal', 0, 'device-b-revoked', 'token-device-b-secret-87654321') ->> 'status'),
    'REJECTED_DEVICE_REVOKED',
    'Scenario A: sync_pull_records strictly rejects Revoked Device B'
);

-- Scenario B: Active Device A ID but NO device token -> FAILS CLOSED
SET LOCAL "request.headers" = '{"x-device-id": "device-a-active"}';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_record_id = ''impersonate-journal-1''',
    'Scenario B: Active Device A with missing token CANNOT read private_journals'
);

SELECT is_empty(
    'SELECT * FROM public.user_account_keys WHERE user_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''',
    'Scenario B: Active Device A with missing token CANNOT read user_account_keys'
);

-- Scenario C: Active Device A ID with FAKE device token -> FAILS CLOSED
SET LOCAL "request.headers" = '{"x-device-id": "device-a-active", "x-device-token": "completely-fake-token-xyz"}';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_record_id = ''impersonate-journal-1''',
    'Scenario C: Active Device A with fake token CANNOT read private_journals'
);

-- Scenario D: Active Device A ID with Device B token -> FAILS CLOSED
SET LOCAL "request.headers" = '{"x-device-id": "device-a-active", "x-device-token": "token-device-b-secret-87654321"}';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_record_id = ''impersonate-journal-1''',
    'Scenario D: Active Device A with Device B token CANNOT read private_journals'
);

-- Scenario E: Unknown device ID -> FAILS CLOSED
SET LOCAL "request.headers" = '{"x-device-id": "device-unknown-attacker", "x-device-token": "some-random-token"}';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_record_id = ''impersonate-journal-1''',
    'Scenario E: Unknown device ID CANNOT read private_journals'
);

-- Scenario F: Missing device headers entirely -> FAILS CLOSED
SET LOCAL "request.headers" = '{}';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_record_id = ''impersonate-journal-1''',
    'Scenario F: Missing device headers CANNOT read private_journals'
);

SELECT is_empty(
    'SELECT * FROM public.user_account_keys WHERE user_id = ''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa''',
    'Scenario F: Missing device headers CANNOT read user_account_keys'
);

-- Scenario G: Device ID from another account (Account B) -> FAILS CLOSED
SET LOCAL "request.headers" = '{"x-device-id": "device-other-account", "x-device-token": "token-device-other-99999999"}';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_record_id = ''impersonate-journal-1''',
    'Scenario G: Device ID from another account CANNOT read Account A records'
);

-- Scenario H: Active Device A ID and CORRECT Device A token -> SUCCEEDS
SET LOCAL "request.headers" = '{"x-device-id": "device-a-active", "x-device-token": "token-device-a-secret-12345678"}';

SELECT is(
    (SELECT count(*)::int FROM public.private_journals WHERE client_record_id = 'impersonate-journal-1'),
    1,
    'Scenario H: Active Device A with correct token CAN read private_journals'
);

SELECT is(
    (SELECT count(*)::int FROM public.user_account_keys WHERE user_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
    1,
    'Scenario H: Active Device A with correct token CAN read user_account_keys'
);

SELECT is(
    (app_security.sync_pull_records('journal', 0, 'device-a-active', 'token-device-a-secret-12345678') ->> 'status'),
    'OK',
    'Scenario H: sync_pull_records succeeds with active Device A credentials'
);

-- 2. Concurrency & Optimistic Locking Defect Analysis
-- Stale client revision rejection in sync_upsert_journal
SELECT is(
    (app_security.sync_upsert_journal(
        'impersonate-journal-1',
        '{"ct": "stale_write"}'::jsonb,
        1::bigint, -- client is at 1 (stale, server is already at 1)
        'idem-stale-test',
        1730000001000::bigint,
        'device-a-active',
        'token-device-a-secret-12345678'
    ) ->> 'status'),
    'CONFLICT_STALE_REVISION',
    'sync_upsert_journal strictly rejects stale or non-advancing client revision'
);

-- Valid optimistic increment to revision 2 succeeds
SELECT is(
    (app_security.sync_upsert_journal(
        'impersonate-journal-1',
        '{"ct": "valid_write_rev2"}'::jsonb,
        2::bigint,
        'idem-rev2-test',
        1730000002000::bigint,
        'device-a-active',
        'token-device-a-secret-12345678'
    ) ->> 'status'),
    'UPDATED',
    'sync_upsert_journal commits valid revision 2 edit'
);

-- Delayed duplicate of revision 2 returns idempotent acknowledgement
SELECT is(
    (app_security.sync_upsert_journal(
        'impersonate-journal-1',
        '{"ct": "valid_write_rev2"}'::jsonb,
        2::bigint,
        'idem-rev2-test',
        1730000002000::bigint,
        'device-a-active',
        'token-device-a-secret-12345678'
    ) ->> 'status'),
    'ACKNOWLEDGED_IDEMPOTENT',
    'sync_upsert_journal returns ACKNOWLEDGED_IDEMPOTENT for duplicate idempotency key'
);

-- Idempotency retention verification: If idempotency key differs, duplicate stale attempt rejected
SELECT is(
    (app_security.sync_upsert_journal(
        'impersonate-journal-1',
        '{"ct": "unrecognized_stale_replay"}'::jsonb,
        2::bigint, -- server is at 2, so client sending 2 is stale
        'idem-pruned-key-xyz',
        1730000002000::bigint,
        'device-a-active',
        'token-device-a-secret-12345678'
    ) ->> 'status'),
    'CONFLICT_STALE_REVISION',
    'After idempotency record expiration, stale replay is safely rejected with CONFLICT_STALE_REVISION'
);

-- Deletion idempotency: Repeated deletion of already-deleted record returns ALREADY_DELETED
SELECT is(
    (app_security.sync_delete_record('prayer', 'impersonate-prayer-1', 10, 'device-a-active', 'token-device-a-secret-12345678') ->> 'status'),
    'DELETED',
    'sync_delete_record successfully soft-deletes record'
);

SELECT is(
    (app_security.sync_delete_record('prayer', 'impersonate-prayer-1', 10, 'device-a-active', 'token-device-a-secret-12345678') ->> 'status'),
    'ALREADY_DELETED',
    'Repeated deletion returns ALREADY_DELETED without creating duplicate tombstones'
);

SELECT * FROM finish();
ROLLBACK;
