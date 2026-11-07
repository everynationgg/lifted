BEGIN;
SELECT plan(21);

-- ============================================================================
-- LIFTED Suite 10: Phase 8 Final Blocker Remediation & Direct-Write Closure
-- 1. Direct REST Write Mutation Closure (P0003 & 55000)
-- 2. Fail-Closed Authentication & Session Verification
-- 3. Expected-Base-Revision RPC Optimistic Concurrency with FOR UPDATE Lock
-- 4. Device Metadata & Key Invariants Protection
-- 5. Revoked Device Re-Enrollment Prevention
-- ============================================================================

-- 1. Setup Test Identities
DO $$
DECLARE
    v_user_10 UUID := '10101010-1010-1010-1010-101010101010';
BEGIN
    INSERT INTO auth.users (id, email)
    VALUES (v_user_10, 'suite10_user@lifted.app')
    ON CONFLICT (id) DO NOTHING;

    -- Enrolled active device
    INSERT INTO public.sync_metadata (
        user_id, device_id, device_platform, client_app_version, device_token_hash, is_revoked
    ) VALUES (
        v_user_10,
        'dev-suite10-active',
        'ios'::public.platform_type,
        '1.0.0',
        encode(extensions.digest(convert_to('token-suite10-secret', 'UTF8'), 'sha256'), 'hex'),
        false
    ), (
        v_user_10,
        'dev-suite10-revoked',
        'android'::public.platform_type,
        '1.0.0',
        encode(extensions.digest(convert_to('token-suite10-revoked', 'UTF8'), 'sha256'), 'hex'),
        true
    )
    ON CONFLICT (user_id, device_id) DO NOTHING;
END;
$$;

-- Test 1: Device Auth verification returns OK for correct token
SELECT is(
    app_security.verify_device_auth(
        '10101010-1010-1010-1010-101010101010'::UUID,
        'dev-suite10-active',
        'token-suite10-secret'
    ),
    'OK',
    'Active device with correct token verifies OK'
);

-- Test 2: Device Auth verification fails closed for revoked device
SELECT is(
    app_security.verify_device_auth(
        '10101010-1010-1010-1010-101010101010'::UUID,
        'dev-suite10-revoked',
        'token-suite10-revoked'
    ),
    'REJECTED_DEVICE_REVOKED',
    'Revoked device token verifies as REJECTED_DEVICE_REVOKED'
);

-- Test 3: Device Auth verification fails closed for fake token
SELECT is(
    app_security.verify_device_auth(
        '10101010-1010-1010-1010-101010101010'::UUID,
        'dev-suite10-active',
        'wrong-fake-token'
    ),
    'REJECTED_DEVICE_UNAUTHORIZED',
    'Active device with wrong token verifies as REJECTED_DEVICE_UNAUTHORIZED'
);

-- Test 4: Physical DELETE on private_journals is strictly forbidden (Error 55000)
DO $$
DECLARE
    v_user_10 UUID := '10101010-1010-1010-1010-101010101010';
    v_threw boolean := false;
BEGIN
    INSERT INTO public.private_journals (
        client_record_id, user_id, encrypted_envelope, sync_revision, client_updated_at
    ) VALUES (
        'rec-suite10-del', v_user_10, '{"cipher":"test"}'::jsonb, 1, 1000
    ) ON CONFLICT (user_id, client_record_id) DO NOTHING;

    BEGIN
        DELETE FROM public.private_journals WHERE client_record_id = 'rec-suite10-del';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        v_threw := true;
    END;

    IF NOT v_threw THEN
        RAISE EXCEPTION 'Physical delete did not throw SQLSTATE 55000';
    END IF;
END;
$$;
SELECT pass('Physical DELETE on private_journals raises SQLSTATE 55000');

-- Test 5: Direct REST INSERT simulated with request.headers raises P0003
DO $$
DECLARE
    v_user_10 UUID := '10101010-1010-1010-1010-101010101010';
    v_threw boolean := false;
BEGIN
    PERFORM set_config('request.headers', '{"x-device-id":"dev-suite10-active","x-device-token":"token-suite10-secret"}', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_10, 'role', 'authenticated')::text, true);

    BEGIN
        INSERT INTO public.private_journals (
            client_record_id, user_id, encrypted_envelope, sync_revision, client_updated_at
        ) VALUES (
            'rec-suite10-direct', v_user_10, '{"cipher":"direct"}'::jsonb, 1, 1000
        );
    EXCEPTION WHEN SQLSTATE 'P0003' THEN
        v_threw := true;
    END;

    IF NOT v_threw THEN
        RAISE EXCEPTION 'Direct REST INSERT did not throw SQLSTATE P0003';
    END IF;
END;
$$;
SELECT pass('Direct REST INSERT with request.headers raises SQLSTATE P0003');

-- Test 6: Direct REST UPDATE simulated with request.headers raises P0003
DO $$
DECLARE
    v_user_10 UUID := '10101010-1010-1010-1010-101010101010';
    v_threw boolean := false;
BEGIN
    PERFORM set_config('request.headers', '{"x-device-id":"dev-suite10-active","x-device-token":"token-suite10-secret"}', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_10, 'role', 'authenticated')::text, true);

    BEGIN
        UPDATE public.private_journals
        SET sync_revision = 2
        WHERE client_record_id = 'rec-suite10-del';
    EXCEPTION WHEN SQLSTATE 'P0003' THEN
        v_threw := true;
    END;

    IF NOT v_threw THEN
        RAISE EXCEPTION 'Direct REST UPDATE did not throw SQLSTATE P0003';
    END IF;
END;
$$;
SELECT pass('Direct REST UPDATE with request.headers raises SQLSTATE P0003');

-- Clean up simulated headers
SELECT set_config('request.headers', NULL, true);

-- Test 7: Dedicated RPC sync_upsert_journal inserts revision 1
SELECT is(
    (app_security.sync_upsert_journal(
        'rec-occ-j10',
        '{"v":1,"ct":"occ1"}'::jsonb,
        1,
        'idem-occ-j10-1',
        1000,
        'dev-suite10-active',
        'token-suite10-secret',
        NULL
    )->>'status'),
    'INSERTED',
    'Dedicated RPC sync_upsert_journal inserts initial revision'
);

-- Test 8: Dedicated RPC with expected_revision = 1 updates to revision 2
SELECT is(
    (app_security.sync_upsert_journal(
        'rec-occ-j10',
        '{"v":1,"ct":"occ2"}'::jsonb,
        2,
        'idem-occ-j10-2',
        2000,
        'dev-suite10-active',
        'token-suite10-secret',
        1
    )->>'status'),
    'UPDATED',
    'Dedicated RPC with matching expected_revision updates record'
);

-- Test 9: Dedicated RPC with stale expected_revision = 1 rejects with CONFLICT_STALE_REVISION
SELECT is(
    (app_security.sync_upsert_journal(
        'rec-occ-j10',
        '{"v":1,"ct":"occ-stale"}'::jsonb,
        3,
        'idem-occ-j10-3',
        3000,
        'dev-suite10-active',
        'token-suite10-secret',
        1 -- Stale! Server is now at revision 2
    )->>'status'),
    'CONFLICT_STALE_REVISION',
    'Dedicated RPC rejects stale expected_revision with CONFLICT_STALE_REVISION'
);

-- Test 10: Arbitrary high sync_revision (99999) with stale base revision is rejected
SELECT is(
    (app_security.sync_upsert_journal(
        'rec-occ-j10',
        '{"v":1,"ct":"occ-high"}'::jsonb,
        99999,
        'idem-occ-j10-4',
        4000,
        'dev-suite10-active',
        'token-suite10-secret',
        1 -- Stale base revision!
    )->>'status'),
    'CONFLICT_STALE_REVISION',
    'Arbitrary revision jump with stale base revision is rejected'
);

-- Test 11: Idempotent replay of same idempotency key returns prior ACK
SELECT is(
    (app_security.sync_upsert_journal(
        'rec-occ-j10',
        '{"v":1,"ct":"occ2"}'::jsonb,
        2,
        'idem-occ-j10-2', -- Prior idempotency key
        2000,
        'dev-suite10-active',
        'token-suite10-secret',
        1
    )->>'status'),
    'ACKNOWLEDGED_IDEMPOTENT',
    'Idempotent replay returns ACKNOWLEDGED_IDEMPOTENT without row corruption'
);

-- Test 12: sync_upsert_prayer optimistic concurrency with expected_revision
SELECT is(
    (app_security.sync_upsert_prayer(
        'rec-occ-p10',
        '{"v":1,"ct":"prayer1"}'::jsonb,
        1,
        'idem-occ-p10-1',
        1000,
        'dev-suite10-active',
        'token-suite10-secret',
        NULL
    )->>'status'),
    'INSERTED',
    'sync_upsert_prayer inserts initial revision'
);

SELECT is(
    (app_security.sync_upsert_prayer(
        'rec-occ-p10',
        '{"v":1,"ct":"prayer2"}'::jsonb,
        2,
        'idem-occ-p10-2',
        2000,
        'dev-suite10-active',
        'token-suite10-secret',
        1
    )->>'status'),
    'UPDATED',
    'sync_upsert_prayer updates with matching expected_revision'
);

-- Test 13: sync_upsert_mood optimistic concurrency with expected_revision
SELECT is(
    (app_security.sync_upsert_mood(
        'rec-occ-m10',
        '{"v":1,"ct":"mood1"}'::jsonb,
        1,
        'idem-occ-m10-1',
        1000,
        'dev-suite10-active',
        'token-suite10-secret',
        NULL
    )->>'status'),
    'INSERTED',
    'sync_upsert_mood inserts initial revision'
);

-- Test 14: Direct REST modification of is_revoked is forbidden (Error 42501)
DO $$
DECLARE
    v_threw boolean := false;
BEGIN
    PERFORM set_config('request.headers', '{"x-device-id":"dev-suite10-active","x-device-token":"token-suite10-secret"}', true);
    PERFORM set_config('request.jwt.claims', '{"sub":"10101010-1010-1010-1010-101010101010","role":"authenticated"}', true);

    BEGIN
        UPDATE public.sync_metadata
        SET is_revoked = false
        WHERE device_id = 'dev-suite10-revoked';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_threw := true;
    END;

    IF NOT v_threw THEN
        RAISE EXCEPTION 'Direct update of is_revoked did not throw SQLSTATE 42501';
    END IF;
END;
$$;
SELECT pass('Direct REST update of is_revoked raises SQLSTATE 42501');

-- Test 15: Direct REST modification of device_token_hash is forbidden (Error 42501)
DO $$
DECLARE
    v_threw boolean := false;
BEGIN
    PERFORM set_config('request.headers', '{"x-device-id":"dev-suite10-active","x-device-token":"token-suite10-secret"}', true);
    PERFORM set_config('request.jwt.claims', '{"sub":"10101010-1010-1010-1010-101010101010","role":"authenticated"}', true);

    BEGIN
        UPDATE public.sync_metadata
        SET device_token_hash = 'hacked_hash'
        WHERE device_id = 'dev-suite10-active';
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_threw := true;
    END;

    IF NOT v_threw THEN
        RAISE EXCEPTION 'Direct update of device_token_hash did not throw SQLSTATE 42501';
    END IF;
END;
$$;
SELECT pass('Direct REST update of device_token_hash raises SQLSTATE 42501');

-- Test 16: Direct REST replacement of wrapped_aek on user_account_keys is forbidden (Error 42501)
DO $$
DECLARE
    v_user_10 UUID := '10101010-1010-1010-1010-101010101010';
    v_threw boolean := false;
BEGIN
    INSERT INTO public.user_account_keys (
        user_id, key_version, wrapped_aek
    ) VALUES (
        v_user_10, 1, '{"v": 1, "alg": "AES-GCM-256", "ct": "orig"}'::jsonb
    ) ON CONFLICT (user_id) DO NOTHING;
    PERFORM set_config('request.headers', '{"x-device-id":"dev-suite10-active","x-device-token":"token-suite10-secret"}', true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user_10, 'role', 'authenticated')::text, true);

    BEGIN
        UPDATE public.user_account_keys
        SET wrapped_aek = '{"cipher":"hacked"}'::jsonb
        WHERE user_id = v_user_10;
    EXCEPTION WHEN SQLSTATE '42501' THEN
        v_threw := true;
    END;

    IF NOT v_threw THEN
        RAISE EXCEPTION 'Direct update of wrapped_aek did not throw SQLSTATE 42501';
    END IF;
END;
$$;
SELECT pass('Direct REST update of wrapped_aek raises SQLSTATE 42501');

-- Test 17: enroll_sync_device rejects re-enrolling a revoked device
SELECT set_config('request.headers', NULL, true);
SELECT set_config('request.jwt.claims', '{"sub":"10101010-1010-1010-1010-101010101010","role":"authenticated"}', true);
SELECT throws_matching(
    $$SELECT app_security.enroll_sync_device(
        'dev-suite10-revoked',
        'android'::public.platform_type,
        '1.0.0',
        'token-new-attempt',
        'Attempted Re-enrollment'
    )$$,
    'REJECTED_DEVICE_REVOKED',
    'enroll_sync_device rejects re-enrolling a revoked device'
);

-- Test 18: sync_delete_record marks record is_deleted = true and creates active tombstone
SELECT is(
    (app_security.sync_delete_record(
        'journal',
        'rec-occ-j10',
        10,
        'dev-suite10-active',
        'token-suite10-secret'
    )->>'status'),
    'DELETED',
    'sync_delete_record returns DELETED and creates tombstone'
);

-- Test 19: Tombstone permanently rejects stale updates
SELECT is(
    (app_security.sync_upsert_journal(
        'rec-occ-j10',
        '{"v":1,"ct":"after-delete"}'::jsonb,
        11,
        'idem-occ-j10-5',
        5000,
        'dev-suite10-active',
        'token-suite10-secret',
        2
    )->>'status'),
    'REJECTED_TOMBSTONE',
    'Tombstone permanently rejects update against deleted record'
);

-- Test 20: sync_restore_record resurrects deleted record and increments generation
SELECT is(
    (app_security.sync_restore_record(
        'journal',
        'rec-occ-j10'
    )->>'status'),
    'RESTORED',
    'sync_restore_record resurrects deleted record'
);

SELECT * FROM finish();
ROLLBACK;
