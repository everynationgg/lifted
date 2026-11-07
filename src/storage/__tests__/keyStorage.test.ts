import { describe, it, expect, beforeEach } from 'vitest';
import { WebKeyStorage } from '../keyStorage';
import { WebCryptoEncryptionService } from '../encryptionService';

describe('WebKeyStorage - Non-Extractable Key Lifecycle', () => {
  let keyStorage: WebKeyStorage;
  let encryption: WebCryptoEncryptionService;

  beforeEach(async () => {
    encryption = new WebCryptoEncryptionService();
    keyStorage = new WebKeyStorage(encryption);
    await keyStorage.clearKey();
  });

  it('generates a new key on clean first installation', async () => {
    const result = await keyStorage.loadOrCreateKey(false);
    expect(result.state).toBe('FIRST_INSTALL');
    expect(result.key).toBeDefined();
    expect(result.key?.extractable).toBe(false); // Non-extractable security guarantee
  });

  it('retrieves the existing key on subsequent launch', async () => {
    const firstResult = await keyStorage.loadOrCreateKey(false);
    expect(firstResult.state).toBe('FIRST_INSTALL');

    const secondResult = await keyStorage.loadOrCreateKey(true);
    expect(secondResult.state).toBe('READY');
    expect(secondResult.key).toBeDefined();
  });

  it('safeguards against key loss: halts with KEY_MISSING when database exists but key is lost', async () => {
    // Database exists, but key is missing from storage (e.g. storage cleared)
    const result = await keyStorage.loadOrCreateKey(true);
    expect(result.state).toBe('KEY_MISSING');
    expect(result.key).toBeNull();
  });

  it('verifies key presence accurately with hasKey', async () => {
    expect(await keyStorage.hasKey()).toBe(false);
    await keyStorage.loadOrCreateKey(false);
    expect(await keyStorage.hasKey()).toBe(true);
    await keyStorage.clearKey();
    expect(await keyStorage.hasKey()).toBe(false);
  });
});
