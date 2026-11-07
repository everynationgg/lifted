import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBDriver } from '../databaseDriver';
import { WebCryptoEncryptionService } from '../encryptionService';
import { JournalRepository } from '../repositories/journalRepository';
import { PrayerRepository } from '../repositories/prayerRepository';
import { MoodRepository } from '../repositories/moodRepository';
import { DraftRepository } from '../repositories/draftRepository';
import { GuestIdentityRepository } from '../repositories/guestIdentityRepository';

describe('Domain Repositories - Encrypted Local-First Data Layer', () => {
  let driver: IndexedDBDriver;
  let encryption: WebCryptoEncryptionService;
  let key: CryptoKey;

  beforeEach(async () => {
    driver = new IndexedDBDriver('lifted_test_repo_vault');
    await driver.initialize();
    await driver.journals.clear();
    await driver.prayers.clear();
    await driver.moods.clear();
    await driver.drafts.clear();
    await driver.identity.clear();

    encryption = new WebCryptoEncryptionService();
    key = await encryption.generateKey(false);
  });

  afterEach(async () => {
    await driver.close();
  });

  describe('JournalRepository', () => {
    it('creates, encrypts on disk, and decrypts on read', async () => {
      const repo = new JournalRepository(driver, encryption, key);
      const plaintextReflection = 'This is my confidential reflection on healing from trauma.';

      const created = await repo.create({
        id: 'journal-synth-1',
        date: '2026-10-31',
        timestamp: Date.now(),
        content: plaintextReflection,
        promptQuestion: 'What gave you hope today?',
        localUserId: 'guest-user-abc',
      });

      expect(created.id).toBe('journal-synth-1');
      expect(created.content).toBe(plaintextReflection);

      // Verify on-disk storage record is encrypted
      const onDisk = await driver.journals.get('journal-synth-1');
      expect(onDisk).toBeDefined();
      expect(onDisk?.contentEncrypted).toBeDefined();
      expect(onDisk?.contentEncrypted.ct).toBeDefined();
      expect(onDisk?.contentEncrypted.ct).not.toContain('confidential'); // Ciphertext assertion

      // Read back through repository
      const readBack = await repo.getById('journal-synth-1');
      expect(readBack).toBeDefined();
      expect(readBack?.content).toBe(plaintextReflection);
      expect(readBack?.promptQuestion).toBe('What gave you hope today?');
    });

    it('updates journal content and re-encrypts', async () => {
      const repo = new JournalRepository(driver, encryption, key);
      await repo.create({
        id: 'journal-synth-2',
        date: '2026-10-31',
        timestamp: Date.now(),
        content: 'Original draft',
        localUserId: 'guest-user-abc',
      });

      const updated = await repo.update('journal-synth-2', {
        content: 'Updated and expanded reflection with prayer',
      });

      expect(updated.content).toBe('Updated and expanded reflection with prayer');

      const readBack = await repo.getById('journal-synth-2');
      expect(readBack?.content).toBe('Updated and expanded reflection with prayer');
    });

    it('deletes journal entry cleanly', async () => {
      const repo = new JournalRepository(driver, encryption, key);
      await repo.create({
        id: 'journal-synth-3',
        date: '2026-10-31',
        timestamp: Date.now(),
        content: 'To be deleted',
        localUserId: 'guest-user-abc',
      });

      expect(await repo.count()).toBe(1);
      await repo.delete('journal-synth-3');
      expect(await repo.count()).toBe(0);
      expect(await repo.getById('journal-synth-3')).toBeNull();
    });
  });

  describe('PrayerRepository', () => {
    it('encrypts sensitive prayer title and request text', async () => {
      const repo = new PrayerRepository(driver, encryption, key);

      const created = await repo.create({
        id: 'pray-synth-1',
        title: 'Healing for my marriage',
        request: 'Lord, bring reconcilation and tenderness into our home.',
        category: 'Family & Marriage',
        isPrivate: true,
        followUpStatus: 'none',
        intercessorsCount: 1,
        isPrayedByMe: true,
      });

      expect(created.id).toBe('pray-synth-1');

      // Verify on-disk storage is encrypted
      const onDisk = await driver.prayers.get('pray-synth-1');
      expect(onDisk?.titleEncrypted.ct).not.toContain('marriage');
      expect(onDisk?.requestEncrypted.ct).not.toContain('reconcilation');

      // Read back through repository
      const readBack = await repo.getById('pray-synth-1');
      expect(readBack?.title).toBe('Healing for my marriage');
      expect(readBack?.request).toBe('Lord, bring reconcilation and tenderness into our home.');
    });

    it('updates followUpStatus correctly', async () => {
      const repo = new PrayerRepository(driver, encryption, key);
      await repo.create({
        id: 'pray-synth-2',
        title: 'Job interview',
        request: 'Praying for peace during interview',
        category: 'Work & Purpose',
        isPrivate: false,
        followUpStatus: 'still_praying',
        intercessorsCount: 3,
        isPrayedByMe: true,
      });

      const updated = await repo.update('pray-synth-2', {
        followUpStatus: 'answered',
      });

      expect(updated.followUpStatus).toBe('answered');
      const readBack = await repo.getById('pray-synth-2');
      expect(readBack?.followUpStatus).toBe('answered');
    });
  });

  describe('MoodRepository', () => {
    it('creates and reads mood check-in with encrypted note', async () => {
      const repo = new MoodRepository(driver, encryption, key);

      await repo.create({
        id: 'mood-synth-1',
        mood: 'anxious',
        additionalMoods: ['tired'],
        note: 'Feeling racing thoughts after a difficult conversation.',
        timestamp: Date.now(),
        dateStr: 'Today',
      });

      const onDisk = await driver.moods.get('mood-synth-1');
      expect(onDisk?.noteEncrypted).toBeDefined();
      expect(onDisk?.noteEncrypted?.ct).not.toContain('racing thoughts');

      const readBack = await repo.getById('mood-synth-1');
      expect(readBack?.mood).toBe('anxious');
      expect(readBack?.additionalMoods).toEqual(['tired']);
      expect(readBack?.note).toBe('Feeling racing thoughts after a difficult conversation.');
    });
  });

  describe('DraftRepository', () => {
    it('saves, retrieves, and clears unfinished reflection drafts', async () => {
      const repo = new DraftRepository(driver, encryption, key);

      await repo.saveDraft('journal_draft', 'Incomplete thoughts in progress...');

      const draft = await repo.getDraft('journal_draft');
      expect(draft).toBeDefined();
      expect(draft?.content).toBe('Incomplete thoughts in progress...');

      // Overwrite with newer draft
      await repo.saveDraft('journal_draft', 'Updated incomplete thoughts with more detail.');
      const updatedDraft = await repo.getDraft('journal_draft');
      expect(updatedDraft?.content).toBe('Updated incomplete thoughts with more detail.');

      // Clear draft after publish
      await repo.clearDraft('journal_draft');
      expect(await repo.getDraft('journal_draft')).toBeNull();
    });
  });

  describe('GuestIdentityRepository', () => {
    it('generates a stable guest identity and preserves it across subsequent calls', async () => {
      const repo = new GuestIdentityRepository(driver);

      const identity1 = await repo.getOrCreateIdentity();
      expect(identity1.localUserId.startsWith('guest-')).toBe(true);
      expect(identity1.schemaVersion).toBe(1);

      const identity2 = await repo.getOrCreateIdentity();
      expect(identity2.localUserId).toBe(identity1.localUserId);
    });
  });
});
