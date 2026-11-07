import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MigrationCoordinator } from '../migrationCoordinator';
import { VaultManager } from '../../vaultManager';
import { IndexedDBDriver } from '../../databaseDriver';
import { WebKeyStorage } from '../../keyStorage';
import { WebCryptoEncryptionService } from '../../encryptionService';

describe('MigrationCoordinator - Controlled Activation & State Transitions', () => {
  let driver: IndexedDBDriver;
  let keyStorage: WebKeyStorage;
  let encryption: WebCryptoEncryptionService;
  let vault: VaultManager;
  let coordinator: MigrationCoordinator;

  beforeEach(async () => {
    const testDbName = `lifted_test_coord_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    driver = new IndexedDBDriver(testDbName);
    encryption = new WebCryptoEncryptionService();
    keyStorage = new WebKeyStorage(encryption);

    await driver.initialize();
    await keyStorage.clearKey();

    vault = new VaultManager(driver, keyStorage, encryption);
    coordinator = new MigrationCoordinator(vault);

    // Clear simulated localStorage
    localStorage.clear();
  });

  afterEach(async () => {
    await vault.close();
    localStorage.clear();
  });

  it('transitions directly to COMPLETED on clean installation with zero legacy data', async () => {
    // Zero localStorage items
    const snapshot = await coordinator.checkReadiness();
    expect(snapshot.state).toBe('COMPLETED');
    expect(snapshot.hasLegacyData).toBe(false);
  });

  it('detects legacy records and transitions to READY_FOR_CONSENT without running migration', async () => {
    // Populate mock legacy records
    localStorage.setItem(
      'lifted_journal_entries',
      JSON.stringify([{ id: 'j-legacy-1', date: 'Oct 20, 2026', content: 'Legacy reflection' }])
    );
    localStorage.setItem(
      'lifted_prayer_requests',
      JSON.stringify([{ id: 'p-legacy-1', title: 'Peace', body: 'Praying for peace' }])
    );

    const snapshot = await coordinator.checkReadiness();
    expect(snapshot.state).toBe('READY_FOR_CONSENT');
    expect(snapshot.hasLegacyData).toBe(true);
    expect(snapshot.legacyRecordCounts.journals).toBe(1);
    expect(snapshot.legacyRecordCounts.prayers).toBe(1);

    // Verify vault is NOT populated yet (migration must NOT run automatically)
    expect(await vault.journals.count()).toBe(0);
    expect(await vault.prayers.count()).toBe(0);
  });

  it('enforces explicit user consent: throws error if migration is triggered outside consent state', async () => {
    coordinator.resetForTesting('NOT_STARTED');
    await expect(coordinator.startMigrationWithConsent()).rejects.toThrow(
      'Cannot start migration in state: NOT_STARTED. User consent is required.'
    );
  });

  it('executes migration and transitions to COMPLETED upon explicit user consent', async () => {
    localStorage.setItem(
      'lifted_journal_entries',
      JSON.stringify([{ id: 'j-consent-1', date: 'Oct 25, 2026', content: 'Consented migration reflection' }])
    );

    await coordinator.checkReadiness();
    expect(coordinator.getState()).toBe('READY_FOR_CONSENT');

    // User explicitly consents
    const summary = await coordinator.startMigrationWithConsent();
    expect(summary.status).toBe('COMPLETED');
    expect(summary.journals.migrated).toBe(1);
    expect(coordinator.getState()).toBe('COMPLETED');

    // Confirm destination contains encrypted record and decrypts properly
    const decrypted = await vault.journals.getById('j-consent-1');
    expect(decrypted?.content).toBe('Consented migration reflection');

    // Confirm original legacy record remains 100% untouched
    expect(localStorage.getItem('lifted_journal_entries')).toContain('Consented migration reflection');
  });

  it('transitions to BLOCKED if encrypted vault cannot be initialized', async () => {
    // Simulate broken driver initialization
    vi.spyOn(driver, 'initialize').mockRejectedValueOnce(new Error('Hardware security module locked'));

    localStorage.setItem('lifted_journal_entries', JSON.stringify([{ id: 'j-1', content: 'Test' }]));

    const snapshot = await coordinator.checkReadiness();
    expect(snapshot.state).toBe('BLOCKED');
    expect(snapshot.errorMessage).toContain('Hardware security module locked');
  });

  it('transitions to FAILED_RECOVERABLE on write failure, leaving legacy data safe for retry', async () => {
    localStorage.setItem(
      'lifted_journal_entries',
      JSON.stringify([{ id: 'j-retry-1', content: 'Will fail write' }])
    );

    await coordinator.checkReadiness();
    expect(coordinator.getState()).toBe('READY_FOR_CONSENT');

    // Force failure during migration write
    await vault.initialize();
    vi.spyOn(vault.journals, 'create').mockRejectedValueOnce(new Error('Storage I/O failure'));

    const failedSummary = await coordinator.startMigrationWithConsent();
    expect(failedSummary.status).toBe('FAILED');
    expect(coordinator.getState()).toBe('FAILED_RECOVERABLE');
    expect(coordinator.getSnapshot().errorMessage).toContain('Storage I/O failure');

    // Legacy data is still safe in localStorage
    expect(localStorage.getItem('lifted_journal_entries')).toContain('Will fail write');

    // Retry after fixing issue
    vi.restoreAllMocks();
    const retrySummary = await coordinator.startMigrationWithConsent();
    expect(retrySummary.status).toBe('COMPLETED');
    expect(coordinator.getState()).toBe('COMPLETED');
  });

  it('notifies subscribers on each state transition', async () => {
    const statesObserved: string[] = [];
    const unsubscribe = coordinator.subscribe((snapshot) => {
      statesObserved.push(snapshot.state);
    });

    localStorage.setItem('lifted_journal_entries', JSON.stringify([{ id: 'j-sub-1', content: 'Observe' }]));

    await coordinator.checkReadiness();
    await coordinator.startMigrationWithConsent();

    expect(statesObserved).toContain('READY_FOR_CONSENT');
    expect(statesObserved).toContain('VERIFYING');
    expect(statesObserved).toContain('COMPLETED');

    unsubscribe();
  });
});
