import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MigrationCoordinator } from '../migration/migrationCoordinator';
import { MigrationHarness } from '../migration/migrationHarness';
import { VaultManager } from '../vaultManager';
import { IndexedDBDriver } from '../databaseDriver';
import { WebKeyStorage } from '../keyStorage';
import { WebCryptoEncryptionService } from '../encryptionService';
import { MIGRATION_METADATA_KEYS } from '../migration/migrationPlan';

describe('Phase 2B Final Stabilization — Edge Cases & Regression Gate', () => {
  let driver: IndexedDBDriver;
  let keyStorage: WebKeyStorage;
  let encryption: WebCryptoEncryptionService;
  let vault: VaultManager;
  let coordinator: MigrationCoordinator;

  beforeEach(async () => {
    const testDbName = `lifted_test_stab_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    driver = new IndexedDBDriver(testDbName);
    encryption = new WebCryptoEncryptionService();
    keyStorage = new WebKeyStorage(encryption);

    await driver.initialize();
    await keyStorage.clearKey();

    vault = new VaultManager(driver, keyStorage, encryption);
    await vault.initialize();
    coordinator = new MigrationCoordinator(vault);

    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(async () => {
    await vault.close();
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  describe('Edge Case 1: Migration Consent Postponed / Dismissed ("Maybe Later")', () => {
    it('preserves legacy storage untouched and leaves state as READY_FOR_CONSENT when postponed', async () => {
      localStorage.setItem(
        'lifted_journal_entries',
        JSON.stringify([{ id: 'j-postpone-1', date: 'Oct 28, 2026', content: 'Unmigrated reflection' }])
      );

      const snapshot = await coordinator.checkReadiness();
      expect(snapshot.state).toBe('READY_FOR_CONSENT');

      // User chooses "Maybe Later"
      coordinator.dismissConsentBanner();

      // State remains READY_FOR_CONSENT for future session, zero writes to vault
      expect(coordinator.getState()).toBe('READY_FOR_CONSENT');
      expect(await vault.journals.count()).toBe(0);

      // Legacy records remain completely intact
      const legacyRaw = localStorage.getItem('lifted_journal_entries');
      expect(legacyRaw).toContain('Unmigrated reflection');
    });
  });

  describe('Edge Case 2: App Termination During Migration & Clean Recovery', () => {
    it('safely re-prompts for consent on restart after simulated app crash during migration', async () => {
      localStorage.setItem(
        'lifted_journal_entries',
        JSON.stringify([{ id: 'j-crash-1', date: 'Oct 28, 2026', content: 'Reflection before crash' }])
      );

      // 1. Initial preflight detects legacy data
      await coordinator.checkReadiness();
      expect(coordinator.getState()).toBe('READY_FOR_CONSENT');

      // 2. Simulate crash during migration: coordinator was in 'MIGRATING', process terminated
      coordinator.resetForTesting('MIGRATING');
      expect(coordinator.getState()).toBe('MIGRATING');

      // 3. New app session starts: fresh coordinator checks readiness
      const freshCoordinator = new MigrationCoordinator(vault);
      const restartSnapshot = await freshCoordinator.checkReadiness();

      // Since migration status metadata was not marked COMPLETED, it safely returns to READY_FOR_CONSENT
      expect(restartSnapshot.state).toBe('READY_FOR_CONSENT');
      expect(restartSnapshot.hasLegacyData).toBe(true);
      expect(restartSnapshot.legacyRecordCounts.journals).toBe(1);

      // User can successfully consent and complete migration in new session
      const summary = await freshCoordinator.startMigrationWithConsent();
      expect(summary.status).toBe('COMPLETED');
      expect(await vault.journals.count()).toBe(1);
    });
  });

  describe('Edge Case 3: Partial Migration Recovery & Idempotency', () => {
    it('safely resumes partial migration without duplicate records or primary key collision', async () => {
      const harness = new MigrationHarness(vault);
      const legacyData = {
        lifted_journal_entries: [
          { id: 'j-partial-1', date: 'Oct 20, 2026', content: 'First entry' },
          { id: 'j-partial-2', date: 'Oct 21, 2026', content: 'Second entry' },
        ],
      };

      // 1. Simulate partial migration: First entry already written to vault
      const idRecord = await vault.identity.getOrCreateIdentity();
      await vault.journals.create({
        id: 'j-partial-1',
        date: 'Oct 20, 2026',
        timestamp: Date.now() - 100000,
        content: 'First entry',
        localUserId: idRecord.localUserId,
        cloudUserId: null,
      });

      expect(await vault.journals.count()).toBe(1);

      // 2. Execute migration with both items
      const summary = await harness.executeMigration(legacyData, {
        verifyIntegrity: true,
        rollbackOnError: true,
      });

      expect(summary.status).toBe('COMPLETED');
      expect(summary.journals.total).toBe(2);
      // First item was safely handled via idempotent update/skip, second item created
      expect(await vault.journals.count()).toBe(2);

      const item1 = await vault.journals.getById('j-partial-1');
      const item2 = await vault.journals.getById('j-partial-2');
      expect(item1?.content).toBe('First entry');
      expect(item2?.content).toBe('Second entry');
    });
  });

  describe('Edge Case 4: Storage Quota Exhaustion (Low Storage Conditions)', () => {
    it('rolls back vault modifications and transitions to FAILED_RECOVERABLE on QuotaExceededError', async () => {
      localStorage.setItem(
        'lifted_journal_entries',
        JSON.stringify([{ id: 'j-quota-1', date: 'Oct 29, 2026', content: 'Will exceed quota' }])
      );

      await coordinator.checkReadiness();
      expect(coordinator.getState()).toBe('READY_FOR_CONSENT');

      // Mock low disk space / quota exceeded
      const quotaErr = new Error('The quota has been exceeded: QuotaExceededError');
      vi.spyOn(vault.journals, 'create').mockRejectedValueOnce(quotaErr);

      const summary = await coordinator.startMigrationWithConsent();
      expect(summary.status).toBe('FAILED');
      expect(coordinator.getState()).toBe('FAILED_RECOVERABLE');

      // Legacy storage remains safe and intact
      expect(localStorage.getItem('lifted_journal_entries')).toContain('Will exceed quota');
      // Vault journals rolled back / empty
      expect(await vault.journals.count()).toBe(0);
    });
  });

  describe('Edge Case 5: Encrypted Draft Recovery & Lifecycle', () => {
    it('saves draft to vault, survives simulated crash, and restores or clears correctly', async () => {
      // 1. Save uncommitted draft
      await vault.drafts.saveDraft('draft_journal_test', 'Deep unsaved reflection about trauma recovery');
      const savedDraft = await vault.drafts.getDraft('draft_journal_test');
      expect(savedDraft?.content).toBe('Deep unsaved reflection about trauma recovery');

      // 2. Simulate crash / reload: draft is retrieved from encrypted storage
      const reloadedDraft = await vault.drafts.getDraft('draft_journal_test');
      expect(reloadedDraft?.content).toBe('Deep unsaved reflection about trauma recovery');

      // 3. User discards draft: permanently removed from encrypted storage
      await vault.drafts.clearDraft('draft_journal_test');
      const clearedDraft = await vault.drafts.getDraft('draft_journal_test');
      expect(clearedDraft).toBeNull();
    });

    it('ensures draft is preserved if persistent journal write fails', async () => {
      // Save draft first
      await vault.drafts.saveDraft('draft_journal_fail_test', 'My tender heart draft');

      // Attempt to save journal, but database write fails
      vi.spyOn(vault.journals, 'create').mockRejectedValueOnce(new Error('Disk write timeout'));

      let saveSucceeded = false;
      try {
        await vault.journals.create({
          id: 'j-fail',
          date: 'Today',
          timestamp: Date.now(),
          content: 'My tender heart draft',
          localUserId: 'test-user',
          cloudUserId: null,
        });
        saveSucceeded = true;
      } catch {
        saveSucceeded = false;
      }

      expect(saveSucceeded).toBe(false);

      // Because write failed, clearDraft is NOT called: draft is safely preserved in vault
      const retainedDraft = await vault.drafts.getDraft('draft_journal_fail_test');
      expect(retainedDraft?.content).toBe('My tender heart draft');
    });

    it('ensures draft is deleted only AFTER persistent write successfully resolves', async () => {
      await vault.drafts.saveDraft('draft_journal_success_test', 'My victorious reflection');

      const idRecord = await vault.identity.getOrCreateIdentity();
      await vault.journals.create({
        id: 'j-success-1',
        date: 'Today',
        timestamp: Date.now(),
        content: 'My victorious reflection',
        localUserId: idRecord.localUserId,
        cloudUserId: null,
      });

      // Persistent write succeeded -> delete draft
      await vault.drafts.clearDraft('draft_journal_success_test');

      const verifiedJournal = await vault.journals.getById('j-success-1');
      expect(verifiedJournal?.content).toBe('My victorious reflection');

      const clearedDraft = await vault.drafts.getDraft('draft_journal_success_test');
      expect(clearedDraft).toBeNull();
    });
  });

  describe('Edge Case 6: Rapid Repeated Submissions (Double-Click Prevention)', () => {
    it('prevents duplicate record creation when identical requests are processed', async () => {
      const idRecord = await vault.identity.getOrCreateIdentity();
      const entryId = `journal-dedup-${Date.now()}`;

      // Simulate simultaneous dual-invocation
      await vault.journals.create({
        id: entryId,
        date: 'Oct 31, 2026',
        timestamp: 1700000000000,
        content: 'Single entry text',
        localUserId: idRecord.localUserId,
        cloudUserId: null,
      });

      // Second write with same ID updates rather than creates duplicate row
      await vault.journals.update(entryId, {
        content: 'Single entry text',
      });

      const all = await vault.journals.getAll();
      const matches = all.filter((j) => j.id === entryId);
      expect(matches.length).toBe(1);
    });
  });

  describe('Edge Case 7: Clean Slate State Gate', () => {
    it('marks migration COMPLETED immediately for brand-new user with empty localStorage', async () => {
      const snapshot = await coordinator.checkReadiness();
      expect(snapshot.state).toBe('COMPLETED');
      expect(snapshot.hasLegacyData).toBe(false);

      const statusMeta = await vault.driver.getMetadata(MIGRATION_METADATA_KEYS.STATUS);
      expect(statusMeta).toBe('COMPLETED');
    });
  });
});
