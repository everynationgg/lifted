/**
 * LIFTED — Real HTTP Two-Device E2EE Sync, Multi-Device Recovery & Security Validation
 * Phase 8 Stage 3: Live Local Supabase Auth, PostgreSQL & PostgREST Harness
 *
 * Verifies end-to-end cryptographic and multi-device invariants over real HTTP:
 * 1. Independent local hardware DEKs (DEK A on Device A, DEK B on Device B).
 * 2. Shared Account Encryption Key (AEK) wrapped with canonical 29-symbol Crockford Base32 recovery code.
 * 3. Metadata encryption: Mood scores and emotions are strictly encrypted inside AEK envelopes.
 *    Plaintext mood_score in cloud table is NULL, and selected_emotions is empty array.
 * 4. Device B recovery: Unwrapping AEK via 29-symbol code, rewrapping under DEK B, decrypting
 *    journal, prayer, and mood check-in with 100% plaintext fidelity.
 * 5. Conflict preservation: Journal reflection forking, prayer status correction, immutable mood observations.
 * 6. Authoritative deletion fences: Active tombstones permanently block stale updates (including Year 2099 attacks).
 * 7. Device authentication & revocation: SHA-256 device token verification and revoked device rejection.
 * 8. Cross-account isolation: Strict zero-trust RLS prevents Account B from accessing Account A records.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { RecoveryKeyService } from '../recoveryKeyService';
import { WebCryptoEncryptionService } from '../../storage/encryptionService';
import { TamperedCiphertextError } from '../../storage/errors';
import { ConflictResolver } from '../conflictResolver';
import type { AekAssociatedData, WrappedAekEnvelope } from '../types';
import type { JournalRecord, PrayerRecord, MoodRecord } from '../../storage/types';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

describe('Real HTTP Cross-Device E2EE Synchronization & Recovery Harness (Phase 8 Stage 3)', () => {
  const recoveryService = new RecoveryKeyService();
  const encryption = new WebCryptoEncryptionService();

  const adminClient: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false, storageKey: 'admin-auth-token' },
  });

  const timestamp = Date.now();
  const userAlphaEmail = `stage3_alpha_${timestamp}@lifted.app`;
  const userBetaEmail = `stage3_beta_${timestamp}@lifted.app`;
  const userPassword = 'LiftedSecureTestPassword2026!';

  let userAlphaId: string;
  let userBetaId: string;

  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  let clientBeta: SupabaseClient;

  const deviceIdA = 'device-alpha-ios-1';
  const deviceTokenA = 'secret_token_device_alpha_1234567890';
  const deviceIdB = 'device-beta-android-2';
  const deviceTokenB = 'secret_token_device_beta_0987654321';

  let deviceADEK: CryptoKey;
  let deviceBDEK: CryptoKey;
  let recoveryCodeA: string;
  let rawEntropyA: Uint8Array;
  let aekA: CryptoKey;
  let wrappedAekEnvelopeA: WrappedAekEnvelope;

  const journalRecordId = `journal-${timestamp}`;
  const prayerRecordId = `prayer-${timestamp}`;
  const moodRecordId = `mood-${timestamp}`;

  beforeAll(async () => {
    // 1. Check local Supabase availability
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
      if (!res.ok) throw new Error('Supabase health check failed');
    } catch {
      throw new Error(`Local Supabase is not reachable at ${SUPABASE_URL}. Ensure Docker stack is active.`);
    }

    // 2. Create synthetic User Alpha
    const { data: authAlpha, error: errAlpha } = await adminClient.auth.admin.createUser({
      email: userAlphaEmail,
      password: userPassword,
      email_confirm: true,
    });
    if (errAlpha || !authAlpha.user) {
      throw new Error(`Failed to create synthetic User Alpha: ${errAlpha?.message}`);
    }
    userAlphaId = authAlpha.user.id;

    // 3. Create synthetic User Beta (for cross-account isolation testing)
    const { data: authBeta, error: errBeta } = await adminClient.auth.admin.createUser({
      email: userBetaEmail,
      password: userPassword,
      email_confirm: true,
    });
    if (errBeta || !authBeta.user) {
      throw new Error(`Failed to create synthetic User Beta: ${errBeta?.message}`);
    }
    userBetaId = authBeta.user.id;

    // 4. Initialize Device A client & login with device credentials
    clientA = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'device-a-token' },
      global: {
        headers: {
          'x-device-id': deviceIdA,
          'x-device-token': deviceTokenA,
        },
      },
    });
    const { error: loginErrA } = await clientA.auth.signInWithPassword({
      email: userAlphaEmail,
      password: userPassword,
    });
    if (loginErrA) throw new Error(`Device A login failed: ${loginErrA.message}`);

    // 5. Initialize Device B client & login with device credentials
    clientB = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'device-b-token' },
      global: {
        headers: {
          'x-device-id': deviceIdB,
          'x-device-token': deviceTokenB,
        },
      },
    });
    const { error: loginErrB } = await clientB.auth.signInWithPassword({
      email: userAlphaEmail,
      password: userPassword,
    });
    if (loginErrB) throw new Error(`Device B login failed: ${loginErrB.message}`);

    // 6. Initialize User Beta client & login
    clientBeta = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, storageKey: 'user-beta-token' },
    });
    const { error: loginErrBeta } = await clientBeta.auth.signInWithPassword({
      email: userBetaEmail,
      password: userPassword,
    });
    if (loginErrBeta) throw new Error(`User Beta login failed: ${loginErrBeta.message}`);
  });

  afterAll(async () => {
    // Clean up synthetic accounts from local auth schema
    if (userAlphaId) await adminClient.auth.admin.deleteUser(userAlphaId);
    if (userBetaId) await adminClient.auth.admin.deleteUser(userBetaId);
  });

  it('1. Device A: Enrolls device, derives AEK, wraps via 29-symbol recovery code, and uploads key', async () => {
    // Generate Device A isolated hardware DEK
    deviceADEK = await encryption.generateKey(true);
    expect(deviceADEK).toBeDefined();

    // Enroll Device A via PostgREST RPC
    const { data: enrollRes, error: enrollErr } = await clientA.rpc('enroll_sync_device', {
      p_device_id: deviceIdA,
      p_platform: 'ios',
      p_app_version: '1.0.0',
      p_device_token: deviceTokenA,
      p_device_nickname: 'iPhone 15 Pro',
    });
    expect(enrollErr).toBeNull();
    expect(enrollRes.status).toBe('ENROLLED');

    // Generate AEK and canonical 29-symbol Crockford Base32 recovery code
    const generated = await recoveryService.generateRecoveryCode();
    recoveryCodeA = generated.code;
    rawEntropyA = generated.rawEntropy;
    expect(recoveryCodeA.replace(/^LIFT-/, '').replace(/[^0-9A-Z]/g, '').length).toBe(29);

    aekA = await recoveryService.generateAEK();

    const salt = new Uint8Array(32);
    globalThis.crypto.getRandomValues(salt);

    const aadAlpha: AekAssociatedData = {
      userId: userAlphaId,
      keyVersion: 1,
      domain: 'LIFTED-AEK-ESCROW-v1',
    };

    const wrappingKeyA = await recoveryService.deriveWrappingKeyHKDF(rawEntropyA, salt);
    wrappedAekEnvelopeA = await recoveryService.wrapAEK(aekA, wrappingKeyA, aadAlpha, salt, 'HKDF-SHA256');

    // Upload wrapped AEK to cloud database via PostgREST
    const { error: keyUploadErr } = await clientA.from('user_account_keys').insert({
      user_id: userAlphaId,
      key_version: 1,
      wrapped_aek: wrappedAekEnvelopeA,
    });
    expect(keyUploadErr).toBeNull();
  });

  it('2. Device A: Encrypts journal, prayer, and mood check-in (Zero Plaintext in Cloud)', async () => {
    // A. Journal E2EE
    const journalPlaintext = 'Lord, you are my refuge and strength in every trial.';
    const journalEnvelope = await encryption.encryptString(journalPlaintext, aekA);

    const { data: journalRes, error: journalErr } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalRecordId,
      p_encrypted_envelope: journalEnvelope,
      p_sync_revision: 1,
      p_idempotency_key: `idem-j1-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(journalErr).toBeNull();
    expect(journalRes.status).toBe('INSERTED');

    // B. Prayer E2EE
    const prayerPlaintext = 'Praying for emotional healing, peace, and family reconciliation.';
    const prayerEnvelope = await encryption.encryptString(prayerPlaintext, aekA);

    const { data: prayerRes, error: prayerErr } = await clientA.rpc('sync_upsert_prayer', {
      p_client_record_id: prayerRecordId,
      p_encrypted_payload: prayerEnvelope,
      p_sync_revision: 1,
      p_idempotency_key: `idem-p1-${timestamp}`,
      p_client_updated_at: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(prayerErr).toBeNull();
    expect(prayerRes.status).toBe('INSERTED');

    // C. Mood Check-in E2EE (Encrypted Score & Emotional Tags)
    const moodPayload = {
      score: 4,
      emotions: ['peaceful', 'supported'],
      notes: 'Morning breath prayer brought deep calm.',
    };
    const moodEnvelope = await encryption.encryptString(JSON.stringify(moodPayload), aekA);

    const { data: moodRes, error: moodErr } = await clientA.rpc('sync_upsert_mood', {
      p_client_record_id: moodRecordId,
      p_encrypted_payload: moodEnvelope,
      p_sync_revision: 1,
      p_idempotency_key: `idem-m1-${timestamp}`,
      p_checkin_timestamp: timestamp,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(moodErr).toBeNull();
    expect(moodRes.status).toBe('INSERTED');

    // Verify Zero Plaintext in Cloud: Server table has NULL mood_score and empty selected_emotions
    const { data: cloudMoodRows, error: cloudMoodErr } = await adminClient
      .from('mood_checkins')
      .select('mood_score, selected_emotions, encrypted_payload')
      .eq('client_record_id', moodRecordId);

    expect(cloudMoodErr).toBeNull();
    expect(cloudMoodRows).toHaveLength(1);
    expect(cloudMoodRows![0].mood_score).toBeNull();
    expect(cloudMoodRows![0].selected_emotions).toEqual([]);
    expect(cloudMoodRows![0].encrypted_payload.ct).toBeDefined();
  });

  it('3. Device B: Recovers AEK via 29-symbol code, rewraps under DEK B, and decrypts with 100% fidelity', async () => {
    // Device B generates independent hardware DEK B
    deviceBDEK = await encryption.generateKey(true);

    // Enroll Device B via PostgREST RPC
    const { data: enrollResB, error: enrollErrB } = await clientB.rpc('enroll_sync_device', {
      p_device_id: deviceIdB,
      p_platform: 'android',
      p_app_version: '1.0.0',
      p_device_token: deviceTokenB,
      p_device_nickname: 'Pixel 8',
    });
    expect(enrollErrB).toBeNull();
    expect(enrollResB.status).toBe('ENROLLED');

    // Download encrypted records from cloud PostgREST
    const { data: cloudJournals } = await clientB.from('private_journals').select('*').eq('client_record_id', journalRecordId);
    const { data: cloudPrayers } = await clientB.from('prayer_requests').select('*').eq('client_record_id', prayerRecordId);
    const { data: cloudMoods } = await clientB.from('mood_checkins').select('*').eq('client_record_id', moodRecordId);

    expect(cloudJournals).toHaveLength(1);
    expect(cloudPrayers).toHaveLength(1);
    expect(cloudMoods).toHaveLength(1);

    // Negative Invariant: Device B CANNOT decrypt with its local DEK B!
    await expect(
      encryption.decryptString(cloudJournals![0].encrypted_envelope, deviceBDEK)
    ).rejects.toThrow(TamperedCiphertextError);

    // Download wrapped AEK
    const { data: keyRows, error: keyErr } = await clientB.from('user_account_keys').select('*').eq('user_id', userAlphaId);
    expect(keyErr).toBeNull();
    expect(keyRows).toHaveLength(1);
    const cloudWrappedAek: WrappedAekEnvelope = keyRows![0].wrapped_aek;

    // Validate 29-symbol recovery code
    const validation = await recoveryService.validateRecoveryCode(recoveryCodeA);
    expect(validation.valid).toBe(true);

    const saltBytes = new Uint8Array(
      atob(cloudWrappedAek.salt).split('').map((c) => c.charCodeAt(0))
    );
    const rawEntropy = new Uint8Array(
      validation.rawEntropyHex!.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16))
    );

    // Derive wrapping key on Device B and unwrap AEK
    const aadAlpha: AekAssociatedData = {
      userId: userAlphaId,
      keyVersion: 1,
      domain: 'LIFTED-AEK-ESCROW-v1',
    };
    const wrappingKeyB = await recoveryService.deriveWrappingKeyHKDF(rawEntropy, saltBytes);
    const recoveredAEK = await recoveryService.unwrapAEK(cloudWrappedAek, wrappingKeyB, aadAlpha);
    expect(recoveredAEK).toBeDefined();

    // Device B rewraps recovered AEK with Device B's local DEK B for fast local caching
    const aekRawBytes = await encryption.exportRawKey(recoveredAEK);
    const rewrappedUnderDEKB = await encryption.encryptString(btoa(String.fromCharCode(...aekRawBytes)), deviceBDEK);
    expect(rewrappedUnderDEKB.ct).toBeDefined();

    // Device B decrypts all downloaded records using the recovered AEK
    const decryptedJournal = await encryption.decryptString(cloudJournals![0].encrypted_envelope, recoveredAEK);
    expect(decryptedJournal).toBe('Lord, you are my refuge and strength in every trial.');

    const decryptedPrayer = await encryption.decryptString(cloudPrayers![0].encrypted_payload, recoveredAEK);
    expect(decryptedPrayer).toBe('Praying for emotional healing, peace, and family reconciliation.');

    const decryptedMoodJson = await encryption.decryptString(cloudMoods![0].encrypted_payload, recoveredAEK);
    const decryptedMood = JSON.parse(decryptedMoodJson);
    expect(decryptedMood.score).toBe(4);
    expect(decryptedMood.emotions).toEqual(['peaceful', 'supported']);
    expect(decryptedMood.notes).toBe('Morning breath prayer brought deep calm.');
  });

  it('4. Concurrency: Preserves divergent reflections via forking and merges prayer status corrections', async () => {
    // 1. Device A pushes revision 2 to cloud
    const journalTextA = 'Lord, you are my refuge. Adding evening gratitude for community.';
    const envA2 = await encryption.encryptString(journalTextA, aekA);

    const { data: resA2, error: errA2 } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: journalRecordId,
      p_encrypted_envelope: envA2,
      p_sync_revision: 2,
      p_idempotency_key: `idem-j2-a-${timestamp}`,
      p_client_updated_at: timestamp + 1000,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(errA2).toBeNull();
    expect(resA2.status).toBe('UPDATED');

    // 2. Device B (offline at revision 1) pushes conflicting revision 2
    const journalTextB = 'Lord, you are my refuge. Adding morning reflection on Psalm 23.';
    const envB2 = await encryption.encryptString(journalTextB, aekA);

    const { data: resB2, error: errB2 } = await clientB.rpc('sync_upsert_journal', {
      p_client_record_id: journalRecordId,
      p_encrypted_envelope: envB2,
      p_sync_revision: 2, // stale revision! Server already has revision 2
      p_idempotency_key: `idem-j2-b-${timestamp}`,
      p_client_updated_at: timestamp + 2000,
      p_device_id: deviceIdB,
      p_device_token: deviceTokenB,
    });
    expect(errB2).toBeNull();
    expect(resB2.status).toBe('CONFLICT_STALE_REVISION');

    // 3. Device B executes zero-data-loss conflict resolution
    const localRecordB: JournalRecord = {
      id: journalRecordId,
      date: '2026-11-01',
      timestamp: timestamp + 2000,
      content: journalTextB,
      promptQuestion: 'Evening Gratitude',
      localUserId: 'local-guest-b',
      createdAt: timestamp,
      updatedAt: timestamp + 2000,
    };

    const serverPlaintext = await encryption.decryptString(resB2.server_envelope, aekA);
    const serverRecordA: JournalRecord = {
      id: journalRecordId,
      date: '2026-11-01',
      timestamp: timestamp + 1000,
      content: serverPlaintext,
      promptQuestion: 'Evening Gratitude',
      localUserId: 'local-guest-b',
      createdAt: timestamp,
      updatedAt: timestamp + 1000,
    };

    const journalConflict = ConflictResolver.resolveJournal(localRecordB, serverRecordA);
    expect(journalConflict.strategy).toBe('FORK_JOURNAL_COPY');
    expect(journalConflict.preservedLocal.content).toBe(journalTextB);
    expect(journalConflict.forkedCopy).toBeDefined();
    expect(journalConflict.forkedCopy!.content).toBe(journalTextA);
    expect(journalConflict.forkedCopy!.id).toContain('-conflict-');

    // 4. Prayer status correction: Device A mistakenly marked answered; Device B corrects back to active
    const localPrayerB: PrayerRecord = {
      id: prayerRecordId,
      title: 'Family Healing',
      request: 'Praying for emotional healing and family reconciliation.',
      category: 'Family',
      isPrivate: true,
      followUpStatus: 'still_praying',
      intercessorsCount: 0,
      isPrayedByMe: true,
      isAnswered: false, // Active! User realizes need for ongoing intercession
      answeredNote: 'Continued prayer needed during transition.',
      createdAt: timestamp,
      updatedAt: timestamp + 3000, // Later explicit correction
    };

    const incomingPrayerA: PrayerRecord = {
      id: prayerRecordId,
      title: 'Family Healing',
      request: 'Praying for emotional healing and family reconciliation.',
      category: 'Family',
      isPrivate: true,
      followUpStatus: 'answered',
      intercessorsCount: 0,
      isPrayedByMe: true,
      isAnswered: true, // Mistakenly marked answered
      answeredNote: 'Initial breakthrough observed.',
      createdAt: timestamp,
      updatedAt: timestamp + 1500,
    };

    const prayerConflict = ConflictResolver.resolvePrayer(localPrayerB, incomingPrayerA);
    expect(prayerConflict.strategy).toBe('MERGE_PRAYER_STATUS');
    expect(prayerConflict.mergedPrayer.isAnswered).toBe(false); // Active status preserved!
    expect(prayerConflict.mergedPrayer.answeredNote).toContain('Continued prayer needed');

    // 5. Mood observations: Point-in-time check-ins remain separate immutable observations
    const moodRecord1: MoodRecord = {
      id: 'mood-obs-1',
      dateStr: '2026-11-01',
      timestamp: timestamp + 1000,
      mood: 'peaceful',
      note: 'Morning breath pacer completed.',
    };

    const moodRecord2: MoodRecord = {
      id: 'mood-obs-1',
      dateStr: '2026-11-01',
      timestamp: timestamp + 5000,
      mood: 'anxious',
      note: 'Afternoon meeting triggers anxiety.',
    };

    const moodConflict = ConflictResolver.resolveMood(moodRecord1, moodRecord2);
    expect(moodConflict.strategy).toBe('FORK_MOOD_OBSERVATION');
    expect(moodConflict.mergedMood.mood).toBe('peaceful');
    expect(moodConflict.forkedObservation).toBeDefined();
    expect(moodConflict.forkedObservation!.mood).toBe('anxious');
  });

  it('5. Authoritative Deletion Fences: Active tombstone permanently rejects stale updates (Year 2099 resistant)', async () => {
    // Device A deletes the prayer record via sync_delete_record
    const { data: delRes, error: delErr } = await clientA.rpc('sync_delete_record', {
      p_record_type: 'prayer',
      p_client_record_id: prayerRecordId,
      p_deletion_revision: 10,
      p_device_id: deviceIdA,
      p_device_token: deviceTokenA,
    });
    expect(delErr).toBeNull();
    expect(delRes.status).toBe('DELETED');

    // Device B attempts to update the deleted record with standard sync
    const stalePayload = await encryption.encryptString('Stale prayer update from offline device', aekA);
    const { data: staleRes, error: staleErr } = await clientB.rpc('sync_upsert_prayer', {
      p_client_record_id: prayerRecordId,
      p_encrypted_payload: stalePayload,
      p_sync_revision: 5,
      p_idempotency_key: `idem-p-stale-${timestamp}`,
      p_client_updated_at: timestamp + 6000,
      p_device_id: deviceIdB,
      p_device_token: deviceTokenB,
    });
    expect(staleErr).toBeNull();
    expect(staleRes.status).toBe('REJECTED_TOMBSTONE');

    // Deliberate Future-Dated Attack: Year 2099 timestamp CANNOT bypass the tombstone fence
    const year2099Timestamp = 4102444800000;
    const { data: futureRes, error: futureErr } = await clientB.rpc('sync_upsert_prayer', {
      p_client_record_id: prayerRecordId,
      p_encrypted_payload: stalePayload,
      p_sync_revision: 999999,
      p_idempotency_key: `idem-p-future-${timestamp}`,
      p_client_updated_at: year2099Timestamp,
      p_device_id: deviceIdB,
      p_device_token: deviceTokenB,
    });
    expect(futureErr).toBeNull();
    expect(futureRes.status).toBe('REJECTED_TOMBSTONE');
  });

  it('6. Device Authorization & Revocation: Rejects revoked devices and spoofed device tokens', async () => {
    // 1. Revoke Device B
    const { error: revokeErr } = await adminClient
      .from('sync_metadata')
      .update({ is_revoked: true, revoked_at: new Date().toISOString() })
      .eq('user_id', userAlphaId)
      .eq('device_id', deviceIdB);
    expect(revokeErr).toBeNull();

    // 2. Device B attempts sync mutation -> REJECTED_DEVICE_REVOKED
    const testEnv = await encryption.encryptString('Testing revoked push', aekA);
    const { data: revRes } = await clientB.rpc('sync_upsert_journal', {
      p_client_record_id: `test-rec-${timestamp}`,
      p_encrypted_envelope: testEnv,
      p_sync_revision: 1,
      p_idempotency_key: `idem-rev-${timestamp}`,
      p_client_updated_at: Date.now(),
      p_device_id: deviceIdB,
      p_device_token: deviceTokenB,
    });
    expect(revRes.status).toBe('REJECTED_DEVICE_REVOKED');

    // 3. Spoofed Token Attack: Passing Device A ID with forged or missing token
    const { data: spoofRes } = await clientA.rpc('sync_upsert_journal', {
      p_client_record_id: `test-rec-spoof-${timestamp}`,
      p_encrypted_envelope: testEnv,
      p_sync_revision: 1,
      p_idempotency_key: `idem-spoof-${timestamp}`,
      p_client_updated_at: Date.now(),
      p_device_id: deviceIdA,
      p_device_token: 'forged_fake_token_value_xyz123',
    });
    expect(spoofRes.status).toBe('REJECTED_DEVICE_UNAUTHORIZED');
  });

  it('7. Zero-Trust Cross-Account Isolation: Account Beta cannot read or mutate Account Alpha records', async () => {
    // 1. Account Beta cannot read Account Alpha journals
    const { data: betaJournals } = await clientBeta.from('private_journals').select('*').eq('user_id', userAlphaId);
    expect(betaJournals).toEqual([]);

    // 2. Account Beta cannot read Account Alpha wrapped AEK
    const { data: betaKeys } = await clientBeta.from('user_account_keys').select('*').eq('user_id', userAlphaId);
    expect(betaKeys).toEqual([]);

    // 3. Account Beta cannot read Account Alpha tombstones
    const { data: betaTombstones } = await clientBeta.from('user_tombstones').select('*').eq('user_id', userAlphaId);
    expect(betaTombstones).toEqual([]);

    // 4. Account Beta cannot read Account Alpha sync metadata
    const { data: betaMeta } = await clientBeta.from('sync_metadata').select('*').eq('user_id', userAlphaId);
    expect(betaMeta).toEqual([]);

    // 5. Account Beta cannot mutate Account Alpha records via sync RPC
    await clientBeta.rpc('enroll_sync_device', {
      p_device_id: 'beta-device-1',
      p_platform: 'web',
      p_app_version: '1.0.0',
      p_device_token: 'secret_token_beta_device_1234567890',
      p_device_nickname: 'Web Browser',
    });

    const dummyEnv = await encryption.encryptString('Attacking Alpha record', aekA);
    const { data: crossMutateRes } = await clientBeta.rpc('sync_upsert_journal', {
      p_client_record_id: journalRecordId,
      p_encrypted_envelope: dummyEnv,
      p_sync_revision: 99,
      p_idempotency_key: `idem-cross-${timestamp}`,
      p_client_updated_at: Date.now(),
      p_device_id: 'beta-device-1',
      p_device_token: 'secret_token_beta_device_1234567890',
    });
    expect(crossMutateRes.status).toBe('INSERTED'); // inserted only in Beta's isolated account

    // Insertion in Beta namespace does not touch Alpha namespace
    const { data: alphaJournalCheck } = await adminClient
      .from('private_journals')
      .select('sync_revision, user_id')
      .eq('user_id', userAlphaId)
      .eq('client_record_id', journalRecordId);

    expect(alphaJournalCheck).toHaveLength(1);
    expect(alphaJournalCheck![0].sync_revision).toBe(2); // Alpha revision unchanged at 2!
  });
});
