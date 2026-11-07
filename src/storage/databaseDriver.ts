import { Capacitor } from '@capacitor/core';
import { openDB, type IDBPDatabase } from 'idb';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import type {
  JournalStorageRecord,
  PrayerStorageRecord,
  MoodStorageRecord,
  DraftStorageRecord,
  GuestIdentityRecord,
  OutboxStorageRecord,
} from './types';
import { DatabaseInitError } from './errors';

export interface IStoreDriver<T> {
  put(item: T): Promise<void>;
  get(idOrKey: string): Promise<T | null>;
  getAll(): Promise<T[]>;
  delete(idOrKey: string): Promise<void>;
  count(): Promise<number>;
  clear(): Promise<void>;
}

export interface IDatabaseDriver {
  readonly platform: 'sqlite' | 'indexeddb';
  initialize(): Promise<void>;
  isAvailable(): boolean;
  getMetadata(key: string): Promise<string | null>;
  setMetadata(key: string, value: string): Promise<void>;
  hasExistingData(): Promise<boolean>;
  close(): Promise<void>;
  executeTransaction<R>(fn: () => Promise<R>): Promise<R>;

  journals: IStoreDriver<JournalStorageRecord>;
  prayers: IStoreDriver<PrayerStorageRecord>;
  moods: IStoreDriver<MoodStorageRecord>;
  drafts: IStoreDriver<DraftStorageRecord>;
  identity: IStoreDriver<GuestIdentityRecord>;
  outbox: IStoreDriver<OutboxStorageRecord>;
}

const VAULT_DB_NAME = 'lifted_vault';
const SCHEMA_VERSION = 1;

/**
 * ==========================================
 * IndexedDB Driver (Web & Testing Runtimes)
 * ==========================================
 */
class IDBStoreDriver<T extends { id?: string; key?: string; localUserId?: string }>
  implements IStoreDriver<T>
{
  private getDB: () => Promise<IDBPDatabase>;
  private storeName: string;

  constructor(
    getDB: () => Promise<IDBPDatabase>,
    storeName: string
  ) {
    this.getDB = getDB;
    this.storeName = storeName;
  }

  async put(item: T): Promise<void> {
    const db = await this.getDB();
    await db.put(this.storeName, item);
  }

  async get(idOrKey: string): Promise<T | null> {
    const db = await this.getDB();
    const res = await db.get(this.storeName, idOrKey);
    return res || null;
  }

  async getAll(): Promise<T[]> {
    const db = await this.getDB();
    return db.getAll(this.storeName);
  }

  async delete(idOrKey: string): Promise<void> {
    const db = await this.getDB();
    await db.delete(this.storeName, idOrKey);
  }

  async count(): Promise<number> {
    const db = await this.getDB();
    return db.count(this.storeName);
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    await db.clear(this.storeName);
  }
}

export class IndexedDBDriver implements IDatabaseDriver {
  readonly platform = 'indexeddb' as const;
  private db: IDBPDatabase | null = null;
  private initialized = false;
  private dbName: string;

  journals: IStoreDriver<JournalStorageRecord>;
  prayers: IStoreDriver<PrayerStorageRecord>;
  moods: IStoreDriver<MoodStorageRecord>;
  drafts: IStoreDriver<DraftStorageRecord>;
  identity: IStoreDriver<GuestIdentityRecord>;
  outbox: IStoreDriver<OutboxStorageRecord>;

  constructor(dbName: string = VAULT_DB_NAME) {
    this.dbName = dbName;
    const getter = () => this.getActiveDB();
    this.journals = new IDBStoreDriver<JournalStorageRecord>(getter, 'journals');
    this.prayers = new IDBStoreDriver<PrayerStorageRecord>(getter, 'prayers');
    this.moods = new IDBStoreDriver<MoodStorageRecord>(getter, 'moods');
    this.drafts = new IDBStoreDriver<DraftStorageRecord>(getter, 'drafts');
    this.identity = new IDBStoreDriver<GuestIdentityRecord>(getter, 'identity');
    this.outbox = new IDBStoreDriver<OutboxStorageRecord>(getter, 'outbox');
  }

  private async getActiveDB(): Promise<IDBPDatabase> {
    if (!this.db) {
      await this.initialize();
    }
    if (!this.db) {
      throw new DatabaseInitError('IndexedDB failed to open.');
    }
    return this.db;
  }

  async initialize(): Promise<void> {
    if (this.initialized && this.db) return;

    try {
      this.db = await openDB(this.dbName, SCHEMA_VERSION, {
        upgrade(db) {
          if (!db.objectStoreNames.contains('metadata')) {
            db.createObjectStore('metadata');
          }
          if (!db.objectStoreNames.contains('journals')) {
            db.createObjectStore('journals', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('prayers')) {
            db.createObjectStore('prayers', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('moods')) {
            db.createObjectStore('moods', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('drafts')) {
            db.createObjectStore('drafts', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('identity')) {
            db.createObjectStore('identity', { keyPath: 'localUserId' });
          }
          if (!db.objectStoreNames.contains('outbox')) {
            db.createObjectStore('outbox', { keyPath: 'operationId' });
          }
        },
      });

      this.initialized = true;
    } catch (err: unknown) {
      this.initialized = false;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      throw new DatabaseInitError(`IndexedDB initialization failed: ${msg}`);
    }
  }

  isAvailable(): boolean {
    return this.initialized && this.db !== null;
  }

  async getMetadata(key: string): Promise<string | null> {
    const db = await this.getActiveDB();
    const val = await db.get('metadata', key);
    return val !== undefined ? String(val) : null;
  }

  async setMetadata(key: string, value: string): Promise<void> {
    const db = await this.getActiveDB();
    await db.put('metadata', value, key);
  }

  async hasExistingData(): Promise<boolean> {
    const db = await this.getActiveDB();
    const canary = await db.get('metadata', 'canary');
    if (canary) return true;

    const jCount = await db.count('journals');
    const pCount = await db.count('prayers');
    const mCount = await db.count('moods');
    return jCount > 0 || pCount > 0 || mCount > 0;
  }

  async executeTransaction<R>(fn: () => Promise<R>): Promise<R> {
    // In IndexedDB, transactional execution is handled per store operation
    return fn();
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initialized = false;
    }
  }
}

/**
 * ==========================================
 * Native Mobile SQLite Driver (Android / iOS)
 * ==========================================
 */
export class CapacitorSQLiteDriver implements IDatabaseDriver {
  readonly platform = 'sqlite' as const;
  private sqlite: SQLiteConnection | null = null;
  private db: SQLiteDBConnection | null = null;
  private initialized = false;

  private dbName: string;

  journals: IStoreDriver<JournalStorageRecord> = {} as IStoreDriver<JournalStorageRecord>;
  prayers: IStoreDriver<PrayerStorageRecord> = {} as IStoreDriver<PrayerStorageRecord>;
  moods: IStoreDriver<MoodStorageRecord> = {} as IStoreDriver<MoodStorageRecord>;
  drafts: IStoreDriver<DraftStorageRecord> = {} as IStoreDriver<DraftStorageRecord>;
  identity: IStoreDriver<GuestIdentityRecord> = {} as IStoreDriver<GuestIdentityRecord>;
  outbox: IStoreDriver<OutboxStorageRecord> = {} as IStoreDriver<OutboxStorageRecord>;

  constructor(dbName: string = 'lifted_vault') {
    this.dbName = dbName;
    this.createStoreAdapters();
  }

  private createStoreAdapters() {
    this.journals = {
      put: async (item) => {
        const sql = `INSERT OR REPLACE INTO journals (id, date, timestamp, contentEncrypted, promptEncrypted, localUserId, cloudUserId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await this.db!.run(sql, [
          item.id,
          item.date,
          item.timestamp,
          JSON.stringify(item.contentEncrypted),
          item.promptEncrypted ? JSON.stringify(item.promptEncrypted) : null,
          item.localUserId,
          item.cloudUserId || null,
          item.createdAt,
          item.updatedAt,
        ]);
      },
      get: async (id) => {
        const res = await this.db!.query(`SELECT * FROM journals WHERE id = ?`, [id]);
        const row = res.values?.[0];
        if (!row) return null;
        return {
          ...row,
          contentEncrypted: JSON.parse(row.contentEncrypted),
          promptEncrypted: row.promptEncrypted ? JSON.parse(row.promptEncrypted) : null,
        };
      },
      getAll: async () => {
        const res = await this.db!.query(`SELECT * FROM journals ORDER BY timestamp DESC`);
        return (res.values || []).map((row) => ({
          ...row,
          contentEncrypted: JSON.parse(row.contentEncrypted),
          promptEncrypted: row.promptEncrypted ? JSON.parse(row.promptEncrypted) : null,
        }));
      },
      delete: async (id) => {
        await this.db!.run(`DELETE FROM journals WHERE id = ?`, [id]);
      },
      count: async () => {
        const res = await this.db!.query(`SELECT COUNT(*) as count FROM journals`);
        return res.values?.[0]?.count || 0;
      },
      clear: async () => {
        await this.db!.run(`DELETE FROM journals`);
      },
    };

    this.prayers = {
      put: async (item) => {
        const sql = `INSERT OR REPLACE INTO prayers (id, titleEncrypted, requestEncrypted, category, isPrivate, followUpStatus, followUpDate, intercessorsCount, isPrayedByMe, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await this.db!.run(sql, [
          item.id,
          JSON.stringify(item.titleEncrypted),
          JSON.stringify(item.requestEncrypted),
          item.category,
          item.isPrivate ? 1 : 0,
          item.followUpStatus,
          item.followUpDate || null,
          item.intercessorsCount,
          item.isPrayedByMe ? 1 : 0,
          item.createdAt,
          item.updatedAt,
        ]);
      },
      get: async (id) => {
        const res = await this.db!.query(`SELECT * FROM prayers WHERE id = ?`, [id]);
        const row = res.values?.[0];
        if (!row) return null;
        return {
          ...row,
          titleEncrypted: JSON.parse(row.titleEncrypted),
          requestEncrypted: JSON.parse(row.requestEncrypted),
          isPrivate: Boolean(row.isPrivate),
          isPrayedByMe: Boolean(row.isPrayedByMe),
        };
      },
      getAll: async () => {
        const res = await this.db!.query(`SELECT * FROM prayers ORDER BY createdAt DESC`);
        return (res.values || []).map((row) => ({
          ...row,
          titleEncrypted: JSON.parse(row.titleEncrypted),
          requestEncrypted: JSON.parse(row.requestEncrypted),
          isPrivate: Boolean(row.isPrivate),
          isPrayedByMe: Boolean(row.isPrayedByMe),
        }));
      },
      delete: async (id) => {
        await this.db!.run(`DELETE FROM prayers WHERE id = ?`, [id]);
      },
      count: async () => {
        const res = await this.db!.query(`SELECT COUNT(*) as count FROM prayers`);
        return res.values?.[0]?.count || 0;
      },
      clear: async () => {
        await this.db!.run(`DELETE FROM prayers`);
      },
    };

    this.moods = {
      put: async (item) => {
        const sql = `INSERT OR REPLACE INTO moods (id, mood, additionalMoods, noteEncrypted, timestamp, dateStr) VALUES (?, ?, ?, ?, ?, ?)`;
        await this.db!.run(sql, [
          item.id,
          item.mood,
          item.additionalMoods ? JSON.stringify(item.additionalMoods) : null,
          item.noteEncrypted ? JSON.stringify(item.noteEncrypted) : null,
          item.timestamp,
          item.dateStr,
        ]);
      },
      get: async (id) => {
        const res = await this.db!.query(`SELECT * FROM moods WHERE id = ?`, [id]);
        const row = res.values?.[0];
        if (!row) return null;
        return {
          ...row,
          additionalMoods: row.additionalMoods ? JSON.parse(row.additionalMoods) : undefined,
          noteEncrypted: row.noteEncrypted ? JSON.parse(row.noteEncrypted) : null,
        };
      },
      getAll: async () => {
        const res = await this.db!.query(`SELECT * FROM moods ORDER BY timestamp DESC`);
        return (res.values || []).map((row) => ({
          ...row,
          additionalMoods: row.additionalMoods ? JSON.parse(row.additionalMoods) : undefined,
          noteEncrypted: row.noteEncrypted ? JSON.parse(row.noteEncrypted) : null,
        }));
      },
      delete: async (id) => {
        await this.db!.run(`DELETE FROM moods WHERE id = ?`, [id]);
      },
      count: async () => {
        const res = await this.db!.query(`SELECT COUNT(*) as count FROM moods`);
        return res.values?.[0]?.count || 0;
      },
      clear: async () => {
        await this.db!.run(`DELETE FROM moods`);
      },
    };

    this.drafts = {
      put: async (item) => {
        const sql = `INSERT OR REPLACE INTO drafts (key, contentEncrypted, updatedAt) VALUES (?, ?, ?)`;
        await this.db!.run(sql, [
          item.key,
          JSON.stringify(item.contentEncrypted),
          item.updatedAt,
        ]);
      },
      get: async (key) => {
        const res = await this.db!.query(`SELECT * FROM drafts WHERE key = ?`, [key]);
        const row = res.values?.[0];
        if (!row) return null;
        return {
          ...row,
          contentEncrypted: JSON.parse(row.contentEncrypted),
        };
      },
      getAll: async () => {
        const res = await this.db!.query(`SELECT * FROM drafts`);
        return (res.values || []).map((row) => ({
          ...row,
          contentEncrypted: JSON.parse(row.contentEncrypted),
        }));
      },
      delete: async (key) => {
        await this.db!.run(`DELETE FROM drafts WHERE key = ?`, [key]);
      },
      count: async () => {
        const res = await this.db!.query(`SELECT COUNT(*) as count FROM drafts`);
        return res.values?.[0]?.count || 0;
      },
      clear: async () => {
        await this.db!.run(`DELETE FROM drafts`);
      },
    };

    this.identity = {
      put: async (item) => {
        const sql = `INSERT OR REPLACE INTO identity (localUserId, createdAt, devicePlatform, schemaVersion) VALUES (?, ?, ?, ?)`;
        await this.db!.run(sql, [
          item.localUserId,
          item.createdAt,
          item.devicePlatform,
          item.schemaVersion,
        ]);
      },
      get: async (id) => {
        const res = await this.db!.query(`SELECT * FROM identity WHERE localUserId = ?`, [id]);
        return res.values?.[0] || null;
      },
      getAll: async () => {
        const res = await this.db!.query(`SELECT * FROM identity`);
        return res.values || [];
      },
      delete: async (id) => {
        await this.db!.run(`DELETE FROM identity WHERE localUserId = ?`, [id]);
      },
      count: async () => {
        const res = await this.db!.query(`SELECT COUNT(*) as count FROM identity`);
        return res.values?.[0]?.count || 0;
      },
      clear: async () => {
        await this.db!.run(`DELETE FROM identity`);
      },
    };

    this.outbox = {
      put: async (item) => {
        const sql = `INSERT OR REPLACE INTO outbox (
          operationId, recordId, localUserId, cloudUserId, recordType, operationType,
          baseRevision, newLocalRevision, encryptedEnvelope, createdAt, status,
          retryCount, lastAttemptAt, nextAttemptAt, lastErrorCategory, idempotencyKey
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
        await this.db!.run(sql, [
          item.operationId,
          item.recordId,
          item.localUserId,
          item.cloudUserId || null,
          item.recordType,
          item.operationType,
          item.baseRevision,
          item.newLocalRevision,
          JSON.stringify(item.encryptedEnvelope),
          item.createdAt,
          item.status,
          item.retryCount,
          item.lastAttemptAt || null,
          item.nextAttemptAt || null,
          item.lastErrorCategory || null,
          item.idempotencyKey,
        ]);
      },
      get: async (id) => {
        const res = await this.db!.query(`SELECT * FROM outbox WHERE operationId = ?`, [id]);
        const row = res.values?.[0];
        if (!row) return null;
        return {
          ...row,
          encryptedEnvelope: JSON.parse(row.encryptedEnvelope),
        };
      },
      getAll: async () => {
        const res = await this.db!.query(`SELECT * FROM outbox ORDER BY createdAt ASC`);
        return (res.values || []).map((row) => ({
          ...row,
          encryptedEnvelope: JSON.parse(row.encryptedEnvelope),
        }));
      },
      delete: async (id) => {
        await this.db!.run(`DELETE FROM outbox WHERE operationId = ?`, [id]);
      },
      count: async () => {
        const res = await this.db!.query(`SELECT COUNT(*) as count FROM outbox`);
        return res.values?.[0]?.count || 0;
      },
      clear: async () => {
        await this.db!.run(`DELETE FROM outbox`);
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized && this.db) return;

    try {
      this.sqlite = new SQLiteConnection(CapacitorSQLite);
      this.db = await this.sqlite.createConnection(
        this.dbName,
        false,
        'no-encryption',
        1,
        false
      );
      await this.db.open();

      // Create core schemas
      const schemaStatements = `
        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS journals (
          id TEXT PRIMARY KEY,
          date TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          contentEncrypted TEXT NOT NULL,
          promptEncrypted TEXT,
          localUserId TEXT NOT NULL,
          cloudUserId TEXT,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS prayers (
          id TEXT PRIMARY KEY,
          titleEncrypted TEXT NOT NULL,
          requestEncrypted TEXT NOT NULL,
          category TEXT NOT NULL,
          isPrivate INTEGER NOT NULL,
          followUpStatus TEXT NOT NULL,
          followUpDate INTEGER,
          intercessorsCount INTEGER NOT NULL,
          isPrayedByMe INTEGER NOT NULL,
          createdAt INTEGER NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS moods (
          id TEXT PRIMARY KEY,
          mood TEXT NOT NULL,
          additionalMoods TEXT,
          noteEncrypted TEXT,
          timestamp INTEGER NOT NULL,
          dateStr TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS drafts (
          key TEXT PRIMARY KEY,
          contentEncrypted TEXT NOT NULL,
          updatedAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS identity (
          localUserId TEXT PRIMARY KEY,
          createdAt INTEGER NOT NULL,
          devicePlatform TEXT NOT NULL,
          schemaVersion INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS outbox (
          operationId TEXT PRIMARY KEY,
          recordId TEXT NOT NULL,
          localUserId TEXT NOT NULL,
          cloudUserId TEXT,
          recordType TEXT NOT NULL,
          operationType TEXT NOT NULL,
          baseRevision INTEGER NOT NULL,
          newLocalRevision INTEGER NOT NULL,
          encryptedEnvelope TEXT NOT NULL,
          createdAt INTEGER NOT NULL,
          status TEXT NOT NULL,
          retryCount INTEGER NOT NULL,
          lastAttemptAt INTEGER,
          nextAttemptAt INTEGER,
          lastErrorCategory TEXT,
          idempotencyKey TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_outbox_status_next ON outbox(status, nextAttemptAt);
      `;

      await this.db.execute(schemaStatements);
      this.initialized = true;
    } catch (err: unknown) {
      this.initialized = false;
      const msg = err instanceof Error ? err.message : 'Unknown SQLite error';
      throw new DatabaseInitError(`Native SQLite initialization failed: ${msg}`);
    }
  }

  isAvailable(): boolean {
    return this.initialized && this.db !== null;
  }

  async getMetadata(key: string): Promise<string | null> {
    if (!this.db) throw new DatabaseInitError('Database not initialized');
    const res = await this.db.query(`SELECT value FROM metadata WHERE key = ?`, [key]);
    return res.values?.[0]?.value || null;
  }

  async setMetadata(key: string, value: string): Promise<void> {
    if (!this.db) throw new DatabaseInitError('Database not initialized');
    await this.db.run(`INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)`, [key, value]);
  }

  async hasExistingData(): Promise<boolean> {
    if (!this.db) return false;
    const canary = await this.getMetadata('canary');
    if (canary) return true;

    const jRes = await this.db.query(`SELECT COUNT(*) as count FROM journals`);
    const pRes = await this.db.query(`SELECT COUNT(*) as count FROM prayers`);
    const mRes = await this.db.query(`SELECT COUNT(*) as count FROM moods`);
    return (
      (jRes.values?.[0]?.count || 0) > 0 ||
      (pRes.values?.[0]?.count || 0) > 0 ||
      (mRes.values?.[0]?.count || 0) > 0
    );
  }

  async executeTransaction<R>(fn: () => Promise<R>): Promise<R> {
    if (!this.db) throw new DatabaseInitError('Database not initialized');
    await this.db.beginTransaction();
    try {
      const result = await fn();
      await this.db.commitTransaction();
      return result;
    } catch (err) {
      await this.db.rollbackTransaction();
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    if (this.sqlite) {
      await this.sqlite.closeConnection(this.dbName, false);
      this.sqlite = null;
    }
    this.initialized = false;
  }
}

/**
 * Driver Factory: selects native SQLite on mobile devices, IndexedDB on web
 */
export function getDatabaseDriver(options?: {
  forcePlatform?: 'sqlite' | 'indexeddb';
  dbName?: string;
}): IDatabaseDriver {
  if (options?.forcePlatform === 'sqlite' || (options?.forcePlatform !== 'indexeddb' && Capacitor.isNativePlatform())) {
    return new CapacitorSQLiteDriver(options?.dbName || 'lifted_vault');
  }
  return new IndexedDBDriver(options?.dbName || VAULT_DB_NAME);
}
