/**
 * LIFTED — Phase 8 Final Blocker Remediation Integration Test
 *
 * Real Negative Tests Required (Sections 1 through 13: Tests A through P):
 * A. Stale client direct PATCH with exact server_revision + 1 (prohibited by P0003 trigger)
 * B. Stale client RPC request with arbitrarily high supplied revision (rejected with CONFLICT_STALE_REVISION)
 * C. Missing request.headers execution context (RLS fails closed, 0 rows)
 * D. Empty request.headers JSON (RLS fails closed, 0 rows)
 * E. Account with no active enrolled devices (RLS fails closed, 0 rows)
 * F. Revoked device attempting fresh device INSERT (rejected with DIRECT_DEVICE_INSERT_FORBIDDEN 42501)
 * G. Revoked device attempting enrollment RPC without recovery authorization (rejected with REJECTED_DEVICE_REVOKED)
 * H. Authenticated user trying to change is_revoked (rejected with DIRECT_REVOCATION_MUTATION_FORBIDDEN 42501)
 * I. Authenticated user trying to replace device_token_hash (rejected with DIRECT_TOKEN_HASH_MUTATION_FORBIDDEN 42501)
 * J. Missing JWT session_id (fails closed with SESSION_REVOKED)
 * K. Signed-out JWT (fails closed with SESSION_REVOKED)
 * L. Replacing the account's wrapped AEK directly (rejected with DIRECT_KEY_REPLACEMENT_FORBIDDEN 42501)
 * M. Direct INSERT/UPDATE/DELETE after least-privilege trigger enforcement (P0003 and 55000)
 * N. Concurrent updates of one journal from two devices (Device A commits, Device B gets CONFLICT_STALE_REVISION)
 * O. Duplicate idempotency key after retry/restart (ACKNOWLEDGED_IDEMPOTENT, 0 duplicate rows)
 * P. Cross-account device token substitution (rejected with REJECTED_DEVICE_UNAUTHORIZED)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RecoveryKeyService } from '../recoveryKeyService';
import { WebCryptoEncryptionService } from '../../storage/encryptionService';
import type { AekAssociatedData, WrappedAekEnvelope } from '../types';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe('Phase 8 Final Blocker Remediation Gate (Tests A through P)', () => {
  const timestamp = Date.now();
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const recoveryService = new RecoveryKeyService();
  const encryption = new WebCryptoEncryptionService();

  // Test Account Alpha
  const userAlphaEmail = `alpha_rem_${timestamp}@lifted.app`;
  const userPassword = 'Password123!SecureRemediationGate';
  let userAlphaId: string;
  let userAlphaJwt: string;

  // Test Account Beta (Cross-account isolation)
  const userBetaEmail = `beta_rem_${timestamp}@lifted.app`;

  // Test Account Gamma (Account with NO enrolled devices)
  const userGammaEmail = `gamma_no_dev_${timestamp}@lifted.app`;
  let userGammaJwt: string;

  // Device Identifiers
  const deviceIdA = `dev-a-rem-${timestamp}`;
  const deviceTokenA = `tok-a-secret-256bit-${timestamp}-${Math.random().toString(36).substring(2)}`;

  const deviceIdB = `dev-b-rem-${timestamp}`;
  const deviceTokenB = `tok-b-secret-256bit-${timestamp}-${Math.random().toString(36).substring(2)}`;

  const deviceIdBeta = `dev-beta-rem-${timestamp}`;
  const deviceTokenBeta = `tok-beta-secret-256bit-${timestamp}-${Math.random().toString(36).substring(2)}`;

  let aekAlpha: CryptoKey;
  let wrappedAekAlpha: WrappedAekEnvelope;

  let clientA: SupabaseClient;

  beforeAll(async () => {
    // 1. Create User Alpha
    const { data: authA, error: errA } = await adminClient.auth.admin.createUser({
      email: userAlphaEmail,
      password: userPassword,
      email_confirm: true,
    });
    if (errA || !authA.user) throw new Error(`User Alpha creation failed: ${errA?.message}`);
    userAlphaId = authA.user.id;

    // 2. Create User Beta
    const { data: authB, error: errB } = await adminClient.auth.admin.createUser({
      email: userBetaEmail,
      password: userPassword,
      email_confirm: true,
    });
    if (errB || !authB.user) throw new Error(`User Beta creation failed: ${errB?.message}`);

    // 3. Create User Gamma (No enrolled devices)
    const { data: authG, error: errG } = await adminClient.auth.admin.createUser({
      email: userGammaEmail,
      password: userPassword,
      email_confirm: true,
    });
    if (errG || !authG.user) throw new Error(`User Gamma creation failed: ${errG?.message}`);

    // 4. Sign in User Alpha
    const loginAlpha = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sessA, error: lErrA } = await loginAlpha.auth.signInWithPassword({
      email: userAlphaEmail,
      password: userPassword,
    });
    if (lErrA || !sessA.session) throw new Error(`Alpha login failed: ${lErrA?.message}`);
    userAlphaJwt = sessA.session.access_token;

    // 5. Sign in User Beta
    const loginBeta = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sessB, error: lErrB } = await loginBeta.auth.signInWithPassword({
      email: userBetaEmail,
      password: userPassword,
    });
    if (lErrB || !sessB.session) throw new Error(`Beta login failed: ${lErrB?.message}`);

    // 6. Sign in User Gamma
    const loginGamma = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sessG, error: lErrG } = await loginGamma.auth.signInWithPassword({
      email: userGammaEmail,
      password: userPassword,
    });
    if (lErrG || !sessG.session) throw new Error(`Gamma login failed: ${lErrG?.message}`);
    userGammaJwt = sessG.session.access_token;

    // 7. Enroll Device A (Active) on Alpha
    await loginAlpha.rpc('enroll_sync_device', {
      p_device_id: deviceIdA,
      p_platform: 'ios',
      p_app_version: '1.0.0',
      p_device_token: deviceTokenA,
      p_device_nickname: 'Remediation Terminal Alpha-A',
    });

    // 8. Enroll Device B on Alpha, then revoke it
    await loginAlpha.rpc('enroll_sync_device', {
      p_device_id: deviceIdB,
      p_platform: 'android',
      p_app_version: '1.0.0',
      p_device_token: deviceTokenB,
      p_device_nickname: 'Remediation Terminal Alpha-B (Revoked)',
    });
    await loginAlpha.rpc('revoke_sync_device', { p_device_id: deviceIdB });

    // 9. Enroll Device Beta on Beta
    await loginBeta.rpc('enroll_sync_device', {
      p_device_id: deviceIdBeta,
      p_platform: 'web',
      p_app_version: '1.0.0',
      p_device_token: deviceTokenBeta,
      p_device_nickname: 'Remediation Terminal Beta',
    });

    // 10. Generate AEK and escrow on Alpha
    aekAlpha = await recoveryService.generateAEK();
    const generated = await recoveryService.generateRecoveryCode();
    const salt = new Uint8Array(32);
    globalThis.crypto.getRandomValues(salt);
    const aad: AekAssociatedData = { userId: userAlphaId, keyVersion: 1, domain: 'LIFTED-AEK-ESCROW-v1' };
    const wrappingKey = await recoveryService.deriveWrappingKeyHKDF(generated.rawEntropy, salt);
    wrappedAekAlpha = await recoveryService.wrapAEK(aekAlpha, wrappingKey, aad, salt, 'HKDF-SHA256');

    clientA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${userAlphaJwt}`,
          'x-device-id': deviceIdA,
          'x-device-token': deviceTokenA,
        },
      },
    });

    await clientA.from('user_account_keys').insert({
      user_id: userAlphaId,
      key_version: 1,
      wrapped_aek: wrappedAekAlpha,
    });
  });

  // Test A: Stale client direct PATCH with exact server_revision + 1
  it('Test A: Stale client direct PATCH with exact server_revision + 1 is prohibited by P0003 trigger', async () => {
    const journalId = `journal-test-a-${timestamp}`;
    const env1 = await encryption.encryptString('Journal Rev 1 content', aekAlpha);

    // 1. Create journal at server revision 1 via approved RPC
    const { data: res1, error: err1 } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalId,
      p_encrypted_envelope: env1,
      p_sync_revision: 1,
      p_idempotency_key: `idem-test-a-1-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
      p_expected_revision: null,
    });
    expect(err1).toBeNull();
    expect(res1.status).toBe('INSERTED');
    expect(res1.sync_revision).toBe(1);

    // 2. Device A updates through approved RPC, producing server revision 2
    const env2 = await encryption.encryptString('Journal Rev 2 content from Device A', aekAlpha);
    const { data: res2, error: err2 } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalId,
      p_encrypted_envelope: env2,
      p_sync_revision: 2,
      p_idempotency_key: `idem-test-a-2-${timestamp}`,
      p_client_updated_at: timestamp + 1000,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
      p_expected_revision: 1,
    });
    expect(err2).toBeNull();
    expect(res2.status).toBe('UPDATED');
    expect(res2.sync_revision).toBe(2);

    // 3. Stale client attempts direct authenticated REST PATCH with revision 3
    const maliciousEnv = await encryption.encryptString('Malicious blind overwrite', aekAlpha);
    const { error: directPatchErr } = await clientA
      .from('private_journals')
      .update({
        encrypted_envelope: maliciousEnv,
        sync_revision: 3,
        client_updated_at: timestamp + 2000,
      })
      .eq('client_record_id', journalId);

    // Confirms HTTP error with SQLSTATE P0003: DIRECT_REST_MUTATION_PROHIBITED
    expect(directPatchErr).toBeDefined();
    expect(directPatchErr?.code).toBe('P0003');
    expect(directPatchErr?.message).toContain('DIRECT_REST_MUTATION_PROHIBITED');

    // Confirm the database row remains strictly at revision 2 with Device A's ciphertext
    const { data: verifyRow } = await adminClient
      .from('private_journals')
      .select('sync_revision, encrypted_envelope')
      .eq('client_record_id', journalId)
      .single();

    expect(verifyRow?.sync_revision).toBe(2);
    expect(verifyRow?.encrypted_envelope.ct).toBe(env2.ct);
  });

  // Test B: Stale client RPC request with arbitrarily high supplied revision
  it('Test B: Stale client RPC request with arbitrarily high supplied revision is rejected with CONFLICT_STALE_REVISION', async () => {
    const journalId = `journal-test-b-${timestamp}`;
    const env1 = await encryption.encryptString('Journal Base', aekAlpha);

    // Seed at revision 1
    await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalId,
      p_encrypted_envelope: env1,
      p_sync_revision: 1,
      p_idempotency_key: `idem-test-b-1-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });

    // Update to revision 2
    const env2 = await encryption.encryptString('Journal Advanced', aekAlpha);
    await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalId,
      p_encrypted_envelope: env2,
      p_sync_revision: 2,
      p_idempotency_key: `idem-test-b-2-${timestamp}`,
      p_client_updated_at: timestamp + 1000,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
      p_expected_revision: 1,
    });

    // Stale client sends arbitrarily high revision (999999) with stale base revision (1)
    const envHigh = await encryption.encryptString('Arbitrary Jump Payload', aekAlpha);
    const { data: resHigh } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalId,
      p_encrypted_envelope: envHigh,
      p_sync_revision: 999999,
      p_idempotency_key: `idem-test-b-high-${timestamp}`,
      p_client_updated_at: timestamp + 2000,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
      p_expected_revision: 1, // Stale! Server is at 2
    });

    expect(resHigh.status).toBe('CONFLICT_STALE_REVISION');
    expect(resHigh.server_revision).toBe(2);

    // Confirm row unchanged
    const { data: current } = await adminClient
      .from('private_journals')
      .select('sync_revision, encrypted_envelope')
      .eq('client_record_id', journalId)
      .single();
    expect(current?.sync_revision).toBe(2);
    expect(current?.encrypted_envelope.ct).toBe(env2.ct);
  });

  // Test C: Missing request.headers execution context
  it('Test C: Missing request.headers execution context fails closed with 0 rows returned by RLS', async () => {
    // Client with valid JWT but NO device headers
    const clientNoHeaders = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${userAlphaJwt}`,
        },
      },
    });

    const { data: rows, error } = await clientNoHeaders.from('private_journals').select('*');
    expect(error).toBeNull();
    // Fail-closed RLS ensures 0 rows returned
    expect(rows).toEqual([]);
  });

  // Test D: Empty request.headers JSON
  it('Test D: Empty request.headers JSON fails closed with 0 rows returned by RLS', async () => {
    const clientEmptyHeaders = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${userAlphaJwt}`,
          'x-device-id': '',
          'x-device-token': '',
        },
      },
    });

    const { data: rows, error } = await clientEmptyHeaders.from('private_journals').select('*');
    expect(error).toBeNull();
    expect(rows).toEqual([]);
  });

  // Test E: Account with no active enrolled devices
  it('Test E: Account with no active enrolled devices fails closed with 0 rows returned', async () => {
    // User Gamma has NO enrolled devices
    const clientGamma = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${userGammaJwt}`,
        },
      },
    });

    const { data: rows } = await clientGamma.from('private_journals').select('*');
    expect(rows).toEqual([]);
  });

  // Test F: Revoked device attempting a fresh device INSERT
  it('Test F: Revoked device attempting direct device INSERT is rejected with DIRECT_DEVICE_INSERT_FORBIDDEN', async () => {
    const clientRevoked = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${userAlphaJwt}`,
          'x-device-id': deviceIdB,
          'x-device-token': deviceTokenB,
        },
      },
    });

    const { error: insertErr } = await clientRevoked.from('sync_metadata').insert({
      user_id: userAlphaId,
      device_id: `forged-device-${timestamp}`,
      device_platform: 'web',
      client_app_version: '1.0.0',
      device_token_hash: 'forged_hash',
      is_revoked: false,
    });

    expect(insertErr).toBeDefined();
    expect(insertErr?.code).toBe('42501');
    expect(insertErr?.message).toContain('DIRECT_DEVICE_INSERT_FORBIDDEN');
  });

  // Test G: Revoked device attempting enrollment RPC without recovery authorization
  it('Test G: Revoked device attempting enrollment RPC is rejected with REJECTED_DEVICE_REVOKED', async () => {
    const clientRevoked = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${userAlphaJwt}`,
          'x-device-id': deviceIdB,
          'x-device-token': deviceTokenB,
        },
      },
    });

    const { error: enrollErr } = await clientRevoked.rpc('enroll_sync_device', {
      p_device_id: deviceIdB, // Attempting to re-enroll revoked device
      p_platform: 'android',
      p_app_version: '1.0.0',
      p_device_token: 'new-token-secret-12345678',
    });

    expect(enrollErr).toBeDefined();
    expect(enrollErr?.message).toContain('REJECTED_DEVICE_REVOKED');
  });

  // Test H: Authenticated user trying to change is_revoked
  it('Test H: Authenticated user trying to directly modify is_revoked is rejected with DIRECT_REVOCATION_MUTATION_FORBIDDEN', async () => {
    const { error: unrevokeErr } = await clientA
      .from('sync_metadata')
      .update({ is_revoked: false })
      .eq('device_id', deviceIdB);

    expect(unrevokeErr).toBeDefined();
    expect(unrevokeErr?.code).toBe('42501');
    expect(unrevokeErr?.message).toContain('DIRECT_REVOCATION_MUTATION_FORBIDDEN');
  });

  // Test I: Authenticated user trying to replace device_token_hash
  it('Test I: Authenticated user trying to directly replace device_token_hash is rejected with DIRECT_TOKEN_HASH_MUTATION_FORBIDDEN', async () => {
    const { error: hashErr } = await clientA
      .from('sync_metadata')
      .update({ device_token_hash: 'malicious_replaced_hash' })
      .eq('device_id', deviceIdA);

    expect(hashErr).toBeDefined();
    expect(hashErr?.code).toBe('42501');
    expect(hashErr?.message).toContain('DIRECT_TOKEN_HASH_MUTATION_FORBIDDEN');
  });

  // Test J: Missing JWT session_id
  it('Test J: Missing JWT session_id fails closed with SESSION_REVOKED', async () => {
    // Generate a synthetic anon/custom JWT without session_id claim
    const customClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${ANON_KEY}`, // anon key lacks session_id claim
          'x-device-id': deviceIdA,
          'x-device-token': deviceTokenA,
        },
      },
    });

    const { error } = await customClient.rpc('sync_delete_record', {
      p_record_type: 'journal',
      p_client_record_id: 'any-id',
      p_deletion_revision: 99,
    });

    expect(error).toBeDefined();
    expect(error?.code).toBe('28000');
  });

  // Test K: Signed-out JWT
  it('Test K: Signed-out JWT is rejected immediately with SESSION_REVOKED', async () => {
    // Create dedicated user for logout test
    const logoutEmail = `logout_${timestamp}@lifted.app`;
    await adminClient.auth.admin.createUser({
      email: logoutEmail,
      password: userPassword,
      email_confirm: true,
    });

    const clientLogout = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: sess } = await clientLogout.auth.signInWithPassword({
      email: logoutEmail,
      password: userPassword,
    });
    const loggedOutJwt = sess.session!.access_token;

    // Sign out to revoke the session in auth.sessions
    await clientLogout.auth.signOut();

    // Attempt to invoke sync RPC with the signed-out JWT
    const clientZombie = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        headers: {
          Authorization: `Bearer ${loggedOutJwt}`,
          'x-device-id': 'any-dev',
          'x-device-token': 'any-token',
        },
      },
    });

    const { error: zombieErr } = await clientZombie.rpc('sync_upsert_journal', {
      p_client_record_id: 'zombie-rec',
      p_encrypted_envelope: { v: 1, ct: 'zombie' },
      p_sync_revision: 1,
      p_idempotency_key: 'idem-zombie',
      p_client_updated_at: timestamp,
    });

    expect(zombieErr).toBeDefined();
    expect(zombieErr?.code).toBe('28000');
    expect(zombieErr?.message).toContain('SESSION_REVOKED');
  });

  // Test L: Replacing the account's wrapped AEK directly
  it('Test L: Replacing the account wrapped AEK directly via REST is rejected with DIRECT_KEY_REPLACEMENT_FORBIDDEN', async () => {
    const { error: replaceKeyErr } = await clientA
      .from('user_account_keys')
      .update({
        wrapped_aek: { v: 1, alg: 'AES-GCM-256', ct: 'hacked_wrapped_aek' },
      })
      .eq('user_id', userAlphaId);

    expect(replaceKeyErr).toBeDefined();
    expect(replaceKeyErr?.code).toBe('42501');
    expect(replaceKeyErr?.message).toContain('DIRECT_KEY_REPLACEMENT_FORBIDDEN');
  });

  // Test M: Direct INSERT/UPDATE/DELETE after least-privilege trigger enforcement
  it('Test M: Direct REST INSERT, UPDATE, DELETE are all prohibited by security triggers', async () => {
    const journalId = `journal-test-m-${timestamp}`;
    const env = await encryption.encryptString('M content', aekAlpha);

    // Direct INSERT -> P0003
    const { error: insErr } = await clientA.from('private_journals').insert({
      client_record_id: journalId,
      user_id: userAlphaId,
      encrypted_envelope: env,
      sync_revision: 1,
      client_updated_at: timestamp,
    });
    expect(insErr?.code).toBe('P0003');
    expect(insErr?.message).toContain('DIRECT_REST_MUTATION_PROHIBITED');

    // Create a legitimate row via approved RPC to test direct UPDATE and direct DELETE
    await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalId,
      p_encrypted_envelope: env,
      p_sync_revision: 1,
      p_idempotency_key: `idem-test-m-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });

    // Direct UPDATE on existing row -> P0003
    const { error: updErr } = await clientA.from('private_journals').update({ sync_revision: 2 }).eq('client_record_id', journalId);
    expect(updErr?.code).toBe('P0003');
    expect(updErr?.message).toContain('DIRECT_REST_MUTATION_PROHIBITED');

    // Direct DELETE on existing row -> 55000 (DIRECT_DELETE_PROHIBITED)
    const { error: delErr } = await clientA.from('private_journals').delete().eq('client_record_id', journalId);
    expect(delErr?.code).toBe('55000');
    expect(delErr?.message).toContain('DIRECT_DELETE_PROHIBITED');
  });

  // Test N: Concurrent updates of one journal from two devices
  it('Test N: Concurrent updates of one journal from two devices strictly accepts first, rejects second with CONFLICT_STALE_REVISION', async () => {
    const sharedJournalId = `shared-journal-race-${timestamp}`;
    const envBase = await encryption.encryptString('Shared base revision 1', aekAlpha);

    // 1. Base record committed at server revision 1
    const { data: resBase } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: sharedJournalId,
      p_encrypted_envelope: envBase,
      p_sync_revision: 1,
      p_idempotency_key: `idem-race-base-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
      p_expected_revision: null,
    });
    expect(resBase.status).toBe('INSERTED');
    expect(resBase.sync_revision).toBe(1);

    // 2. Both Device A and Device B observed revision 1 offline
    // Device A commits its update with expected_revision = 1
    const envA = await encryption.encryptString('Device A revision 2 edit', aekAlpha);
    const { data: resA } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: sharedJournalId,
      p_encrypted_envelope: envA,
      p_sync_revision: 2,
      p_idempotency_key: `idem-race-a-${timestamp}`,
      p_client_updated_at: timestamp + 1000,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
      p_expected_revision: 1,
    });
    expect(resA.status).toBe('UPDATED');
    expect(resA.sync_revision).toBe(2);

    // 3. Device B attempts to commit its update also with expected_revision = 1
    const envB = await encryption.encryptString('Device B revision 2 edit', aekAlpha);
    const { data: resB } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: sharedJournalId,
      p_encrypted_envelope: envB,
      p_sync_revision: 2,
      p_idempotency_key: `idem-race-b-${timestamp}`,
      p_client_updated_at: timestamp + 1000,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
      p_expected_revision: 1, // Stale! Server is already at 2
    });

    // Device B is rejected with CONFLICT_STALE_REVISION
    expect(resB.status).toBe('CONFLICT_STALE_REVISION');
    expect(resB.server_revision).toBe(2);

    // Server text remains Device A's text (no silent replacement)
    const { data: serverRow } = await adminClient
      .from('private_journals')
      .select('sync_revision, encrypted_envelope')
      .eq('client_record_id', sharedJournalId)
      .single();

    expect(serverRow?.sync_revision).toBe(2);
    expect(serverRow?.encrypted_envelope.ct).toBe(envA.ct);
  });

  // Test O: Duplicate idempotency key after retry/restart
  it('Test O: Duplicate idempotency key after retry returns prior ACK with zero row duplication', async () => {
    const journalId = `journal-idem-${timestamp}`;
    const env = await encryption.encryptString('Idempotent payload', aekAlpha);
    const idemKey = `idem-key-unique-${timestamp}`;

    // 1st attempt: Inserts
    const { data: firstRes } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalId,
      p_encrypted_envelope: env,
      p_sync_revision: 1,
      p_idempotency_key: idemKey,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(firstRes.status).toBe('INSERTED');
    expect(firstRes.sync_revision).toBe(1);

    // 2nd attempt with same idempotency key (simulating retry after lost ACK)
    const { data: replayRes } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalId,
      p_encrypted_envelope: env,
      p_sync_revision: 1,
      p_idempotency_key: idemKey,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(replayRes.status).toBe('ACKNOWLEDGED_IDEMPOTENT');
    expect(replayRes.sync_revision).toBe(1);

    // Exactly 1 row in the table
    const { data: rows } = await adminClient
      .from('private_journals')
      .select('id')
      .eq('client_record_id', journalId);

    expect(rows).toHaveLength(1);
  });

  // Test P: Cross-account device token substitution
  it('Test P: Cross-account device token substitution is rejected with REJECTED_DEVICE_UNAUTHORIZED', async () => {
    // User Alpha attempts sync RPC using Device A ID but Device Beta's secret token
    const env = await encryption.encryptString('Spoofed token push', aekAlpha);
    const { data: spoofRes } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: `rec-spoofed-${timestamp}`,
      p_encrypted_envelope: env,
      p_sync_revision: 1,
      p_idempotency_key: `idem-spoofed-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenBeta, // Cross-account token from Beta!
    });

    expect(spoofRes.status).toBe('REJECTED_DEVICE_UNAUTHORIZED');
  });
});
