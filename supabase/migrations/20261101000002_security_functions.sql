-- LIFTED Master Roadmap Phase 6: Hardened Security Functions and Triggers
-- Migration: 20261101000002_security_functions.sql
-- Description: Creates server-controlled RBAC security definer functions in private schema 'app_security'
-- with hardened empty search_paths (SET search_path = ''), automated timestamp triggers,
-- testimony moderation constraints, and sync revision integrity.

--------------------------------------------------------------------------------
-- 1. TIMESTAMP HANDLING FUNCTION (Hardened Empty Search Path)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at = pg_catalog.now();
    RETURN NEW;
END;
$$;

-- Apply updated_at triggers to all mutable tables
CREATE TRIGGER on_profiles_updated
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_private_journals_updated
    BEFORE UPDATE ON public.private_journals
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_mood_checkins_updated
    BEFORE UPDATE ON public.mood_checkins
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_prayer_requests_updated
    BEFORE UPDATE ON public.prayer_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_community_testimonies_updated
    BEFORE UPDATE ON public.community_testimonies
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_devotional_catalog_updated
    BEFORE UPDATE ON public.devotional_catalog
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_article_catalog_updated
    BEFORE UPDATE ON public.article_catalog
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_video_catalog_updated
    BEFORE UPDATE ON public.video_catalog
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER on_sync_metadata_updated
    BEFORE UPDATE ON public.sync_metadata
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_updated_at();

--------------------------------------------------------------------------------
-- 2. PROFILE CREATION ON AUTH.USERS INSERT (Hardened Empty Search Path)
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, created_at, updated_at)
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'display_name',
            NEW.raw_user_meta_data->>'name',
            'Beloved Seeker'
        ),
        pg_catalog.now(),
        pg_catalog.now()
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'member')
    ON CONFLICT (user_id, role) DO NOTHING;

    RETURN NEW;
END;
$$;

-- Trigger on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

--------------------------------------------------------------------------------
-- 3. SERVER-CONTROLLED RBAC FUNCTIONS IN PRIVATE SCHEMA 'app_security'
-- Hardened Empty Search Path (SET search_path = '') prevents search-path hijacking.
-- Dedicated schema 'app_security' is NOT exposed via PostgREST Data API.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_security.has_role(required_role public.app_role)
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
          AND role = required_role
    );
$$;

CREATE OR REPLACE FUNCTION app_security.is_admin()
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
          AND role = 'admin'::public.app_role
    );
$$;

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
          AND role IN ('admin'::public.app_role, 'moderator'::public.app_role)
    );
$$;

-- Safe, read-only public wrapper for authorized client RPC checks (SECURITY INVOKER)
-- Invoker semantics prevent privilege escalation; delegates to unexposed app_security.is_admin()
CREATE OR REPLACE FUNCTION public.check_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
    SELECT app_security.is_admin();
$$;

-- Revoke execute from PUBLIC to prevent unauthorized probing
REVOKE ALL ON FUNCTION app_security.has_role(public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_security.has_role(public.app_role) TO authenticated, service_role;

REVOKE ALL ON FUNCTION app_security.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_security.is_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION app_security.is_staff() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_security.is_staff() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.check_is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 4. TESTIMONY MODERATION ENFORCEMENT TRIGGER (Hardened Empty Search Path)
-- Guarantees that ordinary users cannot self-approve, self-feature, or mutate moderation metadata.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_testimony_moderation_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    -- If executed by staff (admin or moderator) or service_role, allow administrative operations
    IF app_security.is_staff() THEN
        RETURN NEW;
    END IF;

    -- Non-staff users must not mutate reviews or self-approve
    IF TG_OP = 'INSERT' THEN
        IF NEW.status != 'pending'::public.moderation_status THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: New testimonies must be submitted with pending status';
        END IF;
        IF NEW.is_featured = true THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Users cannot self-feature testimonies';
        END IF;
        IF NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Users cannot set review metadata';
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Ordinary user can only modify their pending submission
        IF OLD.status != 'pending'::public.moderation_status THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Cannot modify a testimony that has already been moderated';
        END IF;
        -- User cannot transition status to approved or rejected
        IF NEW.status != 'pending'::public.moderation_status AND NEW.status != 'archived'::public.moderation_status THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Users cannot self-approve or reject testimonies';
        END IF;
        -- User cannot alter featured state
        IF NEW.is_featured != OLD.is_featured THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Users cannot alter featured status';
        END IF;
        -- User cannot set moderation metadata
        IF NEW.reviewed_by IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'PERMISSION_DENIED: Users cannot set review metadata';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER on_testimony_moderation_check
    BEFORE INSERT OR UPDATE ON public.community_testimonies
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_testimony_moderation_rules();

--------------------------------------------------------------------------------
-- 5. SYNC REVISION INTEGRITY TRIGGER (Hardened Empty Search Path)
-- Guarantees monotonically increasing revisions and rejects stale/regressive revisions.
--------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_sync_revision_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.sync_revision < OLD.sync_revision THEN
            RAISE EXCEPTION 'CONFLICT_REJECTED: Stale sync revision detected (incoming: %, current: %)',
                NEW.sync_revision, OLD.sync_revision;
        END IF;
        -- Auto-increment revision if not explicitly bumped
        IF NEW.sync_revision = OLD.sync_revision THEN
            NEW.sync_revision = OLD.sync_revision + 1;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER on_private_journals_revision
    BEFORE UPDATE ON public.private_journals
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_sync_revision_integrity();

CREATE TRIGGER on_mood_checkins_revision
    BEFORE UPDATE ON public.mood_checkins
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_sync_revision_integrity();

CREATE TRIGGER on_prayer_requests_revision
    BEFORE UPDATE ON public.prayer_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_sync_revision_integrity();
