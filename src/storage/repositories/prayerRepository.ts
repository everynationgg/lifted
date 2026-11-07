import type { IPrayerRepository, PrayerRecord, PrayerStorageRecord } from '../types';
import type { IDatabaseDriver } from '../databaseDriver';
import type { IEncryptionService } from '../encryptionService';
import { RecordNotFoundError } from '../errors';

export class PrayerRepository implements IPrayerRepository {
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

  async create(prayer: Omit<PrayerRecord, 'createdAt' | 'updatedAt'>): Promise<PrayerRecord> {
    const now = Date.now();
    const reqText = prayer.request || prayer.body || '';
    const titleEncrypted = await this.encryption.encryptString(prayer.title, this.key);
    const requestEncrypted = await this.encryption.encryptString(reqText, this.key);
    const answeredNoteEncrypted = prayer.answeredNote
      ? await this.encryption.encryptString(prayer.answeredNote, this.key)
      : null;

    const storageRecord: PrayerStorageRecord = {
      id: prayer.id,
      titleEncrypted,
      requestEncrypted,
      answeredNoteEncrypted,
      category: prayer.category,
      visibility: prayer.visibility,
      isPrivate: prayer.isPrivate,
      followUpStatus: prayer.followUpStatus,
      followUpDate: prayer.followUpDate || null,
      followUpScheduledDays: prayer.followUpScheduledDays,
      followUpTriggered: prayer.followUpTriggered,
      intercessorsCount: prayer.intercessorsCount,
      isPrayedByMe: prayer.isPrayedByMe,
      isAnswered: prayer.isAnswered,
      remindersEnabled: prayer.remindersEnabled,
      createdAt: now,
      updatedAt: now,
    };

    await this.driver.prayers.put(storageRecord);

    return {
      ...prayer,
      request: reqText,
      body: reqText,
      createdAt: now,
      updatedAt: now,
    };
  }

  async getById(id: string): Promise<PrayerRecord | null> {
    const stored = await this.driver.prayers.get(id);
    if (!stored) return null;

    const title = await this.encryption.decryptString(stored.titleEncrypted, this.key);
    const request = await this.encryption.decryptString(stored.requestEncrypted, this.key);
    const answeredNote = stored.answeredNoteEncrypted
      ? await this.encryption.decryptString(stored.answeredNoteEncrypted, this.key)
      : undefined;

    return {
      id: stored.id,
      title,
      request,
      body: request,
      category: stored.category,
      visibility: stored.visibility,
      isPrivate: stored.isPrivate,
      followUpStatus: stored.followUpStatus as PrayerRecord['followUpStatus'],
      followUpDate: stored.followUpDate,
      followUpScheduledDays: stored.followUpScheduledDays,
      followUpTriggered: stored.followUpTriggered,
      intercessorsCount: stored.intercessorsCount,
      isPrayedByMe: stored.isPrayedByMe,
      isAnswered: stored.isAnswered,
      answeredNote,
      remindersEnabled: stored.remindersEnabled,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  }

  async getAll(): Promise<PrayerRecord[]> {
    const allStored = await this.driver.prayers.getAll();
    const decrypted = await Promise.all(
      allStored.map(async (stored) => {
        const title = await this.encryption.decryptString(stored.titleEncrypted, this.key);
        const request = await this.encryption.decryptString(stored.requestEncrypted, this.key);
        const answeredNote = stored.answeredNoteEncrypted
          ? await this.encryption.decryptString(stored.answeredNoteEncrypted, this.key)
          : undefined;

        return {
          id: stored.id,
          title,
          request,
          body: request,
          category: stored.category,
          visibility: stored.visibility,
          isPrivate: stored.isPrivate,
          followUpStatus: stored.followUpStatus as PrayerRecord['followUpStatus'],
          followUpDate: stored.followUpDate,
          followUpScheduledDays: stored.followUpScheduledDays,
          followUpTriggered: stored.followUpTriggered,
          intercessorsCount: stored.intercessorsCount,
          isPrayedByMe: stored.isPrayedByMe,
          isAnswered: stored.isAnswered,
          answeredNote,
          remindersEnabled: stored.remindersEnabled,
          createdAt: stored.createdAt,
          updatedAt: stored.updatedAt,
        };
      })
    );

    return decrypted.sort((a, b) => b.createdAt - a.createdAt);
  }

  async update(
    id: string,
    updates: Partial<Omit<PrayerRecord, 'id' | 'createdAt'>>
  ): Promise<PrayerRecord> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new RecordNotFoundError('Prayer', id);
    }

    const updatedEntity: PrayerRecord = {
      ...existing,
      ...updates,
      updatedAt: Date.now(),
    };

    const reqText = updatedEntity.request || updatedEntity.body || '';
    const titleEncrypted = await this.encryption.encryptString(updatedEntity.title, this.key);
    const requestEncrypted = await this.encryption.encryptString(reqText, this.key);
    const answeredNoteEncrypted = updatedEntity.answeredNote
      ? await this.encryption.encryptString(updatedEntity.answeredNote, this.key)
      : null;

    const storageRecord: PrayerStorageRecord = {
      id: updatedEntity.id,
      titleEncrypted,
      requestEncrypted,
      answeredNoteEncrypted,
      category: updatedEntity.category,
      visibility: updatedEntity.visibility,
      isPrivate: updatedEntity.isPrivate,
      followUpStatus: updatedEntity.followUpStatus,
      followUpDate: updatedEntity.followUpDate || null,
      followUpScheduledDays: updatedEntity.followUpScheduledDays,
      followUpTriggered: updatedEntity.followUpTriggered,
      intercessorsCount: updatedEntity.intercessorsCount,
      isPrayedByMe: updatedEntity.isPrayedByMe,
      isAnswered: updatedEntity.isAnswered,
      remindersEnabled: updatedEntity.remindersEnabled,
      createdAt: updatedEntity.createdAt,
      updatedAt: updatedEntity.updatedAt,
    };

    await this.driver.prayers.put(storageRecord);
    return updatedEntity;
  }

  async delete(id: string): Promise<void> {
    await this.driver.prayers.delete(id);
  }

  async count(): Promise<number> {
    return this.driver.prayers.count();
  }
}
