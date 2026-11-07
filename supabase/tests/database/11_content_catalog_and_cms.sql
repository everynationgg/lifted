-- ============================================================================
-- LIFTED — Test Suite 11: Curated Content Catalog, Editorial CMS & RLS Security
-- Phase 10: Curated Content Catalog, Editorial CMS & Offline-First Content Delivery
-- ============================================================================

BEGIN;
SELECT plan(22);

-- Setup test users with authenticated sessions running as postgres
INSERT INTO auth.users (id, email) VALUES
    ('55555555-5555-5555-5555-555555555555', 'member.test@lifted.app'),
    ('66666666-6666-6666-6666-666666666666', 'editor.test@lifted.app'),
    ('77777777-7777-7777-7777-777777777777', 'publisher.test@lifted.app')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
    ('55555555-5555-5555-5555-555555555555', 'member'),
    ('66666666-6666-6666-6666-666666666666', 'editor'),
    ('77777777-7777-7777-7777-777777777777', 'moderator')
ON CONFLICT (user_id, role) DO NOTHING;

-- Test 1: Public anonymous can read published devotional seed fixtures
SET LOCAL ROLE anon;
SELECT results_eq(
    'SELECT title FROM public.devotional_catalog WHERE is_published = true AND title = ''Morning Mercies in the Valley''',
    ARRAY['Morning Mercies in the Valley'],
    '1. Anonymous visitor can read published devotional fixture'
);

-- Test 2: Public anonymous can read published article seed fixture
SELECT results_eq(
    'SELECT title FROM public.article_catalog WHERE is_published = true AND title = ''Understanding the Vagus Nerve & Christian Grounding''',
    ARRAY['Understanding the Vagus Nerve & Christian Grounding'],
    '2. Anonymous visitor can read published article fixture'
);

-- Test 3: Public anonymous can read published video seed fixture
SELECT results_eq(
    'SELECT title FROM public.video_catalog WHERE is_published = true AND title = ''Breathe in Grace, Exhale the Weight''',
    ARRAY['Breathe in Grace, Exhale the Weight'],
    '3. Anonymous visitor can read published video fixture'
);

-- Test 4: Anonymous visitor receives ZERO rows for draft devotional
SELECT is_empty(
    'SELECT * FROM public.devotional_catalog WHERE title = ''[DRAFT] Walking Through Unanswered Questions''',
    '4. Anonymous visitor receives 0 rows when attempting to select draft devotional'
);

-- Test 5: Anonymous visitor receives ZERO rows for draft article
SELECT is_empty(
    'SELECT * FROM public.article_catalog WHERE title = ''[DRAFT] Complex Grief and Boundary Rebuilding''',
    '5. Anonymous visitor receives 0 rows when attempting to select draft article'
);

-- Test 6: Anonymous visitor receives ZERO rows for draft video
SELECT is_empty(
    'SELECT * FROM public.video_catalog WHERE title = ''[DRAFT] Processing Sudden Loss''',
    '6. Anonymous visitor receives 0 rows when attempting to select draft video'
);

-- Test 7: Regular authenticated member receives ZERO rows for draft devotional
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '55555555-5555-5555-5555-555555555555';
SELECT is_empty(
    'SELECT * FROM public.devotional_catalog WHERE content_status = ''draft''',
    '7. Authenticated member cannot view unpublished drafts'
);

-- Test 8: Regular authenticated member cannot insert drafts directly
SELECT throws_ok(
    $$INSERT INTO public.devotional_catalog (
        title, scripture_reference, scripture_text, reflection, prayer
    ) VALUES (
        'Member Hack', 'Ps 1', 'Text', 'Reflection', 'Prayer'
    )$$,
    '42501',
    NULL,
    '8. Authenticated member CANNOT insert into devotional_catalog'
);

-- Test 9: Regular member cannot call cms_create_draft RPC
SELECT throws_ok(
    $$SELECT public.cms_create_draft('devotional', 'Unauthorized Title', '{"reflection": "bad"}'::jsonb)$$,
    '42501',
    NULL,
    '9. Authenticated member is rejected by cms_create_draft RPC'
);

-- Test 10: Editor can view drafts in devotional_catalog
SET LOCAL "request.jwt.claim.sub" = '66666666-6666-6666-6666-666666666666';
SELECT results_eq(
    'SELECT title FROM public.devotional_catalog WHERE title = ''[DRAFT] Walking Through Unanswered Questions''',
    ARRAY['[DRAFT] Walking Through Unanswered Questions'],
    '10. Authorized editor CAN view unpublished draft devotionals'
);

-- Test 11: Editor creates a draft devotional via cms_create_draft
SELECT lives_ok(
    $$SELECT public.cms_create_draft(
        'devotional',
        'Finding Hope in Darkness',
        '{"scripture_reference": "Romans 15:13", "scripture_text": "May the God of hope fill you with all joy and peace", "reflection": "Hope is an anchor.", "prayer": "Lord, fill my soul with peace."}'::jsonb,
        'dev-hope-darkness'
    )$$,
    '11. Editor can create a structured draft via cms_create_draft'
);

-- Test 12: Editor submits draft for review
SELECT lives_ok(
    $$SELECT public.cms_submit_for_review(
        'devotional',
        (SELECT id FROM public.devotional_catalog WHERE content_id = 'dev-hope-darkness'),
        'Initial theological and pastoral check completed'
    )$$,
    '12. Editor can submit draft for editorial review'
);

-- Test 13: Verify item status is now in_review
SELECT results_eq(
    'SELECT content_status::text FROM public.devotional_catalog WHERE content_id = ''dev-hope-darkness''',
    ARRAY['in_review'],
    '13. Devotional status successfully updated to in_review'
);

-- Test 14: Editor CANNOT self-approve (requires publisher/moderator/admin)
SELECT throws_ok(
    $$SELECT public.cms_approve_content(
        'devotional',
        (SELECT id FROM public.devotional_catalog WHERE content_id = 'dev-hope-darkness'),
        'Self approval attempt'
    )$$,
    '42501',
    NULL,
    '14. Editor CANNOT self-approve content (Publisher authority required)'
);

-- Test 15: Publisher/Moderator approves content
SET LOCAL "request.jwt.claim.sub" = '77777777-7777-7777-7777-777777777777';
SELECT lives_ok(
    $$SELECT public.cms_approve_content(
        'devotional',
        (SELECT id FROM public.devotional_catalog WHERE content_id = 'dev-hope-darkness'),
        'Pastor Michael'
    )$$,
    '15. Publisher/Moderator can approve content in review'
);

-- Test 16: Publisher publishes content
SELECT lives_ok(
    $$SELECT public.cms_publish_content(
        'devotional',
        (SELECT id FROM public.devotional_catalog WHERE content_id = 'dev-hope-darkness')
    )$$,
    '16. Publisher can publish approved content'
);

-- Test 17: Public anonymous visitor can now read the newly published devotional
SET LOCAL ROLE anon;
SELECT results_eq(
    'SELECT title FROM public.devotional_catalog WHERE content_id = ''dev-hope-darkness''',
    ARRAY['Finding Hope in Darkness'],
    '17. Anonymous visitor can now read the newly published devotional'
);

-- Test 18: Publisher unpublishes and archives content
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '77777777-7777-7777-7777-777777777777';
SELECT lives_ok(
    $$SELECT public.cms_unpublish_content(
        'devotional',
        (SELECT id FROM public.devotional_catalog WHERE content_id = 'dev-hope-darkness'),
        'Withdrawn for revision'
    )$$,
    '18. Publisher can unpublish and archive content'
);

-- Test 19: Once archived, anonymous user receives ZERO rows
SET LOCAL ROLE anon;
SELECT is_empty(
    'SELECT * FROM public.devotional_catalog WHERE content_id = ''dev-hope-darkness''',
    '19. Anonymous visitor receives 0 rows for unpublished/archived content'
);

-- Test 20: Editor creates a new revision from archived item
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '66666666-6666-6666-6666-666666666666';
SELECT lives_ok(
    $$SELECT public.cms_create_new_revision(
        'devotional',
        (SELECT id FROM public.devotional_catalog WHERE content_id = 'dev-hope-darkness'),
        'Finding Hope in Darkness (Revised Edition)',
        '{"reflection": "Deeper reflection on lament."}'::jsonb,
        'Updated pastoral guidance on lament'
    )$$,
    '20. Editor can create a new revised draft version'
);

-- Test 21: Verify revision version is bumped to 2 and status reset to draft
SELECT results_eq(
    'SELECT version, content_status::text FROM public.devotional_catalog WHERE content_id = ''dev-hope-darkness''',
    $$VALUES (2, 'draft')$$,
    '21. Revised devotional version incremented to 2 and status reset to draft'
);

-- Test 22: Content revisions audit log records all transitions
SELECT isnt_empty(
    'SELECT * FROM public.content_revisions WHERE content_id = ''dev-hope-darkness''',
    '22. Content revisions table preserves full audit trail of lifecycle transitions'
);

SELECT * FROM finish();
ROLLBACK;
