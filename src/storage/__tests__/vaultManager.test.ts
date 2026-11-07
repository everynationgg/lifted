import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VaultManager } from '../vaultManager';
import { IndexedDBDriver } from '../databaseDriver';
import { WebKeyStorage } from '../keyStorage';
import { WebCryptoEncryptionService } from '../encryptionService';

describe('VaultManager - Lifecycle & Security Canary Orchestration', () => {
  let driver: IndexedDBDriver;
  let keyStorage: WebKeyStorage;
  let encryption: WebCryptoEncryptionService;
  let vault: VaultManager;

  beforeEach(async () => {
    driver = new IndexedDBDriver('lifted_test_vault_manager');
    encryption = new WebCryptoEncryptionService();
    keyStorage = new WebKeyStorage(encryption);

    await driver.initialize();
    await driver.journals.clear();
    await driver.setMetadata('canary', '');
    await keyStorage.clearKey();

    vault = new VaultManager(driver, keyStorage, encryption);
  });

  afterEach(async () => {
    await vault.close();
  });

  it('initializes cleanly on clean first install and establishes security canary', async () => {
    const res = await vault.initialize();
    expect(res.state).toBe('READY');
    expect(vault.isReady()).toBe(true);
    expect(vault.journals).toBeDefined();
    expect(vault.prayers).toBeDefined();
    expect(vault.moods).toBeDefined();
    expect(vault.drafts).toBeDefined();
    expect(vault.identity).toBeDefined();

    // Verify security canary token is written to metadata
    const canary = await driver.getMetadata('canary');
    expect(canary).toBeDefined();
    expect(canary).toContain('ct');
  });

  it('reopens existing vault successfully by verifying canary token', async () => {
    // First setup
    await vault.initialize();
    await vault.close();

    // Reopen
    const reopenVault = new VaultManager(driver, keyStorage, encryption);
    const reopenRes = await reopenVault.initialize();

    expect(reopenRes.state).toBe('READY');
    expect(reopenVault.isReady()).toBe(true);
    await reopenVault.close();
  });

  it('safeguards against key loss: reports KEY_MISSING when database exists but key was cleared', async () => {
    // First setup and write a record
    await vault.initialize();
    await vault.journals.create({
      id: 'journal-pre-loss',
      date: '2026-10-31',
      timestamp: Date.now(),
      content: 'Important reflection that must not be wiped',
      localUserId: 'guest-123',
    });
    await vault.close();

    // Simulate key loss (e.g. user or OS cleared Keychain/KeyStore)
    await keyStorage.clearKey();

    const recoveredVault = new VaultManager(driver, keyStorage, encryption);
    const res = await recoveredVault.initialize();

    expect(res.state).toBe('KEY_MISSING');
    expect(recoveredVault.isReady()).toBe(false);
    expect(res.errorMessage).toContain('Halting to prevent data overwrite');

    // Confirm existing record in database was NOT wiped or orphaned
    expect(await driver.journals.count()).toBe(1);
    await recoveredVault.close();
  });

  it('reports KEY_INVALID when key fails canary verification', async () => {
    await vault.initialize();
    await vault.close();

    // Create a mock key storage that returns a different, incorrect key
    const badKey = await encryption.generateKey(false);
    const mockBadKeyStorage = {
      loadOrCreateKey: async () => ({ key: badKey, state: 'READY' as const }),
      clearKey: async () => {},
      hasKey: async () => true,
    };

    const invalidKeyVault = new VaultManager(driver, mockBadKeyStorage, encryption);
    const res = await invalidKeyVault.initialize();

    expect(res.state).toBe('KEY_INVALID');
    expect(invalidKeyVault.isReady()).toBe(false);
    expect(res.errorMessage).toContain('Encryption key failed canary verification');
    await invalidKeyVault.close();
  });
});
