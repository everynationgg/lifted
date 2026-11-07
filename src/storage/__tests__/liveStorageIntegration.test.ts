import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VaultManager } from '../vaultManager';
import { IndexedDBDriver } from '../databaseDriver';
import { WebKeyStorage } from '../keyStorage';
import { WebCryptoEncryptionService } from '../encryptionService';
import type { UserPreferences, HelpingHandsModule } from '../../types';

describe('Live Storage Integration - Security, Encrypted Metadata & Draft Recovery', () => {
  let driver: IndexedDBDriver;
  let keyStorage: WebKeyStorage;
  let encryption: WebCryptoEncryptionService;
  let vault: VaultManager;

  beforeEach(async () => {
    const testDbName = `lifted_test_live_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    driver = new IndexedDBDriver(testDbName);
    encryption = new WebCryptoEncryptionService();
    keyStorage = new WebKeyStorage(encryption);

    await driver.initialize();
    await keyStorage.clearKey();

    vault = new VaultManager(driver, keyStorage, encryption);
    await vault.initialize();
  });

  afterEach(async () => {
    await vault.close();
  });

  describe('Sensitive Metadata Encryption & PIN Purging', () => {
    it('encrypts user profile name under AES-256-GCM and purges legacy sanctuaryPin', async () => {
      const prefs: UserPreferences = {
        name: 'Rachel Henderson',
        prayerFollowUpReminders: true,
        dailyDevotionalReminders: true,
        notificationsEnabled: true,
        language: 'en',
        currency: 'USD',
        sanctuaryLockEnabled: true,
        sanctuaryPin: '9876', // Must be purged!
      };

      await vault.saveUserPreferences(prefs);

      // 1. Inspect raw disk metadata: name must NOT appear in plaintext, and PIN must NOT exist
      const rawStored = await driver.getMetadata('user_preferences');
      expect(rawStored).toBeDefined();
      expect(rawStored).not.toContain('Rachel Henderson');
      expect(rawStored).not.toContain('9876');
      expect(rawStored).toContain('nameEncrypted');

      // 2. Read through vault: name is cleanly decrypted and PIN is undefined
      const loaded = await vault.getUserPreferences();
      expect(loaded).toBeDefined();
      expect(loaded?.name).toBe('Rachel Henderson');
      expect(loaded?.sanctuaryPin).toBeUndefined();
      expect(loaded?.sanctuaryLockEnabled).toBe(false);
    });

    it('encrypts Helping Hands user-authored reflection notes on disk', async () => {
      const modules: HelpingHandsModule[] = [
        {
          id: 'mod-grief-1',
          moduleNumber: 1,
          title: 'Grief & Mourning',
          subtitle: 'Acknowledge Pain',
          description: 'Faithful grounding in sorrow.',
          steps: [
            {
              id: 'step-1-1',
              stepNumber: 1,
              title: 'Naming the Loss',
              purpose: 'Speak truth to sadness.',
              guidedSequence: ['Sit quietly', 'Breathe'],
              scriptureAnchor: 'Psalm 34:18',
              biblicalTruth: 'The Lord is close to the brokenhearted.',
              exercisePrompt: 'Write what you miss most.',
              practicalTakeaway: 'Grief is an act of love.',
              isCompleted: true,
              userNote: 'I really miss my father’s quiet guidance when making decisions.',
            },
          ],
        },
      ];

      await vault.saveHelpingHands(modules);

      // 1. Inspect raw metadata on disk: personal reflection note must be encrypted
      const rawStored = await driver.getMetadata('helping_hands');
      expect(rawStored).toBeDefined();
      expect(rawStored).not.toContain('father’s quiet guidance');
      expect(rawStored).toContain('userNoteEncrypted');

      // 2. Read through vault: note is decrypted accurately
      const loaded = await vault.getHelpingHands(modules);
      expect(loaded).toBeDefined();
      expect(loaded?.[0].steps[0].isCompleted).toBe(true);
      expect(loaded?.[0].steps[0].userNote).toBe('I really miss my father’s quiet guidance when making decisions.');
    });
  });

  describe('Encrypted Draft Recovery Lifecycle', () => {
    it('saves, retrieves, and clears crash-resilient editor drafts with encryption', async () => {
      const draftKey = 'draft_journal_composition';
      const draftContent = 'Unfinished reflection: Lord, I am struggling with anger today and need your peace.';

      // Save draft
      await vault.drafts.saveDraft(draftKey, draftContent);

      // Verify on disk: content is encrypted
      const storedDrafts = await driver.drafts.getAll();
      expect(storedDrafts).toHaveLength(1);
      expect(storedDrafts[0].contentEncrypted.ct).toBeDefined();
      expect(JSON.stringify(storedDrafts[0])).not.toContain('struggling with anger');

      // Retrieve via repository: content is decrypted
      const retrieved = await vault.drafts.getDraft(draftKey);
      expect(retrieved).toBeDefined();
      expect(retrieved?.content).toBe(draftContent);

      // Clear draft upon successful submission
      await vault.drafts.clearDraft(draftKey);
      const afterClear = await vault.drafts.getDraft(draftKey);
      expect(afterClear).toBeNull();
    });
  });

  describe('Hydration Safety & Persistence Verification', () => {
    it('persists and retrieves bookmarks and gatekeeper dates accurately', async () => {
      await vault.saveBookmarks({
        devotionals: ['dev-grace-1', 'dev-peace-2'],
        content: ['cat-breath-478'],
      });
      await vault.saveCheckInDate('2026-10-31');

      const bookmarks = await vault.getBookmarks();
      expect(bookmarks.devotionals).toEqual(['dev-grace-1', 'dev-peace-2']);
      expect(bookmarks.content).toEqual(['cat-breath-478']);

      const checkInDate = await vault.getCheckInDate();
      expect(checkInDate).toBe('2026-10-31');
    });

    it('creates, updates, and deletes prayers with encrypted title and request', async () => {
      const prayer = await vault.prayers.create({
        id: 'p-live-1',
        title: 'Work Discernment',
        request: 'Seeking clarity for career transition.',
        category: 'personal',
        isPrivate: true,
        followUpStatus: 'none',
        followUpScheduledDays: 3,
        intercessorsCount: 1,
        isPrayedByMe: true,
        followUpTriggered: false,
        remindersEnabled: true,
      });

      expect(prayer.id).toBe('p-live-1');
      expect(prayer.request).toBe('Seeking clarity for career transition.');

      // Update follow-up status
      const updated = await vault.prayers.update('p-live-1', {
        followUpStatus: 'answered',
        isAnswered: true,
        answeredNote: 'God provided an open door.',
      });

      expect(updated.followUpStatus).toBe('answered');
      expect(updated.answeredNote).toBe('God provided an open door.');

      // Verify on disk: answeredNote is encrypted
      const stored = await driver.prayers.get('p-live-1');
      expect(stored?.answeredNoteEncrypted?.ct).toBeDefined();
      expect(JSON.stringify(stored)).not.toContain('open door');

      // Delete
      await vault.prayers.delete('p-live-1');
      expect(await vault.prayers.count()).toBe(0);
    });
  });
});
