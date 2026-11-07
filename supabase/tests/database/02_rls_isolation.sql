-- LIFTED Phase 6 pgTAP Test Suite: RLS Isolation & Multi-Tenant Boundaries
-- File: supabase/tests/database/02_rls_isolation.sql

BEGIN;
SELECT plan(16);

-- Setup synthetic test users in auth.users
INSERT INTO auth.users (id, email)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'alice@test.lifted.app'),
    ('22222222-2222-2222-2222-222222222222', 'bob@test.lifted.app');

-- Test 1: Alice creates an encrypted journal
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';

INSERT INTO public.private_journals (
    user_id, client_record_id, encrypted_envelope, client_updated_at
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'journal-001',
    '{"v":1,"iv":"test-iv","ciphertext":"encrypted-bytes","tag":"tag","kid":"key-01"}'::jsonb,
    1730419200000
);

SELECT results_eq(
    'SELECT client_record_id FROM public.private_journals WHERE user_id = ''11111111-1111-1111-1111-111111111111''',
    ARRAY['journal-001'],
    'Alice can read her own encrypted journal entry'
);

-- Test 2: Bob cannot read Alice's journal
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE user_id = ''11111111-1111-1111-1111-111111111111''',
    'Bob CANNOT read Alice''s private journal entries'
);

-- Test 3: Bob cannot update Alice's journal
UPDATE public.private_journals
SET client_updated_at = 1730420000000
WHERE user_id = '11111111-1111-1111-1111-111111111111';

SELECT is_empty(
    'SELECT * FROM public.private_journals WHERE client_updated_at = 1730420000000',
    'Bob CANNOT update Alice''s private journal'
);

-- Test 4: Bob cannot delete Alice's journal
DELETE FROM public.private_journals
WHERE user_id = '11111111-1111-1111-1111-111111111111';

SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT results_eq(
    'SELECT client_record_id FROM public.private_journals WHERE user_id = ''11111111-1111-1111-1111-111111111111''',
    ARRAY['journal-001'],
    'Alice''s journal remains intact after Bob''s unauthorized delete attempt'
);

-- Test 5: Forged user_id on INSERT is rejected
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';

SELECT throws_ok(
    $$INSERT INTO public.private_journals (
        user_id, client_record_id, encrypted_envelope, client_updated_at
    ) VALUES (
        '11111111-1111-1111-1111-111111111111',
        'forged-001',
        '{"v":1,"iv":"iv","ciphertext":"data"}'::jsonb,
        1730419200000
    )$$,
    '42501',
    NULL,
    'Bob CANNOT insert private journals with Alice''s user_id'
);

-- Test 6: Mood Check-ins Isolation
INSERT INTO public.mood_checkins (
    user_id, client_record_id, mood_score, selected_emotions, checkin_timestamp
) VALUES (
    '22222222-2222-2222-2222-222222222222',
    'mood-001',
    4,
    ARRAY['peaceful', 'hopeful'],
    1730419200000
);

SELECT results_eq(
    'SELECT client_record_id FROM public.mood_checkins WHERE user_id = ''22222222-2222-2222-2222-222222222222''',
    ARRAY['mood-001'],
    'Bob can read his own mood check-in'
);

SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT is_empty(
    'SELECT * FROM public.mood_checkins WHERE user_id = ''22222222-2222-2222-2222-222222222222''',
    'Alice CANNOT read Bob''s mood check-in'
);

-- Test 7: Prayer Requests Isolation
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
INSERT INTO public.prayer_requests (
    user_id, client_record_id, is_private, encrypted_payload, client_updated_at
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'prayer-001',
    true,
    '{"v":1,"ct":"prayer-data"}'::jsonb,
    1730419200000
);

SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is_empty(
    'SELECT * FROM public.prayer_requests WHERE user_id = ''11111111-1111-1111-1111-111111111111''',
    'Bob CANNOT read Alice''s private prayer requests'
);

-- Test 8: Anonymous user cannot read private journals (Table-level grant denial)
SET LOCAL ROLE anon;
SELECT throws_ok(
    'SELECT * FROM public.private_journals',
    '42501',
    NULL,
    'Anonymous visitors CANNOT read any private journals (Permission Denied)'
);

-- Test 9: Anonymous user cannot read private prayers (Table-level grant denial)
SELECT throws_ok(
    'SELECT * FROM public.prayer_requests',
    '42501',
    NULL,
    'Anonymous visitors CANNOT read any prayer requests (Permission Denied)'
);

-- Test 10: Anonymous user cannot read mood check-ins (Table-level grant denial)
SELECT throws_ok(
    'SELECT * FROM public.mood_checkins',
    '42501',
    NULL,
    'Anonymous visitors CANNOT read any mood check-ins (Permission Denied)'
);

-- Test 11: Anonymous user cannot insert private journals (Table-level grant denial)
SELECT throws_ok(
    $$INSERT INTO public.private_journals (
        user_id, client_record_id, encrypted_envelope, client_updated_at
    ) VALUES (
        '11111111-1111-1111-1111-111111111111',
        'anon-001',
        '{"v":1}'::jsonb,
        1730419200000
    )$$,
    '42501',
    NULL,
    'Anonymous visitors CANNOT insert private journals (Permission Denied)'
);

-- Test 12: Anonymous user cannot read sync_metadata (Table-level grant denial)
SELECT throws_ok(
    'SELECT * FROM public.sync_metadata',
    '42501',
    NULL,
    'Anonymous visitors CANNOT read sync_metadata (Permission Denied)'
);

-- Test 13: Sync Metadata Isolation
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
INSERT INTO public.sync_metadata (
    user_id, device_id, device_platform, client_app_version
) VALUES (
    '11111111-1111-1111-1111-111111111111',
    'device-alice-01',
    'android',
    '1.0.0'
);

SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-222222222222';
SELECT is_empty(
    'SELECT * FROM public.sync_metadata WHERE user_id = ''11111111-1111-1111-1111-111111111111''',
    'Bob CANNOT read Alice''s device metadata'
);

-- Test 14: Profiles Isolation
SELECT is_empty(
    'SELECT * FROM public.profiles WHERE id = ''11111111-1111-1111-1111-111111111111''',
    'Bob CANNOT read Alice''s private profile'
);

-- Test 15: Bob cannot update Alice's profile
UPDATE public.profiles
SET display_name = 'Hacked by Bob'
WHERE id = '11111111-1111-1111-1111-111111111111';

SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-111111111111';
SELECT isnt(
    (SELECT display_name FROM public.profiles WHERE id = '11111111-1111-1111-1111-111111111111'),
    'Hacked by Bob',
    'Alice''s profile was not updated by Bob'
);

SELECT * FROM finish();
ROLLBACK;
