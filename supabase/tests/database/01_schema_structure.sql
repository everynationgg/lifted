-- LIFTED Phase 6 pgTAP Test Suite: Database Schema & Structural Integrity
-- File: supabase/tests/database/01_schema_structure.sql

BEGIN;
SELECT plan(38);

-- 1. Test Extensions & Schemas
SELECT has_extension('pgcrypto', 'pgcrypto extension should be installed');
SELECT has_schema('app_security', 'private app_security schema should exist');

-- 2. Test Tables Exist
SELECT has_table('public', 'profiles', 'public.profiles table should exist');
SELECT has_table('public', 'user_roles', 'public.user_roles table should exist');
SELECT has_table('public', 'private_journals', 'public.private_journals table should exist');
SELECT has_table('public', 'mood_checkins', 'public.mood_checkins table should exist');
SELECT has_table('public', 'prayer_requests', 'public.prayer_requests table should exist');
SELECT has_table('public', 'community_testimonies', 'public.community_testimonies table should exist');
SELECT has_table('public', 'devotional_catalog', 'public.devotional_catalog table should exist');
SELECT has_table('public', 'article_catalog', 'public.article_catalog table should exist');
SELECT has_table('public', 'video_catalog', 'public.video_catalog table should exist');
SELECT has_table('public', 'sync_metadata', 'public.sync_metadata table should exist');

-- 3. Test Primary Keys
SELECT col_is_pk('public', 'profiles', 'id', 'profiles primary key is id');
SELECT col_is_pk('public', 'user_roles', 'id', 'user_roles primary key is id');
SELECT col_is_pk('public', 'private_journals', 'id', 'private_journals primary key is id');
SELECT col_is_pk('public', 'mood_checkins', 'id', 'mood_checkins primary key is id');
SELECT col_is_pk('public', 'prayer_requests', 'id', 'prayer_requests primary key is id');
SELECT col_is_pk('public', 'community_testimonies', 'id', 'community_testimonies primary key is id');
SELECT col_is_pk('public', 'devotional_catalog', 'id', 'devotional_catalog primary key is id');
SELECT col_is_pk('public', 'article_catalog', 'id', 'article_catalog primary key is id');
SELECT col_is_pk('public', 'video_catalog', 'id', 'video_catalog primary key is id');
SELECT col_is_pk('public', 'sync_metadata', 'id', 'sync_metadata primary key is id');

-- 4. Test RLS is Enabled
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.profiles'::regclass), 'profiles has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.user_roles'::regclass), 'user_roles has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.private_journals'::regclass), 'private_journals has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.mood_checkins'::regclass), 'mood_checkins has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.prayer_requests'::regclass), 'prayer_requests has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.community_testimonies'::regclass), 'community_testimonies has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.devotional_catalog'::regclass), 'devotional_catalog has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.article_catalog'::regclass), 'article_catalog has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.video_catalog'::regclass), 'video_catalog has RLS enabled');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.sync_metadata'::regclass), 'sync_metadata has RLS enabled');

-- 5. Test Functions Exist in app_security and public
SELECT has_function('app_security', 'has_role', ARRAY['public.app_role'], 'app_security.has_role function exists');
SELECT has_function('app_security', 'is_admin', ARRAY[]::text[], 'app_security.is_admin function exists');
SELECT has_function('app_security', 'is_staff', ARRAY[]::text[], 'app_security.is_staff function exists');
SELECT has_function('public', 'check_is_admin', ARRAY[]::text[], 'public.check_is_admin wrapper exists');
SELECT has_function('public', 'handle_updated_at', ARRAY[]::text[], 'handle_updated_at function exists');
SELECT has_function('public', 'enforce_testimony_moderation_rules', ARRAY[]::text[], 'enforce_testimony_moderation_rules function exists');

SELECT * FROM finish();
ROLLBACK;
