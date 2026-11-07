import type { IJournalRepository, JournalRecord, JournalStorageRecord } from '../types';
import type { IDatabaseDriver } from '../databaseDriver';
import type { IEncryptionService } from '../encryptionService';
import { RecordNotFoundError } from '../errors';

export class JournalRepository implements IJournalRepository {
  private driver: IDatabaseDriver;
  private encryption: IEncryptionService;
  private key: CryptoKey;

  constructor(
    driver: IDatabaseDriver,
    encryption: IEncryptionService,
    key: CryptoKey
  ) {
    this.driver = driver;
    this.encryption = encryption;
    this.key = key;
  }

  async create(entry: Omit<JournalRecord, 'createdAt' | 'updatedAt'>): Promise<JournalRecord> {
    const now = Date.now();
    const contentEncrypted = await this.encryption.encryptString(entry.content, this.key);
    const promptEncrypted = entry.promptQuestion
      ? await this.encryption.encryptString(entry.promptQuestion, this.key)
      : null;

    const storageRecord: JournalStorageRecord = {
      id: entry.id,
      date: entry.date,
      timestamp: entry.timestamp,
      contentEncrypted,
      promptEncrypted,
      moodTag: entry.moodTag,
      localUserId: entry.localUserId,
      cloudUserId: entry.cloudUserId || null,
      createdAt: now,
      updatedAt: now,
    };

    await this.driver.journals.put(storageRecord);

    return {
      ...entry,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getById(id: string): Promise<JournalRecord | null> {
    const stored = await this.driver.journals.get(id);
    if (!stored) return null;

    const content = await this.encryption.decryptString(stored.contentEncrypted, this.key);
    const promptQuestion = stored.promptEncrypted
      ? await this.encryption.decryptString(stored.promptEncrypted, this.key)
      : undefined;

    return {
      id: stored.id,
      date: stored.date,
      timestamp: stored.timestamp,
      content,
      promptQuestion,
      moodTag: stored.moodTag,
      localUserId: stored.localUserId,
      cloudUserId: stored.cloudUserId,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async getAll(): Promise<JournalRecord[]> {
    const allStored = await this.driver.journals.getAll();
    const decrypted = await Promise.all(
      allStored.map(async (stored) => {
        const content = await this.encryption.decryptString(stored.contentEncrypted, this.key);
        const promptQuestion = stored.promptEncrypted
          ? await this.encryption.decryptString(stored.promptEncrypted, this.key)
          : undefined;

        return {
          id: stored.id,
          date: stored.date,
          timestamp: stored.timestamp,
          content,
          promptQuestion,
          moodTag: stored.moodTag,
          localUserId: stored.localUserId,
          cloudUserId: stored.cloudUserId,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
        };
      })
    );

    return decrypted.sort((a, b) => b.timestamp - a.timestamp);
  }

  async update(
    id: string,
    updates: Partial<Omit<JournalRecord, 'id' | 'createdAt'>>
  ): Promise<JournalRecord> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new RecordNotFoundError('Journal', id);
    }

    const updatedEntity: JournalRecord = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    const contentEncrypted = await this.encryption.encryptString(updatedEntity.content, this.key);
    const promptEncrypted = updatedEntity.promptQuestion
      ? await this.encryption.encryptString(updatedEntity.promptQuestion, this.key)
      : null;

    const storageRecord: JournalStorageRecord = {
      id: updatedEntity.id,
      date: updatedEntity.date,
      timestamp: updatedEntity.timestamp,
      contentEncrypted,
      promptEncrypted,
      moodTag: updatedEntity.moodTag,
      localUserId: updatedEntity.localUserId,
      cloudUserId: updatedEntity.cloudUserId || null,
      createdAt: updatedEntity.createdAt,
      updatedAt: updatedEntity.updatedAt,
    };

    await this.driver.journals.put(storageRecord);
    return updatedEntity;
  }

  async delete(id: string): Promise<void> {
    await this.driver.journals.delete(id);
  }

  async count(): Promise<number> {
    return this.driver.journals.count();
  }
}
