import type { VaultManager } from '../vaultManager';
import { vaultManager } from '../vaultManager';
import { MigrationHarness } from './migrationHarness';
import { MIGRATION_METADATA_KEYS } from './migrationPlan';
import type { LegacyStorageDump, MigrationSummary } from './migrationTypes';

export type MigrationState =
  | 'NOT_STARTED'
  | 'PREFLIGHT'
  | 'READY_FOR_CONSENT'
  | 'MIGRATING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED_RECOVERABLE'
  | 'BLOCKED';

export interface MigrationStateSnapshot {
  state: MigrationState;
  hasLegacyData: boolean;
  legacyRecordCounts: {
    journals: number;
    prayers: number;
    moods: number;
    hasPreferences: boolean;
    hasHelpingHands: boolean;
    bookmarksCount: number;
  };
  errorMessage?: string;
  report?: MigrationSummary;
}

export class MigrationCoordinator {
  private vault: VaultManager;
  private harness: MigrationHarness;
  private state: MigrationState = 'NOT_STARTED';
  private errorMessage?: string;
  private lastReport?: MigrationSummary;
  private listeners: Set<(snapshot: MigrationStateSnapshot) => void> = new Set();

  constructor(vault: VaultManager = vaultManager) {
    this.vault = vault;
    this.harness = new MigrationHarness(vault);
  }

  getState(): MigrationState {
    return this.state;
  }

  getSnapshot(): MigrationStateSnapshot {
    const counts = this.inspectLegacyStorageCounts();
    return {
      state: this.state,
      hasLegacyData:
        counts.journals > 0 ||
        counts.prayers > 0 ||
        counts.moods > 0 ||
        counts.hasPreferences ||
        counts.hasHelpingHands ||
        counts.bookmarksCount > 0,
      legacyRecordCounts: counts,
      errorMessage: this.errorMessage,
      report: this.lastReport,
    };
  }

  subscribe(listener: (snapshot: MigrationStateSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('MigrationCoordinator listener error:', err);
      }
    }
  }

  /**
   * Inspects existing localStorage records without modifying or deleting them.
   */
  inspectLegacyStorageCounts(): {
    journals: number;
    prayers: number;
    moods: number;
    hasPreferences: boolean;
    hasHelpingHands: boolean;
    bookmarksCount: number;
  } {
    if (typeof window === 'undefined' || !window.localStorage) {
      return {
        journals: 0,
        prayers: 0,
        moods: 0,
        hasPreferences: false,
        hasHelpingHands: false,
        bookmarksCount: 0,
      };
    }

    let journals = 0;
    try {
      const raw = localStorage.getItem('lifted_journal_entries');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) journals = parsed.length;
      }
    } catch { /* Ignore */ }

    let prayers = 0;
    try {
      const raw = localStorage.getItem('lifted_prayer_requests');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) prayers = parsed.length;
      }
    } catch { /* Ignore */ }

    let moods = 0;
    try {
      const raw = localStorage.getItem('lifted_mood_history');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) moods = parsed.length;
      }
    } catch { /* Ignore */ }

    let hasPreferences = false;
    try {
      const raw = localStorage.getItem('lifted_user_preferences');
      if (raw && raw !== '{}') hasPreferences = true;
    } catch { /* Ignore */ }

    let hasHelpingHands = false;
    try {
      const raw = localStorage.getItem('lifted_helping_hands');
      if (raw) hasHelpingHands = true;
    } catch { /* Ignore */ }

    let bookmarksCount = 0;
    try {
      const rawDev = localStorage.getItem('lifted_saved_devotionals');
      if (rawDev) {
        const p = JSON.parse(rawDev);
        if (Array.isArray(p)) bookmarksCount += p.length;
      }
      const rawContent = localStorage.getItem('lifted_saved_content');
      if (rawContent) {
        const p = JSON.parse(rawContent);
        if (Array.isArray(p)) bookmarksCount += p.length;
      }
    } catch { /* Ignore */ }

    return {
      journals,
      prayers,
      moods,
      hasPreferences,
      hasHelpingHands,
      bookmarksCount,
    };
  }

  /**
   * Reads raw legacy records into a structured dump for the migration harness.
   */
  readLegacyStorageDump(): LegacyStorageDump {
    if (typeof window === 'undefined' || !window.localStorage) return {};

    const readJson = (key: string) => {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : undefined;
      } catch {
        return undefined;
      }
    };

    return {
      lifted_journal_entries: readJson('lifted_journal_entries'),
      lifted_prayer_requests: readJson('lifted_prayer_requests'),
      lifted_mood_history: readJson('lifted_mood_history'),
      lifted_user_preferences: readJson('lifted_user_preferences'),
      lifted_helping_hands: readJson('lifted_helping_hands'),
      lifted_saved_devotionals: readJson('lifted_saved_devotionals'),
      lifted_saved_content: readJson('lifted_saved_content'),
      lifted_last_checkin_date: localStorage.getItem('lifted_last_checkin_date') || undefined,
      lifted_haptics_enabled: localStorage.getItem('lifted_haptics_enabled') || undefined,
    };
  }

  /**
   * Stage 1: Preflight Readiness Check
   * Runs on application startup. Never begins migration automatically.
   */
  async checkReadiness(): Promise<MigrationStateSnapshot> {
    this.state = 'PREFLIGHT';
    this.errorMessage = undefined;
    this.notify();

    try {
      // 1. Initialize vault if not already initialized
      if (!this.vault.isReady()) {
        const initResult = await this.vault.initialize();
        if (initResult.state !== 'READY') {
          this.state = 'BLOCKED';
          this.errorMessage = initResult.errorMessage || `Vault initialization failed with state: ${initResult.state}`;
          this.notify();
          return this.getSnapshot();
        }
      }

      // 2. Check if migration was already completed
      const existingStatus = await this.vault.driver.getMetadata(MIGRATION_METADATA_KEYS.STATUS);
      if (existingStatus === 'COMPLETED') {
        this.state = 'COMPLETED';
        this.notify();
        return this.getSnapshot();
      }

      // 3. Inspect localStorage for legacy records
      const counts = this.inspectLegacyStorageCounts();
      const hasLegacy =
        counts.journals > 0 ||
        counts.prayers > 0 ||
        counts.moods > 0 ||
        counts.hasPreferences ||
        counts.hasHelpingHands ||
        counts.bookmarksCount > 0;

      if (!hasLegacy) {
        // Clean slate installation: mark completed so vault is active immediately
        await this.vault.driver.setMetadata(MIGRATION_METADATA_KEYS.STATUS, 'COMPLETED');
        await this.vault.driver.setMetadata(MIGRATION_METADATA_KEYS.TIMESTAMP, String(Date.now()));
        this.state = 'COMPLETED';
        this.notify();
        return this.getSnapshot();
      }

      // Legacy records found & vault ready -> require explicit user consent!
      this.state = 'READY_FOR_CONSENT';
      this.notify();
      return this.getSnapshot();
    } catch (err: unknown) {
      this.state = 'BLOCKED';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.notify();
      return this.getSnapshot();
    }
  }

  /**
   * Stage 2: Controlled Migration Execution
   * Requires explicit user consent action before invoking.
   */
  async startMigrationWithConsent(): Promise<MigrationSummary> {
    if (this.state !== 'READY_FOR_CONSENT' && this.state !== 'FAILED_RECOVERABLE') {
      throw new Error(`Cannot start migration in state: ${this.state}. User consent is required.`);
    }

    this.state = 'MIGRATING';
    this.errorMessage = undefined;
    this.notify();

    try {
      const dump = this.readLegacyStorageDump();

      // Transition to VERIFYING state during execution
      this.state = 'VERIFYING';
      this.notify();

      const summary = await this.harness.executeMigration(dump, {
        verifyIntegrity: true,
        rollbackOnError: true,
      });

      this.lastReport = summary;

      if (summary.status === 'COMPLETED') {
        this.state = 'COMPLETED';
      } else {
        this.state = 'FAILED_RECOVERABLE';
        this.errorMessage = summary.errors.join('; ') || 'Migration verification failed.';
      }

      this.notify();
      return summary;
    } catch (err: unknown) {
      this.state = 'FAILED_RECOVERABLE';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.notify();
      throw err;
    }
  }

  /**
   * Dismisses consent banner for current session without modifying state
   */
  dismissConsentBanner(): void {
    // Keep state as READY_FOR_CONSENT, UI can hide the banner for the active session
    this.notify();
  }

  /**
   * Reset helper for automated testing
   */
  resetForTesting(initialState: MigrationState = 'NOT_STARTED'): void {
    this.state = initialState;
    this.errorMessage = undefined;
    this.lastReport = undefined;
    this.notify();
  }
}

export const migrationCoordinator = new MigrationCoordinator();
