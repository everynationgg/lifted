-- ============================================================================
-- LIFTED — Test Suite 14: Video Storage & Media Security Policies
-- Phase 13: Functional Admin Portal & Curated Video Storage Delivery
-- ============================================================================

BEGIN;
SELECT plan(10);

-- 1. Verify bucket configuration in storage.buckets
SELECT ok(
    EXISTS (
        SELECT 1
        FROM storage.buckets
        WHERE id = 'curated-videos'
          AND public = false
          AND file_size_limit = 52428800
    ),
    '1. Bucket curated-videos exists, is private (public = false), and has 50MB limit'
);

-- 2. Verify allowed MIME types on the bucket
SELECT ok(
    EXISTS (
        SELECT 1
        FROM storage.buckets
        WHERE id = 'curated-videos'
          AND 'video/mp4' = ANY(allowed_mime_types)
          AND 'video/webm' = ANY(allowed_mime_types)
          AND 'video/quicktime' = ANY(allowed_mime_types)
    ),
    '2. Bucket allows video/mp4, video/webm, and video/quicktime MIME types'
);

-- 3. Verify RLS policies exist on storage.objects
SELECT ok(
    EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'curated_videos_insert_editor'
    ),
    '3. Insert policy curated_videos_insert_editor exists on storage.objects'
);

SELECT ok(
    EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'storage'
          AND tablename = 'objects'
          AND policyname = 'curated_videos_select_policy'
    ),
    '4. Select policy curated_videos_select_policy exists on storage.objects'
);

-- Setup test users: one editor, one regular member
INSERT INTO auth.users (id, email) VALUES
    ('77777777-7777-7777-7777-777777777777', 'video.editor@lifted.app'),
    ('66666666-6666-6666-6666-666666666666', 'video.member@lifted.app')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.user_roles (user_id, role) VALUES
    ('77777777-7777-7777-7777-777777777777', 'editor'),
    ('66666666-6666-6666-6666-666666666666', 'member')
ON CONFLICT (user_id, role) DO NOTHING;

-- 5. Editor can insert an object into curated-videos
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '77777777-7777-7777-7777-777777777777';

INSERT INTO storage.objects (id, bucket_id, name, owner)
VALUES (
    '11111111-2222-3333-4444-555555555555',
    'curated-videos',
    'videos/peace-in-the-storm.mp4',
    '77777777-7777-7777-7777-777777777777'
);

SELECT ok(
    EXISTS (
        SELECT 1 FROM storage.objects
        WHERE id = '11111111-2222-3333-4444-555555555555'
    ),
    '5. Authorized editor can upload video objects to curated-videos'
);

-- 6. Regular member CANNOT insert into curated-videos (RLS violation)
SET LOCAL "request.jwt.claim.sub" = '66666666-6666-6666-6666-666666666666';

SELECT throws_ok(
    $$INSERT INTO storage.objects (id, bucket_id, name, owner)
      VALUES (
        '22222222-3333-4444-5555-666666666666',
        'curated-videos',
        'videos/unauthorized.mp4',
        '66666666-6666-6666-6666-666666666666'
      )$$,
    '42501',
    NULL,
    '6. Regular member is strictly blocked from inserting objects into curated-videos'
);

-- 7. Anonymous visitor CANNOT insert into curated-videos
SET LOCAL ROLE anon;
SET LOCAL "request.jwt.claim.sub" = '';

SELECT throws_ok(
    $$INSERT INTO storage.objects (id, bucket_id, name)
      VALUES (
        '33333333-4444-5555-6666-777777777777',
        'curated-videos',
        'videos/anon.mp4'
      )$$,
    '42501',
    NULL,
    '7. Anonymous guest is strictly blocked from inserting objects into curated-videos'
);

-- 8. Anonymous visitor CANNOT view draft video object
SELECT is_empty(
    'SELECT * FROM storage.objects WHERE id = ''11111111-2222-3333-4444-555555555555''',
    '8. Anonymous guest receives 0 rows when attempting to select draft video object'
);

-- 9. Staff member CAN view draft video object
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '77777777-7777-7777-7777-777777777777';

SELECT isnt_empty(
    'SELECT * FROM storage.objects WHERE id = ''11111111-2222-3333-4444-555555555555''',
    '9. Staff editor can select and view draft video object'
);

-- 10. Link video in video_catalog and mark published -> Anonymous visitor CAN now view it
-- Reset to trusted backend context to publish catalog row
RESET ROLE;
SET LOCAL "request.jwt.claim.sub" = '';

INSERT INTO public.video_catalog (
    id, title, description, video_url, category, is_published, content_status, duration_seconds
) VALUES (
    '44444444-5555-6666-7777-888888888888',
    'Peace in the Storm',
    'Curated video on finding calm.',
    'videos/peace-in-the-storm.mp4',
    'peace',
    true,
    'published',
    180
);

SET LOCAL ROLE anon;
SELECT isnt_empty(
    'SELECT * FROM storage.objects WHERE id = ''11111111-2222-3333-4444-555555555555''',
    '10. Anonymous visitor can view published video object once approved & published'
);

SELECT * FROM finish();
ROLLBACK;
