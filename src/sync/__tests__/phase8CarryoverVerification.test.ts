/**
 * Phase 8 Carryover Verification Suite (Phase 9 Carryover Remediation Gate)
 * Formally verifies and proves the remediation of the three carryover issues:
 * A. Null Expected Revision:
 *    Proves sending NULL expected_revision on existing records is strictly rejected
 *    with CONFLICT_STALE_REVISION, while valid initial inserts (revision 1) and matching
 *    updates (revision 2 with expected_revision = 1) succeed.
 * B. Second-Device Recovery Bootstrap:
 *    Proves direct table SELECT on user_account_keys remains fail-closed (0 rows),
 *    while the dedicated app_security.get_recovery_bootstrap_envelope() RPC enables
 *    a freshly authenticated, unenrolled device to retrieve wrapped AEK before enrolling
 *    without exposing plaintext keys or personal journals.
 * C. Revoked Device with a New Device ID:
 *    Proves a revoked device retaining its pre-revocation session CANNOT enroll a
 *    new device ID (e.g. dev-c-new-id). Re-authentication is strictly required.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe('Phase 8 Carryover Verification & Remediation Gate', () => {
  let adminClient: SupabaseClient;
  let userClient: SupabaseClient;
  let testUserId: string;
  let testUserJwt: string;
  const timestamp = Date.now();
  const testEmail = `carryover-gate-${timestamp}@test.lifted.app`;
  const testPassword = 'Password123!SafeGate';

  const dev1Id = `dev-gate-1-${timestamp}`;
  const dev1Token = 'device-token-1-secret-123456';

  beforeAll(async () => {
    adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: userAuth, error: createErr } = await adminClient.auth.admin.createUser({
      email: testEmail,
      password: testPassword,
      email_confirm: true,
    });
    if (createErr) throw createErr;
    testUserId = userAuth.user.id;

    userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: loginData, error: loginErr } = await userClient.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });
    if (loginErr) throw loginErr;
    testUserJwt = loginData.session.access_token;

    // Enroll Device 1
    const { data: enroll1, error: enroll1Err } = await userClient.rpc('enroll_sync_device', {
      p_device_id: dev1Id,
      p_platform: 'android',
      p_app_version: '1.0.0',
      p_device_token: dev1Token,
      p_device_nickname: 'Phone 1',
    });
    if (enroll1Err) throw enroll1Err;
    expect(enroll1.status).toBe('ENROLLED');
  });

  afterAll(async () => {
    if (testUserId) {
      await adminClient.auth.admin.deleteUser(testUserId);
    }
  });

  // ------------------------------------------------------------------------
  // A. Null Expected Revision
  // ------------------------------------------------------------------------
  describe('A. Null Expected Revision Closure', () => {
    it('requires expected_revision for existing updates, while valid first inserts and matching updates succeed', async () => {
      const recordId = `rec-null-rev-${timestamp}`;

      // 1. Initial insert of record: NULL expected_revision is valid on first insert
      const { data: insertRes, error: insertErr } = await userClient.rpc('sync_upsert_journal', {
        p_client_record_id: recordId,
        p_encrypted_envelope: { v: 1, ct: 'initial-encrypted-content' },
        p_sync_revision: 1,
        p_idempotency_key: `idem-first-insert-${timestamp}`,
        p_client_updated_at: timestamp,
        p_device_id: dev1Id,
        p_device_token: dev1Token,
        p_expected_revision: null, // First insert
      });
      expect(insertErr).toBeNull();
      expect(insertRes.status).toBe('INSERTED');
      expect(insertRes.server_revision).toBe(1);

      // 2. Legitimate update to revision 2 with matching expected_revision = 1
      const { data: updateRes1, error: update1Err } = await userClient.rpc('sync_upsert_journal', {
        p_client_record_id: recordId,
        p_encrypted_envelope: { v: 1, ct: 'updated-content-rev-2' },
        p_sync_revision: 2,
        p_idempotency_key: `idem-legit-update-${timestamp}`,
        p_client_updated_at: timestamp + 1000,
        p_device_id: dev1Id,
        p_device_token: dev1Token,
        p_expected_revision: 1, // Valid expected base
      });
      expect(update1Err).toBeNull();
      expect(updateRes1.status).toBe('UPDATED');
      expect(updateRes1.server_revision).toBe(2);

      // 3. Stale client sends update with NULL expected_revision and arbitrary sync_revision (9999)
      const { data: staleNullRes, error: staleNullErr } = await userClient.rpc('sync_upsert_journal', {
        p_client_record_id: recordId,
        p_encrypted_envelope: { v: 1, ct: 'attack-null-expected' },
        p_sync_revision: 9999,
        p_idempotency_key: `idem-null-attack-${timestamp}`,
        p_client_updated_at: timestamp + 2000,
        p_device_id: dev1Id,
        p_device_token: dev1Token,
        p_expected_revision: null, // NULL EXPECTED REVISION IS NOW STRICTLY REJECTED!
      });
      expect(staleNullErr).toBeNull();
      expect(staleNullRes.status).toBe('CONFLICT_STALE_REVISION');
      expect(staleNullRes.server_revision).toBe(2);
      expect(staleNullRes.message).toContain('expected base revision');
    });
  });

  // ------------------------------------------------------------------------
  // B. Second-Device Recovery Bootstrap
  // ------------------------------------------------------------------------
  describe('B. Second-Device Recovery Bootstrap', () => {
    it('keeps direct table SELECT fail-closed while providing narrowly authorized recovery bootstrap RPC', async () => {
      // 1. Device 1 uploads wrapped AEK
      const clientWithDev1Headers = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${testUserJwt}`,
            'x-device-id': dev1Id,
            'x-device-token': dev1Token,
          },
        },
      });

      const wrappedPayload = {
        v: 1,
        alg: 'AES-GCM-256',
        kdf: 'HKDF-SHA256',
        salt: 'c2FsdC1iYXNlNjQtdmFsdWU=',
        iv: 'aXYtYmFzZTY0LXZhbHVl',
        ct: 'Y2lwaGVydGV4dC1iYXNlNjQtdmFsdWU=',
        aad: { userId: testUserId, keyVersion: 1, domain: 'test' },
      };

      const { error: keyInsertErr } = await clientWithDev1Headers.from('user_account_keys').insert({
        user_id: testUserId,
        wrapped_aek: wrappedPayload,
        kdf_algorithm: 'HKDF-SHA256',
      });
      expect(keyInsertErr).toBeNull();

      // 2. Device 2: Brand new unenrolled device signs in via Auth
      const dev2Client = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${testUserJwt}`,
          },
        },
      });

      // Direct SELECT on user_account_keys remains fail-closed (0 rows)
      const { data: dev2DirectSelect } = await dev2Client
        .from('user_account_keys')
        .select('*')
        .eq('user_id', testUserId);
      expect(dev2DirectSelect).toEqual([]);

      // 3. Narrowly authorized recovery bootstrap RPC succeeds for authenticated session
      const { data: bootstrapRes, error: bootstrapErr } = await dev2Client.rpc('get_recovery_bootstrap_envelope');
      expect(bootstrapErr).toBeNull();
      expect(bootstrapRes.status).toBe('FOUND');
      expect(bootstrapRes.key_version).toBe(1);
      expect(bootstrapRes.wrapped_aek.ct).toBe(wrappedPayload.ct);
      expect(bootstrapRes.kdf_algorithm).toBe('HKDF-SHA256');
    });
  });

  // ------------------------------------------------------------------------
  // C. Revoked Device with a New Device ID
  // ------------------------------------------------------------------------
  describe('C. Revoked Device Boundary Closure', () => {
    it('strictly prohibits a revoked device session from enrolling a new device ID without re-authentication', async () => {
      const devBId = `dev-b-revoke-${timestamp}`;
      const devBToken = 'token-dev-b-secret-123456';

      // 1. Enroll Device B
      const { data: enrollB } = await userClient.rpc('enroll_sync_device', {
        p_device_id: devBId,
        p_platform: 'ios',
        p_app_version: '1.0.0',
        p_device_token: devBToken,
        p_device_nickname: 'iPhone 12',
      });
      expect(enrollB.status).toBe('ENROLLED');

      // 2. Revoke Device B
      const { data: revokedStatus } = await userClient.rpc('revoke_sync_device', {
        p_device_id: devBId,
      });
      expect(revokedStatus).toBe(true);

      // 3. Revoked device holding pre-revocation JWT attempts to enroll a BRAND NEW device ID 'dev-c-bypass'
      const clientRevokedHolder = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${testUserJwt}`, // Session issued BEFORE revocation
            'x-device-id': 'dev-c-bypass',
          },
        },
      });

      const { data: bypassRes, error: bypassErr } = await clientRevokedHolder.rpc('enroll_sync_device', {
        p_device_id: 'dev-c-bypass',
        p_platform: 'android',
        p_app_version: '1.0.0',
        p_device_token: 'new-bypass-token-secret-123',
        p_device_nickname: 'Sneaky Bypass Device',
      });

      // Enrollment MUST be rejected because the session predates device revocation!
      expect(bypassRes).toBeNull();
      expect(bypassErr).toBeDefined();
      expect(bypassErr?.message).toContain('REJECTED_DEVICE_REVOKED');
      expect(bypassErr?.message).toContain('Re-authentication required');

      // 4. Legitimate re-authentication produces fresh session that CAN enroll
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const { data: freshLogin, error: freshLoginErr } = await userClient.auth.signInWithPassword({
        email: testEmail,
        password: testPassword,
      });
      expect(freshLoginErr).toBeNull();
      expect(freshLogin.session).not.toBeNull();
      const freshJwt = freshLogin.session!.access_token;

      const clientFreshReauth = createClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          headers: {
            Authorization: `Bearer ${freshJwt}`,
            'x-device-id': 'dev-c-legit',
          },
        },
      });

      const { data: legitEnrollRes, error: legitEnrollErr } = await clientFreshReauth.rpc('enroll_sync_device', {
        p_device_id: 'dev-c-legit',
        p_platform: 'android',
        p_app_version: '1.0.0',
        p_device_token: 'new-legit-token-secret-123',
        p_device_nickname: 'Legitimate New Device',
      });

      expect(legitEnrollErr).toBeNull();
      expect(legitEnrollRes.status).toBe('ENROLLED');
    });
  });
});
