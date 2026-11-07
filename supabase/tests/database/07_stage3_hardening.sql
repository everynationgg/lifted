-- ============================================================================
-- LIFTED pgTAP Test Suite 07: E2EE Metadata Encryption & Full-Sync Hardening
-- File: supabase/tests/database/07_stage3_hardening.sql
-- ============================================================================

BEGIN;
SELECT plan(22);

-- 1. Schema & Column Existence Checks
SELECT has_column('public', 'mood_checkins', 'encrypted_payload', 'mood_checkins table should have encrypted_payload JSONB column');
SELECT has_column('public', 'sync_metadata', 'device_token_hash', 'sync_metadata table should have device_token_hash column');

-- 2. Function Existence Checks
SELECT has_function('app_security', 'enroll_sync_device', 'enroll_sync_device function should exist');
SELECT has_function('app_security', 'verify_device_auth', 'verify_device_auth function should exist');
SELECT has_function('app_security', 'sync_upsert_prayer', 'sync_upsert_prayer function should exist');
SELECT has_function('app_security', 'sync_upsert_mood', 'sync_upsert_mood function should exist');
SELECT has_function('app_security', 'sync_delete_record', 'sync_delete_record function should exist');

-- 3. Test Users Setup
DO $$
DECLARE
    v_u1 UUID := '33333333-3333-3333-3333-333333333333';
    v_u2 UUID := '44444444-4444-4444-4444-444444444444';
BEGIN
    INSERT INTO auth.users (id, email)
    VALUES (v_u1, 'stage3_user1@lifted.app'),
           (v_u2, 'stage3_user2@lifted.app')
    ON CONFLICT (id) DO NOTHING;
END $$;

-- Switch to Authenticated User 1
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333", "role": "authenticated"}';

-- 4. Device Enrollment & Token Hashing
SELECT is(
    (app_security.enroll_sync_device(
        'device-alpha-1',
        'android'::public.platform_type,
        '1.0.0',
        'super-secret-device-token-12345',
        'Alpha Device'
    ) ->> 'status'),
    'ENROLLED',
    'enroll_sync_device returns ENROLLED status'
);

SELECT is(
    (SELECT device_token_hash FROM public.sync_metadata WHERE user_id = '33333333-3333-3333-3333-333333333333' AND device_id = 'device-alpha-1'),
    encode(extensions.digest(convert_to('super-secret-device-token-12345', 'UTF8'), 'sha256'), 'hex'),
    'Device token is stored as SHA-256 digest in sync_metadata'
);

-- 5. Device Authentication Verifications
SELECT is(
    app_security.verify_device_auth('33333333-3333-3333-3333-333333333333', 'device-alpha-1', 'super-secret-device-token-12345'),
    'OK',
    'verify_device_auth succeeds with correct token'
);

SELECT is(
    app_security.verify_device_auth('33333333-3333-3333-3333-333333333333', 'device-alpha-1', NULL),
    'REJECTED_DEVICE_TOKEN_MISSING',
    'verify_device_auth rejects request when device token is missing'
);

SELECT is(
    app_security.verify_device_auth('33333333-3333-3333-3333-333333333333', 'device-alpha-1', 'wrong-spoofed-token-abcde'),
    'REJECTED_DEVICE_UNAUTHORIZED',
    'verify_device_auth rejects request when device token does not match'
);

SELECT is(
    app_security.verify_device_auth('33333333-3333-3333-3333-333333333333', 'device-unknown-99', 'any-token-value-12345'),
    'REJECTED_DEVICE_NOT_ENROLLED',
    'verify_device_auth rejects non-enrolled device'
);

-- 6. Sensitive Metadata Encryption (Mood Check-in: Zero Plaintext in Cloud)
SELECT is(
    (app_security.sync_upsert_mood(
        'mood-rec-s3-1',
        '{"v": 1, "ct": "encrypted_mood_ct_123", "iv": "iv_sample"}'::jsonb,
        1::bigint,
        'idem-mood-1',
        1700000000000::bigint,
        'device-alpha-1',
        'super-secret-device-token-12345'
    ) ->> 'status'),
    'INSERTED',
    'sync_upsert_mood successfully inserts encrypted check-in'
);

SELECT is(
    (SELECT mood_score FROM public.mood_checkins WHERE client_record_id = 'mood-rec-s3-1'),
    NULL,
    'Cloud mood_score is NULL (zero plaintext emotional rating)'
);

SELECT is(
    (SELECT selected_emotions FROM public.mood_checkins WHERE client_record_id = 'mood-rec-s3-1'),
    ARRAY[]::TEXT[],
    'Cloud selected_emotions is empty array (zero plaintext emotional tags)'
);

-- 7. Dedicated Prayer Sync RPC & Concurrency
SELECT is(
    (app_security.sync_upsert_prayer(
        'prayer-rec-s3-1',
        '{"v": 1, "ct": "encrypted_prayer_ct_456", "iv": "iv_prayer"}'::jsonb,
        1::bigint,
        'idem-prayer-1',
        1700000000000::bigint,
        'device-alpha-1',
        'super-secret-device-token-12345'
    ) ->> 'status'),
    'INSERTED',
    'sync_upsert_prayer successfully inserts encrypted prayer'
);

SELECT is(
    (app_security.sync_upsert_prayer(
        'prayer-rec-s3-1',
        '{"v": 1, "ct": "encrypted_prayer_ct_456", "iv": "iv_prayer"}'::jsonb,
        1::bigint,
        'idem-prayer-1',
        1700000000000::bigint,
        'device-alpha-1',
        'super-secret-device-token-12345'
    ) ->> 'status'),
    'ACKNOWLEDGED_IDEMPOTENT',
    'sync_upsert_prayer returns ACKNOWLEDGED_IDEMPOTENT for duplicate idempotency key'
);

SELECT is(
    (app_security.sync_upsert_prayer(
        'prayer-rec-s3-1',
        '{"v": 1, "ct": "stale_prayer_update", "iv": "iv_stale"}'::jsonb,
        1::bigint, -- same revision without match idempotency key = stale
        'idem-prayer-stale-key',
        1700000001000::bigint,
        'device-alpha-1',
        'super-secret-device-token-12345'
    ) ->> 'status'),
    'CONFLICT_STALE_REVISION',
    'sync_upsert_prayer rejects stale revision with CONFLICT_STALE_REVISION'
);

-- 8. Authoritative Sync Delete RPC & Deletion Fence
SELECT is(
    (app_security.sync_delete_record(
        'prayer',
        'prayer-rec-s3-1',
        5::bigint,
        'device-alpha-1',
        'super-secret-device-token-12345'
    ) ->> 'status'),
    'DELETED',
    'sync_delete_record successfully soft-deletes and creates authoritative tombstone'
);

SELECT is(
    (SELECT is_deleted FROM public.prayer_requests WHERE client_record_id = 'prayer-rec-s3-1'),
    true,
    'prayer_requests record is marked is_deleted = true'
);

-- Direct REST UPDATE with strictly stale revision is rejected by trigger
SELECT throws_ok(
    $$ UPDATE public.prayer_requests
       SET sync_revision = 0
       WHERE user_id = '33333333-3333-3333-3333-333333333333' AND client_record_id = 'prayer-rec-s3-1' $$,
    'P0002',
    NULL,
    'Direct REST UPDATE with strictly stale revision rejected with P0002'
);

SELECT * FROM finish();
ROLLBACK;
