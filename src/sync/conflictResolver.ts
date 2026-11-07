/**
 * LIFTED — Conflict Preservation & Resolution Engine
 * Phase 8 Stage 1/2: Zero-Data-Loss Conflict Semantics
 *
 * Enforces sacred personal narrative protection:
 * NEVER use blind Last-Write-Wins (LWW) to overwrite user reflections.
 *
 * Domain Rules:
 * 1. Journals: Preserve both divergent textual versions via distinct sibling conflict copies.
 * 2. Prayers: Preserve status history; allow users to correct accidentally marked answered status;
 *    never force an irreversible answered state without an explicit user requirement.
 * 3. Moods: A mood check-in is an atomic point-in-time observation. Do NOT union disparate emotion
 *    categories from divergent records into a franken-mood. Preserve separate observations.
 */

import type { JournalRecord, PrayerRecord, MoodRecord } from '../storage/types';
import type {
  JournalConflictResolution,
  PrayerConflictResolution,
  MoodConflictResolution,
} from './types';

export class ConflictResolver {
  /**
   * Resolves concurrent edits to private journals without overwriting personal narratives.
   * If both devices edited the text differently, generates a forked conflict copy.
   */
  static resolveJournal(
    local: JournalRecord,
    incoming: JournalRecord
  ): JournalConflictResolution {
    // 1. Identical content: clean convergence
    if (local.content.trim() === incoming.content.trim()) {
      return {
        strategy: 'NO_CONFLICT',
        preservedLocal: local,
        forkedCopy: null,
        message: 'Identical content detected; preserved without conflict.',
      };
    }

    // 2. Divergent content: FORK THE REFLECTION
    // Local copy remains authoritative on this device.
    // Incoming copy is saved as a sibling conflict copy with distinct ID.
    const forkedCopy: JournalRecord = {
      ...incoming,
      id: `${incoming.id}-conflict-${incoming.updatedAt || Date.now()}`,
      promptQuestion: incoming.promptQuestion
        ? `[Conflict Copy] ${incoming.promptQuestion}`
        : '[Conflict Copy] Restored Reflection',
      localUserId: local.localUserId,
      cloudUserId: local.cloudUserId,
      createdAt: incoming.createdAt,
      updatedAt: incoming.updatedAt,
    };

    return {
      strategy: 'FORK_JOURNAL_COPY',
      preservedLocal: local,
      forkedCopy,
      message: 'Concurrent edits detected. Both reflections preserved to prevent loss of personal trauma processing.',
    };
  }

  /**
   * Resolves concurrent edits to prayers.
   * Allows correction of accidentally marked answered prayers while preserving history.
   */
  static resolvePrayer(
    local: PrayerRecord,
    incoming: PrayerRecord
  ): PrayerConflictResolution {
    const isTextIdentical = local.request.trim() === incoming.request.trim();
    const intercessorsCountMerged = Math.max(local.intercessorsCount || 0, incoming.intercessorsCount || 0);

    // 1. Identical request text
    if (isTextIdentical) {
      // If status matches, simple clean convergence
      if (local.isAnswered === incoming.isAnswered) {
        const mergedPrayer: PrayerRecord = {
          ...local,
          intercessorsCount: intercessorsCountMerged,
          answeredNote: local.answeredNote || incoming.answeredNote,
          updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
        };

        return {
          strategy: 'NO_CONFLICT',
          mergedPrayer,
          conflictCopy: null,
          message: 'Identical prayer text and status detected; merged metrics cleanly.',
        };
      }

      // If status diverges (e.g. user corrected accidentally marked answered prayer):
      // The later explicit update dictates the current status (allowing correction),
      // while preserving historical notes.
      const primary = local.updatedAt >= incoming.updatedAt ? local : incoming;
      const mergedPrayer: PrayerRecord = {
        ...primary,
        intercessorsCount: intercessorsCountMerged,
        answeredNote: local.answeredNote && incoming.answeredNote && local.answeredNote !== incoming.answeredNote
          ? `${local.answeredNote} | [Concurrent Note] ${incoming.answeredNote}`
          : (local.answeredNote || incoming.answeredNote),
        updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
      };

      return {
        strategy: 'MERGE_PRAYER_STATUS',
        mergedPrayer,
        conflictCopy: null,
        message: 'Resolved prayer status divergence honoring latest explicit correction without irreversible lock.',
      };
    }

    // 2. Divergent request texts: Fork prayer copy so neither prayer intention is destroyed
    const primaryIsLocal = local.updatedAt >= incoming.updatedAt;
    const mergedPrayer: PrayerRecord = {
      ...(primaryIsLocal ? local : incoming),
      intercessorsCount: intercessorsCountMerged,
      updatedAt: Math.max(local.updatedAt, incoming.updatedAt),
    };

    const conflictCopy: PrayerRecord = {
      ...(primaryIsLocal ? incoming : local),
      id: `${(primaryIsLocal ? incoming : local).id}-prayer-conflict-${(primaryIsLocal ? incoming : local).updatedAt || Date.now()}`,
      title: `[Conflict Copy] ${(primaryIsLocal ? incoming : local).title}`,
    };

    return {
      strategy: 'FORK_PRAYER_COPY',
      mergedPrayer,
      conflictCopy,
      message: 'Concurrent prayer edits detected. Preserved divergent requests and separate states.',
    };
  }

  /**
   * Resolves concurrent mood check-ins.
   * Invariant: A mood check-in is an atomic point-in-time historical observation.
   * Do NOT union disparate emotion categories into a composite franken-mood.
   * If divergent observations occur, preserve them as distinct sibling observations.
   */
  static resolveMood(
    local: MoodRecord,
    incoming: MoodRecord
  ): MoodConflictResolution {
    const isMoodIdentical =
      local.mood === incoming.mood &&
      (local.note || '') === (incoming.note || '') &&
      JSON.stringify(local.additionalMoods || []) === JSON.stringify(incoming.additionalMoods || []);

    if (isMoodIdentical) {
      return {
        strategy: 'NO_CONFLICT',
        mergedMood: local,
        forkedObservation: null,
        message: 'Identical mood check-in detected; preserved without conflict.',
      };
    }

    // Divergent historical observation: Preserve local observation intact,
    // and store incoming as a distinct sibling observation.
    const forkedObservation: MoodRecord = {
      ...incoming,
      id: `${incoming.id}-observation-${incoming.timestamp || Date.now()}`,
      note: incoming.note
        ? `[Concurrent Observation] ${incoming.note}`
        : '[Concurrent Observation]',
    };

    return {
      strategy: 'FORK_MOOD_OBSERVATION',
      mergedMood: local,
      forkedObservation,
      message: 'Divergent mood check-ins preserved as distinct historical observations without artificial union.',
    };
  }
}
