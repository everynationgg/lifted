/**
 * LIFTED — Conflict Resolution & Narrative Preservation Test Suite
 * Phase 8 Stage 1: Zero-Data-Loss Conflict Resolution
 */

import { describe, it, expect } from 'vitest';
import { ConflictResolver } from '../conflictResolver';
import type { JournalRecord, PrayerRecord, MoodRecord } from '../../storage/types';

describe('Conflict Preservation & Resolution Engine', () => {
  describe('1. Private Journal Conflict Resolution', () => {
    it('preserves both reflections by generating a forked conflict copy when concurrent edits diverge', () => {
      const localJournal: JournalRecord = {
        id: 'j-root-1',
        date: '2026-10-31',
        timestamp: 1000,
        content: 'I worked through my childhood anxiety today. God felt so near in the quiet.',
        promptQuestion: 'Where did you see grace today?',
        moodTag: 'peaceful',
        localUserId: 'guest-1',
        cloudUserId: 'cloud-1',
        createdAt: 1000,
        updatedAt: 2000,
      };

      const incomingJournal: JournalRecord = {
        id: 'j-root-1',
        date: '2026-10-31',
        timestamp: 1000,
        content: 'I edited this reflection on my iPad with different thoughts about family healing.',
        promptQuestion: 'Where did you see grace today?',
        moodTag: 'hopeful',
        localUserId: 'guest-2',
        cloudUserId: 'cloud-1',
        createdAt: 1000,
        updatedAt: 2500,
      };

      const resolution = ConflictResolver.resolveJournal(localJournal, incomingJournal);

      // Invariant: Never blind LWW overwrite!
      expect(resolution.strategy).toBe('FORK_JOURNAL_COPY');
      expect(resolution.preservedLocal.content).toBe(localJournal.content);
      expect(resolution.forkedCopy).toBeDefined();
      expect(resolution.forkedCopy?.content).toBe(incomingJournal.content);
      expect(resolution.forkedCopy?.id).toContain('j-root-1-conflict-');
      expect(resolution.forkedCopy?.promptQuestion).toContain('[Conflict Copy]');
    });

    it('identifies identical content convergence and skips conflict copy', () => {
      const localJournal: JournalRecord = {
        id: 'j-root-2',
        date: '2026-10-31',
        timestamp: 1000,
        content: 'Lord, thank You for holding my heart steady.',
        localUserId: 'guest-1',
        createdAt: 1000,
        updatedAt: 2000,
      };

      const incomingJournal: JournalRecord = {
        ...localJournal,
        updatedAt: 2100, // Slightly later timestamp, but identical text
      };

      const resolution = ConflictResolver.resolveJournal(localJournal, incomingJournal);

      expect(resolution.strategy).toBe('NO_CONFLICT');
      expect(resolution.forkedCopy).toBeNull();
      expect(resolution.preservedLocal.content).toBe(localJournal.content);
    });
  });

  describe('2. Prayer Conflict Resolution', () => {
    it('Milestone Preservation: Once marked answered on either device, prayer remains answered', () => {
      const localPrayer: PrayerRecord = {
        id: 'prayer-milestone-1',
        title: 'Healing for Mama',
        request: 'Please pray for Mama complete recovery from pneumonia.',
        category: 'healing',
        isPrivate: true,
        followUpStatus: 'answered',
        intercessorsCount: 5,
        isPrayedByMe: true,
        isAnswered: true,
        answeredNote: 'Praise God, her fever broke and she is home safe!',
        createdAt: 1000,
        updatedAt: 3000,
      };

      const staleIncomingPrayer: PrayerRecord = {
        id: 'prayer-milestone-1',
        title: 'Healing for Mama',
        request: 'Please pray for Mama complete recovery from pneumonia.',
        category: 'healing',
        isPrivate: true,
        followUpStatus: 'still_praying', // Stale device didn't know she was healed yet
        intercessorsCount: 4,
        isPrayedByMe: true,
        isAnswered: false,
        createdAt: 1000,
        updatedAt: 2500,
      };

      const resolution = ConflictResolver.resolvePrayer(localPrayer, staleIncomingPrayer);

      expect(resolution.strategy).toBe('MERGE_PRAYER_STATUS');
      expect(resolution.mergedPrayer.isAnswered).toBe(true);
      expect(resolution.mergedPrayer.followUpStatus).toBe('answered');
      expect(resolution.mergedPrayer.answeredNote).toBe('Praise God, her fever broke and she is home safe!');
      expect(resolution.mergedPrayer.intercessorsCount).toBe(5);
    });

    it('Status Correction: Allows user to correct an accidentally marked answered prayer with explicit newer update', () => {
      const earlierAccidentalAnswered: PrayerRecord = {
        id: 'prayer-correct-1',
        title: 'Peace in Decision',
        request: 'Praying for wisdom in job offer.',
        category: 'guidance',
        isPrivate: true,
        followUpStatus: 'answered',
        intercessorsCount: 3,
        isPrayedByMe: true,
        isAnswered: true,
        answeredNote: 'Accidental click',
        createdAt: 1000,
        updatedAt: 2000, // Accidental mark at t=2000
      };

      const laterCorrection: PrayerRecord = {
        id: 'prayer-correct-1',
        title: 'Peace in Decision',
        request: 'Praying for wisdom in job offer.',
        category: 'guidance',
        isPrivate: true,
        followUpStatus: 'still_praying',
        intercessorsCount: 3,
        isPrayedByMe: true,
        isAnswered: false, // User intentionally corrected it at t=3000
        answeredNote: undefined,
        createdAt: 1000,
        updatedAt: 3000,
      };

      const resolution = ConflictResolver.resolvePrayer(earlierAccidentalAnswered, laterCorrection);

      expect(resolution.strategy).toBe('MERGE_PRAYER_STATUS');
      expect(resolution.mergedPrayer.isAnswered).toBe(false);
      expect(resolution.mergedPrayer.followUpStatus).toBe('still_praying');
      expect(resolution.mergedPrayer.updatedAt).toBe(3000);
    });

    it('preserves divergent prayer request narratives through secondary conflict copy', () => {
      const localPrayer: PrayerRecord = {
        id: 'prayer-divergent-1',
        title: 'Family Guidance',
        request: 'Praying for wisdom in discussing boundaries with my siblings this weekend.',
        category: 'guidance',
        isPrivate: true,
        followUpStatus: 'still_praying',
        intercessorsCount: 2,
        isPrayedByMe: true,
        createdAt: 1000,
        updatedAt: 2000,
      };

      const incomingPrayer: PrayerRecord = {
        id: 'prayer-divergent-1',
        title: 'Family Guidance',
        request: 'Praying for financial peace regarding parents healthcare bills.',
        category: 'guidance',
        isPrivate: true,
        followUpStatus: 'still_praying',
        intercessorsCount: 3,
        isPrayedByMe: true,
        createdAt: 1000,
        updatedAt: 2500,
      };

      const resolution = ConflictResolver.resolvePrayer(localPrayer, incomingPrayer);

      expect(resolution.strategy).toBe('FORK_PRAYER_COPY');
      expect(resolution.mergedPrayer.request).toBe(incomingPrayer.request);
      expect(resolution.conflictCopy).toBeDefined();
      expect(resolution.conflictCopy?.request).toBe(localPrayer.request);
      expect(resolution.conflictCopy?.title).toContain('[Conflict Copy]');
    });
  });

  describe('3. Mood Check-in Observation Preservation', () => {
    it('preserves identical mood observations without conflict', () => {
      const localMood: MoodRecord = {
        id: 'mood-today',
        mood: 'peaceful',
        additionalMoods: ['grateful'],
        note: 'Quiet morning prayer.',
        timestamp: 1000,
        dateStr: '2026-10-31',
      };

      const incomingMood: MoodRecord = { ...localMood };
      const resolution = ConflictResolver.resolveMood(localMood, incomingMood);

      expect(resolution.strategy).toBe('NO_CONFLICT');
      expect(resolution.forkedObservation).toBeNull();
      expect(resolution.mergedMood.mood).toBe('peaceful');
    });

    it('preserves divergent mood observations as distinct historical check-ins without artificial union', () => {
      const localMood: MoodRecord = {
        id: 'mood-today',
        mood: 'anxious',
        additionalMoods: ['tired'],
        note: 'Big work presentation today.',
        timestamp: 1000,
        dateStr: '2026-10-31',
      };

      const incomingMood: MoodRecord = {
        id: 'mood-today',
        mood: 'peaceful',
        additionalMoods: ['hopeful'],
        note: 'Prayed on lunch break.',
        timestamp: 1500,
        dateStr: '2026-10-31',
      };

      const resolution = ConflictResolver.resolveMood(localMood, incomingMood);

      // Invariant: Do NOT combine anxious + peaceful into a hybrid state!
      // Preserve local observation and save incoming observation as a distinct linked check-in.
      expect(resolution.strategy).toBe('FORK_MOOD_OBSERVATION');
      expect(resolution.mergedMood.mood).toBe('anxious');
      expect(resolution.mergedMood.additionalMoods).toEqual(['tired']);
      expect(resolution.forkedObservation).toBeDefined();
      expect(resolution.forkedObservation?.mood).toBe('peaceful');
      expect(resolution.forkedObservation?.additionalMoods).toEqual(['hopeful']);
      expect(resolution.forkedObservation?.id).toContain('mood-today-observation-');
      expect(resolution.forkedObservation?.note).toContain('[Concurrent Observation]');
    });
  });
});
