-- ============================================================================
-- LIFTED — Migration 15: CMS Video Storage & Media Security Policies
-- Phase 13: Functional Admin Portal & Curated Video Storage Delivery
-- ============================================================================

-- 1. BUCKET CONFIGURATION: curated-videos
-- Storage bucket for curated video files (MP4, WebM, QuickTime)
-- Max 50MB file size limit to prevent resource exhaustion and ensure mobile bandwidth friendliness.
-- Set to public = false to enforce zero-trust RLS policies on media delivery.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'curated-videos',
    'curated-videos',
    false,
    52428800, -- 50 MB
    ARRAY['video/mp4', 'video/webm', 'video/quicktime']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['video/mp4', 'video/webm', 'video/quicktime'];

-- 2. SAFE EVALUATION OF is_staff() FOR ANONYMOUS GUESTS
-- Grant EXECUTE to anon so RLS policies can evaluate role check without SQLSTATE 42501.
-- For anon, auth.uid() is NULL, so this safely evaluates to false.
GRANT EXECUTE ON FUNCTION app_security.is_staff() TO anon;
GRANT EXECUTE ON FUNCTION app_security.is_editor() TO anon;
GRANT EXECUTE ON FUNCTION app_security.is_publisher() TO anon;

-- 3. STORAGE RLS POLICIES FOR curated-videos

-- INSERT: Authorized editors, moderators, and admins only
DROP POLICY IF EXISTS "curated_videos_insert_editor" ON storage.objects;
CREATE POLICY "curated_videos_insert_editor"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'curated-videos' AND
        app_security.is_editor()
    );

-- UPDATE: Authorized editors, moderators, and admins only
DROP POLICY IF EXISTS "curated_videos_update_editor" ON storage.objects;
CREATE POLICY "curated_videos_update_editor"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'curated-videos' AND
        app_security.is_editor()
    )
    WITH CHECK (
        bucket_id = 'curated-videos' AND
        app_security.is_editor()
    );

-- DELETE: Authorized editors, moderators, and admins only
DROP POLICY IF EXISTS "curated_videos_delete_staff" ON storage.objects;
CREATE POLICY "curated_videos_delete_staff"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'curated-videos' AND
        app_security.is_editor()
    );

-- SELECT: Staff can access any curated video (draft, review, published).
-- Unauthenticated guests and ordinary users can ONLY access files that belong
-- to an active published video in public.video_catalog.
DROP POLICY IF EXISTS "curated_videos_select_policy" ON storage.objects;
CREATE POLICY "curated_videos_select_policy"
    ON storage.objects FOR SELECT
    TO authenticated, anon
    USING (
        bucket_id = 'curated-videos' AND (
            app_security.is_staff()
            OR EXISTS (
                SELECT 1 FROM public.video_catalog
                WHERE content_status = 'published'
                  AND is_published = true
                  AND (
                      video_url LIKE '%' || storage.objects.name || '%'
                      OR thumbnail_url LIKE '%' || storage.objects.name || '%'
                  )
            )
        )
    );
