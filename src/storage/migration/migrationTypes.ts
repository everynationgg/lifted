import type { MoodId } from '../types';

/**
 * Legacy localStorage schema interfaces representing the actual legacy structures
 * discovered across App.tsx, JourneyScreen.tsx, and HomeScreen.tsx.
 */

export interface LegacyJournalEntry {
  id: string;
  date: string;
  timestamp: number;
  promptQuestion?: string;
  content: string;
  moodTag?: MoodId;
}

export interface LegacyPrayerRequest {
  id: string;
  title: string;
  body: string;
  request?: string; // Potential variant
  visibility?: 'private' | 'confidential' | 'community';
  createdAt?: string;
  createdAtTimestamp?: number;
  followUpScheduledDays?: number;
  intercessorsCount?: number;
  isPrayedByMe?: boolean;
  followUpTriggered?: boolean;
  followUpStatus?: 'still_praying' | 'experiencing_peace' | 'answered';
  isAnswered?: boolean;
  answeredNote?: string;
  remindersEnabled?: boolean;
}

export interface LegacyMoodCheckIn {
  id: string;
  mood: MoodId;
  additionalMoods?: MoodId[];
  note?: string;
  timestamp: number;
  dateStr?: string;
}

export interface LegacyUserPreferences {
  name?: string;
  prayerFollowUpReminders?: boolean;
  dailyDevotionalReminders?: boolean;
  notificationsEnabled?: boolean;
  language?: string;
  currency?: string;
  isAdminMode?: boolean;
  hapticsEnabled?: boolean;
  sanctuaryLockEnabled?: boolean;
  sanctuaryPin?: string;
}

export interface LegacyStorageDump {
  lifted_journal_entries?: unknown;
  lifted_prayer_requests?: unknown;
  lifted_mood_history?: unknown;
  lifted_user_preferences?: unknown;
  lifted_helping_hands?: unknown;
  lifted_saved_devotionals?: unknown;
  lifted_saved_content?: unknown;
  lifted_last_checkin_date?: unknown;
  lifted_haptics_enabled?: unknown;
}

export interface TransformResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  recordId?: string;
}

export interface MigrationEntityStats {
  total: number;
  migrated: number;
  skipped: number;
  rejected: number;
}

export interface MigrationSummary {
  version: number;
  status: 'COMPLETED' | 'FAILED' | 'HALTED' | 'ALREADY_COMPLETED';
  startedAt: number;
  completedAt?: number;
  journals: MigrationEntityStats;
  prayers: MigrationEntityStats;
  moods: MigrationEntityStats;
  preferences: { migrated: boolean; error?: string };
  helpingHands: { totalModules: number; completedStepsCount: number };
  bookmarks: { devotionalsCount: number; contentCount: number };
  errors: string[];
}

export interface IntegrityVerificationReport {
  entityType: 'journal' | 'prayer' | 'mood';
  id: string;
  matched: boolean;
  reason?: string;
}
