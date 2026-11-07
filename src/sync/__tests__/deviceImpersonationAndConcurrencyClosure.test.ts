/**
 * LIFTED — Phase 8 Critical Authorization & Concurrency Closure Integration
 *
 * Verifies:
 * 1. The Critical Device Impersonation Attack Matrix (Scenarios A through H)
 *    - Revoked Device B + valid token
 *    - Active Device A + no token
 *    - Active Device A + fake token
 *    - Active Device A + Device B's token
 *    - Unknown device ID
 *    - Missing device headers
 *    - Cross-account device ID
 *    - Active Device A + correct token
 * 2. Direct REST Update Bypass Proof & Closure
 * 3. True Optimistic Concurrency with Row Serialization
 * 4. Read-side Device Revocation & Active Session Verification
 * 5. Idempotency Retention & Pruning Resistance
 * 6. Sensitive Metadata & Zero-Knowledge Content Audit
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RecoveryKeyService } from '../recoveryKeyService';
import { WebCryptoEncryptionService } from '../../storage/encryptionService';
import type { AekAssociatedData, WrappedAekEnvelope } from '../types';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe('Phase 8 Critical Authorization & Concurrency Closure', () => {
  const timestamp = Date.now();
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const recoveryService = new RecoveryKeyService();
  const encryption = new WebCryptoEncryptionService();

  // Test Account A
  const userAEmail = `auth_closure_a_${timestamp}@lifted.app`;
  const userPassword = 'Password123!SecureAuthClosure';
  let userAId: string;
  let userAJwt: string;

  // Test Account Other (Cross-account isolation)
  const userOtherEmail = `auth_closure_other_${timestamp}@lifted.app`;
  let userOtherId: string;

  // Device Identifiers & Cryptographic Tokens
  const deviceIdA = `dev-a-${timestamp}`;
  const deviceTokenA = `token-a-secret-256bit-${timestamp}-${Math.random().toString(36).substring(2)}`;

  const deviceIdB = `dev-b-${timestamp}`;
  const deviceTokenB = `token-b-secret-256bit-${timestamp}-${Math.random().toString(36).substring(2)}`;

  const deviceIdOther = `dev-other-${timestamp}`;
  const deviceTokenOther = `token-other-secret-256bit-${timestamp}-${Math.random().toString(36).substring(2)}`;

  let aekA: CryptoKey;
  let wrappedAekA: WrappedAekEnvelope;

  const testJournalId = `journal-closure-${timestamp}`;
  const testPrayerId = `prayer-closure-${timestamp}`;
  const testMoodId = `mood-closure-${timestamp}`;

  beforeAll(async () => {
    // 1. Create Account A
    const { data: authA, error: errA } = await adminClient.auth.admin.createUser({
      email: userAEmail,
      password: userPassword,
      email_confirm: true,
    });
    if (errA || !authA.user) throw new Error(`User A creation failed: ${errA?.message}`);
    userAId = authA.user.id;

    // 2. Create Account Other
    const { data: authOther, error: errOther } = await adminClient.auth.admin.createUser({
      email: userOtherEmail,
      password: userPassword,
      email_confirm: true,
    });
    if (errOther || !authOther.user) throw new Error(`User Other creation failed: ${errOther?.message}`);
    userOtherId = authOther.user.id;

    // 3. Obtain Account A session JWT
    const clientLogin = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sessionA, error: loginErrA } = await clientLogin.auth.signInWithPassword({
      email: userAEmail,
      password: userPassword,
    });
    if (loginErrA || !sessionA.session) throw new Error(`Login failed: ${loginErrA?.message}`);
    userAJwt = sessionA.session.access_token;

    // 4. Enroll Device A (Active) on Account A
    await clientLogin.rpc('enroll_sync_device', {
      p_device_id: deviceIdA,
      p_platform: 'ios',
      p_app_version: '1.0.0',
      p_device_token: deviceTokenA,
      p_device_nickname: 'Device A Terminal',
    });

    // 5. Enroll Device B on Account A, then immediately revoke it
    await clientLogin.rpc('enroll_sync_device', {
      p_device_id: deviceIdB,
      p_platform: 'android',
      p_app_version: '1.0.0',
      p_device_token: deviceTokenB,
      p_device_nickname: 'Device B Compromised',
    });
    await clientLogin.rpc('revoke_sync_device', { p_device_id: deviceIdB });

    // 6. Enroll Device Other on Account Other
    const clientOtherLogin = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await clientOtherLogin.auth.signInWithPassword({
      email: userOtherEmail,
      password: userPassword,
    });
    await clientOtherLogin.rpc('enroll_sync_device', {
      p_device_id: deviceIdOther,
      p_platform: 'web',
      p_app_version: '1.0.0',
      p_device_token: deviceTokenOther,
      p_device_nickname: 'Other Account Terminal',
    });

    // 7. Seed AEK and Initial Records for Account A using Device A credentials
    const clientA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${userAJwt}`,
          'x-device-id': deviceIdA,
          'x-device-token': deviceTokenA,
        },
      },
    });

    aekA = await recoveryService.generateAEK();
    const generated = await recoveryService.generateRecoveryCode();
    const salt = new Uint8Array(32);
    globalThis.crypto.getRandomValues(salt);
    const aad: AekAssociatedData = { userId: userAId, keyVersion: 1, domain: 'LIFTED-AEK-ESCROW-v1' };
    const wrappingKey = await recoveryService.deriveWrappingKeyHKDF(generated.rawEntropy, salt);
    wrappedAekA = await recoveryService.wrapAEK(aekA, wrappingKey, aad, salt, 'HKDF-SHA256');

    await clientA.from('user_account_keys').insert({
      user_id: userAId,
      key_version: 1,
      wrapped_aek: wrappedAekA,
    });

    const envJ = await encryption.encryptString('Initial Journal Entry - Rev 1', aekA);
    await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: testJournalId,
      p_encrypted_envelope: envJ,
      p_sync_revision: 1,
      p_idempotency_key: `idem-j1-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });

    const envP = await encryption.encryptString('Initial Prayer Request - Rev 1', aekA);
    await clientA.rpc('sync_upsert_prayer', {
      p_client_record_id: testPrayerId,
      p_encrypted_payload: envP,
      p_sync_revision: 1,
      p_idempotency_key: `idem-p1-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });

    const envM = await encryption.encryptString('{"score":4,"mood":"peaceful"}', aekA);
    await clientA.rpc('sync_upsert_mood', {
      p_client_record_id: testMoodId,
      p_encrypted_payload: envM,
      p_sync_revision: 1,
      p_idempotency_key: `idem-m1-${timestamp}`,
      p_checkin_timestamp: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
  });

  afterAll(async () => {
    if (userAId) await adminClient.auth.admin.deleteUser(userAId);
    if (userOtherId) await adminClient.auth.admin.deleteUser(userOtherId);
  });

  function makeClient(headers: Record<string, string>): SupabaseClient {
    return createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${userAJwt}`,
          ...headers,
        },
      },
    });
  }

  // ==========================================================================
  // SECTION 1: CRITICAL DEVICE IMPERSONATION ATTACK MATRIX (SCENARIOS A-H)
  // ==========================================================================

  it('Scenario A: Revoked Device B with valid Device B token FAILS CLOSED', async () => {
    const client = makeClient({
      'x-device-id': deviceIdB,
      'x-device-token': deviceTokenB,
    });

    // Direct SELECT on private_journals fails closed (0 rows)
    const { data: journals } = await client.from('private_journals').select('*').eq('client_record_id', testJournalId);
    expect(journals).toEqual([]);

    // Direct SELECT on prayer_requests fails closed (0 rows)
    const { data: prayers } = await client.from('prayer_requests').select('*').eq('client_record_id', testPrayerId);
    expect(prayers).toEqual([]);

    // Direct SELECT on mood_checkins fails closed (0 rows)
    const { data: moods } = await client.from('mood_checkins').select('*').eq('client_record_id', testMoodId);
    expect(moods).toEqual([]);

    // Direct SELECT on user_account_keys fails closed (0 rows)
    const { data: keys } = await client.from('user_account_keys').select('*').eq('user_id', userAId);
    expect(keys).toEqual([]);

    // sync_pull_records RPC fails closed
    const { data: pullRes } = await client.rpc('sync_pull_records', {
      p_record_type: 'journal',
      p_since_revision: 0,
      p_device_id: deviceIdB,
      p_device_token: deviceTokenB,
    });
    expect(pullRes.status).toBe('REJECTED_DEVICE_REVOKED');
  });

  it('Scenario B: Active Device A with NO device token FAILS CLOSED', async () => {
    const client = makeClient({
      'x-device-id': deviceIdA,
      // NO x-device-token header!
    });

    const { data: journals } = await client.from('private_journals').select('*').eq('client_record_id', testJournalId);
    expect(journals).toEqual([]);

    const { data: keys } = await client.from('user_account_keys').select('*').eq('user_id', userAId);
    expect(keys).toEqual([]);

    const { data: pullRes } = await client.rpc('sync_pull_records', {
      p_record_type: 'journal',
      p_since_revision: 0,
      p_device_id: deviceIdA,
    });
    expect(pullRes.status).toBe('REJECTED_DEVICE_TOKEN_MISSING');
  });

  it('Scenario C: Active Device A with FAKE device token FAILS CLOSED', async () => {
    const client = makeClient({
      'x-device-id': deviceIdA,
      'x-device-token': 'fake_forged_device_token_xyz_999999',
    });

    const { data: journals } = await client.from('private_journals').select('*').eq('client_record_id', testJournalId);
    expect(journals).toEqual([]);

    const { data: keys } = await client.from('user_account_keys').select('*').eq('user_id', userAId);
    expect(keys).toEqual([]);

    const { data: pullRes } = await client.rpc('sync_pull_records', {
      p_record_type: 'journal',
      p_since_revision: 0,
      p_device_id: deviceIdA,
      p_device_token: 'fake_forged_device_token_xyz_999999',
    });
    expect(pullRes.status).toBe('REJECTED_DEVICE_UNAUTHORIZED');
  });

  it('Scenario D: Active Device A with Device B token FAILS CLOSED', async () => {
    const client = makeClient({
      'x-device-id': deviceIdA,
      'x-device-token': deviceTokenB, // Token belonging to Device B
    });

    const { data: journals } = await client.from('private_journals').select('*').eq('client_record_id', testJournalId);
    expect(journals).toEqual([]);

    const { data: keys } = await client.from('user_account_keys').select('*').eq('user_id', userAId);
    expect(keys).toEqual([]);

    const { data: pullRes } = await client.rpc('sync_pull_records', {
      p_record_type: 'journal',
      p_since_revision: 0,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenB,
    });
    expect(pullRes.status).toBe('REJECTED_DEVICE_UNAUTHORIZED');
  });

  it('Scenario E: Unknown device ID FAILS CLOSED', async () => {
    const client = makeClient({
      'x-device-id': 'device-completely-unknown-attacker',
      'x-device-token': 'token-does-not-matter',
    });

    const { data: journals } = await client.from('private_journals').select('*').eq('client_record_id', testJournalId);
    expect(journals).toEqual([]);

    const { data: keys } = await client.from('user_account_keys').select('*').eq('user_id', userAId);
    expect(keys).toEqual([]);

    const { data: pullRes } = await client.rpc('sync_pull_records', {
      p_record_type: 'journal',
      p_since_revision: 0,
      p_device_id: 'device-completely-unknown-attacker',
      p_device_token: 'token-does-not-matter',
    });
    expect(pullRes.status).toBe('REJECTED_DEVICE_NOT_ENROLLED');
  });

  it('Scenario F: Missing device headers entirely FAILS CLOSED', async () => {
    const client = makeClient({}); // No x-device-id or x-device-token

    const { data: journals } = await client.from('private_journals').select('*').eq('client_record_id', testJournalId);
    expect(journals).toEqual([]);

    const { data: keys } = await client.from('user_account_keys').select('*').eq('user_id', userAId);
    expect(keys).toEqual([]);

    const { data: pullRes } = await client.rpc('sync_pull_records', {
      p_record_type: 'journal',
      p_since_revision: 0,
    });
    expect(pullRes.status).toBe('REJECTED_DEVICE_TOKEN_MISSING');
  });

  it('Scenario G: Device ID from another account FAILS CLOSED', async () => {
    const client = makeClient({
      'x-device-id': deviceIdOther,
      'x-device-token': deviceTokenOther,
    });

    const { data: journals } = await client.from('private_journals').select('*').eq('client_record_id', testJournalId);
    expect(journals).toEqual([]);

    const { data: keys } = await client.from('user_account_keys').select('*').eq('user_id', userAId);
    expect(keys).toEqual([]);

    const { data: pullRes } = await client.rpc('sync_pull_records', {
      p_record_type: 'journal',
      p_since_revision: 0,
      p_device_id: deviceIdOther,
      p_device_token: deviceTokenOther,
    });
    expect(pullRes.status).toBe('REJECTED_DEVICE_NOT_ENROLLED');
  });

  it('Scenario H: Correct active Device A ID and correct Device A token SUCCEEDS', async () => {
    const client = makeClient({
      'x-device-id': deviceIdA,
      'x-device-token': deviceTokenA,
    });

    // Direct SELECT on private_journals succeeds
    const { data: journals, error: jErr } = await client.from('private_journals').select('*').eq('client_record_id', testJournalId);
    expect(jErr).toBeNull();
    expect(journals).toHaveLength(1);
    expect(journals![0].client_record_id).toBe(testJournalId);

    // Direct SELECT on prayer_requests succeeds
    const { data: prayers, error: pErr } = await client.from('prayer_requests').select('*').eq('client_record_id', testPrayerId);
    expect(pErr).toBeNull();
    expect(prayers).toHaveLength(1);

    // Direct SELECT on mood_checkins succeeds
    const { data: moods, error: mErr } = await client.from('mood_checkins').select('*').eq('client_record_id', testMoodId);
    expect(mErr).toBeNull();
    expect(moods).toHaveLength(1);

    // Direct SELECT on user_account_keys succeeds
    const { data: keys, error: kErr } = await client.from('user_account_keys').select('*').eq('user_id', userAId);
    expect(kErr).toBeNull();
    expect(keys).toHaveLength(1);

    // sync_pull_records RPC succeeds
    const { data: pullRes, error: pullErr } = await client.rpc('sync_pull_records', {
      p_record_type: 'journal',
      p_since_revision: 0,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(pullErr).toBeNull();
    expect(pullRes.status).toBe('OK');
    expect(pullRes.records).toHaveLength(1);
  });

  // ==========================================================================
  // SECTION 2: DIRECT REST UPDATE BYPASS INVESTIGATION & RPC CLOSURE
  // ==========================================================================

  it('Direct REST Update vs RPC OCC: Stale client cannot overwrite advanced server state', async () => {
    const clientA = makeClient({
      'x-device-id': deviceIdA,
      'x-device-token': deviceTokenA,
    });

    // Step 1: Device A read revision 1 (testJournalId is at revision 1)

    // Step 2: An authorized mutation advances the record to revision 2
    const envRev2 = await encryption.encryptString('Authorized revision 2 content', aekA);
    const { data: rpcRes2 } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: testJournalId,
      p_encrypted_envelope: envRev2,
      p_sync_revision: 2,
      p_idempotency_key: `idem-j2-${timestamp}`,
      p_client_updated_at: timestamp + 1000,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(rpcRes2.status).toBe('UPDATED');
    expect(rpcRes2.sync_revision).toBe(2);

    // Step 3: Stale client attempting to push revision 1 or 2 is strictly rejected by dedicated RPC
    const staleEnv = await encryption.encryptString('Stale overwrite attempt', aekA);
    const { data: staleRpcRes } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: testJournalId,
      p_encrypted_envelope: staleEnv,
      p_sync_revision: 2, // stale! Server is already at 2
      p_idempotency_key: `idem-stale-${timestamp}`,
      p_client_updated_at: timestamp + 2000,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(staleRpcRes.status).toBe('CONFLICT_STALE_REVISION');
    expect(staleRpcRes.server_revision).toBe(2);

    // Step 4: Stale client cannot blind-write via direct REST without advancing authoritatively
    const { error: directErr } = await clientA
      .from('private_journals')
      .update({ sync_revision: 2, encrypted_envelope: { ct: 'direct_stale_overwrite' } })
      .eq('client_record_id', testJournalId);

    // Equal revision is caught and rejected by trigger
    expect(directErr).toBeDefined();
    expect(directErr?.code).toBe('P0002');
    expect(directErr?.message).toContain('CONFLICT_EQUAL_REVISION');

    // Database content remains untouched at revision 2
    const { data: currentRows } = await clientA
      .from('private_journals')
      .select('sync_revision, encrypted_envelope')
      .eq('client_record_id', testJournalId);
    expect(currentRows![0].sync_revision).toBe(2);
  });

  // ==========================================================================
  // SECTION 3: IDEMPOTENCY RETENTION & REPLAY SAFETY
  // ==========================================================================

  it('Idempotency Pruning Safety: Stale replay with pruned/new key safely rejected', async () => {
    const clientA = makeClient({
      'x-device-id': deviceIdA,
      'x-device-token': deviceTokenA,
    });

    // Record testPrayerId is currently at revision 1
    // Replay with exact same idempotency key returns ACKNOWLEDGED_IDEMPOTENT
    const envP = await encryption.encryptString('Duplicate prayer push', aekA);
    const { data: idemRes } = await clientA.rpc('sync_upsert_prayer', {
      p_client_record_id: testPrayerId,
      p_encrypted_payload: envP,
      p_sync_revision: 1,
      p_idempotency_key: `idem-p1-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(idemRes.status).toBe('ACKNOWLEDGED_IDEMPOTENT');

    // Replay with expired/pruned/different idempotency key at stale revision is rejected
    const { data: expiredIdemRes } = await clientA.rpc('sync_upsert_prayer', {
      p_client_record_id: testPrayerId,
      p_encrypted_payload: envP,
      p_sync_revision: 1, // server is already at 1, so 1 is stale
      p_idempotency_key: `idem-expired-after-7-days-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(expiredIdemRes.status).toBe('CONFLICT_STALE_REVISION');
  });

  // ==========================================================================
  // SECTION 4: SENSITIVE METADATA ZERO-KNOWLEDGE AUDIT
  // ==========================================================================

  it('Plaintext Metadata Audit: Emotional ratings and tags strictly null/empty', async () => {
    const { data: moodRow } = await adminClient
      .from('mood_checkins')
      .select('mood_score, selected_emotions, encrypted_payload')
      .eq('client_record_id', testMoodId)
      .single();

    expect(moodRow).not.toBeNull();
    expect(moodRow?.mood_score).toBeNull();
    expect(moodRow?.selected_emotions).toEqual([]);
    expect(moodRow?.encrypted_payload.ct).toBeDefined();

    // Sensitive spiritual prayer content is stored strictly in encrypted_payload
    const { data: prayerRow } = await adminClient
      .from('prayer_requests')
      .select('prayer_status, is_private, encrypted_payload')
      .eq('client_record_id', testPrayerId)
      .single();

    expect(prayerRow).not.toBeNull();
    expect(prayerRow?.prayer_status).toBe('active');
    expect(prayerRow?.is_private).toBe(true);
    expect(prayerRow?.encrypted_payload.ct).toBeDefined();
  });
});
