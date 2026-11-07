-- LIFTED Phase 6 pgTAP Test Suite: Testimony Moderation Flow & Anti-Self-Approval
-- File: supabase/tests/database/04_moderation_flow.sql

BEGIN;
SELECT plan(10);

-- Setup users
INSERT INTO auth.users (id, email)
VALUES
    ('55555555-5555-5555-5555-555555555555', 'author@test.lifted.app'),
    ('66666666-6666-6666-6666-666666666666', 'moderator@test.lifted.app');

INSERT INTO public.user_roles (user_id, role)
VALUES ('66666666-6666-6666-6666-666666666666', 'moderator');

-- Test 1: Author submits a valid pending testimony
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';

INSERT INTO public.community_testimonies (
    user_id, author_name, title, testimony_text, category, status
) VALUES (
    '55555555-5555-5555-5555-555555555555',
    'Faithful Seeker',
    'Finding Light in the Darkness',
    'God has truly restored my peace through this daily sanctuary walk. I am grateful.',
    'healing',
    'pending'
);

SELECT results_eq(
    'SELECT title FROM public.community_testimonies WHERE user_id = ''55555555-5555-5555-5555-555555555555''',
    ARRAY['Finding Light in the Darkness'],
    'Author can insert and view their own pending testimony'
);

-- Test 2: Public / Anonymous users cannot view pending testimonies
SET LOCAL ROLE anon;
SELECT is_empty(
    'SELECT * FROM public.community_testimonies WHERE title = ''Finding Light in the Darkness''',
    'Public feed CANNOT view pending unmoderated testimony'
);

-- Test 3: Author cannot self-approve testimony on INSERT
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';

SELECT throws_ok(
    $$INSERT INTO public.community_testimonies (
        user_id, author_name, title, testimony_text, category, status
    ) VALUES (
        '55555555-5555-5555-5555-555555555555',
        'Sneaky User',
        'Self Approved Story',
        'Trying to bypass moderation by directly setting status to approved.',
        'healing',
        'approved'
    )$$,
    'P0001',
    NULL,
    'Users CANNOT insert testimonies with approved status (Trigger & RLS reject)'
);

-- Test 4: Author cannot self-feature testimony on INSERT
SELECT throws_ok(
    $$INSERT INTO public.community_testimonies (
        user_id, author_name, title, testimony_text, category, status, is_featured
    ) VALUES (
        '55555555-5555-5555-5555-555555555555',
        'Sneaky User',
        'Self Featured Story',
        'Trying to feature my own testimony directly upon creation.',
        'healing',
        'pending',
        true
    )$$,
    'P0001',
    NULL,
    'Users CANNOT insert self-featured testimonies'
);

-- Test 5: Author cannot self-approve on UPDATE
SELECT throws_ok(
    $$UPDATE public.community_testimonies
      SET status = 'approved'
      WHERE title = 'Finding Light in the Darkness'$$,
    'P0001',
    NULL,
    'Author CANNOT update status to approved'
);

-- Test 6: Moderator can view pending testimony
SET LOCAL "request.jwt.claim.sub" = '66666666-6666-6666-6666-666666666666';
SELECT results_eq(
    'SELECT title FROM public.community_testimonies WHERE title = ''Finding Light in the Darkness''',
    ARRAY['Finding Light in the Darkness'],
    'Moderator can view pending testimonies for review'
);

-- Test 7: Moderator approves the testimony
UPDATE public.community_testimonies
SET status = 'approved',
    reviewed_by = '66666666-6666-6666-6666-666666666666',
    reviewed_at = now()
WHERE title = 'Finding Light in the Darkness';

SELECT results_eq(
    'SELECT status::text FROM public.community_testimonies WHERE title = ''Finding Light in the Darkness''',
    ARRAY['approved'],
    'Moderator successfully approved testimony'
);

-- Test 8: Public / Anonymous users can now view the approved testimony
SET LOCAL ROLE anon;
SELECT results_eq(
    'SELECT title FROM public.community_testimonies WHERE title = ''Finding Light in the Darkness''',
    ARRAY['Finding Light in the Darkness'],
    'Approved testimony is now visible in the public feed'
);

-- Test 9: Author cannot alter testimony once approved (RLS filter excludes approved rows)
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';

UPDATE public.community_testimonies
SET testimony_text = 'Altered text after approval'
WHERE title = 'Finding Light in the Darkness';

SELECT is_empty(
    'SELECT * FROM public.community_testimonies WHERE testimony_text = ''Altered text after approval''',
    'Author CANNOT mutate testimony once moderated and approved (RLS excludes approved records from UPDATE)'
);

-- Test 10: Author cannot delete testimony once approved
DELETE FROM public.community_testimonies
WHERE title = 'Finding Light in the Darkness';

SELECT results_eq(
    'SELECT title FROM public.community_testimonies WHERE title = ''Finding Light in the Darkness''',
    ARRAY['Finding Light in the Darkness'],
    'Author CANNOT delete approved testimony (archival must go through staff/admin)'
);

SELECT * FROM finish();
ROLLBACK;
