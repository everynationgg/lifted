import { describe, it, expect } from 'vitest';
import {
  mapLegacyJournalEntry,
  mapLegacyPrayerRequest,
  mapLegacyMoodRecord,
  mapLegacyUserPreferences,
  deduplicateLegacyBatch,
} from '../migrationMapper';

describe('MigrationMapper - Legacy Data Transformation & Validation', () => {
  describe('mapLegacyJournalEntry', () => {
    it('successfully maps a complete legacy journal entry', () => {
      const legacy = {
        id: 'j-legacy-1',
        date: 'Oct 22, 2026',
        timestamp: 1729578000000,
        promptQuestion: 'What brought you peace today?',
        content: 'Walking in the garden and praying for wisdom.',
        moodTag: 'peaceful',
      };

      const result = mapLegacyJournalEntry(legacy, 'guest-test-user');
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.id).toBe('j-legacy-1');
      expect(result.data?.content).toBe(legacy.content);
      expect(result.data?.promptQuestion).toBe(legacy.promptQuestion);
      expect(result.data?.moodTag).toBe('peaceful');
      expect(result.data?.localUserId).toBe('guest-test-user');
      expect(result.data?.createdAt).toBe(1729578000000);
    });

    it('handles missing optional fields (promptQuestion, moodTag) with safe defaults', () => {
      const legacy = {
        id: 'j-legacy-2',
        date: 'Oct 23, 2026',
        timestamp: 1729664400000,
        content: 'Simple reflection text without prompts or tags.',
      };

      const result = mapLegacyJournalEntry(legacy, 'guest-test-user');
      expect(result.success).toBe(true);
      expect(result.data?.promptQuestion).toBeUndefined();
      expect(result.data?.moodTag).toBeUndefined();
    });

    it('derives timestamp from date string if timestamp is missing or invalid', () => {
      const legacy = {
        id: 'j-legacy-3',
        date: '2026-10-24T12:00:00.000Z',
        content: 'Entry with ISO date string.',
      };

      const result = mapLegacyJournalEntry(legacy, 'guest-test-user');
      expect(result.success).toBe(true);
      expect(result.data?.timestamp).toBe(Date.parse('2026-10-24T12:00:00.000Z'));
    });

    it('rejects malformed records without id', () => {
      const legacy = {
        content: 'Missing ID completely',
      };

      const result = mapLegacyJournalEntry(legacy, 'guest-test-user');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing or empty required "id" field');
    });

    it('rejects malformed records where content is not a string', () => {
      const legacy = {
        id: 'j-bad-content',
        content: 12345,
      };

      const result = mapLegacyJournalEntry(legacy, 'guest-test-user');
      expect(result.success).toBe(false);
      expect(result.error).toContain('"content" field must be a string');
    });

    it('does not leak user reflection text in rejection error messages', () => {
      const legacy = {
        // Missing id
        content: 'EXTREMELY_CONFIDENTIAL_USER_SECRET_TEXT',
      };

      const result = mapLegacyJournalEntry(legacy, 'guest-test-user');
      expect(result.success).toBe(false);
      expect(result.error).not.toContain('EXTREMELY_CONFIDENTIAL_USER_SECRET_TEXT');
    });
  });

  describe('mapLegacyPrayerRequest', () => {
    it('successfully maps legacy prayer with "body" field and follow-up tracking', () => {
      const legacy = {
        id: 'p-legacy-1',
        title: 'Healing for Mom',
        body: 'Praying for complete recovery following surgery.',
        visibility: 'confidential',
        createdAtTimestamp: 1729578000000,
        followUpScheduledDays: 3,
        followUpStatus: 'still_praying',
        isPrayedByMe: true,
        isAnswered: false,
      };

      const result = mapLegacyPrayerRequest(legacy);
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('p-legacy-1');
      expect(result.data?.title).toBe('Healing for Mom');
      expect(result.data?.request).toBe('Praying for complete recovery following surgery.');
      expect(result.data?.body).toBe('Praying for complete recovery following surgery.');
      expect(result.data?.followUpStatus).toBe('still_praying');
      expect(result.data?.isPrivate).toBe(true);
    });

    it('supports legacy variants that used "request" instead of "body"', () => {
      const legacy = {
        id: 'p-legacy-2',
        title: 'Guidance in Work',
        request: 'Seeking discernment for new career direction.',
        visibility: 'private',
        createdAtTimestamp: 1729664400000,
      };

      const result = mapLegacyPrayerRequest(legacy);
      expect(result.success).toBe(true);
      expect(result.data?.request).toBe('Seeking discernment for new career direction.');
      expect(result.data?.body).toBe('Seeking discernment for new career direction.');
    });

    it('maps community visibility properly to non-private category', () => {
      const legacy = {
        id: 'p-comm-1',
        title: 'Church Mission Trip',
        body: 'Please pray for traveling mercies.',
        visibility: 'community',
      };

      const result = mapLegacyPrayerRequest(legacy);
      expect(result.success).toBe(true);
      expect(result.data?.category).toBe('community');
      expect(result.data?.isPrivate).toBe(false);
    });

    it('rejects prayer when neither "body" nor "request" is present', () => {
      const legacy = {
        id: 'p-no-body',
        title: 'Empty Prayer',
      };

      const result = mapLegacyPrayerRequest(legacy);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required prayer text');
    });
  });

  describe('mapLegacyMoodRecord', () => {
    it('successfully maps legacy mood history check-in', () => {
      const legacy = {
        id: 'mood-legacy-1',
        mood: 'peaceful',
        additionalMoods: ['grateful', 'hopeful'],
        note: 'Felt a deep sense of calm after morning scripture.',
        timestamp: 1729578000000,
        dateStr: 'Yesterday',
      };

      const result = mapLegacyMoodRecord(legacy);
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('mood-legacy-1');
      expect(result.data?.mood).toBe('peaceful');
      expect(result.data?.additionalMoods).toEqual(['grateful', 'hopeful']);
      expect(result.data?.note).toBe('Felt a deep sense of calm after morning scripture.');
    });

    it('rejects mood record with missing or empty mood', () => {
      const legacy = {
        id: 'mood-no-mood',
        note: 'Only note without mood tag',
      };

      const result = mapLegacyMoodRecord(legacy);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing or invalid "mood" field');
    });
  });

  describe('mapLegacyUserPreferences', () => {
    it('clears hardcoded default "Cherie" name', () => {
      const legacy = {
        name: 'Cherie',
        notificationsEnabled: true,
      };

      const result = mapLegacyUserPreferences(legacy);
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('');
    });

    it('preserves genuine custom user name', () => {
      const legacy = {
        name: 'Sarah M.',
        notificationsEnabled: false,
      };

      const result = mapLegacyUserPreferences(legacy);
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe('Sarah M.');
      expect(result.data?.notificationsEnabled).toBe(false);
    });

    it('security: never migrates legacy sanctuaryPin and resets sanctuaryLockEnabled to false', () => {
      const legacy = {
        name: 'David K.',
        sanctuaryPin: '1234',
        sanctuaryLockEnabled: true,
      };

      const result = mapLegacyUserPreferences(legacy);
      expect(result.success).toBe(true);
      expect(result.data?.sanctuaryPin).toBeUndefined();
      expect(result.data?.sanctuaryLockEnabled).toBe(false);
    });
  });

  describe('deduplicateLegacyBatch', () => {
    it('deduplicates items keeping the latest record by timestamp', () => {
      const batch = [
        { id: 'item-1', content: 'v1', timestamp: 100 },
        { id: 'item-2', content: 'v1', timestamp: 150 },
        { id: 'item-1', content: 'v2', timestamp: 200 }, // newer item-1
      ];

      const deduped = deduplicateLegacyBatch(batch);
      expect(deduped).toHaveLength(2);
      const item1 = deduped.find((i) => i.id === 'item-1');
      expect(item1?.content).toBe('v2');
    });
  });
});
