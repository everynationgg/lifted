import type { VaultManager } from '../vaultManager';
import {
  MIGRATION_VERSION,
  MIGRATION_METADATA_KEYS,
  type MigrationPreflightResult,
  type MigrationOptions,
} from './migrationPlan';
import type {
  LegacyStorageDump,
  MigrationSummary,
  LegacyJournalEntry,
  LegacyPrayerRequest,
  LegacyMoodCheckIn,
} from './migrationTypes';
import {
  mapLegacyJournalEntry,
  mapLegacyPrayerRequest,
  mapLegacyMoodRecord,
  mapLegacyUserPreferences,
  deduplicateLegacyBatch,
} from './migrationMapper';
import type { HelpingHandsModule } from '../../types';

export class MigrationHarness {
  private vault: VaultManager;

  constructor(vault: VaultManager) {
    this.vault = vault;
  }

  /**
   * Preflight Readiness Check
   * Inspects vault state, migration flag, and detected keys in legacy input.
   */
  async preflight(dump: LegacyStorageDump): Promise<MigrationPreflightResult> {
    const reasons: string[] = [];
    const isReady = this.vault.isReady();

    if (!isReady) {
      reasons.push(`Vault is not ready (State: ${this.vault.getState()}).`);
    }

    let alreadyMigrated = false;
    if (isReady) {
      try {
        const storedStatus = await this.vault.driver.getMetadata(MIGRATION_METADATA_KEYS.STATUS);
        if (storedStatus === 'COMPLETED') {
          alreadyMigrated = true;
          reasons.push('Migration v2 has already been completed in this vault.');
        }
      } catch (err: unknown) {
        reasons.push(`Failed to read vault metadata: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const detectedKeys: string[] = [];
    if (dump.lifted_journal_entries !== undefined) detectedKeys.push('lifted_journal_entries');
    if (dump.lifted_prayer_requests !== undefined) detectedKeys.push('lifted_prayer_requests');
    if (dump.lifted_mood_history !== undefined) detectedKeys.push('lifted_mood_history');
    if (dump.lifted_user_preferences !== undefined) detectedKeys.push('lifted_user_preferences');
    if (dump.lifted_helping_hands !== undefined) detectedKeys.push('lifted_helping_hands');
    if (dump.lifted_saved_devotionals !== undefined) detectedKeys.push('lifted_saved_devotionals');
    if (dump.lifted_saved_content !== undefined) detectedKeys.push('lifted_saved_content');
    if (dump.lifted_last_checkin_date !== undefined) detectedKeys.push('lifted_last_checkin_date');
    if (dump.lifted_haptics_enabled !== undefined) detectedKeys.push('lifted_haptics_enabled');

    const canProceed = isReady && (!alreadyMigrated || reasons.length === 0);

    return {
      canProceed,
      vaultReady: isReady,
      alreadyMigrated,
      detectedKeys,
      reasons,
    };
  }

  /**
   * Executes a synthetic dry-run: transforms records, evaluates validation and conflicts,
   * without persisting any data to the vault.
   */
  async dryRun(dump: LegacyStorageDump): Promise<MigrationSummary> {
    const summary: MigrationSummary = {
      version: MIGRATION_VERSION,
      status: 'COMPLETED',
      startedAt: Date.now(),
      journals: { total: 0, migrated: 0, skipped: 0, rejected: 0 },
      prayers: { total: 0, migrated: 0, skipped: 0, rejected: 0 },
      moods: { total: 0, migrated: 0, skipped: 0, rejected: 0 },
      preferences: { migrated: false },
      helpingHands: { totalModules: 0, completedStepsCount: 0 },
      bookmarks: { devotionalsCount: 0, contentCount: 0 },
      errors: [],
    };

    // 1. Journals Dry-Run
    if (Array.isArray(dump.lifted_journal_entries)) {
      const deduped = deduplicateLegacyBatch(dump.lifted_journal_entries as LegacyJournalEntry[]);
      summary.journals.total = deduped.length;
      for (const item of deduped) {
        const res = mapLegacyJournalEntry(item, 'dry-run-user');
        if (res.success) {
          summary.journals.migrated += 1;
        } else {
          summary.journals.rejected += 1;
          summary.errors.push(res.error || 'Unknown journal validation error');
        }
      }
    }

    // 2. Prayers Dry-Run
    if (Array.isArray(dump.lifted_prayer_requests)) {
      const deduped = deduplicateLegacyBatch(dump.lifted_prayer_requests as LegacyPrayerRequest[]);
      summary.prayers.total = deduped.length;
      for (const item of deduped) {
        const res = mapLegacyPrayerRequest(item);
        if (res.success) {
          summary.prayers.migrated += 1;
        } else {
          summary.prayers.rejected += 1;
          summary.errors.push(res.error || 'Unknown prayer validation error');
        }
      }
    }

    // 3. Moods Dry-Run
    if (Array.isArray(dump.lifted_mood_history)) {
      const deduped = deduplicateLegacyBatch(dump.lifted_mood_history as LegacyMoodCheckIn[]);
      summary.moods.total = deduped.length;
      for (const item of deduped) {
        const res = mapLegacyMoodRecord(item);
        if (res.success) {
          summary.moods.migrated += 1;
        } else {
          summary.moods.rejected += 1;
          summary.errors.push(res.error || 'Unknown mood validation error');
        }
      }
    }

    // 4. Preferences Dry-Run
    if (dump.lifted_user_preferences) {
      const res = mapLegacyUserPreferences(dump.lifted_user_preferences);
      summary.preferences.migrated = res.success;
      if (!res.success) summary.preferences.error = res.error;
    }

    summary.completedAt = Date.now();
    return summary;
  }

  /**
   * Executes the full migration against the vault.
   * Performs preflight checks, conflict resolution, authenticated field encryption,
   * post-write integrity verification, and transactional state marking.
   */
  async executeMigration(
    dump: LegacyStorageDump,
    options?: MigrationOptions
  ): Promise<MigrationSummary> {
    const startedAt = Date.now();
    const summary: MigrationSummary = {
      version: MIGRATION_VERSION,
      status: 'COMPLETED',
      startedAt,
      journals: { total: 0, migrated: 0, skipped: 0, rejected: 0 },
      prayers: { total: 0, migrated: 0, skipped: 0, rejected: 0 },
      moods: { total: 0, migrated: 0, skipped: 0, rejected: 0 },
      preferences: { migrated: false },
      helpingHands: { totalModules: 0, completedStepsCount: 0 },
      bookmarks: { devotionalsCount: 0, contentCount: 0 },
      errors: [],
    };

    // Preflight check
    const preflightRes = await this.preflight(dump);
    if (!preflightRes.vaultReady) {
      summary.status = 'HALTED';
      summary.errors.push(`Migration halted: Vault not ready. ${preflightRes.reasons.join(' ')}`);
      return summary;
    }

    if (preflightRes.alreadyMigrated && !options?.force) {
      summary.status = 'ALREADY_COMPLETED';
      return summary;
    }

    // Track written entities for rollback if requested
    const writtenJournals: string[] = [];
    const writtenPrayers: string[] = [];
    const writtenMoods: string[] = [];

    try {
      // 1. Retrieve or establish local guest identity
      const identity = await this.vault.identity.getOrCreateIdentity();
      const localUserId = identity.localUserId;

      // 2. Migrate Journal Entries
      if (Array.isArray(dump.lifted_journal_entries)) {
        const deduped = deduplicateLegacyBatch(dump.lifted_journal_entries as LegacyJournalEntry[]);
        summary.journals.total = deduped.length;

        for (const rawItem of deduped) {
          const mapRes = mapLegacyJournalEntry(rawItem, localUserId);
          if (!mapRes.success || !mapRes.data) {
            summary.journals.rejected += 1;
            summary.errors.push(mapRes.error || 'Invalid journal entry');
            continue;
          }

          const entry = mapRes.data;
          const existing = await this.vault.journals.getById(entry.id);

          // Conflict resolution: if destination record exists and is newer or equal, skip
          if (existing) {
            if (existing.timestamp >= entry.timestamp) {
              summary.journals.skipped += 1;
              continue;
            }
            // Update if legacy entry is newer
            await this.vault.journals.update(entry.id, {
              content: entry.content,
              promptQuestion: entry.promptQuestion,
              moodTag: entry.moodTag,
              timestamp: entry.timestamp,
              date: entry.date,
            });
            summary.journals.migrated += 1;
          } else {
            await this.vault.journals.create({
              id: entry.id,
              date: entry.date,
              timestamp: entry.timestamp,
              content: entry.content,
              promptQuestion: entry.promptQuestion,
              moodTag: entry.moodTag,
              localUserId: entry.localUserId,
              cloudUserId: null,
            });
            writtenJournals.push(entry.id);
            summary.journals.migrated += 1;
          }

          // Verify field integrity immediately
          if (options?.verifyIntegrity !== false) {
            const verified = await this.vault.journals.getById(entry.id);
            if (!verified || verified.content !== entry.content) {
              throw new Error(`Integrity verification failed for Journal [${entry.id}]: Decrypted content mismatch.`);
            }
          }
        }
      }

      // 3. Migrate Prayer Requests
      if (Array.isArray(dump.lifted_prayer_requests)) {
        const deduped = deduplicateLegacyBatch(dump.lifted_prayer_requests as LegacyPrayerRequest[]);
        summary.prayers.total = deduped.length;

        for (const rawItem of deduped) {
          const mapRes = mapLegacyPrayerRequest(rawItem);
          if (!mapRes.success || !mapRes.data) {
            summary.prayers.rejected += 1;
            summary.errors.push(mapRes.error || 'Invalid prayer request');
            continue;
          }

          const prayer = mapRes.data;
          const existing = await this.vault.prayers.getById(prayer.id);

          if (existing) {
            if (existing.createdAt >= prayer.createdAt) {
              summary.prayers.skipped += 1;
              continue;
            }
            await this.vault.prayers.update(prayer.id, {
              title: prayer.title,
              request: prayer.request,
              category: prayer.category,
              isPrivate: prayer.isPrivate,
              followUpStatus: prayer.followUpStatus,
              followUpDate: prayer.followUpDate,
              intercessorsCount: prayer.intercessorsCount,
              isPrayedByMe: prayer.isPrayedByMe,
              isAnswered: prayer.isAnswered,
              answeredNote: prayer.answeredNote,
            });
            summary.prayers.migrated += 1;
          } else {
            await this.vault.prayers.create({
              id: prayer.id,
              title: prayer.title,
              request: prayer.request,
              category: prayer.category,
              isPrivate: prayer.isPrivate,
              followUpStatus: prayer.followUpStatus,
              followUpDate: prayer.followUpDate,
              followUpScheduledDays: prayer.followUpScheduledDays,
              followUpTriggered: prayer.followUpTriggered,
              intercessorsCount: prayer.intercessorsCount,
              isPrayedByMe: prayer.isPrayedByMe,
              isAnswered: prayer.isAnswered,
              answeredNote: prayer.answeredNote,
              remindersEnabled: prayer.remindersEnabled,
            });
            writtenPrayers.push(prayer.id);
            summary.prayers.migrated += 1;
          }

          // Verify field integrity immediately
          if (options?.verifyIntegrity !== false) {
            const verified = await this.vault.prayers.getById(prayer.id);
            if (!verified || verified.title !== prayer.title || verified.request !== prayer.request) {
              throw new Error(`Integrity verification failed for Prayer [${prayer.id}]: Decrypted content mismatch.`);
            }
          }
        }
      }

      // 4. Migrate Mood History
      if (Array.isArray(dump.lifted_mood_history)) {
        const deduped = deduplicateLegacyBatch(dump.lifted_mood_history as LegacyMoodCheckIn[]);
        summary.moods.total = deduped.length;

        for (const rawItem of deduped) {
          const mapRes = mapLegacyMoodRecord(rawItem);
          if (!mapRes.success || !mapRes.data) {
            summary.moods.rejected += 1;
            summary.errors.push(mapRes.error || 'Invalid mood check-in');
            continue;
          }

          const mood = mapRes.data;
          const existing = await this.vault.moods.getById(mood.id);

          if (existing) {
            summary.moods.skipped += 1;
            continue;
          }

          await this.vault.moods.create(mood);
          writtenMoods.push(mood.id);
          summary.moods.migrated += 1;

          // Verify field integrity immediately
          if (options?.verifyIntegrity !== false) {
            const verified = await this.vault.moods.getById(mood.id);
            if (!verified || verified.mood !== mood.mood || verified.note !== mood.note) {
              throw new Error(`Integrity verification failed for Mood [${mood.id}]: Note or mood mismatch.`);
            }
          }
        }
      }

      // 5. Migrate User Preferences (Encrypted Profile Name & Stripped Legacy PIN)
      if (dump.lifted_user_preferences) {
        const prefRes = mapLegacyUserPreferences(dump.lifted_user_preferences);
        if (prefRes.success && prefRes.data) {
          await this.vault.saveUserPreferences(prefRes.data);
          summary.preferences.migrated = true;
        } else {
          summary.preferences.error = prefRes.error;
          summary.errors.push(prefRes.error || 'Failed to map preferences');
        }
      }

      // 6. Migrate Helping Hands Progress (Encrypted Personal Notes)
      if (Array.isArray(dump.lifted_helping_hands)) {
        const modules = dump.lifted_helping_hands as HelpingHandsModule[];
        let completedSteps = 0;
        for (const m of modules) {
          if (Array.isArray(m.steps)) {
            completedSteps += m.steps.filter((s) => s.isCompleted).length;
          }
        }
        await this.vault.saveHelpingHands(modules);
        summary.helpingHands.totalModules = modules.length;
        summary.helpingHands.completedStepsCount = completedSteps;
      }

      // 7. Migrate Bookmarks & Gatekeeper State
      if (Array.isArray(dump.lifted_saved_devotionals)) {
        await this.vault.driver.setMetadata('bookmarks_devotionals', JSON.stringify(dump.lifted_saved_devotionals));
        summary.bookmarks.devotionalsCount = dump.lifted_saved_devotionals.length;
      }
      if (Array.isArray(dump.lifted_saved_content)) {
        await this.vault.driver.setMetadata('bookmarks_content', JSON.stringify(dump.lifted_saved_content));
        summary.bookmarks.contentCount = dump.lifted_saved_content.length;
      }
      if (typeof dump.lifted_last_checkin_date === 'string' && dump.lifted_last_checkin_date.trim()) {
        await this.vault.driver.setMetadata('last_checkin_date', dump.lifted_last_checkin_date.trim());
      }
      if (dump.lifted_haptics_enabled !== undefined) {
        await this.vault.driver.setMetadata('haptics_enabled', String(dump.lifted_haptics_enabled));
      }

      // 8. Record Completion Metadata
      await this.vault.driver.setMetadata(MIGRATION_METADATA_KEYS.STATUS, 'COMPLETED');
      await this.vault.driver.setMetadata(MIGRATION_METADATA_KEYS.TIMESTAMP, String(Date.now()));
      await this.vault.driver.setMetadata(MIGRATION_METADATA_KEYS.REPORT, JSON.stringify(summary));

      summary.completedAt = Date.now();
      summary.status = 'COMPLETED';
      return summary;
    } catch (err: unknown) {
      summary.status = 'FAILED';
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push(`Migration transaction failed: ${msg}`);

      // Handle optional rollback on error
      if (options?.rollbackOnError) {
        for (const id of writtenJournals) {
          try { await this.vault.journals.delete(id); } catch { /* Ignore */ }
        }
        for (const id of writtenPrayers) {
          try { await this.vault.prayers.delete(id); } catch { /* Ignore */ }
        }
        for (const id of writtenMoods) {
          try { await this.vault.moods.delete(id); } catch { /* Ignore */ }
        }
      }

      return summary;
    }
  }
}
