import type { MoodId } from '../types';
export type { MoodId };

/**
 * Versioned Encrypted Payload Envelope
 * Contains AES-256-GCM ciphertext and unique per-operation initialization vector.
 */
export interface EncryptedPayload {
  v: 1;          // Envelope specification version
  iv: string;    // Base64-encoded 96-bit (12-byte) initialization vector
  ct: string;    // Base64-encoded ciphertext with 128-bit authentication tag
}

/**
 * Key and Storage Lifecycle States
 */
export type KeyLifecycleState =
  | 'FIRST_INSTALL'       // Clean installation: no database and no key exist yet
  | 'READY'               // Key and database verified against security canary
  | 'KEY_MISSING'         // Encrypted database exists on device, but key was lost/cleared
  | 'KEY_INVALID'         // Key exists but fails authentication canary decryption
  | 'DATABASE_CORRUPTED'  // Database engine reports file corruption or unparseable state
  | 'UNAVAILABLE';        // Storage engine hardware or driver unavailable

/**
 * Synthetic / Domain Journal Entity (Plaintext in memory)
 */
export interface JournalRecord {
  id: string;
  date: string;
  timestamp: number;
  content: string;
  promptQuestion?: string;
  moodTag?: MoodId;
  localUserId: string;
  cloudUserId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Persisted Storage Journal Entity (Encrypted on disk)
 */
export interface JournalStorageRecord {
  id: string;
  date: string;
  timestamp: number;
  contentEncrypted: EncryptedPayload;
  promptEncrypted?: EncryptedPayload | null;
  moodTag?: MoodId;
  localUserId: string;
  cloudUserId?: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Synthetic / Domain Prayer Request Entity (Plaintext in memory)
 */
export interface PrayerRecord {
  id: string;
  title: string;
  request: string;
  body?: string;
  category: string;
  visibility?: 'private' | 'confidential' | 'community';
  isPrivate: boolean;
  followUpStatus: 'none' | 'still_praying' | 'experiencing_peace' | 'answered';
  followUpDate?: number | null;
  followUpScheduledDays?: number;
  followUpTriggered?: boolean;
  intercessorsCount: number;
  isPrayedByMe: boolean;
  isAnswered?: boolean;
  answeredNote?: string;
  remindersEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Persisted Storage Prayer Entity (Encrypted on disk)
 */
export interface PrayerStorageRecord {
  id: string;
  titleEncrypted: EncryptedPayload;
  requestEncrypted: EncryptedPayload;
  answeredNoteEncrypted?: EncryptedPayload | null;
  category: string;
  visibility?: 'private' | 'confidential' | 'community';
  isPrivate: boolean;
  followUpStatus: string;
  followUpDate?: number | null;
  followUpScheduledDays?: number;
  followUpTriggered?: boolean;
  intercessorsCount: number;
  isPrayedByMe: boolean;
  isAnswered?: boolean;
  remindersEnabled?: boolean;
  createdAt: number;
  updatedAt: number;
}

/**
 * Synthetic / Domain Mood Check-in Entity (Plaintext in memory)
 */
export interface MoodRecord {
  id: string;
  mood: MoodId;
  additionalMoods?: MoodId[];
  note?: string;
  timestamp: number;
  dateStr: string;
}

/**
 * Persisted Storage Mood Check-in Entity (Encrypted on disk)
 */
export interface MoodStorageRecord {
  id: string;
  mood: MoodId;
  additionalMoods?: MoodId[];
  noteEncrypted?: EncryptedPayload | null;
  timestamp: number;
  dateStr: string;
}

/**
 * Unfinished Editor Draft Entity (Plaintext in memory)
 */
export interface DraftRecord {
  key: string;       // e.g. 'journal_draft' | 'prayer_draft'
  content: string;
  updatedAt: number;
}

/**
 * Persisted Storage Draft Entity (Encrypted on disk)
 */
export interface DraftStorageRecord {
  key: string;
  contentEncrypted: EncryptedPayload;
  updatedAt: number;
}

/**
 * Local Guest Identity Entity
 */
export interface GuestIdentityRecord {
  localUserId: string;
  createdAt: number;
  devicePlatform: 'web' | 'android' | 'ios';
  schemaVersion: number;
}

/**
 * Outbox Enums & Storage Types (Phase 8 Offline-First Sync Foundation)
 */
export type OutboxRecordType = 'journal' | 'prayer' | 'mood' | 'sync_meta';
export type OutboxOperationType = 'insert' | 'update' | 'delete';
export type OutboxStatus = 'pending' | 'in_flight' | 'acknowledged' | 'failed' | 'quarantined';
export type OutboxErrorCategory =
  | 'NETWORK_OFFLINE'
  | 'AUTH_UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'ENCRYPTION_PREREQUISITE_FAILED'
  | 'CONFLICT'
  | 'UNKNOWN';

export interface OutboxStorageRecord {
  operationId: string;       // Stable UUID
  recordId: string;          // Domain record ID
  localUserId: string;       // Local device guest identity
  cloudUserId: string | null;// Intended cloud identity if explicitly linked
  recordType: OutboxRecordType;
  operationType: OutboxOperationType;
  baseRevision: number;
  newLocalRevision: number;
  encryptedEnvelope: EncryptedPayload; // NO duplicate plaintext!
  createdAt: number;
  status: OutboxStatus;
  retryCount: number;
  lastAttemptAt: number | null;
  nextAttemptAt: number | null;
  lastErrorCategory: OutboxErrorCategory | null;
  idempotencyKey: string;
}

/**
 * Domain Repository Contracts
 */
export interface IJournalRepository {
  create(entry: Omit<JournalRecord, 'createdAt' | 'updatedAt'>): Promise<JournalRecord>;
  getById(id: string): Promise<JournalRecord | null>;
  getAll(): Promise<JournalRecord[]>;
  update(id: string, updates: Partial<Omit<JournalRecord, 'id' | 'createdAt'>>): Promise<JournalRecord>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

export interface IPrayerRepository {
  create(prayer: Omit<PrayerRecord, 'createdAt' | 'updatedAt'>): Promise<PrayerRecord>;
  getById(id: string): Promise<PrayerRecord | null>;
  getAll(): Promise<PrayerRecord[]>;
  update(id: string, updates: Partial<Omit<PrayerRecord, 'id' | 'createdAt'>>): Promise<PrayerRecord>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

export interface IMoodRepository {
  create(checkIn: MoodRecord): Promise<MoodRecord>;
  getById(id: string): Promise<MoodRecord | null>;
  getAll(): Promise<MoodRecord[]>;
  delete(id: string): Promise<void>;
  count(): Promise<number>;
}

export interface IDraftRepository {
  saveDraft(key: string, content: string): Promise<DraftRecord>;
  getDraft(key: string): Promise<DraftRecord | null>;
  clearDraft(key: string): Promise<void>;
}

export interface IGuestIdentityRepository {
  getOrCreateIdentity(): Promise<GuestIdentityRecord>;
  getIdentity(): Promise<GuestIdentityRecord | null>;
}
