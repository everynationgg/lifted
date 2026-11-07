import { describe, it, expect } from 'vitest';
import migration5 from '../../../../supabase/migrations/20261101000005_ai_gateway_quotas.sql?raw';

describe('Supabase Phase 7: AI Gateway Quota Management, Server Consent & Spending Protection Migration', () => {
  describe('1. Non-Content Quota Schema Structure', () => {
    it('creates table public.ai_usage_quotas with primary key', () => {
      expect(migration5).toContain('CREATE TABLE IF NOT EXISTS public.ai_usage_quotas');
      expect(migration5).toContain('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    });

    it('enforces foreign key constraint to auth.users(id) with ON DELETE CASCADE', () => {
      expect(migration5).toMatch(/user_id UUID NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    });

    it('enforces unique window constraint per user and window type', () => {
      expect(migration5).toContain('CONSTRAINT uq_ai_user_window UNIQUE (user_id, window_type, window_start)');
    });

    it('creates performance index for high-speed rate-limit checks', () => {
      expect(migration5).toContain('CREATE INDEX IF NOT EXISTS idx_ai_usage_user_window');
    });

    it('STRICT PRIVACY: does NOT contain columns for raw user messages or prompts', () => {
      expect(migration5).not.toMatch(/ai_usage_quotas[^;]*\bmessage_text\b/i);
      expect(migration5).not.toMatch(/ai_usage_quotas[^;]*\bprompt_body\b/i);
      expect(migration5).not.toMatch(/ai_usage_quotas[^;]*\bresponse_text\b/i);
      expect(migration5).not.toMatch(/ai_usage_quotas[^;]*\bip_address\b/i);
    });
  });

  describe('2. Server-Side User AI Consent & Idempotency Structure', () => {
    it('creates public.user_ai_consents table with RLS', () => {
      expect(migration5).toContain('CREATE TABLE IF NOT EXISTS public.user_ai_consents');
      expect(migration5).toContain('ALTER TABLE public.user_ai_consents ENABLE ROW LEVEL SECURITY;');
      expect(migration5).toContain('CREATE POLICY "user_ai_consents_select_own"');
      expect(migration5).toContain('CREATE POLICY "user_ai_consents_insert_own"');
      expect(migration5).toContain('CREATE POLICY "user_ai_consents_update_own"');
    });

    it('creates public.ai_request_idempotency ledger', () => {
      expect(migration5).toContain('CREATE TABLE IF NOT EXISTS public.ai_request_idempotency');
      expect(migration5).toContain('ALTER TABLE public.ai_request_idempotency ENABLE ROW LEVEL SECURITY;');
    });

    it('provides server-side consent evaluator functions in app_security', () => {
      expect(migration5).toContain('CREATE OR REPLACE FUNCTION app_security.check_user_ai_consent');
      expect(migration5).toContain('CREATE OR REPLACE FUNCTION app_security.record_user_ai_consent');
      expect(migration5).toContain('CREATE OR REPLACE FUNCTION app_security.revoke_user_ai_consent');
    });
  });

  describe('3. Row Level Security & Defense-in-Depth Permissions', () => {
    it('enables Row Level Security on public.ai_usage_quotas', () => {
      expect(migration5).toContain('ALTER TABLE public.ai_usage_quotas ENABLE ROW LEVEL SECURITY;');
    });

    it('allows authenticated users to view only their own usage quota metrics', () => {
      expect(migration5).toContain('CREATE POLICY "ai_usage_quotas_select_own"');
      expect(migration5).toContain('USING (auth.uid() = user_id)');
    });

    it('strictly revokes INSERT, UPDATE, DELETE permissions from client roles', () => {
      expect(migration5).toContain('REVOKE INSERT, UPDATE, DELETE ON public.ai_usage_quotas FROM anon, authenticated;');
    });

    it('grants full management privileges to service_role', () => {
      expect(migration5).toContain('GRANT ALL ON public.ai_usage_quotas TO service_role;');
    });
  });

  describe('4. Hardened SECURITY DEFINER Quota & Global Spending Evaluator', () => {
    it('places check_and_increment_ai_quota inside private schema app_security', () => {
      expect(migration5).toContain('CREATE OR REPLACE FUNCTION app_security.check_and_increment_ai_quota(');
    });

    it('hardens search_path to empty string (SET search_path = \'\') against hijacking', () => {
      expect(migration5).toMatch(/check_and_increment_ai_quota[\s\S]*?SET search_path = ''/);
    });

    it('fully qualifies all catalog and schema calls in quota function', () => {
      expect(migration5).toContain('pg_catalog.date_trunc(');
      expect(migration5).toContain('COALESCE(');
      expect(migration5).toContain('public.ai_usage_quotas');
    });

    it('enforces burst, daily, and global ceiling limits', () => {
      expect(migration5).toContain('BURST_LIMIT_EXCEEDED');
      expect(migration5).toContain('DAILY_QUOTA_EXCEEDED');
      expect(migration5).toContain('GLOBAL_CEILING_EXCEEDED');
      expect(migration5).toContain('ALLOWED');
    });

    it('provides prune_expired_ai_quotas routine with hardened search_path', () => {
      expect(migration5).toContain('CREATE OR REPLACE FUNCTION app_security.prune_expired_ai_quotas()');
      expect(migration5).toMatch(/prune_expired_ai_quotas[\s\S]*?SET search_path = ''/);
    });

    it('restricts execution privileges to service_role only', () => {
      expect(migration5).toContain('REVOKE ALL ON FUNCTION app_security.check_and_increment_ai_quota(UUID, INT, INT, INT, INT) FROM PUBLIC;');
      expect(migration5).toContain('GRANT EXECUTE ON FUNCTION app_security.check_and_increment_ai_quota(UUID, INT, INT, INT, INT) TO service_role;');
      expect(migration5).toContain('REVOKE ALL ON FUNCTION app_security.prune_expired_ai_quotas() FROM PUBLIC;');
      expect(migration5).toContain('GRANT EXECUTE ON FUNCTION app_security.prune_expired_ai_quotas() TO service_role;');
    });
  });
});
