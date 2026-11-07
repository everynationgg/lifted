-- ============================================================================
-- LIFTED — Test Suite 12: Publication Authorization & Upgrade Compatibility
-- Phase 11: Mandatory Phase 10 Carryover Remediation
-- ============================================================================

BEGIN;
SELECT plan(12);

-- 1. Upgrade Compatibility: Verify 'editor' role exists in public.app_role enum
SELECT ok(
    EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'app_role' AND e.enumlabel = 'editor'
    ),
    '1. Upgrade Compatibility: editor role exists in public.app_role enum'
);

-- Setup test users with authenticated sessions
INSERT INTO auth.users (id, email) VALUES
    ('88888888-8888-8888-8888-888888888888', 'carryover.editor@lifted.app'),
    ('99999999-9999-9999-9999-999999999999', 'carryover.publisher@lifted.app')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
    ('88888888-8888-8888-8888-888888888888', 'editor'),
    ('99999999-9999-9999-9999-999999999999', 'moderator')
ON CONFLICT (user_id, role) DO NOTHING;

-- 2. Verify editor role can be assigned and checked
SELECT ok(
    EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = '88888888-8888-8888-8888-888888888888'
          AND role = 'editor'
    ),
    '2. editor role correctly assigned in public.user_roles'
);

-- Create a draft devotional owned by editor
INSERT INTO public.devotional_catalog (
    id, title, reflection, prayer, scripture_reference, scripture_text,
    day_number, is_published, content_status, content_id, version, created_by
) VALUES (
    'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
    'Carryover Test Draft Devotional',
    'Reflection on honesty and integrity.',
    'Lord keep us faithful.',
    'Proverbs 11:3',
    'The integrity of the upright shall guide them.',
    999,
    false,
    'draft',
    'dev-carryover-test',
    1,
    '88888888-8888-8888-8888-888888888888'
) ON CONFLICT (id) DO NOTHING;

-- 3. Anonymous visitor receives zero rows for this draft
SET LOCAL ROLE anon;
SELECT is_empty(
    'SELECT * FROM public.devotional_catalog WHERE content_id = ''dev-carryover-test''',
    '3. Anonymous visitor cannot read unpublished draft'
);

-- 4. Ordinary editor attempts direct REST update to bypass review by setting is_published = true
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '88888888-8888-8888-8888-888888888888';
SELECT throws_ok(
    $$UPDATE public.devotional_catalog
      SET is_published = true
      WHERE content_id = 'dev-carryover-test'$$,
    '42501',
    NULL,
    '4. Ordinary editor is strictly blocked from setting is_published = true directly'
);

-- 5. Ordinary editor attempts direct approval bypass by setting content_status = 'approved'
SELECT throws_ok(
    $$UPDATE public.devotional_catalog
      SET content_status = 'approved'
      WHERE content_id = 'dev-carryover-test'$$,
    '42501',
    NULL,
    '5. Ordinary editor is strictly blocked from setting content_status = approved directly'
);

-- 6. Ordinary editor attempts direct publication bypass by setting content_status = 'published'
SELECT throws_ok(
    $$UPDATE public.devotional_catalog
      SET content_status = 'published'
      WHERE content_id = 'dev-carryover-test'$$,
    '42501',
    NULL,
    '6. Ordinary editor is strictly blocked from setting content_status = published directly'
);

-- 7. Ordinary editor attempts direct REST insert of already published item
SELECT throws_ok(
    $$INSERT INTO public.devotional_catalog (
        title, reflection, prayer, scripture_reference, scripture_text,
        day_number, is_published, content_status
      ) VALUES (
        'Illegitimate Published Item', 'Reflection', 'Prayer', 'John 1:1', 'In the beginning',
        1000, true, 'published'
      )$$,
    '42501',
    NULL,
    '7. Ordinary editor is strictly blocked from inserting published content directly'
);

-- 8. Ordinary editor attempts direct execution of approval RPC
SELECT throws_ok(
    $$SELECT public.cms_approve_content(
        'devotional',
        'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        'Bypass Reviewer'
    )$$,
    '42501',
    NULL,
    '8. Ordinary editor cannot execute cms_approve_content RPC'
);

-- 9. Ordinary editor can submit draft for review (authorized editor action)
SELECT lives_ok(
    $$SELECT public.cms_submit_for_review(
        'devotional',
        'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        'Ready for publisher review'
    )$$,
    '9. Ordinary editor successfully submits draft for review'
);

-- 10. Publisher (moderator) approves the content
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '99999999-9999-9999-9999-999999999999';
SELECT lives_ok(
    $$SELECT public.cms_approve_content(
        'devotional',
        'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
        'Certified Publisher'
    )$$,
    '10. Publisher successfully approves the submitted content'
);

-- 11. Publisher publishes the content
SELECT lives_ok(
    $$SELECT public.cms_publish_content(
        'devotional',
        'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'
    )$$,
    '11. Publisher successfully publishes the approved content'
);

-- 12. Anonymous user can now read the published item
SET LOCAL ROLE anon;
SELECT results_eq(
    'SELECT title FROM public.devotional_catalog WHERE content_id = ''dev-carryover-test'' AND is_published = true',
    ARRAY['Carryover Test Draft Devotional'],
    '12. Anonymous visitor can now read legitimately published content'
);

SELECT * FROM finish();
ROLLBACK;
