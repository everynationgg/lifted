-- LIFTED Master Roadmap Phase 6: Least-Privilege Table Grants & Role Hardening
-- Migration: 20261101000004_least_privilege_grants.sql
-- Description: Enforces defense-in-depth table-level SQL grants.
-- Strips excessive defaults (TRUNCATE, REFERENCES, TRIGGER), grants minimum necessary schema USAGE,
-- restricts anonymous access strictly to published catalog items, and locks down user_roles and catalog mutations.

--------------------------------------------------------------------------------
-- 1. REVOKE DEFAULT EXCESSIVE PRIVILEGES
--------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;

-- Private schema isolation
REVOKE ALL ON SCHEMA app_security FROM PUBLIC;
REVOKE ALL ON SCHEMA app_security FROM anon;
REVOKE ALL ON SCHEMA app_security FROM authenticated;

--------------------------------------------------------------------------------
-- 2. SCHEMA USAGE PRIVILEGES
--------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA app_security TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 3. ANONYMOUS ROLE (ANON) — LEAST PRIVILEGE READ-ONLY GRANTS
-- Can only SELECT from public community testimonies and content catalogs
-- (RLS further filters down to is_published = true and status = 'approved')
--------------------------------------------------------------------------------
GRANT SELECT ON public.community_testimonies TO anon;
GRANT SELECT ON public.devotional_catalog TO anon;
GRANT SELECT ON public.article_catalog TO anon;
GRANT SELECT ON public.video_catalog TO anon;

--------------------------------------------------------------------------------
-- 4. AUTHENTICATED ROLE — LEAST PRIVILEGE GRANTS
--------------------------------------------------------------------------------
-- Personal Tenant Tables: Full CRUD granted at table level, bounded strictly by RLS (auth.uid() = user_id)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_journals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mood_checkins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prayer_requests TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_metadata TO authenticated;

-- Community Testimonies: Members submit pending, staff moderate (RLS gates status changes)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_testimonies TO authenticated;

-- User Roles: Authenticated users get SELECT ONLY! (RLS restricts to own role or admin)
-- Ordinary users have NO table-level grant for INSERT, UPDATE, or DELETE on user_roles!
GRANT SELECT ON public.user_roles TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.user_roles TO service_role;

-- Catalogs: Authenticated users get SELECT ONLY!
-- Mutations require administrative service_role or admin RLS-checked functions.
GRANT SELECT ON public.devotional_catalog TO authenticated;
GRANT SELECT ON public.article_catalog TO authenticated;
GRANT SELECT ON public.video_catalog TO authenticated;

GRANT INSERT, UPDATE, DELETE ON public.devotional_catalog TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.article_catalog TO service_role;
GRANT INSERT, UPDATE, DELETE ON public.video_catalog TO service_role;

--------------------------------------------------------------------------------
-- 5. FUNCTION EXECUTE PRIVILEGES
--------------------------------------------------------------------------------
-- app_security private functions
GRANT EXECUTE ON FUNCTION app_security.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.is_staff() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_security.has_role(public.app_role) TO authenticated, service_role;

-- public RPC wrapper (SECURITY INVOKER)
GRANT EXECUTE ON FUNCTION public.check_is_admin() TO authenticated, service_role;

--------------------------------------------------------------------------------
-- 6. DEFAULT PRIVILEGES FOR FUTURE OBJECTS
--------------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_security REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_security REVOKE ALL ON ROUTINES FROM PUBLIC, anon;
