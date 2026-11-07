-- ============================================================================
-- LIFTED pgTAP Test Suite 06: Cross-Device Sync Contracts, AEK Escrow & Deletion Fences
-- File: supabase/tests/database/06_sync_contracts.sql
-- ============================================================================

BEGIN;
SELECT plan(27);

-- 1. Table Existence Checks
SELECT has_table('public', 'user_account_keys', 'user_account_keys table should exist');
SELECT has_table('public', 'user_tombstones', 'user_tombstones table should exist');

-- 2. Column Existence & Type Checks
SELECT has_column('public', 'user_account_keys', 'wrapped_aek', 'user_account_keys should have wrapped_aek column');
SELECT has_column('public', 'user_account_keys', 'key_version', 'user_account_keys should have key_version column');
SELECT has_column('public', 'sync_metadata', 'is_revoked', 'sync_metadata should have is_revoked column');
SELECT has_column('public', 'sync_metadata', 'revoked_at', 'sync_metadata should have revoked_at column');
SELECT has_column('public', 'user_tombstones', 'deletion_revision', 'user_tombstones should have deletion_revision column');

-- 3. Least-Privilege Table Grants: Authenticated cannot UPDATE or DELETE user_tombstones!
SELECT table_privs_are('public', 'user_account_keys', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE'], 'Authenticated has least-privilege on user_account_keys');
SELECT table_privs_are('public', 'user_tombstones', 'authenticated', ARRAY['SELECT', 'INSERT'], 'Authenticated cannot UPDATE or DELETE user_tombstones');

-- 4. Test User Setup
DO $$
DECLARE
    v_user1_id UUID := '11111111-1111-1111-1111-111111111111';
    v_user2_id UUID := '22222222-2222-2222-2222-222222222222';
BEGIN
    INSERT INTO auth.users (id, email)
    VALUES (v_user1_id, 'sync_user1@lifted.app'),
           (v_user2_id, 'sync_user2@lifted.app')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.sync_metadata (user_id, device_id, device_platform, client_app_version, is_revoked)
    VALUES (v_user1_id, 'device-good-1', 'android'::public.platform_type, '1.0.0', false),
           (v_user1_id, 'device-revoked-1', 'ios'::public.platform_type, '1.0.0', true)
    ON CONFLICT (user_id, device_id) DO NOTHING;
END $$;

-- 5. Test RLS Isolation on user_account_keys
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

INSERT INTO public.user_account_keys (user_id, key_version, wrapped_aek)
VALUES ('11111111-1111-1111-1111-111111111111', 1, '{"v": 1, "alg": "AES-GCM-256", "ct": "test_ct"}'::jsonb);

SELECT is(
    (SELECT count(*)::int FROM public.user_account_keys WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    1,
    'User 1 can read their own wrapped AEK'
);

-- User 2 cannot read User 1 AEK
SET LOCAL "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222", "role": "authenticated"}';

SELECT is(
    (SELECT count(*)::int FROM public.user_account_keys WHERE user_id = '11111111-1111-1111-1111-111111111111'),
    0,
    'User 2 cannot read User 1 wrapped AEK'
);

-- 6. Test sync_upsert_journal RPC: Clean Insert
SET LOCAL "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111", "role": "authenticated"}';

SELECT is(
    (app_security.sync_upsert_journal(
        'client-rec-1',
        '{"v": 1, "ct": "envelope_rev1"}'::jsonb,
        1::bigint,
        'idem-key-1',
        1000::bigint,
        'device-good-1'
    ) ->> 'status'),
    'INSERTED',
    'sync_upsert_journal successfully inserts new record'
);

-- 7. Test sync_upsert_journal RPC: Idempotent Replay
SELECT is(
    (app_security.sync_upsert_journal(
        'client-rec-1',
        '{"v": 1, "ct": "envelope_rev1"}'::jsonb,
        1::bigint,
        'idem-key-1',
        1000::bigint,
        'device-good-1'
    ) ->> 'status'),
    'ACKNOWLEDGED_IDEMPOTENT',
    'sync_upsert_journal idempotently acknowledges duplicate request'
);

-- 8. Test sync_upsert_journal RPC: Conflict Stale Revision
SELECT is(
    (app_security.sync_upsert_journal(
        'client-rec-1',
        '{"v": 1, "ct": "envelope_rev0"}'::jsonb,
        0::bigint,
        'idem-key-stale',
        500::bigint,
        'device-good-1'
    ) ->> 'status'),
    'CONFLICT_STALE_REVISION',
    'sync_upsert_journal rejects stale revision with CONFLICT_STALE_REVISION'
);

-- 9. Test Deletion Fence: Record Deletion Tombstone Blocks Stale Updates
INSERT INTO public.user_tombstones (user_id, client_record_id, record_type, deletion_revision, deleted_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'client-rec-1', 'journal', 5::bigint, now());

SELECT is(
    (app_security.sync_upsert_journal(
        'client-rec-1',
        '{"v": 1, "ct": "envelope_rev4"}'::jsonb,
        4::bigint,
        'idem-key-stale-offline',
        2000::bigint,
        'device-good-1'
    ) ->> 'status'),
    'REJECTED_TOMBSTONE',
    'sync_upsert_journal rejects update to tombstoned record with REJECTED_TOMBSTONE'
);

-- 10. Vulnerability Test: Deliberately Future-Dated Client Updates (Year 2099) CANNOT Resurrect
SELECT is(
    (app_security.sync_upsert_journal(
        'client-rec-1',
        '{"v": 1, "ct": "malicious_future_ct"}'::jsonb,
        999999::bigint, -- high revision
        'idem-future-attack',
        4102444800000::bigint, -- Year 2099 Epoch Milliseconds
        'device-good-1'
    ) ->> 'status'),
    'REJECTED_TOMBSTONE',
    'Future-dated client timestamp (Year 2099) CANNOT resurrect deleted record'
);

-- 11. Vulnerability Test: Direct REST INSERT against deleted record rejected by server trigger
SELECT throws_ok(
    $$ INSERT INTO public.private_journals (user_id, client_record_id, encrypted_envelope, sync_revision, client_updated_at)
       VALUES ('11111111-1111-1111-1111-111111111111', 'client-rec-1', '{"v": 1, "ct": "bypass"}'::jsonb, 10, 4102444800000) $$,
    'P0001',
    NULL,
    'Direct REST INSERT against deleted record blocked by enforce_sync_tombstone_fence trigger'
);

-- 12. Vulnerability Test: Direct REST UPDATE against deleted record rejected by server trigger
SELECT throws_ok(
    $$ UPDATE public.private_journals
       SET encrypted_envelope = '{"v": 1, "ct": "bypass_update"}'::jsonb, sync_revision = 9999
       WHERE user_id = '11111111-1111-1111-1111-111111111111' AND client_record_id = 'client-rec-1' $$,
    'P0001',
    NULL,
    'Direct REST UPDATE against deleted record blocked by enforce_sync_tombstone_fence trigger'
);

-- 13. Stale update after 31 days
SELECT is(
    (app_security.sync_upsert_journal('client-rec-1', '{"ct":"offline_31d"}'::jsonb, 2::bigint, 'idem-31d', 1000::bigint, 'device-good-1') ->> 'status'),
    'REJECTED_TOMBSTONE',
    'Tombstone fence blocks 31-day stale device upload'
);

-- 14. Stale update after 90 days
SELECT is(
    (app_security.sync_upsert_journal('client-rec-1', '{"ct":"offline_90d"}'::jsonb, 2::bigint, 'idem-90d', 1000::bigint, 'device-good-1') ->> 'status'),
    'REJECTED_TOMBSTONE',
    'Tombstone fence blocks 90-day stale device upload'
);

-- 15. Stale update after 365 days
SELECT is(
    (app_security.sync_upsert_journal('client-rec-1', '{"ct":"offline_365d"}'::jsonb, 2::bigint, 'idem-365d', 1000::bigint, 'device-good-1') ->> 'status'),
    'REJECTED_TOMBSTONE',
    'Tombstone fence blocks 365-day stale device upload'
);

-- 16. Stale update after 730 days (2 years): Proves durable zero-time expiration
SELECT is(
    (app_security.sync_upsert_journal('client-rec-1', '{"ct":"offline_730d"}'::jsonb, 2::bigint, 'idem-730d', 1000::bigint, 'device-good-1') ->> 'status'),
    'REJECTED_TOMBSTONE',
    'Tombstone fence blocks 730-day (2-year) stale device upload (zero-time expiration)'
);

-- 17. Device Revocation Check: Revoked device cannot sync
SELECT is(
    (app_security.sync_upsert_journal(
        'client-rec-2',
        '{"v": 1, "ct": "from_stolen_device"}'::jsonb,
        1::bigint,
        'idem-revoked',
        1000::bigint,
        'device-revoked-1'
    ) ->> 'status'),
    'REJECTED_DEVICE_REVOKED',
    'Revoked device is strictly blocked from synchronizing records'
);

-- 18. Authenticated user cannot directly UPDATE user_tombstones (Restoration tamper prevention)
SELECT throws_ok(
    $$ UPDATE public.user_tombstones SET is_restored = true WHERE client_record_id = 'client-rec-1' $$,
    '42501', -- permission denied
    NULL,
    'Authenticated user cannot directly UPDATE user_tombstones to bypass deletion fence'
);

-- 19. Authorized Restoration: Explicit sync_restore_record function restores the record
SELECT is(
    (app_security.sync_restore_record('journal', 'client-rec-1') ->> 'status'),
    'RESTORED',
    'Authorized sync_restore_record RPC successfully restores deleted record'
);

-- 20. Restoration Generation incremented
SELECT is(
    (SELECT restoration_generation FROM public.user_tombstones WHERE user_id = '11111111-1111-1111-1111-111111111111' AND client_record_id = 'client-rec-1'),
    1::bigint,
    'Restoration generation is incremented to 1'
);

-- 21. After authorized restoration, record can now be updated
SELECT is(
    (app_security.sync_upsert_journal(
        'client-rec-1',
        '{"v": 1, "ct": "envelope_restored_rev6"}'::jsonb,
        6::bigint,
        'idem-restored-rev6',
        5000::bigint,
        'device-good-1'
    ) ->> 'status'),
    'UPDATED',
    'After authorized restore, sync_upsert_journal accepts new updates'
);

SELECT * FROM finish();
ROLLBACK;
