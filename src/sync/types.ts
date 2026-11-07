/**
 * LIFTED — Offline-First Synchronization & Outbox Contracts
 * Phase 8 Stage 1: Durable Local Outbox, Conflict Preservation & Synthetic Transport
 */

import type { OutboxRecordType, OutboxOperationType, OutboxStatus, OutboxErrorCategory, OutboxStorageRecord } from '../storage/types';
import type { JournalRecord, PrayerRecord, MoodRecord } from '../storage/types';

export type { OutboxRecordType, OutboxOperationType, OutboxStatus, OutboxErrorCategory, OutboxStorageRecord };

/**
 * Account Sync Linkage State
 */
export type SyncConsentState = 'NOT_CONSENTED' | 'CONSENTED' | 'REVOKED';

export interface AccountSyncLinkage {
  localUserId: string;              // Device-local guest UUID
  cloudUserId: string | null;       // Linked Supabase authenticated user UUID
  linkedAt: number | null;
  syncConsent: SyncConsentState;
  consentTimestamp: number | null;
  lastSyncedRevision: number;
}

/**
 * Tombstone Record for Tracking Deletions
 */
export interface TombstoneRecord {
  recordId: string;
  recordType: OutboxRecordType;
  deletedAt: number;
  revision: number;
  cloudUserId: string | null;
  acknowledgedDeviceIds?: string[];
  isExplicitRecreate?: boolean;
}

/**
 * Conflict Strategies & Results
 */
export type ConflictResolutionStrategy =
  | 'NO_CONFLICT'
  | 'FORK_JOURNAL_COPY'
  | 'MERGE_PRAYER_STATUS'
  | 'FORK_PRAYER_COPY'
  | 'FORK_MOOD_OBSERVATION'
  | 'TOMBSTONE_PREVAILS'
  | 'STALE_REJECTED';

export interface JournalConflictResolution {
  strategy: ConflictResolutionStrategy;
  preservedLocal: JournalRecord;
  forkedCopy: JournalRecord | null;
  message: string;
}

export interface PrayerConflictResolution {
  strategy: ConflictResolutionStrategy;
  mergedPrayer: PrayerRecord;
  conflictCopy: PrayerRecord | null;
  message: string;
}

export interface MoodConflictResolution {
  strategy: ConflictResolutionStrategy;
  mergedMood: MoodRecord;
  forkedObservation: MoodRecord | null;
  message: string;
}

/**
 * Recovery Key & AEK Cryptographic Contracts
 */
export interface RecoveryKeyValidationResult {
  valid: boolean;
  formattedCode?: string;
  rawEntropyHex?: string;
  checksumHex?: string;
  error?: string;
}

export interface AekAssociatedData {
  userId: string;
  keyVersion: number;
  domain: string;
}

export interface WrappedAekEnvelope {
  v: number;               // 1
  alg: string;             // 'AES-GCM-256'
  kdf: 'HKDF-SHA256' | 'PBKDF2-SHA256';
  salt: string;            // base64 32-byte salt
  iv: string;              // base64 12-byte IV
  ct: string;              // base64 wrapped AEK ciphertext + 16-byte auth tag
  aad: AekAssociatedData;  // Bound authenticated metadata
  iterations?: number;     // 600,000 if PBKDF2
}

/**
 * Durable Per-Record Synchronization Checkpoint
 * Prevents reconciliation scanner from endlessly recreating acknowledged operations.
 */
export interface RecordSyncCheckpoint {
  recordId: string;
  recordType: OutboxRecordType;
  localRevision: number;
  lastConfirmedServerRevision: number;
  lastAcknowledgedOperationId: string | null;
  lastSyncedAt: number | null;
  cloudUserId: string;
  lastContentHash?: string | null;
}

/**
 * Synthetic Transport Interfaces
 */
export interface SyncTransportResponse {
  success: boolean;
  operationId: string;
  acknowledgedRevision?: number;
  errorCategory?: OutboxErrorCategory;
  errorMessage?: string;
  isConflict?: boolean;
}

export interface ISyncTransport {
  pushOperation(op: OutboxStorageRecord): Promise<SyncTransportResponse>;
  simulateNetworkLatencyMs?: number;
}

/**
 * Outbox Processing Run Result
 */
export interface OutboxProcessSummary {
  attempted: number;
  acknowledged: number;
  failed: number;
  skippedReason?: 'OFFLINE' | 'UNVERIFIED_NETWORK' | 'NO_CONSENT' | 'SANCTUARY_LOCKED' | 'LIFECYCLE_SUSPENDED' | 'KEY_MISSING';
}
