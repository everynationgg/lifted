import type {
  KeyLifecycleState,
  IJournalRepository,
  IPrayerRepository,
  IMoodRepository,
  IDraftRepository,
  IGuestIdentityRepository,
  EncryptedPayload,
} from './types';
import type { UserPreferences, HelpingHandsModule } from '../types';
import { encryptionService, type IEncryptionService } from './encryptionService';
import { getKeyStorage, type IKeyStorage } from './keyStorage';
import { getDatabaseDriver, type IDatabaseDriver } from './databaseDriver';
import { JournalRepository } from './repositories/journalRepository';
import { PrayerRepository } from './repositories/prayerRepository';
import { MoodRepository } from './repositories/moodRepository';
import { DraftRepository } from './repositories/draftRepository';
import { GuestIdentityRepository } from './repositories/guestIdentityRepository';

export interface VaultInitResult {
  state: KeyLifecycleState;
  errorMessage?: string;
}

export class VaultManager {
  readonly driver: IDatabaseDriver;
  private keyStorage: IKeyStorage;
  private encryption: IEncryptionService;
  private key: CryptoKey | null = null;
  private state: KeyLifecycleState = 'UNAVAILABLE';
  private initPromise: Promise<VaultInitResult> | null = null;

  journals!: IJournalRepository;
  prayers!: IPrayerRepository;
  moods!: IMoodRepository;
  drafts!: IDraftRepository;
  identity!: IGuestIdentityRepository;

  constructor(
    driver: IDatabaseDriver = getDatabaseDriver(),
    keyStorage: IKeyStorage = getKeyStorage(),
    encryption: IEncryptionService = encryptionService
  ) {
    this.driver = driver;
    this.keyStorage = keyStorage;
    this.encryption = encryption;
  }

  getState(): KeyLifecycleState {
    return this.state;
  }

  isReady(): boolean {
    return this.state === 'READY' && this.key !== null;
  }

  async initialize(): Promise<VaultInitResult> {
    if (this.isReady()) {
      return { state: 'READY' };
    }
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      try {
        // 1. Initialize underlying storage driver
        await this.driver.initialize();

        // 2. Detect if an existing encrypted database or records exist
        const databaseExists = await this.driver.hasExistingData();

        // 3. Retrieve or safely generate encryption key
        const keyResult = await this.keyStorage.loadOrCreateKey(databaseExists);

        if (keyResult.state === 'KEY_MISSING') {
          this.state = 'KEY_MISSING';
          return {
            state: 'KEY_MISSING',
            errorMessage:
              'Encrypted vault database exists, but security key is missing from secure storage. Halting to prevent data overwrite.',
          };
        }

        if (!keyResult.key) {
          this.state = 'UNAVAILABLE';
          return {
            state: 'UNAVAILABLE',
            errorMessage: 'Failed to acquire cryptographic key.',
          };
        }

        this.key = keyResult.key;

        // 4. Verify or create security canary token
        if (keyResult.state === 'FIRST_INSTALL' || !databaseExists) {
          // Clean slate: create and record canary token
          const canaryPayload = await this.encryption.createCanaryPayload(this.key);
          await this.driver.setMetadata('canary', JSON.stringify(canaryPayload));
          this.state = 'READY';
        } else {
          // Existing database: verify canary token
          const storedCanaryJson = await this.driver.getMetadata('canary');
          if (storedCanaryJson) {
            try {
              const canaryPayload = JSON.parse(storedCanaryJson) as EncryptedPayload;
              const isValid = await this.encryption.verifyCanaryPayload(canaryPayload, this.key);
              if (!isValid) {
                this.state = 'KEY_INVALID';
                return {
                  state: 'KEY_INVALID',
                  errorMessage: 'Encryption key failed canary verification. Data cannot be decrypted.',
                };
              }
            } catch {
              this.state = 'KEY_INVALID';
              return {
                state: 'KEY_INVALID',
                errorMessage: 'Corrupted canary record detected in database metadata.',
              };
            }
          }
          this.state = 'READY';
        }

        // 5. Instantiate domain repositories bound to the active verified key
        this.journals = new JournalRepository(this.driver, this.encryption, this.key);
        this.prayers = new PrayerRepository(this.driver, this.encryption, this.key);
        this.moods = new MoodRepository(this.driver, this.encryption, this.key);
        this.drafts = new DraftRepository(this.driver, this.encryption, this.key);
        this.identity = new GuestIdentityRepository(this.driver);

        return { state: 'READY' };
      } catch (err: unknown) {
        this.state = 'UNAVAILABLE';
        const msg = err instanceof Error ? err.message : 'Unknown vault error';
        return {
          state: 'UNAVAILABLE',
          errorMessage: msg,
        };
      } finally {
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Encrypted User Preferences Storage
   * Personal names are encrypted with AES-256-GCM.
   * Legacy plaintext PINs are strictly purged.
   */
  async saveUserPreferences(prefs: UserPreferences): Promise<void> {
    if (!this.key) throw new Error('Vault is not ready to save preferences.');
    const nameEncrypted = prefs.name?.trim()
      ? await this.encryption.encryptString(prefs.name.trim(), this.key)
      : null;

    const stored = {
      nameEncrypted,
      prayerFollowUpReminders: prefs.prayerFollowUpReminders,
      dailyDevotionalReminders: prefs.dailyDevotionalReminders,
      dailyReminderTime: prefs.dailyReminderTime || '08:00',
      notificationsEnabled: prefs.notificationsEnabled,
      language: prefs.language,
      currency: prefs.currency,
      isAdminMode: prefs.isAdminMode,
      hapticsEnabled: prefs.hapticsEnabled,
      // Security Rule: If legacy plaintext PIN is submitted, lock is reset to false until secure enrollment
      sanctuaryLockEnabled: prefs.sanctuaryPin ? false : Boolean(prefs.sanctuaryLockEnabled),
      sanctuaryAutoLockInterval: typeof prefs.sanctuaryAutoLockInterval === 'number' ? prefs.sanctuaryAutoLockInterval : 0,
      useBiometrics: prefs.useBiometrics ?? true,
    };

    await this.driver.setMetadata('user_preferences', JSON.stringify(stored));
  }

  async getUserPreferences(): Promise<UserPreferences | null> {
    const raw = await this.driver.getMetadata('user_preferences');
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      let name = '';
      if (parsed.nameEncrypted && this.key) {
        try {
          name = await this.encryption.decryptString(parsed.nameEncrypted, this.key);
        } catch {
          name = '';
        }
      } else if (typeof parsed.name === 'string') {
        name = parsed.name === 'Cherie' ? '' : parsed.name;
      }

      return {
        name,
        prayerFollowUpReminders: parsed.prayerFollowUpReminders ?? false,
        dailyDevotionalReminders: parsed.dailyDevotionalReminders ?? false,
        dailyReminderTime: parsed.dailyReminderTime || '08:00',
        notificationsEnabled: parsed.notificationsEnabled ?? false,
        language: parsed.language || 'en',
        currency: parsed.currency || 'USD',
        isAdminMode: parsed.isAdminMode ?? false,
        hapticsEnabled: parsed.hapticsEnabled ?? true,
        sanctuaryLockEnabled: Boolean(parsed.sanctuaryLockEnabled),
        sanctuaryAutoLockInterval: typeof parsed.sanctuaryAutoLockInterval === 'number' ? parsed.sanctuaryAutoLockInterval : 0,
        useBiometrics: parsed.useBiometrics ?? true,
        sanctuaryPin: undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Encrypted Helping Hands Module Progress Storage
   * Personal userNotes are individually encrypted with AES-256-GCM.
   */
  async saveHelpingHands(modules: HelpingHandsModule[]): Promise<void> {
    if (!this.key) throw new Error('Vault is not ready to save helping hands.');

    const storedModules = await Promise.all(
      modules.map(async (mod) => {
        const storedSteps = await Promise.all(
          mod.steps.map(async (step) => {
            const userNoteEncrypted = step.userNote?.trim()
              ? await this.encryption.encryptString(step.userNote.trim(), this.key!)
              : null;

            return {
              stepNumber: step.stepNumber,
              isCompleted: step.isCompleted,
              userNoteEncrypted,
            };
          })
        );

        return {
          id: mod.id,
          steps: storedSteps,
        };
      })
    );

    await this.driver.setMetadata('helping_hands', JSON.stringify(storedModules));
  }

  async getHelpingHands(templateModules: HelpingHandsModule[]): Promise<HelpingHandsModule[] | null> {
    const raw = await this.driver.getMetadata('helping_hands');
    if (!raw) return null;

    try {
      const storedModules: {
        id: string;
        steps: { stepNumber: number; isCompleted: boolean; userNoteEncrypted?: EncryptedPayload | null }[];
      }[] = JSON.parse(raw);

      return Promise.all(
        templateModules.map(async (mod) => {
          const stored = storedModules.find((s) => s.id === mod.id);
          if (!stored) return mod;

          const updatedSteps = await Promise.all(
            mod.steps.map(async (step) => {
              const storedStep = stored.steps.find((s) => s.stepNumber === step.stepNumber);
              if (!storedStep) return step;

              let userNote: string | undefined = undefined;
              if (storedStep.userNoteEncrypted && this.key) {
                try {
                  userNote = await this.encryption.decryptString(storedStep.userNoteEncrypted, this.key);
                } catch {
                  userNote = undefined;
                }
              }

              return {
                ...step,
                isCompleted: storedStep.isCompleted,
                userNote,
              };
            })
          );

          return {
            ...mod,
            steps: updatedSteps,
          };
        })
      );
    } catch {
      return null;
    }
  }

  /**
   * Bookmarks & Gatekeeper Metadata Helpers
   */
  async saveBookmarks(bookmarks: { devotionals: string[]; content: string[] }): Promise<void> {
    await this.driver.setMetadata('bookmarks_devotionals', JSON.stringify(bookmarks.devotionals));
    await this.driver.setMetadata('bookmarks_content', JSON.stringify(bookmarks.content));
  }

  async getBookmarks(): Promise<{ devotionals: string[]; content: string[] }> {
    const devRaw = await this.driver.getMetadata('bookmarks_devotionals');
    const contentRaw = await this.driver.getMetadata('bookmarks_content');
    return {
      devotionals: devRaw ? JSON.parse(devRaw) : [],
      content: contentRaw ? JSON.parse(contentRaw) : [],
    };
  }

  async saveCheckInDate(dateStr: string): Promise<void> {
    await this.driver.setMetadata('last_checkin_date', dateStr);
  }

  async getCheckInDate(): Promise<string | null> {
    return this.driver.getMetadata('last_checkin_date');
  }

  async close(): Promise<void> {
    await this.driver.close();
    this.key = null;
    this.state = 'UNAVAILABLE';
  }
}

export const vaultManager = new VaultManager();
