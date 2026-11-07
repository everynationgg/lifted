-- LIFTED Phase 6 pgTAP Test Suite: Admin RBAC & Privilege Escalation Prevention
-- File: supabase/tests/database/03_admin_rbac.sql

BEGIN;
SELECT plan(14);

-- Setup test users
INSERT INTO auth.users (id, email)
VALUES
    ('33333333-3333-3333-3333-333333333333', 'member@test.lifted.app'),
    ('44444444-4444-4444-4444-444444444444', 'admin@test.lifted.app');

-- Assign verified admin role directly (simulating backend service-role admin setup)
UPDATE public.user_roles
SET role = 'admin'
WHERE user_id = '44444444-4444-4444-4444-444444444444';

-- Test 1: app_security.is_admin() returns true for verified admin
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT ok(app_security.is_admin(), 'app_security.is_admin() returns true for verified admin user');

-- Test 2: public.check_is_admin() wrapper returns true for verified admin
SELECT ok(public.check_is_admin(), 'public.check_is_admin() returns true for verified admin user');

-- Test 3: app_security.is_admin() returns false for ordinary member
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT ok(NOT app_security.is_admin(), 'app_security.is_admin() returns false for ordinary member');

-- Test 4: Anonymous visitor is denied execution of check_is_admin() (Permission Denied)
SET LOCAL ROLE anon;
SELECT throws_ok(
    $$SELECT public.check_is_admin()$$,
    '42501',
    NULL,
    'Anonymous visitor is denied execution of check_is_admin() wrapper'
);

-- Test 5: Privilege Escalation Attempt: Ordinary member tries to insert admin role for themselves
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';

SELECT throws_ok(
    $$INSERT INTO public.user_roles (user_id, role)
      VALUES ('33333333-3333-3333-3333-333333333333', 'admin')$$,
    '42501',
    NULL,
    'Ordinary user CANNOT grant themselves an admin role (RLS & Grants reject insert)'
);

-- Test 6: Privilege Escalation Attempt: Ordinary member tries to update their role
SELECT throws_ok(
    $$UPDATE public.user_roles SET role = 'admin' WHERE user_id = '33333333-3333-3333-3333-333333333333'$$,
    '42501',
    NULL,
    'Ordinary user CANNOT update user_roles (RLS & Grants reject update)'
);

-- Test 7: Member cannot insert into devotional_catalog
SELECT throws_ok(
    $$INSERT INTO public.devotional_catalog (
        title, scripture_reference, scripture_text, reflection, prayer
    ) VALUES (
        'Hacked Devotional', 'Genesis 1:1', 'In the beginning', 'Reflection', 'Prayer'
    )$$,
    '42501',
    NULL,
    'Ordinary user CANNOT insert records into devotional_catalog'
);

-- Test 8: Member cannot insert into article_catalog
SELECT throws_ok(
    $$INSERT INTO public.article_catalog (
        title, summary, content, category
    ) VALUES (
        'Hacked Article', 'Summary', 'Content', 'general'
    )$$,
    '42501',
    NULL,
    'Ordinary user CANNOT insert records into article_catalog'
);

-- Test 9: Member cannot insert into video_catalog
SELECT throws_ok(
    $$INSERT INTO public.video_catalog (
        title, description, video_url, category
    ) VALUES (
        'Hacked Video', 'Description', 'https://video.com', 'general'
    )$$,
    '42501',
    NULL,
    'Ordinary user CANNOT insert records into video_catalog'
);

-- Test 10: Non-recursive user_roles query succeeds without policy loops
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT results_eq(
    'SELECT role::text FROM public.user_roles WHERE user_id = ''44444444-4444-4444-4444-444444444444''',
    ARRAY['admin'],
    'user_roles query executes cleanly without policy recursion'
);

-- Setup test catalog records using authorized service_role (backend administration path)
SET LOCAL ROLE service_role;
INSERT INTO public.devotional_catalog (
    title, scripture_reference, scripture_text, reflection, prayer, is_published
) VALUES (
    'Peace in the Valley', 'Psalm 23:1', 'The Lord is my shepherd', 'He leads me', 'Comfort me', true
);

INSERT INTO public.devotional_catalog (
    title, scripture_reference, scripture_text, reflection, prayer, is_published
) VALUES (
    'Draft Unpublished', 'Romans 8:28', 'All things work together', 'Draft', 'Draft', false
);

-- Test 11: Anonymous visitor can read published devotional
SET LOCAL ROLE anon;
SELECT results_eq(
    'SELECT title FROM public.devotional_catalog WHERE is_published = true AND title = ''Peace in the Valley''',
    ARRAY['Peace in the Valley'],
    'Anonymous user can view published devotional catalog item'
);

-- Test 12: Anonymous user cannot read unpublished devotional draft
SELECT is_empty(
    'SELECT * FROM public.devotional_catalog WHERE is_published = false AND title = ''Draft Unpublished''',
    'Anonymous user CANNOT view unpublished catalog drafts'
);

-- Test 13: Ordinary member cannot read unpublished devotional draft
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '33333333-3333-3333-3333-333333333333';
SELECT is_empty(
    'SELECT * FROM public.devotional_catalog WHERE is_published = false AND title = ''Draft Unpublished''',
    'Ordinary member CANNOT view unpublished catalog drafts'
);

-- Test 14: Direct client admin INSERT is rejected by table grants (mutations require authorized server-side service_role)
SET LOCAL "request.jwt.claim.sub" = '44444444-4444-4444-4444-444444444444';
SELECT throws_ok(
    $$INSERT INTO public.devotional_catalog (
        title, scripture_reference, scripture_text, reflection, prayer
    ) VALUES (
        'Direct Client Admin Devotional', 'Genesis 1:1', 'Text', 'Reflection', 'Prayer'
    )$$,
    '42501',
    NULL,
    'Direct client admin INSERT is rejected by table grants (mutations require authorized server-side service_role)'
);

SELECT * FROM finish();
ROLLBACK;
