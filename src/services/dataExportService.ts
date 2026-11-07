import { vaultManager, type VaultManager } from '../storage/vaultManager';
import { sanctuaryPrivacyManager, type SanctuaryPrivacyManager } from './privacy/SanctuaryPrivacyManager';

export interface ExportSummary {
  journalCount: number;
  prayerCount: number;
  moodCount: number;
  hasPreferences: boolean;
  exportedAt: string;
}

export interface ExportDataPayload {
  exportVersion: string;
  appName: string;
  exportedAt: string;
  exportedTimestamp: number;
  privacyNotice: string;
  summary: ExportSummary;
  journals: Array<{
    id: string;
    date: string;
    timestamp: number;
    promptQuestion?: string;
    content: string;
    moodTag?: string;
  }>;
  prayers: Array<{
    id: string;
    title: string;
    body: string;
    visibility: string;
    createdAt: number;
    isAnswered: boolean;
    answeredNote?: string;
    followUpStatus?: string;
  }>;
  moodHistory: Array<{
    id: string;
    mood: string;
    additionalMoods?: string[];
    note?: string;
    timestamp: number;
    dateStr: string;
  }>;
  preferences?: {
    name?: string;
    theme?: string;
    hapticsEnabled?: boolean;
    prayerFollowUpReminders?: boolean;
  };
}

export class DataExportService {
  private vault: VaultManager;
  private privacy: SanctuaryPrivacyManager;

  constructor(
    vault: VaultManager = vaultManager,
    privacy: SanctuaryPrivacyManager = sanctuaryPrivacyManager
  ) {
    this.vault = vault;
    this.privacy = privacy;
  }

  /**
   * Generates decrypted export payload with verified record counts
   */
  async generateExportPayload(): Promise<ExportDataPayload> {
    if (this.privacy.isLocked()) {
      throw new Error('Sanctuary Lock is active. Please authenticate before exporting personal data.');
    }

    if (!this.vault.isReady()) {
      await this.vault.initialize();
    }

    if (!this.vault.isReady()) {
      throw new Error('Encrypted vault is not available. Please unlock or initialize the vault.');
    }

    const [journals, prayers, moods, preferences] = await Promise.all([
      this.vault.journals.getAll(),
      this.vault.prayers.getAll(),
      this.vault.moods.getAll(),
      this.vault.getUserPreferences(),
    ]);

    const exportedAt = new Date().toISOString();

    const payload: ExportDataPayload = {
      exportVersion: '1.0',
      appName: 'LIFTED',
      exportedAt,
      exportedTimestamp: Date.now(),
      privacyNotice:
        'This exported file contains your private spiritual and emotional reflections in decrypted format. Store or handle this file with utmost care to protect your personal privacy.',
      summary: {
        journalCount: journals.length,
        prayerCount: prayers.length,
        moodCount: moods.length,
        hasPreferences: Boolean(preferences),
        exportedAt,
      },
      journals: journals.map((j) => ({
        id: j.id,
        date: j.date,
        timestamp: j.timestamp,
        promptQuestion: j.promptQuestion,
        content: j.content,
        moodTag: j.moodTag,
      })),
      prayers: prayers.map((p) => ({
        id: p.id,
        title: p.title,
        body: p.request || p.body || '',
        visibility: p.visibility || (p.isPrivate ? 'private' : 'community'),
        createdAt: p.createdAt,
        isAnswered: Boolean(p.isAnswered),
        answeredNote: p.answeredNote,
        followUpStatus: p.followUpStatus,
      })),
      moodHistory: moods.map((m) => ({
        id: m.id,
        mood: m.mood,
        additionalMoods: m.additionalMoods,
        note: m.note,
        timestamp: m.timestamp,
        dateStr: m.dateStr,
      })),
      preferences: preferences
        ? {
            name: preferences.name,
            theme: preferences.theme,
            hapticsEnabled: preferences.hapticsEnabled,
            prayerFollowUpReminders: preferences.prayerFollowUpReminders,
          }
        : undefined,
    };

    return payload;
  }

  /**
   * Triggers a secure, client-side download without routing through any external server
   */
  async triggerLocalDownload(filename = 'lifted-personal-backup.json'): Promise<ExportSummary> {
    const payload = await this.generateExportPayload();
    const jsonStr = JSON.stringify(payload, null, 2);

    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);

      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.style.display = 'none';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up object URL after download trigger to prevent memory and privacy leaks
      setTimeout(() => {
        URL.revokeObjectURL(blobUrl);
      }, 1000);
    }

    return payload.summary;
  }
}

export const dataExportService = new DataExportService();
