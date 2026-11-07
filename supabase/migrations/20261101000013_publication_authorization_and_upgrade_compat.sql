-- ============================================================================
-- LIFTED — Migration 13: Publication Authorization & Upgrade Compatibility
-- Phase 11: Mandatory Phase 10 Carryover Remediation
-- ============================================================================

-- 1. UPGRADE COMPATIBILITY: Ensure 'editor' enum value exists on public.app_role
-- Guarantees existing Phase 9 databases receive the role when applying new migrations.
DO $$ BEGIN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'editor';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. HARDENED SYNCHRONIZATION TRIGGER
-- Prevents unauthorized publication bypass:
-- An ordinary editor MUST NOT be able to bypass review by setting is_published = true
-- or setting content_status = 'approved', 'published', or 'archived'.
CREATE OR REPLACE FUNCTION public.sync_content_status_and_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- Publication Authorization Guard:
    -- Only publishers (admin or moderator) or trusted backend processes (auth.uid() IS NULL)
    -- are authorized to mark content as approved or published, or set is_published = true.
    IF (NEW.is_published = true OR NEW.content_status IN ('approved', 'published')) THEN
        IF auth.uid() IS NOT NULL AND NOT app_security.is_publisher() THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Publisher authority required to approve or publish content.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Directly modifying live published content in-place without resetting to draft requires publisher authority.
    IF TG_OP = 'UPDATE' AND OLD.content_status = 'published' AND NEW.content_status = 'published' THEN
        IF auth.uid() IS NOT NULL AND NOT app_security.is_publisher() THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Cannot directly modify live published content without publisher authority. Create a revision draft.'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Bidirectional synchronization between legacy is_published boolean and content_status enum
    IF NEW.is_published = true AND (NEW.content_status IS NULL OR NEW.content_status = 'draft') THEN
        NEW.content_status := 'published';
    ELSIF NEW.content_status = 'published' THEN
        NEW.is_published := true;
    ELSIF NEW.content_status IS NOT NULL AND NEW.content_status != 'published' THEN
        NEW.is_published := false;
    ELSIF NEW.is_published = false THEN
        IF NEW.content_status = 'published' THEN
            NEW.content_status := 'draft';
        END IF;
    END IF;

    IF NEW.content_status = 'published' AND NEW.published_at IS NULL THEN
        NEW.published_at := pg_catalog.now();
    END IF;

    -- Update timestamp
    NEW.updated_at := pg_catalog.now();

    -- Generate stable content_id if missing
    IF NEW.content_id IS NULL OR trim(NEW.content_id) = '' THEN
        NEW.content_id := NEW.id::text;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_content_status_and_timestamps() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_content_status_and_timestamps() TO authenticated, service_role, postgres;

-- 3. HARDENED ROW LEVEL SECURITY (RLS) POLICIES ON CONTENT CATALOGS

-- Devotionals: Disallow non-publishers from inserting or updating published/approved rows
DROP POLICY IF EXISTS "devotionals_insert_staff" ON public.devotional_catalog;
CREATE POLICY "devotionals_insert_staff"
    ON public.devotional_catalog FOR INSERT
    TO authenticated
    WITH CHECK (
        app_security.is_publisher() OR (
            app_security.is_editor() AND
            content_status IN ('draft', 'in_review') AND
            is_published = false
        )
    );

DROP POLICY IF EXISTS "devotionals_update_staff" ON public.devotional_catalog;
CREATE POLICY "devotionals_update_staff"
    ON public.devotional_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_editor())
    WITH CHECK (
        app_security.is_publisher() OR (
            app_security.is_editor() AND
            content_status IN ('draft', 'in_review') AND
            is_published = false
        )
    );

-- Articles
DROP POLICY IF EXISTS "articles_insert_staff" ON public.article_catalog;
CREATE POLICY "articles_insert_staff"
    ON public.article_catalog FOR INSERT
    TO authenticated
    WITH CHECK (
        app_security.is_publisher() OR (
            app_security.is_editor() AND
            content_status IN ('draft', 'in_review') AND
            is_published = false
        )
    );

DROP POLICY IF EXISTS "articles_update_staff" ON public.article_catalog;
CREATE POLICY "articles_update_staff"
    ON public.article_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_editor())
    WITH CHECK (
        app_security.is_publisher() OR (
            app_security.is_editor() AND
            content_status IN ('draft', 'in_review') AND
            is_published = false
        )
    );

-- Videos
DROP POLICY IF EXISTS "videos_insert_staff" ON public.video_catalog;
CREATE POLICY "videos_insert_staff"
    ON public.video_catalog FOR INSERT
    TO authenticated
    WITH CHECK (
        app_security.is_publisher() OR (
            app_security.is_editor() AND
            content_status IN ('draft', 'in_review') AND
            is_published = false
        )
    );

DROP POLICY IF EXISTS "videos_update_staff" ON public.video_catalog;
CREATE POLICY "videos_update_staff"
    ON public.video_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_editor())
    WITH CHECK (
        app_security.is_publisher() OR (
            app_security.is_editor() AND
            content_status IN ('draft', 'in_review') AND
            is_published = false
        )
    );
