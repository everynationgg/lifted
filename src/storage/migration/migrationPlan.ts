/**
 * Master Migration Specification - Phase 2B Stage 1
 * Defines configuration, constants, and policies for migrating legacy localStorage records
 * into the encrypted local-first persistence vault.
 */

export const MIGRATION_VERSION = 2;

export const MIGRATION_METADATA_KEYS = {
  STATUS: 'lifted_migration_v2_status',
  TIMESTAMP: 'lifted_migration_v2_timestamp',
  REPORT: 'lifted_migration_v2_report',
  BACKUP_COMPLETED: 'lifted_migration_v2_backup_completed',
} as const;

export const LEGACY_STORAGE_KEYS = {
  JOURNALS: 'lifted_journal_entries',
  PRAYERS: 'lifted_prayer_requests',
  MOODS: 'lifted_mood_history',
  PREFERENCES: 'lifted_user_preferences',
  HELPING_HANDS: 'lifted_helping_hands',
  SAVED_DEVOTIONALS: 'lifted_saved_devotionals',
  SAVED_CONTENT: 'lifted_saved_content',
  LAST_CHECKIN_DATE: 'lifted_last_checkin_date',
  HAPTICS: 'lifted_haptics_enabled',
} as const;

export const SESSION_KEYS = {
  ACTIVE_CHAT: 'lifted_active_chat',
  ACTIVE_TURN: 'lifted_active_turn',
} as const;

export interface MigrationPreflightResult {
  canProceed: boolean;
  vaultReady: boolean;
  alreadyMigrated: boolean;
  detectedKeys: string[];
  reasons: string[];
}

export interface MigrationOptions {
  force?: boolean;
  verifyIntegrity?: boolean;
  dryRun?: boolean;
  rollbackOnError?: boolean;
}
