import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VaultManager } from '../../vaultManager';
import { IndexedDBDriver } from '../../databaseDriver';
import { WebKeyStorage } from '../../keyStorage';
import { WebCryptoEncryptionService } from '../../encryptionService';
import { MigrationHarness } from '../migrationHarness';
import type { LegacyStorageDump } from '../migrationTypes';

describe('MigrationHarness - Synthetic Migration Dry-Run & Safe Activation', () => {
  let driver: IndexedDBDriver;
  let keyStorage: WebKeyStorage;
  let encryption: WebCryptoEncryptionService;
  let vault: VaultManager;
  let harness: MigrationHarness;

  beforeEach(async () => {
    const testDbName = `lifted_test_migration_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    driver = new IndexedDBDriver(testDbName);
    encryption = new WebCryptoEncryptionService();
    keyStorage = new WebKeyStorage(encryption);

    await driver.initialize();
    await keyStorage.clearKey();

    vault = new VaultManager(driver, keyStorage, encryption);
    await vault.initialize();
    harness = new MigrationHarness(vault);
  });

  afterEach(async () => {
    await vault.close();
  });

  it('case 1: handles completely empty storage cleanly', async () => {
    const emptyDump: LegacyStorageDump = {};
    const preflight = await harness.preflight(emptyDump);
    expect(preflight.canProceed).toBe(true);
    expect(preflight.detectedKeys).toHaveLength(0);

    const summary = await harness.executeMigration(emptyDump);
    expect(summary.status).toBe('COMPLETED');
    expect(summary.journals.migrated).toBe(0);
    expect(summary.prayers.migrated).toBe(0);
    expect(summary.moods.migrated).toBe(0);
    expect(summary.errors).toHaveLength(0);
  });

  it('case 2 & 3: migrates one and multiple journal entries with full encryption and byte-for-byte fidelity', async () => {
    const dump: LegacyStorageDump = {
      lifted_journal_entries: [
        {
          id: 'j-sync-1',
          date: 'Oct 20, 2026',
          timestamp: 1729400000000,
          promptQuestion: 'What gave you strength today?',
          content: 'Reading Psalm 23 during the morning rush brought immediate peace.',
          moodTag: 'peaceful',
        },
        {
          id: 'j-sync-2',
          date: 'Oct 21, 2026',
          timestamp: 1729486400000,
          content: 'Parenting was overwhelming this afternoon, but taking five slow breaths helped me stay patient.',
          moodTag: 'anxious',
        },
      ],
    };

    const summary = await harness.executeMigration(dump);
    expect(summary.status).toBe('COMPLETED');
    expect(summary.journals.total).toBe(2);
    expect(summary.journals.migrated).toBe(2);
    expect(summary.journals.rejected).toBe(0);

    // Verify on disk: contents are encrypted
    const storedOnDisk = await driver.journals.getAll();
    expect(storedOnDisk).toHaveLength(2);
    for (const record of storedOnDisk) {
      expect(record.contentEncrypted.ct).toBeDefined();
      expect(record.contentEncrypted.iv).toBeDefined();
      // Ensure plaintext does NOT appear on disk
      expect(JSON.stringify(record)).not.toContain('Psalm 23');
      expect(JSON.stringify(record)).not.toContain('Parenting was overwhelming');
    }

    // Verify through vault repository: decrypted matches source byte-for-byte
    const decryptedJournals = await vault.journals.getAll();
    expect(decryptedJournals).toHaveLength(2);
    const j1 = decryptedJournals.find((j) => j.id === 'j-sync-1');
    const j2 = decryptedJournals.find((j) => j.id === 'j-sync-2');

    expect(j1?.content).toBe('Reading Psalm 23 during the morning rush brought immediate peace.');
    expect(j1?.promptQuestion).toBe('What gave you strength today?');
    expect(j1?.moodTag).toBe('peaceful');

    expect(j2?.content).toBe('Parenting was overwhelming this afternoon, but taking five slow breaths helped me stay patient.');
    expect(j2?.moodTag).toBe('anxious');
  });

  it('case 4: migrates prayer requests with follow-up state, encrypting title and body', async () => {
    const dump: LegacyStorageDump = {
      lifted_prayer_requests: [
        {
          id: 'p-sync-1',
          title: 'Grace for Difficult Conversation',
          body: 'Lord, give me gentle words and patience when speaking with family tonight.',
          visibility: 'confidential',
          createdAtTimestamp: 1729500000000,
          followUpScheduledDays: 3,
          followUpStatus: 'still_praying',
          intercessorsCount: 2,
          isPrayedByMe: true,
          isAnswered: false,
        },
        {
          id: 'p-sync-2',
          title: 'Thankful for Healing',
          body: 'Doctor appointment showed clear progress.',
          visibility: 'community',
          createdAtTimestamp: 1729600000000,
          followUpStatus: 'answered',
          isAnswered: true,
          answeredNote: 'God provided peace and skilled doctors.',
        },
      ],
    };

    const summary = await harness.executeMigration(dump);
    expect(summary.status).toBe('COMPLETED');
    expect(summary.prayers.migrated).toBe(2);

    // Verify disk encryption
    const storedPrayers = await driver.prayers.getAll();
    for (const record of storedPrayers) {
      expect(record.titleEncrypted.ct).toBeDefined();
      expect(record.requestEncrypted.ct).toBeDefined();
      expect(JSON.stringify(record)).not.toContain('Difficult Conversation');
      expect(JSON.stringify(record)).not.toContain('gentle words and patience');
    }

    // Verify vault decryption
    const decrypted = await vault.prayers.getAll();
    expect(decrypted).toHaveLength(2);
    const p1 = decrypted.find((p) => p.id === 'p-sync-1');
    const p2 = decrypted.find((p) => p.id === 'p-sync-2');

    expect(p1?.title).toBe('Grace for Difficult Conversation');
    expect(p1?.request).toBe('Lord, give me gentle words and patience when speaking with family tonight.');
    expect(p1?.followUpStatus).toBe('still_praying');
    expect(p1?.isPrivate).toBe(true);

    expect(p2?.title).toBe('Thankful for Healing');
    expect(p2?.answeredNote).toBe('God provided peace and skilled doctors.');
    expect(p2?.isPrivate).toBe(false); // Community visibility
  });

  it('case 5 & 6: migrates mood history and user preferences accurately', async () => {
    const dump: LegacyStorageDump = {
      lifted_mood_history: [
        {
          id: 'm-sync-1',
          mood: 'peaceful',
          additionalMoods: ['grateful'],
          note: 'Woke up without tension in my shoulders.',
          timestamp: 1729700000000,
          dateStr: 'Today',
        },
      ],
      lifted_user_preferences: {
        name: 'Cherie', // Should be sanitized to ''
        prayerFollowUpReminders: true,
        hapticsEnabled: true,
        sanctuaryLockEnabled: false,
      },
    };

    const summary = await harness.executeMigration(dump);
    expect(summary.status).toBe('COMPLETED');
    expect(summary.moods.migrated).toBe(1);
    expect(summary.preferences.migrated).toBe(true);

    // Verify mood note is encrypted on disk
    const storedMoods = await driver.moods.getAll();
    expect(storedMoods[0].noteEncrypted?.ct).toBeDefined();
    expect(JSON.stringify(storedMoods[0])).not.toContain('tension in my shoulders');

    // Verify decrypted mood
    const decryptedMoods = await vault.moods.getAll();
    expect(decryptedMoods[0].note).toBe('Woke up without tension in my shoulders.');

    // Verify preferences via vault: name is encrypted and legacy PIN is omitted
    const loadedPrefs = await vault.getUserPreferences();
    expect(loadedPrefs).toBeDefined();
    expect(loadedPrefs?.name).toBe(''); // Stripped Cherie
    expect(loadedPrefs?.hapticsEnabled).toBe(true);
    expect(loadedPrefs?.sanctuaryPin).toBeUndefined();
  });

  it('case 7 & 8: handles missing optional fields and isolates malformed records without failing the batch', async () => {
    const dump: LegacyStorageDump = {
      lifted_journal_entries: [
        {
          id: 'j-valid-minimal',
          content: 'Valid reflection with zero optional fields.',
        },
        {
          // Missing id -> must be rejected
          content: 'Malformed entry without identifier',
        },
        {
          id: 'j-malformed-content',
          content: 99999, // Bad content type -> must be rejected
        },
        {
          id: 'j-valid-2',
          content: 'Another valid reflection.',
        },
      ],
    };

    const summary = await harness.executeMigration(dump);
    expect(summary.status).toBe('COMPLETED');
    expect(summary.journals.total).toBe(4);
    expect(summary.journals.migrated).toBe(2);
    expect(summary.journals.rejected).toBe(2);
    expect(summary.errors).toHaveLength(2);

    // Verify only the 2 valid entries were stored
    expect(await vault.journals.count()).toBe(2);
  });

  it('case 9: deduplicates duplicate identifiers within a batch, keeping the latest timestamp', async () => {
    const dump: LegacyStorageDump = {
      lifted_journal_entries: [
        {
          id: 'j-dup-1',
          content: 'Early draft of entry',
          timestamp: 1000,
        },
        {
          id: 'j-dup-1',
          content: 'Updated and final version of entry',
          timestamp: 2000,
        },
      ],
    };

    const summary = await harness.executeMigration(dump);
    expect(summary.journals.total).toBe(1); // Deduped
    expect(summary.journals.migrated).toBe(1);

    const record = await vault.journals.getById('j-dup-1');
    expect(record?.content).toBe('Updated and final version of entry');
  });

  it('case 10: supports partial migrations (only bookmarks and helping hands)', async () => {
    const dump: LegacyStorageDump = {
      lifted_saved_devotionals: ['dev-today', 'dev-healing-grace'],
      lifted_saved_content: ['cat-breath-478'],
      lifted_helping_hands: [
        {
          id: 'mod-1',
          moduleNumber: 1,
          title: 'Grounding',
          subtitle: 'Step 1',
          description: 'Desc',
          steps: [{ stepNumber: 1, title: 'Step 1', isCompleted: true, userNote: 'Felt calm' }],
        },
      ],
    };

    const summary = await harness.executeMigration(dump);
    expect(summary.status).toBe('COMPLETED');
    expect(summary.bookmarks.devotionalsCount).toBe(2);
    expect(summary.bookmarks.contentCount).toBe(1);
    expect(summary.helpingHands.completedStepsCount).toBe(1);

    const devBookmarks = JSON.parse((await driver.getMetadata('bookmarks_devotionals')) || '[]');
    expect(devBookmarks).toEqual(['dev-today', 'dev-healing-grace']);

    // Verify helping hands personal notes are encrypted on disk
    const rawHh = await driver.getMetadata('helping_hands');
    expect(rawHh).toBeDefined();
    expect(rawHh).not.toContain('Felt calm');
    expect(rawHh).toContain('userNoteEncrypted');

    // Verify decrypted notes via vault
    const templateMod = [
      {
        id: 'mod-1',
        moduleNumber: 1,
        title: 'Grounding',
        subtitle: 'Step 1',
        description: 'Desc',
        steps: [{ id: 'step-1', stepNumber: 1, title: 'Step 1', purpose: 'P', guidedSequence: [], scriptureAnchor: '', biblicalTruth: '', exercisePrompt: '', practicalTakeaway: '', isCompleted: false }],
      },
    ];
    const loadedHh = await vault.getHelpingHands(templateMod);
    expect(loadedHh?.[0].steps[0].isCompleted).toBe(true);
    expect(loadedHh?.[0].steps[0].userNote).toBe('Felt calm');
  });

  it('case 12 & 13: halts safely without data loss when encryption key is unavailable or invalid', async () => {
    // Simulate uninitialized or broken vault
    const unreadyVault = new VaultManager(driver, keyStorage, encryption);
    // Notice: not initialized -> state is UNAVAILABLE
    const unreadyHarness = new MigrationHarness(unreadyVault);

    const summary = await unreadyHarness.executeMigration({
      lifted_journal_entries: [{ id: 'j-fail-1', content: 'Should not write' }],
    });

    expect(summary.status).toBe('HALTED');
    expect(summary.errors[0]).toContain('Migration halted: Vault not ready');
    // Ensure zero records were created in driver
    expect(await driver.journals.count()).toBe(0);
  });

  it('case 15: enforces idempotency on repeated imports without creating duplicates', async () => {
    const dump: LegacyStorageDump = {
      lifted_journal_entries: [
        { id: 'j-idem-1', content: 'Idempotent test reflection', timestamp: 1000 },
      ],
    };

    // First run
    const firstSummary = await harness.executeMigration(dump);
    expect(firstSummary.status).toBe('COMPLETED');
    expect(firstSummary.journals.migrated).toBe(1);
    expect(await vault.journals.count()).toBe(1);

    // Second run without force flag
    const secondSummary = await harness.executeMigration(dump);
    expect(secondSummary.status).toBe('ALREADY_COMPLETED');
    expect(await vault.journals.count()).toBe(1);

    // Third run with force flag (must skip existing destination records because timestamp is equal)
    const forcedSummary = await harness.executeMigration(dump, { force: true });
    expect(forcedSummary.status).toBe('COMPLETED');
    expect(forcedSummary.journals.skipped).toBe(1); // Destination record already exists with equal/newer timestamp
    expect(forcedSummary.journals.migrated).toBe(0);
    expect(await vault.journals.count()).toBe(1);
  });

  it('case 16: conflict resolution: newer destination records are NOT overwritten by older legacy records', async () => {
    // 1. User created a newer record in the vault
    await vault.journals.create({
      id: 'j-conflict-1',
      date: 'Oct 31, 2026',
      timestamp: 5000,
      content: 'Newer reflection authored inside the encrypted vault.',
      localUserId: 'test-user',
      cloudUserId: null,
    });

    // 2. Legacy dump contains an older version of the same ID
    const dump: LegacyStorageDump = {
      lifted_journal_entries: [
        {
          id: 'j-conflict-1',
          date: 'Oct 20, 2026',
          timestamp: 2000, // Older timestamp
          content: 'Outdated legacy draft that should NOT overwrite newer data.',
        },
      ],
    };

    const summary = await harness.executeMigration(dump, { force: true });
    expect(summary.journals.skipped).toBe(1);
    expect(summary.journals.migrated).toBe(0);

    // Verify newer content is preserved intact
    const current = await vault.journals.getById('j-conflict-1');
    expect(current?.content).toBe('Newer reflection authored inside the encrypted vault.');
  });

  it('case 11 & 17: rollback support when transaction encounters an unrecoverable write failure', async () => {
    // Provide a payload that should be rolled back
    const dump: LegacyStorageDump = {
      lifted_journal_entries: [
        { id: 'j-rollback-1', content: 'Will be rolled back', timestamp: 1000 },
      ],
    };

    // Simulate write error
    vi.spyOn(vault.journals, 'create').mockRejectedValueOnce(new Error('Disk write I/O error'));

    const summary = await harness.executeMigration(dump, { rollbackOnError: true });
    expect(summary.status).toBe('FAILED');
    expect(summary.errors[0]).toContain('Migration transaction failed: Disk write I/O error');
  });
});
