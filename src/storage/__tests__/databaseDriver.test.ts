import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBDriver } from '../databaseDriver';
import type { JournalStorageRecord, EncryptedPayload } from '../types';

describe('IndexedDBDriver - Web & Testing Storage Engine', () => {
  let driver: IndexedDBDriver;
  const testDbName = 'lifted_test_driver_vault';

  beforeEach(async () => {
    driver = new IndexedDBDriver(testDbName);
    await driver.initialize();
    await driver.journals.clear();
  });

  afterEach(async () => {
    await driver.close();
  });

  it('initializes and reports availability', () => {
    expect(driver.isAvailable()).toBe(true);
    expect(driver.platform).toBe('indexeddb');
  });

  it('stores and retrieves metadata keys', async () => {
    await driver.setMetadata('schema_version', '1');
    const version = await driver.getMetadata('schema_version');
    expect(version).toBe('1');

    const nonExistent = await driver.getMetadata('unknown_key');
    expect(nonExistent).toBeNull();
  });

  it('performs CRUD operations on journals store', async () => {
    const dummyPayload: EncryptedPayload = {
      v: 1,
      iv: 'dGVzdElWMTIzNDU2',
      ct: 'dGVzdENpcGhlcnRleHQxMjM0NTY3ODkw',
    };

    const record: JournalStorageRecord = {
      id: 'journal-test-1',
      date: '2026-10-31',
      timestamp: Date.now(),
      contentEncrypted: dummyPayload,
      localUserId: 'guest-test-123',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await driver.journals.put(record);
    expect(await driver.journals.count()).toBe(1);

    const fetched = await driver.journals.get('journal-test-1');
    expect(fetched).toBeDefined();
    expect(fetched?.id).toBe('journal-test-1');
    expect(fetched?.contentEncrypted.ct).toBe(dummyPayload.ct);

    await driver.journals.delete('journal-test-1');
    expect(await driver.journals.count()).toBe(0);
    expect(await driver.journals.get('journal-test-1')).toBeNull();
  });

  it('detects existing data correctly', async () => {
    expect(await driver.hasExistingData()).toBe(false);

    await driver.setMetadata('canary', 'some-canary');
    expect(await driver.hasExistingData()).toBe(true);
  });
});
