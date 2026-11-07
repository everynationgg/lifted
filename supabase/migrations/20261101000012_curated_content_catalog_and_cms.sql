-- ============================================================================
-- LIFTED — Migration 12: Curated Content Catalog, Editorial CMS & Versioning
-- Phase 10: Curated Content Catalog, Editorial CMS & Offline-First Content Delivery
-- ============================================================================

-- 1. ENUMS & ROLES
DO $$ BEGIN
    CREATE TYPE public.content_status AS ENUM (
        'draft',
        'in_review',
        'approved',
        'published',
        'archived'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add 'editor' role to public.app_role if not present
DO $$ BEGIN
    ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'editor';
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. ADDITIVE CATALOG FIELDS: DEVOTIONAL_CATALOG
ALTER TABLE public.devotional_catalog
    ADD COLUMN IF NOT EXISTS content_status public.content_status NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS content_id TEXT,
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en',
    ADD COLUMN IF NOT EXISTS topics TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS reflection_prompt TEXT,
    ADD COLUMN IF NOT EXISTS reading_time_minutes INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT 'LIFTED Editorial Team',
    ADD COLUMN IF NOT EXISTS author_title TEXT,
    ADD COLUMN IF NOT EXISTS editor_name TEXT,
    ADD COLUMN IF NOT EXISTS reviewer_name TEXT,
    ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_name TEXT NOT NULL DEFAULT 'LIFTED Original',
    ADD COLUMN IF NOT EXISTS copyright_owner TEXT NOT NULL DEFAULT 'Every Nation GG / LIFTED',
    ADD COLUMN IF NOT EXISTS license_type TEXT NOT NULL DEFAULT 'All Rights Reserved',
    ADD COLUMN IF NOT EXISTS attribution_text TEXT,
    ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_devotional_status_published
    ON public.devotional_catalog(content_status, is_published, day_number);

CREATE INDEX IF NOT EXISTS idx_devotional_content_id
    ON public.devotional_catalog(content_id);

-- 3. ADDITIVE CATALOG FIELDS: ARTICLE_CATALOG
ALTER TABLE public.article_catalog
    ADD COLUMN IF NOT EXISTS content_status public.content_status NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS content_id TEXT,
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en',
    ADD COLUMN IF NOT EXISTS subtitle TEXT,
    ADD COLUMN IF NOT EXISTS topics TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS practical_exercise JSONB,
    ADD COLUMN IF NOT EXISTS author_name TEXT NOT NULL DEFAULT 'LIFTED Clinical & Editorial',
    ADD COLUMN IF NOT EXISTS author_credentials TEXT,
    ADD COLUMN IF NOT EXISTS editor_name TEXT,
    ADD COLUMN IF NOT EXISTS reviewer_name TEXT,
    ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_name TEXT NOT NULL DEFAULT 'LIFTED Original',
    ADD COLUMN IF NOT EXISTS copyright_owner TEXT NOT NULL DEFAULT 'Every Nation GG / LIFTED',
    ADD COLUMN IF NOT EXISTS license_type TEXT NOT NULL DEFAULT 'All Rights Reserved',
    ADD COLUMN IF NOT EXISTS attribution_text TEXT,
    ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_article_status_published
    ON public.article_catalog(content_status, is_published, category);

CREATE INDEX IF NOT EXISTS idx_article_content_id
    ON public.article_catalog(content_id);

-- 4. ADDITIVE CATALOG FIELDS: VIDEO_CATALOG
ALTER TABLE public.video_catalog
    ADD COLUMN IF NOT EXISTS content_status public.content_status NOT NULL DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS content_id TEXT,
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en',
    ADD COLUMN IF NOT EXISTS creator TEXT NOT NULL DEFAULT 'Lifted Care',
    ADD COLUMN IF NOT EXISTS scripture_anchor TEXT,
    ADD COLUMN IF NOT EXISTS thumbnail_gradient TEXT,
    ADD COLUMN IF NOT EXISTS topics TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS editor_name TEXT,
    ADD COLUMN IF NOT EXISTS reviewer_name TEXT,
    ADD COLUMN IF NOT EXISTS last_reviewed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_name TEXT NOT NULL DEFAULT 'LIFTED Original',
    ADD COLUMN IF NOT EXISTS copyright_owner TEXT NOT NULL DEFAULT 'Every Nation GG / LIFTED',
    ADD COLUMN IF NOT EXISTS license_type TEXT NOT NULL DEFAULT 'All Rights Reserved',
    ADD COLUMN IF NOT EXISTS attribution_text TEXT,
    ADD COLUMN IF NOT EXISTS license_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id),
    ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_video_status_published
    ON public.video_catalog(content_status, is_published, category);

CREATE INDEX IF NOT EXISTS idx_video_content_id
    ON public.video_catalog(content_id);

-- 5. CONTENT REVISIONS & AUDIT LOG TABLE
CREATE TABLE IF NOT EXISTS public.content_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content_type TEXT NOT NULL CHECK (content_type IN ('devotional', 'article', 'video')),
    item_id UUID NOT NULL,
    content_id TEXT,
    version INTEGER NOT NULL,
    content_status public.content_status NOT NULL,
    content_snapshot JSONB NOT NULL,
    change_summary TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_revisions_lookup
    ON public.content_revisions(content_type, item_id, version DESC);

ALTER TABLE public.content_revisions ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON public.content_revisions TO authenticated, service_role;

-- 6. SECURITY FUNCTIONS & ROLE RESOLUTION
CREATE OR REPLACE FUNCTION app_security.is_editor()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role::text IN ('admin', 'moderator', 'editor')
    );
$$;

CREATE OR REPLACE FUNCTION app_security.is_publisher()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role::text IN ('admin', 'moderator')
    );
$$;

-- Update is_staff to include editor
CREATE OR REPLACE FUNCTION app_security.is_staff()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = auth.uid()
          AND role::text IN ('admin', 'moderator', 'editor')
    );
$$;

REVOKE ALL ON FUNCTION app_security.is_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_security.is_editor() TO authenticated, service_role;

REVOKE ALL ON FUNCTION app_security.is_publisher() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_security.is_publisher() TO authenticated, service_role;

-- Public wrappers (SECURITY INVOKER for safe UI check)
CREATE OR REPLACE FUNCTION public.check_is_editor()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
    SELECT app_security.is_editor();
$$;

CREATE OR REPLACE FUNCTION public.check_is_publisher()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
    SELECT app_security.is_publisher();
$$;

REVOKE ALL ON FUNCTION public.check_is_editor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_is_editor() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_is_publisher() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_is_publisher() TO authenticated, service_role;

-- 7. SYNCHRONIZATION TRIGGER: KEEP is_published IN SYNC WITH content_status
CREATE OR REPLACE FUNCTION public.sync_content_status_and_timestamps()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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
        NEW.published_at := now();
    END IF;

    -- Update timestamp
    NEW.updated_at := now();

    -- Generate stable content_id if missing
    IF NEW.content_id IS NULL OR trim(NEW.content_id) = '' THEN
        NEW.content_id := NEW.id::text;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_content_status_devotional ON public.devotional_catalog;
CREATE TRIGGER trg_sync_content_status_devotional
    BEFORE INSERT OR UPDATE ON public.devotional_catalog
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_content_status_and_timestamps();

DROP TRIGGER IF EXISTS trg_sync_content_status_article ON public.article_catalog;
CREATE TRIGGER trg_sync_content_status_article
    BEFORE INSERT OR UPDATE ON public.article_catalog
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_content_status_and_timestamps();

DROP TRIGGER IF EXISTS trg_sync_content_status_video ON public.video_catalog;
CREATE TRIGGER trg_sync_content_status_video
    BEFORE INSERT OR UPDATE ON public.video_catalog
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_content_status_and_timestamps();

-- 8. REFINED ROW LEVEL SECURITY POLICIES

-- Devotional Catalog
DROP POLICY IF EXISTS "devotionals_select_published" ON public.devotional_catalog;
CREATE POLICY "devotionals_select_published"
    ON public.devotional_catalog FOR SELECT
    USING (content_status = 'published' AND is_published = true);

DROP POLICY IF EXISTS "devotionals_select_staff" ON public.devotional_catalog;
CREATE POLICY "devotionals_select_staff"
    ON public.devotional_catalog FOR SELECT
    TO authenticated
    USING (app_security.is_staff());

DROP POLICY IF EXISTS "devotionals_insert_admin" ON public.devotional_catalog;
DROP POLICY IF EXISTS "devotionals_insert_staff" ON public.devotional_catalog;
CREATE POLICY "devotionals_insert_staff"
    ON public.devotional_catalog FOR INSERT
    TO authenticated
    WITH CHECK (app_security.is_editor());

DROP POLICY IF EXISTS "devotionals_update_admin" ON public.devotional_catalog;
DROP POLICY IF EXISTS "devotionals_update_staff" ON public.devotional_catalog;
CREATE POLICY "devotionals_update_staff"
    ON public.devotional_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_editor())
    WITH CHECK (app_security.is_editor());

DROP POLICY IF EXISTS "devotionals_delete_admin" ON public.devotional_catalog;
CREATE POLICY "devotionals_delete_admin"
    ON public.devotional_catalog FOR DELETE
    TO authenticated
    USING (app_security.is_admin());

-- Article Catalog
DROP POLICY IF EXISTS "articles_select_published" ON public.article_catalog;
CREATE POLICY "articles_select_published"
    ON public.article_catalog FOR SELECT
    USING (content_status = 'published' AND is_published = true);

DROP POLICY IF EXISTS "articles_select_staff" ON public.article_catalog;
CREATE POLICY "articles_select_staff"
    ON public.article_catalog FOR SELECT
    TO authenticated
    USING (app_security.is_staff());

DROP POLICY IF EXISTS "articles_insert_admin" ON public.article_catalog;
DROP POLICY IF EXISTS "articles_insert_staff" ON public.article_catalog;
CREATE POLICY "articles_insert_staff"
    ON public.article_catalog FOR INSERT
    TO authenticated
    WITH CHECK (app_security.is_editor());

DROP POLICY IF EXISTS "articles_update_admin" ON public.article_catalog;
DROP POLICY IF EXISTS "articles_update_staff" ON public.article_catalog;
CREATE POLICY "articles_update_staff"
    ON public.article_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_editor())
    WITH CHECK (app_security.is_editor());

DROP POLICY IF EXISTS "articles_delete_admin" ON public.article_catalog;
CREATE POLICY "articles_delete_admin"
    ON public.article_catalog FOR DELETE
    TO authenticated
    USING (app_security.is_admin());

-- Video Catalog
DROP POLICY IF EXISTS "videos_select_published" ON public.video_catalog;
CREATE POLICY "videos_select_published"
    ON public.video_catalog FOR SELECT
    USING (content_status = 'published' AND is_published = true);

DROP POLICY IF EXISTS "videos_select_staff" ON public.video_catalog;
CREATE POLICY "videos_select_staff"
    ON public.video_catalog FOR SELECT
    TO authenticated
    USING (app_security.is_staff());

DROP POLICY IF EXISTS "videos_insert_admin" ON public.video_catalog;
DROP POLICY IF EXISTS "videos_insert_staff" ON public.video_catalog;
CREATE POLICY "videos_insert_staff"
    ON public.video_catalog FOR INSERT
    TO authenticated
    WITH CHECK (app_security.is_editor());

DROP POLICY IF EXISTS "videos_update_admin" ON public.video_catalog;
DROP POLICY IF EXISTS "videos_update_staff" ON public.video_catalog;
CREATE POLICY "videos_update_staff"
    ON public.video_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_editor())
    WITH CHECK (app_security.is_editor());

DROP POLICY IF EXISTS "videos_delete_admin" ON public.video_catalog;
CREATE POLICY "videos_delete_admin"
    ON public.video_catalog FOR DELETE
    TO authenticated
    USING (app_security.is_admin());

-- Content Revisions Policies
DROP POLICY IF EXISTS "content_revisions_select_staff" ON public.content_revisions;
CREATE POLICY "content_revisions_select_staff"
    ON public.content_revisions FOR SELECT
    TO authenticated
    USING (app_security.is_staff());

DROP POLICY IF EXISTS "content_revisions_insert_staff" ON public.content_revisions;
CREATE POLICY "content_revisions_insert_staff"
    ON public.content_revisions FOR INSERT
    TO authenticated
    WITH CHECK (app_security.is_editor());

-- 9. EDITORIAL CMS WORKFLOW RPCs (SECURITY DEFINER WITH SEARCH PATH '')

-- Helper to record revision snapshot
CREATE OR REPLACE FUNCTION app_security.record_revision(
    p_content_type TEXT,
    p_item_id UUID,
    p_content_id TEXT,
    p_version INTEGER,
    p_status public.content_status,
    p_snapshot JSONB,
    p_change_summary TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.content_revisions (
        content_type,
        item_id,
        content_id,
        version,
        content_status,
        content_snapshot,
        change_summary,
        created_by
    ) VALUES (
        p_content_type,
        p_item_id,
        p_content_id,
        p_version,
        p_status,
        p_snapshot,
        p_change_summary,
        auth.uid()
    );
END;
$$;

-- Create Draft RPC
CREATE OR REPLACE FUNCTION app_security.cms_create_draft(
    p_content_type TEXT,
    p_title TEXT,
    p_payload JSONB,
    p_content_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_id UUID;
    v_content_id TEXT;
    v_snapshot JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL OR NOT app_security.is_editor() THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Editor authority required to create drafts.' USING ERRCODE = '42501';
    END IF;

    IF p_title IS NULL OR length(trim(p_title)) < 2 THEN
        RAISE EXCEPTION 'VALIDATION_ERROR: Title must be at least 2 characters.' USING ERRCODE = '22023';
    END IF;

    v_content_id := COALESCE(nullif(trim(p_content_id), ''), gen_random_uuid()::text);

    IF p_content_type = 'devotional' THEN
        INSERT INTO public.devotional_catalog (
            title,
            scripture_reference,
            scripture_text,
            reflection,
            prayer,
            reflection_prompt,
            day_number,
            category,
            audio_url,
            content_status,
            content_id,
            version,
            language,
            topics,
            tags,
            author_name,
            source_name,
            copyright_owner,
            license_type,
            created_by,
            updated_by
        ) VALUES (
            trim(p_title),
            COALESCE(p_payload->>'scripture_reference', 'Psalm 23:1'),
            COALESCE(p_payload->>'scripture_text', 'The LORD is my shepherd; I shall not lack.'),
            COALESCE(p_payload->>'reflection', 'Rest in God''s gentle guidance today.'),
            COALESCE(p_payload->>'prayer', 'Lord, lead my heart in peace. Amen.'),
            p_payload->>'reflection_prompt',
            (p_payload->>'day_number')::integer,
            COALESCE(p_payload->>'category', 'daily'),
            p_payload->>'audio_url',
            'draft'::public.content_status,
            v_content_id,
            1,
            COALESCE(p_payload->>'language', 'en'),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'topics')), '{}'),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'tags')), '{}'),
            COALESCE(p_payload->>'author_name', 'LIFTED Editorial Team'),
            COALESCE(p_payload->>'source_name', 'LIFTED Original'),
            COALESCE(p_payload->>'copyright_owner', 'Every Nation GG / LIFTED'),
            COALESCE(p_payload->>'license_type', 'All Rights Reserved'),
            v_user_id,
            v_user_id
        ) RETURNING id INTO v_id;

    ELSIF p_content_type = 'article' THEN
        INSERT INTO public.article_catalog (
            title,
            subtitle,
            summary,
            content,
            category,
            read_time_minutes,
            practical_exercise,
            content_status,
            content_id,
            version,
            language,
            topics,
            tags,
            author_name,
            author_credentials,
            source_name,
            copyright_owner,
            license_type,
            created_by,
            updated_by
        ) VALUES (
            trim(p_title),
            p_payload->>'subtitle',
            COALESCE(p_payload->>'summary', 'Evidence-based emotional reflection.'),
            COALESCE(p_payload->>'content', 'Take a gentle breath and center your nervous system.'),
            COALESCE(p_payload->>'category', 'wellness'),
            COALESCE((p_payload->>'read_time_minutes')::integer, 3),
            p_payload->'practical_exercise',
            'draft'::public.content_status,
            v_content_id,
            1,
            COALESCE(p_payload->>'language', 'en'),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'topics')), '{}'),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'tags')), '{}'),
            COALESCE(p_payload->>'author_name', 'LIFTED Clinical & Editorial'),
            p_payload->>'author_credentials',
            COALESCE(p_payload->>'source_name', 'LIFTED Original'),
            COALESCE(p_payload->>'copyright_owner', 'Every Nation GG / LIFTED'),
            COALESCE(p_payload->>'license_type', 'All Rights Reserved'),
            v_user_id,
            v_user_id
        ) RETURNING id INTO v_id;

    ELSIF p_content_type = 'video' THEN
        INSERT INTO public.video_catalog (
            title,
            description,
            video_url,
            thumbnail_url,
            thumbnail_gradient,
            duration_seconds,
            category,
            creator,
            scripture_anchor,
            content_status,
            content_id,
            version,
            language,
            topics,
            tags,
            source_name,
            copyright_owner,
            license_type,
            created_by,
            updated_by
        ) VALUES (
            trim(p_title),
            COALESCE(p_payload->>'description', 'Encouraging video message.'),
            COALESCE(p_payload->>'video_url', 'https://lifted.example.org/videos/sample'),
            p_payload->>'thumbnail_url',
            p_payload->>'thumbnail_gradient',
            COALESCE((p_payload->>'duration_seconds')::integer, 60),
            COALESCE(p_payload->>'category', 'wellness'),
            COALESCE(p_payload->>'creator', 'Lifted Care'),
            p_payload->>'scripture_anchor',
            'draft'::public.content_status,
            v_content_id,
            1,
            COALESCE(p_payload->>'language', 'en'),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'topics')), '{}'),
            COALESCE(ARRAY(SELECT jsonb_array_elements_text(p_payload->'tags')), '{}'),
            COALESCE(p_payload->>'source_name', 'LIFTED Original'),
            COALESCE(p_payload->>'copyright_owner', 'Every Nation GG / LIFTED'),
            COALESCE(p_payload->>'license_type', 'All Rights Reserved'),
            v_user_id,
            v_user_id
        ) RETURNING id INTO v_id;
    ELSE
        RAISE EXCEPTION 'VALIDATION_ERROR: Unknown content type: %', p_content_type USING ERRCODE = '22023';
    END IF;

    -- Record initial draft revision
    v_snapshot := jsonb_build_object('title', p_title, 'payload', p_payload);
    PERFORM app_security.record_revision(
        p_content_type,
        v_id,
        v_content_id,
        1,
        'draft'::public.content_status,
        v_snapshot,
        'Initial draft creation'
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', v_id,
        'content_id', v_content_id,
        'content_type', p_content_type,
        'status', 'draft',
        'version', 1
    );
END;
$$;

-- Submit for Review RPC
CREATE OR REPLACE FUNCTION app_security.cms_submit_for_review(
    p_content_type TEXT,
    p_id UUID,
    p_change_summary TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_content_id TEXT;
    v_version INTEGER;
    v_snapshot JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL OR NOT app_security.is_editor() THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Editor authority required to submit for review.' USING ERRCODE = '42501';
    END IF;

    IF p_content_type = 'devotional' THEN
        UPDATE public.devotional_catalog
        SET content_status = 'in_review',
            updated_by = v_user_id
        WHERE id = p_id AND content_status = 'draft'
        RETURNING content_id, version, to_jsonb(devotional_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSIF p_content_type = 'article' THEN
        UPDATE public.article_catalog
        SET content_status = 'in_review',
            updated_by = v_user_id
        WHERE id = p_id AND content_status = 'draft'
        RETURNING content_id, version, to_jsonb(article_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSIF p_content_type = 'video' THEN
        UPDATE public.video_catalog
        SET content_status = 'in_review',
            updated_by = v_user_id
        WHERE id = p_id AND content_status = 'draft'
        RETURNING content_id, version, to_jsonb(video_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSE
        RAISE EXCEPTION 'VALIDATION_ERROR: Unknown content type: %', p_content_type USING ERRCODE = '22023';
    END IF;

    IF v_content_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND_OR_INVALID_STATE: Item not found or not in draft status.' USING ERRCODE = '22023';
    END IF;

    PERFORM app_security.record_revision(
        p_content_type,
        p_id,
        v_content_id,
        v_version,
        'in_review'::public.content_status,
        v_snapshot,
        COALESCE(p_change_summary, 'Submitted for editorial review')
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', p_id,
        'status', 'in_review',
        'version', v_version
    );
END;
$$;

-- Approve Content RPC
CREATE OR REPLACE FUNCTION app_security.cms_approve_content(
    p_content_type TEXT,
    p_id UUID,
    p_reviewer_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_content_id TEXT;
    v_version INTEGER;
    v_snapshot JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL OR NOT app_security.is_publisher() THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Publisher/Moderator authority required to approve content.' USING ERRCODE = '42501';
    END IF;

    IF p_content_type = 'devotional' THEN
        UPDATE public.devotional_catalog
        SET content_status = 'approved',
            approved_by = v_user_id,
            approved_at = now(),
            reviewer_name = COALESCE(nullif(trim(p_reviewer_name), ''), 'Senior Editorial Reviewer'),
            last_reviewed_at = now(),
            updated_by = v_user_id
        WHERE id = p_id AND content_status IN ('draft', 'in_review')
        RETURNING content_id, version, to_jsonb(devotional_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSIF p_content_type = 'article' THEN
        UPDATE public.article_catalog
        SET content_status = 'approved',
            approved_by = v_user_id,
            approved_at = now(),
            reviewer_name = COALESCE(nullif(trim(p_reviewer_name), ''), 'Clinical Reviewer'),
            last_reviewed_at = now(),
            updated_by = v_user_id
        WHERE id = p_id AND content_status IN ('draft', 'in_review')
        RETURNING content_id, version, to_jsonb(article_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSIF p_content_type = 'video' THEN
        UPDATE public.video_catalog
        SET content_status = 'approved',
            approved_by = v_user_id,
            approved_at = now(),
            reviewer_name = COALESCE(nullif(trim(p_reviewer_name), ''), 'Media Reviewer'),
            last_reviewed_at = now(),
            updated_by = v_user_id
        WHERE id = p_id AND content_status IN ('draft', 'in_review')
        RETURNING content_id, version, to_jsonb(video_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSE
        RAISE EXCEPTION 'VALIDATION_ERROR: Unknown content type: %', p_content_type USING ERRCODE = '22023';
    END IF;

    IF v_content_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND_OR_INVALID_STATE: Item not found or not in draft/in_review status.' USING ERRCODE = '22023';
    END IF;

    PERFORM app_security.record_revision(
        p_content_type,
        p_id,
        v_content_id,
        v_version,
        'approved'::public.content_status,
        v_snapshot,
        'Editorial approval granted'
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', p_id,
        'status', 'approved',
        'version', v_version
    );
END;
$$;

-- Publish Content RPC
CREATE OR REPLACE FUNCTION app_security.cms_publish_content(
    p_content_type TEXT,
    p_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_content_id TEXT;
    v_version INTEGER;
    v_snapshot JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL OR NOT app_security.is_publisher() THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Publisher authority required to publish content.' USING ERRCODE = '42501';
    END IF;

    IF p_content_type = 'devotional' THEN
        UPDATE public.devotional_catalog
        SET content_status = 'published',
            is_published = true,
            published_at = COALESCE(published_at, now()),
            updated_by = v_user_id
        WHERE id = p_id AND content_status IN ('approved', 'in_review', 'draft')
        RETURNING content_id, version, to_jsonb(devotional_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSIF p_content_type = 'article' THEN
        UPDATE public.article_catalog
        SET content_status = 'published',
            is_published = true,
            published_at = COALESCE(published_at, now()),
            updated_by = v_user_id
        WHERE id = p_id AND content_status IN ('approved', 'in_review', 'draft')
        RETURNING content_id, version, to_jsonb(article_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSIF p_content_type = 'video' THEN
        UPDATE public.video_catalog
        SET content_status = 'published',
            is_published = true,
            published_at = COALESCE(published_at, now()),
            updated_by = v_user_id
        WHERE id = p_id AND content_status IN ('approved', 'in_review', 'draft')
        RETURNING content_id, version, to_jsonb(video_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSE
        RAISE EXCEPTION 'VALIDATION_ERROR: Unknown content type: %', p_content_type USING ERRCODE = '22023';
    END IF;

    IF v_content_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND_OR_INVALID_STATE: Item not found.' USING ERRCODE = '22023';
    END IF;

    PERFORM app_security.record_revision(
        p_content_type,
        p_id,
        v_content_id,
        v_version,
        'published'::public.content_status,
        v_snapshot,
        'Content published to public catalog'
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', p_id,
        'status', 'published',
        'version', v_version
    );
END;
$$;

-- Unpublish / Archive Content RPC
CREATE OR REPLACE FUNCTION app_security.cms_unpublish_content(
    p_content_type TEXT,
    p_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_content_id TEXT;
    v_version INTEGER;
    v_snapshot JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL OR NOT app_security.is_publisher() THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Publisher authority required to unpublish content.' USING ERRCODE = '42501';
    END IF;

    IF p_content_type = 'devotional' THEN
        UPDATE public.devotional_catalog
        SET content_status = 'archived',
            is_published = false,
            updated_by = v_user_id
        WHERE id = p_id
        RETURNING content_id, version, to_jsonb(devotional_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSIF p_content_type = 'article' THEN
        UPDATE public.article_catalog
        SET content_status = 'archived',
            is_published = false,
            updated_by = v_user_id
        WHERE id = p_id
        RETURNING content_id, version, to_jsonb(article_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSIF p_content_type = 'video' THEN
        UPDATE public.video_catalog
        SET content_status = 'archived',
            is_published = false,
            updated_by = v_user_id
        WHERE id = p_id
        RETURNING content_id, version, to_jsonb(video_catalog.*)
        INTO v_content_id, v_version, v_snapshot;
    ELSE
        RAISE EXCEPTION 'VALIDATION_ERROR: Unknown content type: %', p_content_type USING ERRCODE = '22023';
    END IF;

    IF v_content_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Item not found.' USING ERRCODE = '22023';
    END IF;

    PERFORM app_security.record_revision(
        p_content_type,
        p_id,
        v_content_id,
        v_version,
        'archived'::public.content_status,
        v_snapshot,
        COALESCE(p_reason, 'Content unpublished and archived')
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', p_id,
        'status', 'archived',
        'version', v_version
    );
END;
$$;

-- Create New Revision RPC (Creates a new revision of published content)
CREATE OR REPLACE FUNCTION app_security.cms_create_new_revision(
    p_content_type TEXT,
    p_id UUID,
    p_new_title TEXT,
    p_payload JSONB,
    p_change_summary TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID;
    v_content_id TEXT;
    v_new_version INTEGER;
    v_snapshot JSONB;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL OR NOT app_security.is_editor() THEN
        RAISE EXCEPTION 'PERMISSION_DENIED: Editor authority required to create revisions.' USING ERRCODE = '42501';
    END IF;

    IF p_content_type = 'devotional' THEN
        UPDATE public.devotional_catalog
        SET title = COALESCE(nullif(trim(p_new_title), ''), title),
            reflection = COALESCE(p_payload->>'reflection', reflection),
            prayer = COALESCE(p_payload->>'prayer', prayer),
            scripture_reference = COALESCE(p_payload->>'scripture_reference', scripture_reference),
            scripture_text = COALESCE(p_payload->>'scripture_text', scripture_text),
            reflection_prompt = COALESCE(p_payload->>'reflection_prompt', reflection_prompt),
            audio_url = COALESCE(p_payload->>'audio_url', audio_url),
            version = version + 1,
            content_status = 'draft'::public.content_status,
            is_published = false,
            updated_by = v_user_id
        WHERE id = p_id
        RETURNING content_id, version, to_jsonb(devotional_catalog.*)
        INTO v_content_id, v_new_version, v_snapshot;

    ELSIF p_content_type = 'article' THEN
        UPDATE public.article_catalog
        SET title = COALESCE(nullif(trim(p_new_title), ''), title),
            subtitle = COALESCE(p_payload->>'subtitle', subtitle),
            summary = COALESCE(p_payload->>'summary', summary),
            content = COALESCE(p_payload->>'content', content),
            practical_exercise = COALESCE(p_payload->'practical_exercise', practical_exercise),
            version = version + 1,
            content_status = 'draft'::public.content_status,
            is_published = false,
            updated_by = v_user_id
        WHERE id = p_id
        RETURNING content_id, version, to_jsonb(article_catalog.*)
        INTO v_content_id, v_new_version, v_snapshot;

    ELSIF p_content_type = 'video' THEN
        UPDATE public.video_catalog
        SET title = COALESCE(nullif(trim(p_new_title), ''), title),
            description = COALESCE(p_payload->>'description', description),
            video_url = COALESCE(p_payload->>'video_url', video_url),
            thumbnail_url = COALESCE(p_payload->>'thumbnail_url', thumbnail_url),
            duration_seconds = COALESCE((p_payload->>'duration_seconds')::integer, duration_seconds),
            version = version + 1,
            content_status = 'draft'::public.content_status,
            is_published = false,
            updated_by = v_user_id
        WHERE id = p_id
        RETURNING content_id, version, to_jsonb(video_catalog.*)
        INTO v_content_id, v_new_version, v_snapshot;
    ELSE
        RAISE EXCEPTION 'VALIDATION_ERROR: Unknown content type: %', p_content_type USING ERRCODE = '22023';
    END IF;

    IF v_content_id IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND: Item not found.' USING ERRCODE = '22023';
    END IF;

    PERFORM app_security.record_revision(
        p_content_type,
        p_id,
        v_content_id,
        v_new_version,
        'draft'::public.content_status,
        v_snapshot,
        COALESCE(p_change_summary, 'Created revised draft version')
    );

    RETURN jsonb_build_object(
        'success', true,
        'id', p_id,
        'content_id', v_content_id,
        'status', 'draft',
        'version', v_new_version
    );
END;
$$;

-- Grant EXECUTE to authenticated and service_role
GRANT EXECUTE ON FUNCTION app_security.cms_create_draft(TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.cms_submit_for_review(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.cms_approve_content(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.cms_publish_content(TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.cms_unpublish_content(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.cms_create_new_revision(TEXT, UUID, TEXT, JSONB, TEXT) TO authenticated, service_role;

-- Public schema wrappers for PostgREST RPC access
CREATE OR REPLACE FUNCTION public.cms_create_draft(
    content_type TEXT,
    title TEXT,
    payload JSONB,
    content_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.cms_create_draft(content_type, title, payload, content_id);
$$;

CREATE OR REPLACE FUNCTION public.cms_submit_for_review(
    content_type TEXT,
    id UUID,
    change_summary TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.cms_submit_for_review(content_type, id, change_summary);
$$;

CREATE OR REPLACE FUNCTION public.cms_approve_content(
    content_type TEXT,
    id UUID,
    reviewer_name TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.cms_approve_content(content_type, id, reviewer_name);
$$;

CREATE OR REPLACE FUNCTION public.cms_publish_content(
    content_type TEXT,
    id UUID
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.cms_publish_content(content_type, id);
$$;

CREATE OR REPLACE FUNCTION public.cms_unpublish_content(
    content_type TEXT,
    id UUID,
    reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.cms_unpublish_content(content_type, id, reason);
$$;

CREATE OR REPLACE FUNCTION public.cms_create_new_revision(
    content_type TEXT,
    id UUID,
    new_title TEXT,
    payload JSONB,
    change_summary TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT app_security.cms_create_new_revision(content_type, id, new_title, payload, change_summary);
$$;

GRANT EXECUTE ON FUNCTION public.cms_create_draft(TEXT, TEXT, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cms_submit_for_review(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cms_approve_content(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cms_publish_content(TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cms_unpublish_content(TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cms_create_new_revision(TEXT, UUID, TEXT, JSONB, TEXT) TO authenticated, service_role;

-- 10. SYNTHETIC EDITORIAL CONTENT SEED FIXTURES
-- Clearly marked synthetic development content ensuring public app has rich initial data
-- Scripture texts from World English Bible (WEB - Public Domain)

-- Synthetic Devotional 1 (Published)
INSERT INTO public.devotional_catalog (
    id,
    content_id,
    title,
    scripture_reference,
    scripture_text,
    reflection,
    prayer,
    reflection_prompt,
    day_number,
    category,
    content_status,
    is_published,
    version,
    topics,
    tags,
    author_name,
    author_title,
    reviewer_name,
    source_name,
    copyright_owner,
    license_type,
    attribution_text,
    published_at
) VALUES (
    '11111111-1111-1111-1111-111111111101',
    'dev-morning-mercy',
    'Morning Mercies in the Valley',
    'Lamentations 3:22-23 (WEB)',
    'It is of the LORD''s mercies that we are not consumed, because his compassions don''t fail. They are new every morning. Great is your faithfulness.',
    'Trauma often whispers that your exhausted state is permanent. But Scripture gently reminds us that God does not demand you navigate yesterday or tomorrow right now. Grace arrives in quiet daily portions.',
    'Heavenly Father, quiet the storms within my chest. Teach me to receive today''s gentle mercy and release what I cannot control. Amen.',
    'What is one heavy burden from yesterday that you can surrender into God''s hands today?',
    1,
    'daily',
    'published',
    true,
    1,
    ARRAY['Grief & Comfort', 'Anxiety & Peace'],
    ARRAY['hope', 'peace', 'morning'],
    'Cherie Magsanoc',
    'Founder, LIFTED',
    'Senior Editorial Reviewer',
    'LIFTED Synthetic Fixture',
    'Every Nation GG / LIFTED',
    'Synthetic Development License (WEB Scripture Public Domain)',
    'Scripture quotations from World English Bible (Public Domain).',
    now()
) ON CONFLICT (id) DO NOTHING;

-- Synthetic Devotional 2 (Published)
INSERT INTO public.devotional_catalog (
    id,
    content_id,
    title,
    scripture_reference,
    scripture_text,
    reflection,
    prayer,
    reflection_prompt,
    day_number,
    category,
    content_status,
    is_published,
    version,
    topics,
    tags,
    author_name,
    author_title,
    reviewer_name,
    source_name,
    copyright_owner,
    license_type,
    attribution_text,
    published_at
) VALUES (
    '11111111-1111-1111-1111-111111111102',
    'dev-shelter-peace',
    'The Shelter of Gentle Stillness',
    'Psalm 46:10 (WEB)',
    'Be still, and know that I am God. I will be exalted among the nations. I will be exalted in the earth.',
    'Stillness is not passive emptiness; it is an active somatic surrender. When fight-or-flight surges, pausing for three intentional breaths invites the Prince of Peace into your physical space.',
    'Lord Jesus, You stilled the winds of Galilee. Still the tempest in my mind and remind my soul that You reign. Amen.',
    'Where in your body do you feel tension right now? Breathe deeply and invite God''s peace there.',
    2,
    'daily',
    'published',
    true,
    1,
    ARRAY['Anxiety & Peace', 'Burnout & Rest'],
    ARRAY['stillness', 'breath', 'calm'],
    'LIFTED Editorial Team',
    'Care Team Contributor',
    'Senior Editorial Reviewer',
    'LIFTED Synthetic Fixture',
    'Every Nation GG / LIFTED',
    'Synthetic Development License (WEB Scripture Public Domain)',
    'Scripture quotations from World English Bible (Public Domain).',
    now()
) ON CONFLICT (id) DO NOTHING;

-- Synthetic Devotional 3 (Draft - MUST NOT BE VISIBLE TO ORDINARY USERS)
INSERT INTO public.devotional_catalog (
    id,
    content_id,
    title,
    scripture_reference,
    scripture_text,
    reflection,
    prayer,
    reflection_prompt,
    day_number,
    category,
    content_status,
    is_published,
    version,
    topics,
    tags,
    author_name,
    source_name,
    copyright_owner,
    license_type
) VALUES (
    '11111111-1111-1111-1111-111111111103',
    'dev-draft-valley',
    '[DRAFT] Walking Through Unanswered Questions',
    'Habakkuk 3:17-18 (WEB)',
    'For though the fig tree doesn''t flourish, yet I will rejoice in the LORD.',
    'Draft reflection on processing spiritual doubt and persistent sorrow with honesty.',
    'Lord, hold me when answers fail to come. Amen.',
    'Write what is honestly perplexing your spirit.',
    3,
    'daily',
    'draft',
    false,
    1,
    ARRAY['Grief & Comfort'],
    ARRAY['draft', 'internal'],
    'LIFTED Editorial Team',
    'LIFTED Synthetic Fixture',
    'Every Nation GG / LIFTED',
    'Internal Draft'
) ON CONFLICT (id) DO NOTHING;

-- Synthetic Article 1 (Published)
INSERT INTO public.article_catalog (
    id,
    content_id,
    title,
    subtitle,
    summary,
    content,
    category,
    read_time_minutes,
    practical_exercise,
    content_status,
    is_published,
    version,
    topics,
    tags,
    author_name,
    author_credentials,
    source_name,
    copyright_owner,
    license_type,
    published_at
) VALUES (
    '22222222-2222-2222-2222-222222222201',
    'art-trauma-grounding',
    'Understanding the Vagus Nerve & Christian Grounding',
    'How faith and trauma-informed somatic biology work in harmony',
    'Learn how God designed your autonomic nervous system to signal physical safety through paced respiration and scripture anchoring.',
    'When trauma triggers fight-or-flight, the amygdala signals an acute emergency regardless of current surroundings. By intentionally extending exhalation (such as in 4-7-8 breathing) while meditating on the shepherd''s presence, you stimulate the parasympathetic ventral vagus branch, physically de-escalating panic.',
    'wellness',
    4,
    jsonb_build_object(
        'title', 'The 4-7-8 Somatic Anchor',
        'instruction', 'Inhale for 4 seconds through the nose. Hold for 7 seconds while repeating "The Lord is with me". Exhale slowly for 8 seconds.'
    ),
    'published',
    true,
    1,
    ARRAY['Anxiety & Panic', 'Burnout & Rest'],
    ARRAY['vagus', 'grounding', 'somatic'],
    'Dr. Evelyn Reed, PhD',
    'Licensed Clinical Psychologist & Faith Integration Specialist',
    'LIFTED Synthetic Fixture',
    'Every Nation GG / LIFTED',
    'Synthetic Educational License',
    now()
) ON CONFLICT (id) DO NOTHING;

-- Synthetic Article 2 (Draft - MUST NOT BE VISIBLE TO ORDINARY USERS)
INSERT INTO public.article_catalog (
    id,
    content_id,
    title,
    summary,
    content,
    category,
    content_status,
    is_published,
    version,
    author_name,
    source_name,
    copyright_owner,
    license_type
) VALUES (
    '22222222-2222-2222-2222-222222222202',
    'art-draft-clinical',
    '[DRAFT] Complex Grief and Boundary Rebuilding',
    'Internal draft examining healthy relational boundaries post-trauma.',
    'Draft body awaiting senior clinical supervisor review.',
    'wellness',
    'draft',
    false,
    1,
    'LIFTED Clinical Team',
    'LIFTED Synthetic Fixture',
    'Every Nation GG / LIFTED',
    'Internal Draft'
) ON CONFLICT (id) DO NOTHING;

-- Synthetic Video 1 (Published)
INSERT INTO public.video_catalog (
    id,
    content_id,
    title,
    description,
    video_url,
    thumbnail_gradient,
    duration_seconds,
    category,
    creator,
    scripture_anchor,
    content_status,
    is_published,
    version,
    topics,
    tags,
    source_name,
    copyright_owner,
    license_type,
    published_at
) VALUES (
    '33333333-3333-3333-3333-333333333301',
    'vid-peace-breath',
    'Breathe in Grace, Exhale the Weight',
    'A 60-second guided breathing reflection focusing on Psalm 34:18.',
    'https://lifted.example.org/videos/peace-breath.mp4',
    'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
    60,
    'wellness',
    'Cherie Magsanoc',
    'Psalm 34:18',
    'published',
    true,
    1,
    ARRAY['Anxiety & Grounding', 'Quiet Peace'],
    ARRAY['video', 'grounding', 'breath'],
    'LIFTED Synthetic Fixture',
    'Every Nation GG / LIFTED',
    'Synthetic Media License',
    now()
) ON CONFLICT (id) DO NOTHING;

-- Synthetic Video 2 (Draft - MUST NOT BE VISIBLE TO ORDINARY USERS)
INSERT INTO public.video_catalog (
    id,
    content_id,
    title,
    description,
    video_url,
    duration_seconds,
    category,
    content_status,
    is_published,
    version,
    source_name,
    copyright_owner,
    license_type
) VALUES (
    '33333333-3333-3333-3333-333333333302',
    'vid-draft-clip',
    '[DRAFT] Processing Sudden Loss',
    'Draft clip in post-production review.',
    'https://lifted.example.org/videos/draft-clip.mp4',
    45,
    'wellness',
    'draft',
    false,
    1,
    'LIFTED Synthetic Fixture',
    'Every Nation GG / LIFTED',
    'Internal Draft'
) ON CONFLICT (id) DO NOTHING;
