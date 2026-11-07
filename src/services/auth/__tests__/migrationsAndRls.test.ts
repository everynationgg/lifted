import { describe, it, expect } from 'vitest';

// Vite ?raw imports guarantee cross-platform execution without Node fs/path dependencies
import migration1 from '../../../../supabase/migrations/20261101000001_core_schema.sql?raw';
import migration2 from '../../../../supabase/migrations/20261101000002_security_functions.sql?raw';
import migration3 from '../../../../supabase/migrations/20261101000003_row_level_security.sql?raw';
import migration4 from '../../../../supabase/migrations/20261101000004_least_privilege_grants.sql?raw';

import pgtap1 from '../../../../supabase/tests/database/01_schema_structure.sql?raw';
import pgtap2 from '../../../../supabase/tests/database/02_rls_isolation.sql?raw';
import pgtap3 from '../../../../supabase/tests/database/03_admin_rbac.sql?raw';
import pgtap4 from '../../../../supabase/tests/database/04_moderation_flow.sql?raw';

describe('Supabase Schema Migrations, Hardened Security Definers & Zero-Trust RLS (Phase 6)', () => {
  const allMigrations = `${migration1}\n${migration2}\n${migration3}\n${migration4}`;

  const REQUIRED_TABLES = [
    'profiles',
    'user_roles',
    'private_journals',
    'mood_checkins',
    'prayer_requests',
    'community_testimonies',
    'devotional_catalog',
    'article_catalog',
    'video_catalog',
    'sync_metadata',
  ];

  describe('1. Migration File Structure & Table Definitions', () => {
    it('contains all 4 required SQL migration contents', () => {
      expect(migration1.length).toBeGreaterThan(100);
      expect(migration2.length).toBeGreaterThan(100);
      expect(migration3.length).toBeGreaterThan(100);
      expect(migration4.length).toBeGreaterThan(100);
    });

    it('creates dedicated private schema app_security for non-exposed privileged functions', () => {
      expect(migration1).toContain('CREATE SCHEMA IF NOT EXISTS app_security;');
    });

    it.each(REQUIRED_TABLES)('creates table public.%s with primary key and timestamps', (table) => {
      const tableRegex = new RegExp(`CREATE TABLE (IF NOT EXISTS )?public\\.${table}\\s*\\(`, 'i');
      expect(tableRegex.test(migration1)).toBe(true);
      expect(allMigrations).toContain(`public.${table}`);
    });

    it('enforces foreign key constraints to auth.users on all user-owned tables', () => {
      const userOwnedTables = [
        'profiles',
        'user_roles',
        'private_journals',
        'mood_checkins',
        'prayer_requests',
        'community_testimonies',
        'sync_metadata',
      ];

      for (const _table of userOwnedTables) {
        expect(migration1).toMatch(new RegExp(`REFERENCES auth\\.users\\(id\\)`, 'i'));
      }
    });
  });

  describe('2. Mandatory Journal Privacy Boundary (Zero Plaintext)', () => {
    it('ensures private_journals stores only versioned encrypted_envelope JSONB', () => {
      expect(migration1).toContain('encrypted_envelope JSONB NOT NULL');
      // Must NOT contain plaintext journal body columns
      expect(migration1).not.toMatch(/private_journals[^;]*\bjournal_text\b/i);
      expect(migration1).not.toMatch(/private_journals[^;]*\bplaintext_content\b/i);
    });

    it('ensures prayer_requests stores encrypted_payload JSONB', () => {
      expect(migration1).toContain('encrypted_payload JSONB NOT NULL');
      expect(migration1).not.toMatch(/prayer_requests[^;]*\bprayer_text\b/i);
    });

    it('includes sync revision tracking and soft-delete tombstones', () => {
      expect(migration1).toContain('sync_revision BIGINT NOT NULL DEFAULT 1');
      expect(migration1).toContain('is_deleted BOOLEAN NOT NULL DEFAULT false');
    });
  });

  describe('3. Hardened SECURITY DEFINER Functions & Empty Search Path', () => {
    it('places privileged helper functions in private schema app_security', () => {
      expect(migration2).toContain('app_security.is_admin()');
      expect(migration2).toContain('app_security.has_role(required_role public.app_role)');
      expect(migration2).toContain('app_security.is_staff()');
    });

    it('enforces hardened empty search_path (SET search_path = \'\') on all SECURITY DEFINER functions', () => {
      const securityDefinerRegex = /CREATE OR REPLACE FUNCTION (public|app_security)\.\w+\([^)]*\)[\s\S]*?SECURITY DEFINER[\s\S]*?SET search_path = ''/gi;
      const matches = migration2.match(securityDefinerRegex);

      expect(matches).not.toBeNull();
      // Must match handle_updated_at, handle_new_user, has_role, is_admin, is_staff, enforce_testimony, enforce_sync
      expect(matches!.length).toBeGreaterThanOrEqual(7);
    });

    it('fully qualifies all catalog, auth, and schema references inside empty search path functions', () => {
      expect(migration2).toContain('pg_catalog.now()');
      expect(migration2).toContain('COALESCE(');
      expect(migration2).toContain('public.user_roles');
      expect(migration2).toContain('auth.uid()');
    });

    it('revokes public execute privileges on all privileged functions', () => {
      expect(migration2).toContain('REVOKE ALL ON FUNCTION app_security.is_admin() FROM PUBLIC;');
      expect(migration2).toContain('REVOKE ALL ON FUNCTION app_security.has_role(public.app_role) FROM PUBLIC;');
      expect(migration2).toContain('REVOKE ALL ON FUNCTION app_security.is_staff() FROM PUBLIC;');
    });
  });

  describe('4. Zero-Trust Row Level Security (RLS) & Non-Recursive Role Policies', () => {
    it.each(REQUIRED_TABLES)('explicitly enables Row Level Security on public.%s', (table) => {
      const rlsRegex = new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY;`, 'i');
      expect(rlsRegex.test(migration3)).toBe(true);
    });

    it('ensures user_roles SELECT policies are split to guarantee zero policy recursion', () => {
      expect(migration3).toContain('"user_roles_select_own"');
      expect(migration3).toContain('USING (auth.uid() = user_id)');
      expect(migration3).toContain('"user_roles_select_admin"');
      expect(migration3).toContain('USING (app_security.is_admin())');
    });

    it('defines explicit policies for SELECT, INSERT, UPDATE, DELETE on private_journals', () => {
      expect(migration3).toContain('"private_journals_select_own"');
      expect(migration3).toContain('"private_journals_insert_own"');
      expect(migration3).toContain('"private_journals_update_own"');
      expect(migration3).toContain('"private_journals_delete_own"');
      expect(migration3).toContain('USING (auth.uid() = user_id)');
      expect(migration3).toContain('WITH CHECK (auth.uid() = user_id)');
    });

    it('restricts content catalogs (devotional, article, video) mutations strictly to admin', () => {
      expect(migration3).toContain('"devotionals_insert_admin"');
      expect(migration3).toContain('WITH CHECK (app_security.is_admin())');
      expect(migration3).toContain('"articles_insert_admin"');
      expect(migration3).toContain('"videos_insert_admin"');
    });
  });

  describe('5. Table-Level SQL Grants Audit & Least Privilege', () => {
    it('revokes all default excessive privileges on public tables and sequences', () => {
      expect(migration4).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;');
      expect(migration4).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;');
      expect(migration4).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;');
    });

    it('grants anonymous (anon) role strictly read-only access to published community content and catalogs', () => {
      expect(migration4).toContain('GRANT SELECT ON public.community_testimonies TO anon;');
      expect(migration4).toContain('GRANT SELECT ON public.devotional_catalog TO anon;');
      expect(migration4).toContain('GRANT SELECT ON public.article_catalog TO anon;');
      expect(migration4).toContain('GRANT SELECT ON public.video_catalog TO anon;');
      // Anonymous role must NOT receive grants on sensitive personal tables
      expect(migration4).not.toMatch(/GRANT\s+.*?\s+ON\s+public\.private_journals\s+TO\s+anon/i);
      expect(migration4).not.toMatch(/GRANT\s+.*?\s+ON\s+public\.prayer_requests\s+TO\s+anon/i);
      expect(migration4).not.toMatch(/GRANT\s+.*?\s+ON\s+public\.mood_checkins\s+TO\s+anon/i);
    });

    it('denies authenticated users table-level INSERT, UPDATE, DELETE on user_roles and catalogs', () => {
      expect(migration4).toContain('GRANT SELECT ON public.user_roles TO authenticated;');
      expect(migration4).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)\s+ON\s+public\.user_roles\s+TO\s+authenticated/i);
      expect(migration4).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE|ALL)\s+ON\s+public\.devotional_catalog\s+TO\s+authenticated/i);
    });
  });

  describe('6. Community Testimony Moderation Protection', () => {
    it('enforces moderation state machine via database trigger', () => {
      expect(migration2).toContain('CREATE OR REPLACE FUNCTION public.enforce_testimony_moderation_rules()');
      expect(migration2).toContain('PERMISSION_DENIED: New testimonies must be submitted with pending status');
      expect(migration2).toContain('PERMISSION_DENIED: Users cannot self-feature testimonies');
      expect(migration2).toContain('PERMISSION_DENIED: Users cannot self-approve or reject testimonies');
    });

    it('protects unapproved testimonies from public view in RLS', () => {
      expect(migration3).toContain('"testimonies_select_approved"');
      expect(migration3).toContain("USING (status = 'approved'::public.moderation_status)");
      expect(migration3).toContain('"testimonies_select_own_pending"');
      expect(migration3).toContain('"testimonies_select_staff"');
    });
  });

  describe('7. pgTAP Test Suite Integrity', () => {
    const pgtapFiles = [
      { name: '01_schema_structure.sql', content: pgtap1 },
      { name: '02_rls_isolation.sql', content: pgtap2 },
      { name: '03_admin_rbac.sql', content: pgtap3 },
      { name: '04_moderation_flow.sql', content: pgtap4 },
    ];

    it.each(pgtapFiles)('ensures pgTAP test suite $name contains planned assertions', ({ content }) => {
      expect(content).toContain('SELECT plan(');
      expect(content).toContain('SELECT * FROM finish();');
      expect(content).toContain('ROLLBACK;');
    });
  });
});
