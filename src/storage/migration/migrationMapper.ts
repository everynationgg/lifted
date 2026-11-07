import type { MoodId, JournalRecord, PrayerRecord, MoodRecord } from '../types';
import type { UserPreferences } from '../../types';
import type { TransformResult } from './migrationTypes';

/**
 * Validates that an item is a non-null object.
 */
function isRecordObject(item: unknown): item is Record<string, unknown> {
  return typeof item === 'object' && item !== null && !Array.isArray(item);
}

/**
 * Parses and sanitizes a timestamp.
 */
function sanitizeTimestamp(rawTimestamp: unknown, fallbackDateStr?: unknown): number {
  if (typeof rawTimestamp === 'number' && !Number.isNaN(rawTimestamp) && rawTimestamp > 0) {
    return Math.floor(rawTimestamp);
  }
  if (typeof fallbackDateStr === 'string' && fallbackDateStr.trim()) {
    const parsed = Date.parse(fallbackDateStr);
    if (!Number.isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return Date.now();
}

/**
 * Maps a legacy JournalEntry into a validated JournalRecord.
 * Privacy rule: Error messages must NEVER output sensitive user content.
 */
export function mapLegacyJournalEntry(
  raw: unknown,
  localUserId: string
): TransformResult<JournalRecord> {
  if (!isRecordObject(raw)) {
    return {
      success: false,
      error: 'Invalid journal payload: Expected an object record.',
    };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) {
    return {
      success: false,
      error: 'Journal record rejected: Missing or empty required "id" field.',
    };
  }

  if (typeof raw.content !== 'string') {
    return {
      success: false,
      recordId: id,
      error: `Journal record [${id}] rejected: "content" field must be a string.`,
    };
  }

  const timestamp = sanitizeTimestamp(raw.timestamp, raw.date);
  const date = typeof raw.date === 'string' && raw.date.trim()
    ? raw.date.trim()
    : new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const promptQuestion = typeof raw.promptQuestion === 'string' && raw.promptQuestion.trim()
    ? raw.promptQuestion.trim()
    : undefined;

  const moodTag = typeof raw.moodTag === 'string' && raw.moodTag.trim()
    ? (raw.moodTag.trim() as MoodId)
    : undefined;

  const mapped: JournalRecord = {
    id,
    date,
    timestamp,
    content: raw.content,
    promptQuestion,
    moodTag,
    localUserId,
    cloudUserId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    success: true,
    data: mapped,
    recordId: id,
  };
}

/**
 * Maps a legacy PrayerRequest into a validated PrayerRecord.
 * Privacy rule: Error messages must NEVER output sensitive prayer content.
 */
export function mapLegacyPrayerRequest(raw: unknown): TransformResult<PrayerRecord> {
  if (!isRecordObject(raw)) {
    return {
      success: false,
      error: 'Invalid prayer payload: Expected an object record.',
    };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) {
    return {
      success: false,
      error: 'Prayer record rejected: Missing or empty required "id" field.',
    };
  }

  // Legacy prayers may store text in either 'body' or 'request'
  const textVal = typeof raw.body === 'string' ? raw.body : (typeof raw.request === 'string' ? raw.request : null);
  if (textVal === null) {
    return {
      success: false,
      recordId: id,
      error: `Prayer record [${id}] rejected: Missing required prayer text ("body" or "request").`,
    };
  }

  const title = typeof raw.title === 'string' && raw.title.trim()
    ? raw.title.trim()
    : '(Untitled Prayer)';

  const timestamp = sanitizeTimestamp(raw.createdAtTimestamp, raw.createdAt);

  const rawVisibility = raw.visibility;
  const visibility: 'private' | 'confidential' | 'community' =
    rawVisibility === 'community' || rawVisibility === 'confidential' ? rawVisibility : 'private';

  const category = visibility === 'community' ? 'community' : 'personal';
  const isPrivate = visibility !== 'community';

  const rawStatus = raw.followUpStatus;
  const allowedStatuses: PrayerRecord['followUpStatus'][] = [
    'none',
    'still_praying',
    'experiencing_peace',
    'answered',
  ];
  let followUpStatus: PrayerRecord['followUpStatus'] = 'none';
  if (typeof rawStatus === 'string' && allowedStatuses.includes(rawStatus as PrayerRecord['followUpStatus'])) {
    followUpStatus = rawStatus as PrayerRecord['followUpStatus'];
  } else if (raw.isAnswered === true) {
    followUpStatus = 'answered';
  }

  const followUpScheduledDays = typeof raw.followUpScheduledDays === 'number' && raw.followUpScheduledDays >= 0
    ? raw.followUpScheduledDays
    : 3;

  const followUpDate = typeof raw.followUpDate === 'number' && raw.followUpDate > 0
    ? raw.followUpDate
    : timestamp + followUpScheduledDays * 86400000;

  const intercessorsCount = typeof raw.intercessorsCount === 'number' && raw.intercessorsCount >= 0
    ? raw.intercessorsCount
    : 0;

  const isPrayedByMe = typeof raw.isPrayedByMe === 'boolean' ? raw.isPrayedByMe : true;
  const followUpTriggered = typeof raw.followUpTriggered === 'boolean' ? raw.followUpTriggered : false;
  const isAnswered = typeof raw.isAnswered === 'boolean' ? raw.isAnswered : (followUpStatus === 'answered');
  const answeredNote = typeof raw.answeredNote === 'string' && raw.answeredNote.trim()
    ? raw.answeredNote.trim()
    : undefined;
  const remindersEnabled = typeof raw.remindersEnabled === 'boolean' ? raw.remindersEnabled : true;

  const mapped: PrayerRecord = {
    id,
    title,
    request: textVal,
    body: textVal,
    category,
    visibility,
    isPrivate,
    followUpStatus,
    followUpDate,
    followUpScheduledDays,
    followUpTriggered,
    intercessorsCount,
    isPrayedByMe,
    isAnswered,
    answeredNote,
    remindersEnabled,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  return {
    success: true,
    data: mapped,
    recordId: id,
  };
}

/**
 * Maps a legacy MoodCheckInRecord into a validated MoodRecord.
 * Privacy rule: Error messages must NEVER output sensitive note content.
 */
export function mapLegacyMoodRecord(raw: unknown): TransformResult<MoodRecord> {
  if (!isRecordObject(raw)) {
    return {
      success: false,
      error: 'Invalid mood payload: Expected an object record.',
    };
  }

  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  if (!id) {
    return {
      success: false,
      error: 'Mood check-in record rejected: Missing or empty required "id" field.',
    };
  }

  if (typeof raw.mood !== 'string' || !raw.mood.trim()) {
    return {
      success: false,
      recordId: id,
      error: `Mood check-in record [${id}] rejected: Missing or invalid "mood" field.`,
    };
  }

  const timestamp = sanitizeTimestamp(raw.timestamp, raw.dateStr);
  const dateStr = typeof raw.dateStr === 'string' && raw.dateStr.trim()
    ? raw.dateStr.trim()
    : new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const note = typeof raw.note === 'string' && raw.note.trim()
    ? raw.note.trim()
    : undefined;

  let additionalMoods: MoodId[] | undefined;
  if (Array.isArray(raw.additionalMoods)) {
    additionalMoods = raw.additionalMoods.filter((m): m is MoodId => typeof m === 'string' && Boolean(m.trim()));
  }

  const mapped: MoodRecord = {
    id,
    mood: raw.mood.trim() as MoodId,
    additionalMoods: additionalMoods && additionalMoods.length > 0 ? additionalMoods : undefined,
    note,
    timestamp,
    dateStr,
  };

  return {
    success: true,
    data: mapped,
    recordId: id,
  };
}

/**
 * Validates and maps user preferences.
 * Strips legacy hardcoded "Cherie" default name if present.
 */
export function mapLegacyUserPreferences(raw: unknown): TransformResult<UserPreferences> {
  if (!isRecordObject(raw)) {
    return {
      success: false,
      error: 'Invalid user preferences payload: Expected an object.',
    };
  }

  let name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (name === 'Cherie') {
    name = '';
  }

  const mapped: UserPreferences = {
    name,
    prayerFollowUpReminders: typeof raw.prayerFollowUpReminders === 'boolean' ? raw.prayerFollowUpReminders : false,
    dailyDevotionalReminders: typeof raw.dailyDevotionalReminders === 'boolean' ? raw.dailyDevotionalReminders : false,
    dailyReminderTime: typeof raw.dailyReminderTime === 'string' && raw.dailyReminderTime ? raw.dailyReminderTime : '08:00',
    notificationsEnabled: typeof raw.notificationsEnabled === 'boolean' ? raw.notificationsEnabled : false,
    language: typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : 'en',
    currency: typeof raw.currency === 'string' && raw.currency.trim() ? raw.currency.trim() : 'USD',
    isAdminMode: typeof raw.isAdminMode === 'boolean' ? raw.isAdminMode : false,
    hapticsEnabled: typeof raw.hapticsEnabled === 'boolean' ? raw.hapticsEnabled : true,
    // Security Rule: Never migrate legacy sanctuaryPin into database metadata.
    // Legacy plaintext 4-digit PINs cannot be treated as secure keys or authenticators.
    // Lock is reset to false until a secure enrollment process with key derivation is introduced.
    sanctuaryLockEnabled: false,
    sanctuaryPin: undefined,
  };

  return {
    success: true,
    data: mapped,
  };
}

/**
 * Deduplicates records by ID, keeping the latest entry by timestamp.
 */
export function deduplicateLegacyBatch<
  T extends { id: string; timestamp?: number; createdAtTimestamp?: number; createdAt?: string | number }
>(items: T[]): T[] {
  const map = new Map<string, T>();

  const getSortTime = (item: T): number => {
    if (typeof item.timestamp === 'number') return item.timestamp;
    if (typeof item.createdAtTimestamp === 'number') return item.createdAtTimestamp;
    if (typeof item.createdAt === 'number') return item.createdAt;
    if (typeof item.createdAt === 'string') {
      const parsed = Date.parse(item.createdAt);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
  };

  for (const item of items) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
    } else {
      if (getSortTime(item) >= getSortTime(existing)) {
        map.set(item.id, item);
      }
    }
  }
  return Array.from(map.values());
}
