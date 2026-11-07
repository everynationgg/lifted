-- LIFTED Master Roadmap Phase 6: Row Level Security Policies
-- Migration: 20261101000003_row_level_security.sql
-- Description: Zero-Trust Row Level Security (RLS) policies for all exposed tables.
-- Guarantees complete tenant isolation, zero unauthenticated data leakage, server-controlled
-- RBAC enforcement (using app_security schema), non-recursive role queries, and strict moderation protection.

--------------------------------------------------------------------------------
-- 1. ENABLE ROW LEVEL SECURITY ON ALL TABLES
--------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mood_checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prayer_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_testimonies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devotional_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_metadata ENABLE ROW LEVEL SECURITY;

--------------------------------------------------------------------------------
-- 2. PROFILES POLICIES
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
    ON public.profiles FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON public.profiles;
CREATE POLICY "profiles_delete_own"
    ON public.profiles FOR DELETE
    TO authenticated
    USING (auth.uid() = id);

--------------------------------------------------------------------------------
-- 3. USER ROLES POLICIES (Non-Recursive, Server-Controlled Administration)
-- Non-admin users have ZERO mutation privileges. Escalation is blocked.
-- Split SELECT policies guarantee zero policy recursion.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "user_roles_select_own" ON public.user_roles;
CREATE POLICY "user_roles_select_own"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_roles_select_admin" ON public.user_roles;
CREATE POLICY "user_roles_select_admin"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (app_security.is_admin());

DROP POLICY IF EXISTS "user_roles_insert_admin" ON public.user_roles;
CREATE POLICY "user_roles_insert_admin"
    ON public.user_roles FOR INSERT
    TO authenticated
    WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS "user_roles_update_admin" ON public.user_roles;
CREATE POLICY "user_roles_update_admin"
    ON public.user_roles FOR UPDATE
    TO authenticated
    USING (app_security.is_admin())
    WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS "user_roles_delete_admin" ON public.user_roles;
CREATE POLICY "user_roles_delete_admin"
    ON public.user_roles FOR DELETE
    TO authenticated
    USING (app_security.is_admin());

--------------------------------------------------------------------------------
-- 4. PRIVATE JOURNALS POLICIES (Strict Personal Isolation)
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "private_journals_select_own" ON public.private_journals;
CREATE POLICY "private_journals_select_own"
    ON public.private_journals FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "private_journals_insert_own" ON public.private_journals;
CREATE POLICY "private_journals_insert_own"
    ON public.private_journals FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "private_journals_update_own" ON public.private_journals;
CREATE POLICY "private_journals_update_own"
    ON public.private_journals FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "private_journals_delete_own" ON public.private_journals;
CREATE POLICY "private_journals_delete_own"
    ON public.private_journals FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

--------------------------------------------------------------------------------
-- 5. MOOD CHECK-INS POLICIES (Strict Personal Isolation)
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "mood_checkins_select_own" ON public.mood_checkins;
CREATE POLICY "mood_checkins_select_own"
    ON public.mood_checkins FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "mood_checkins_insert_own" ON public.mood_checkins;
CREATE POLICY "mood_checkins_insert_own"
    ON public.mood_checkins FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "mood_checkins_update_own" ON public.mood_checkins;
CREATE POLICY "mood_checkins_update_own"
    ON public.mood_checkins FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "mood_checkins_delete_own" ON public.mood_checkins;
CREATE POLICY "mood_checkins_delete_own"
    ON public.mood_checkins FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

--------------------------------------------------------------------------------
-- 6. PRAYER REQUESTS POLICIES (Strict Personal Isolation)
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "prayer_requests_select_own" ON public.prayer_requests;
CREATE POLICY "prayer_requests_select_own"
    ON public.prayer_requests FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "prayer_requests_insert_own" ON public.prayer_requests;
CREATE POLICY "prayer_requests_insert_own"
    ON public.prayer_requests FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prayer_requests_update_own" ON public.prayer_requests;
CREATE POLICY "prayer_requests_update_own"
    ON public.prayer_requests FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "prayer_requests_delete_own" ON public.prayer_requests;
CREATE POLICY "prayer_requests_delete_own"
    ON public.prayer_requests FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

--------------------------------------------------------------------------------
-- 7. COMMUNITY TESTIMONIES POLICIES
-- Moderation Model:
-- - Approved testimonies are publicly visible.
-- - Pending/rejected testimonies are visible ONLY to the author or staff.
-- - Authors can only insert/update pending testimonies and cannot self-approve.
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "testimonies_select_approved" ON public.community_testimonies;
CREATE POLICY "testimonies_select_approved"
    ON public.community_testimonies FOR SELECT
    USING (status = 'approved'::public.moderation_status);

DROP POLICY IF EXISTS "testimonies_select_own_pending" ON public.community_testimonies;
CREATE POLICY "testimonies_select_own_pending"
    ON public.community_testimonies FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "testimonies_select_staff" ON public.community_testimonies;
CREATE POLICY "testimonies_select_staff"
    ON public.community_testimonies FOR SELECT
    TO authenticated
    USING (app_security.is_staff());

DROP POLICY IF EXISTS "testimonies_insert_member" ON public.community_testimonies;
CREATE POLICY "testimonies_insert_member"
    ON public.community_testimonies FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND status = 'pending'::public.moderation_status
        AND is_featured = false
        AND reviewed_by IS NULL
    );

DROP POLICY IF EXISTS "testimonies_update_own_pending" ON public.community_testimonies;
CREATE POLICY "testimonies_update_own_pending"
    ON public.community_testimonies FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = user_id
        AND status = 'pending'::public.moderation_status
    )
    WITH CHECK (
        auth.uid() = user_id
        AND status = 'pending'::public.moderation_status
        AND is_featured = false
        AND reviewed_by IS NULL
    );

DROP POLICY IF EXISTS "testimonies_update_staff" ON public.community_testimonies;
CREATE POLICY "testimonies_update_staff"
    ON public.community_testimonies FOR UPDATE
    TO authenticated
    USING (app_security.is_staff())
    WITH CHECK (app_security.is_staff());

DROP POLICY IF EXISTS "testimonies_delete_own_pending" ON public.community_testimonies;
CREATE POLICY "testimonies_delete_own_pending"
    ON public.community_testimonies FOR DELETE
    TO authenticated
    USING (
        auth.uid() = user_id
        AND status = 'pending'::public.moderation_status
    );

DROP POLICY IF EXISTS "testimonies_delete_admin" ON public.community_testimonies;
CREATE POLICY "testimonies_delete_admin"
    ON public.community_testimonies FOR DELETE
    TO authenticated
    USING (app_security.is_admin());

--------------------------------------------------------------------------------
-- 8. CONTENT CATALOG POLICIES (Devotionals, Articles, Videos)
-- - Published items are readable by all users (anon & authenticated).
-- - Unpublished items are viewable by staff only.
-- - Write operations are restricted strictly to administrators.
--------------------------------------------------------------------------------

-- Devotionals
DROP POLICY IF EXISTS "devotionals_select_published" ON public.devotional_catalog;
CREATE POLICY "devotionals_select_published"
    ON public.devotional_catalog FOR SELECT
    USING (is_published = true);

DROP POLICY IF EXISTS "devotionals_select_staff" ON public.devotional_catalog;
CREATE POLICY "devotionals_select_staff"
    ON public.devotional_catalog FOR SELECT
    TO authenticated
    USING (app_security.is_staff());

DROP POLICY IF EXISTS "devotionals_insert_admin" ON public.devotional_catalog;
CREATE POLICY "devotionals_insert_admin"
    ON public.devotional_catalog FOR INSERT
    TO authenticated
    WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS "devotionals_update_admin" ON public.devotional_catalog;
CREATE POLICY "devotionals_update_admin"
    ON public.devotional_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_admin())
    WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS "devotionals_delete_admin" ON public.devotional_catalog;
CREATE POLICY "devotionals_delete_admin"
    ON public.devotional_catalog FOR DELETE
    TO authenticated
    USING (app_security.is_admin());

-- Articles
DROP POLICY IF EXISTS "articles_select_published" ON public.article_catalog;
CREATE POLICY "articles_select_published"
    ON public.article_catalog FOR SELECT
    USING (is_published = true);

DROP POLICY IF EXISTS "articles_select_staff" ON public.article_catalog;
CREATE POLICY "articles_select_staff"
    ON public.article_catalog FOR SELECT
    TO authenticated
    USING (app_security.is_staff());

DROP POLICY IF EXISTS "articles_insert_admin" ON public.article_catalog;
CREATE POLICY "articles_insert_admin"
    ON public.article_catalog FOR INSERT
    TO authenticated
    WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS "articles_update_admin" ON public.article_catalog;
CREATE POLICY "articles_update_admin"
    ON public.article_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_admin())
    WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS "articles_delete_admin" ON public.article_catalog;
CREATE POLICY "articles_delete_admin"
    ON public.article_catalog FOR DELETE
    TO authenticated
    USING (app_security.is_admin());

-- Videos
DROP POLICY IF EXISTS "videos_select_published" ON public.video_catalog;
CREATE POLICY "videos_select_published"
    ON public.video_catalog FOR SELECT
    USING (is_published = true);

DROP POLICY IF EXISTS "videos_select_staff" ON public.video_catalog;
CREATE POLICY "videos_select_staff"
    ON public.video_catalog FOR SELECT
    TO authenticated
    USING (app_security.is_staff());

DROP POLICY IF EXISTS "videos_insert_admin" ON public.video_catalog;
CREATE POLICY "videos_insert_admin"
    ON public.video_catalog FOR INSERT
    TO authenticated
    WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS "videos_update_admin" ON public.video_catalog;
CREATE POLICY "videos_update_admin"
    ON public.video_catalog FOR UPDATE
    TO authenticated
    USING (app_security.is_admin())
    WITH CHECK (app_security.is_admin());

DROP POLICY IF EXISTS "videos_delete_admin" ON public.video_catalog;
CREATE POLICY "videos_delete_admin"
    ON public.video_catalog FOR DELETE
    TO authenticated
    USING (app_security.is_admin());

--------------------------------------------------------------------------------
-- 9. SYNC METADATA POLICIES
--------------------------------------------------------------------------------
DROP POLICY IF EXISTS "sync_metadata_select_own" ON public.sync_metadata;
CREATE POLICY "sync_metadata_select_own"
    ON public.sync_metadata FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "sync_metadata_insert_own" ON public.sync_metadata;
CREATE POLICY "sync_metadata_insert_own"
    ON public.sync_metadata FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sync_metadata_update_own" ON public.sync_metadata;
CREATE POLICY "sync_metadata_update_own"
    ON public.sync_metadata FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "sync_metadata_delete_own" ON public.sync_metadata;
CREATE POLICY "sync_metadata_delete_own"
    ON public.sync_metadata FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);
