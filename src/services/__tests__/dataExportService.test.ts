import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DataExportService } from '../dataExportService';
import { VaultManager } from '../../storage/vaultManager';
import { IndexedDBDriver } from '../../storage/databaseDriver';
import { WebKeyStorage } from '../../storage/keyStorage';
import { WebCryptoEncryptionService } from '../../storage/encryptionService';

describe('DataExportService', () => {
  let driver: IndexedDBDriver;
  let keyStorage: WebKeyStorage;
  let encryption: WebCryptoEncryptionService;
  let vault: VaultManager;
  let service: DataExportService;

  beforeEach(async () => {
    const testDbName = `lifted_test_export_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    driver = new IndexedDBDriver(testDbName);
    encryption = new WebCryptoEncryptionService();
    keyStorage = new WebKeyStorage(encryption);

    await driver.initialize();
    await keyStorage.clearKey();

    vault = new VaultManager(driver, keyStorage, encryption);
    await vault.initialize();
    service = new DataExportService(vault);
  });

  afterEach(async () => {
    await vault.close();
    vi.restoreAllMocks();
  });

  it('generates structured export payload containing decrypted records with accurate summary counts', async () => {
    const idRecord = await vault.identity.getOrCreateIdentity();

    // Insert synthetic records into vault
    await vault.journals.create({
      id: 'j-export-1',
      date: 'Oct 31, 2026',
      timestamp: Date.now(),
      content: 'Private reflection on grace',
      promptQuestion: 'Where did you see grace?',
      localUserId: idRecord.localUserId,
      cloudUserId: null,
    });

    await vault.prayers.create({
      id: 'p-export-1',
      title: 'Family Peace',
      request: 'Praying for harmony in my home',
      category: 'personal',
      visibility: 'private',
      isPrivate: true,
      followUpStatus: 'none',
      intercessorsCount: 1,
      isPrayedByMe: true,
      followUpTriggered: false,
      remindersEnabled: true,
    });

    await vault.moods.create({
      id: 'm-export-1',
      mood: 'peaceful',
      additionalMoods: ['grateful'],
      note: 'Felt calm this morning',
      timestamp: Date.now(),
      dateStr: 'Today',
    });

    await vault.saveUserPreferences({
      name: 'Sarah',
      theme: 'powder-blue',
      hapticsEnabled: true,
      prayerFollowUpReminders: true,
      dailyDevotionalReminders: true,
      notificationsEnabled: true,
      language: 'en',
      currency: 'USD',
    });

    const payload = await service.generateExportPayload();

    expect(payload.summary.journalCount).toBe(1);
    expect(payload.summary.prayerCount).toBe(1);
    expect(payload.summary.moodCount).toBe(1);
    expect(payload.summary.hasPreferences).toBe(true);

    expect(payload.journals[0].content).toBe('Private reflection on grace');
    expect(payload.prayers[0].title).toBe('Family Peace');
    expect(payload.prayers[0].body).toBe('Praying for harmony in my home');
    expect(payload.moodHistory[0].mood).toBe('peaceful');
    expect(payload.preferences?.name).toBe('Sarah');

    expect(payload.privacyNotice).toContain('private spiritual and emotional reflections');
  });

  it('preserves vault records without deleting or modifying them during export', async () => {
    const idRecord = await vault.identity.getOrCreateIdentity();
    await vault.journals.create({
      id: 'j-untouched-1',
      date: 'Oct 31, 2026',
      timestamp: Date.now(),
      content: 'This must remain in vault',
      localUserId: idRecord.localUserId,
      cloudUserId: null,
    });

    await service.generateExportPayload();

    // Confirm vault record still exists and decrypts
    const preserved = await vault.journals.getById('j-untouched-1');
    expect(preserved?.content).toBe('This must remain in vault');
    expect(await vault.journals.count()).toBe(1);
  });

  it('triggers local browser download and cleans up temporary object URL', async () => {
    const clickMock = vi.fn();
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    vi.spyOn(document, 'createElement').mockReturnValue({
      set href(_val: string) {},
      set download(_val: string) {},
      style: {},
      click: clickMock,
    } as any);

    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);

    const summary = await service.triggerLocalDownload('test-backup.json');

    expect(clickMock).toHaveBeenCalled();
    expect(createUrlSpy).toHaveBeenCalled();
    expect(summary).toBeDefined();

    // Revocation scheduled via setTimeout
    await new Promise((r) => setTimeout(r, 1100));
    expect(revokeUrlSpy).toHaveBeenCalledWith('blob:mock-url');
  });
});
