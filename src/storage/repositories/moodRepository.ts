import type { IMoodRepository, MoodRecord, MoodStorageRecord } from '../types';
import type { IDatabaseDriver } from '../databaseDriver';
import type { IEncryptionService } from '../encryptionService';

export class MoodRepository implements IMoodRepository {
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

  async create(checkIn: MoodRecord): Promise<MoodRecord> {
    const noteEncrypted = checkIn.note
      ? await this.encryption.encryptString(checkIn.note, this.key)
      : null;

    const storageRecord: MoodStorageRecord = {
      id: checkIn.id,
      mood: checkIn.mood,
      additionalMoods: checkIn.additionalMoods,
      noteEncrypted,
      timestamp: checkIn.timestamp,
      dateStr: checkIn.dateStr,
    };

    await this.driver.moods.put(storageRecord);
    return checkIn;
  }

  async getById(id: string): Promise<MoodRecord | null> {
    const stored = await this.driver.moods.get(id);
    if (!stored) return null;

    const note = stored.noteEncrypted
      ? await this.encryption.decryptString(stored.noteEncrypted, this.key)
      : undefined;

    return {
      id: stored.id,
      mood: stored.mood,
      additionalMoods: stored.additionalMoods,
      note,
      timestamp: stored.timestamp,
      dateStr: stored.dateStr,
    };
  }

  async getAll(): Promise<MoodRecord[]> {
    const allStored = await this.driver.moods.getAll();
    const decrypted = await Promise.all(
      allStored.map(async (stored) => {
        const note = stored.noteEncrypted
          ? await this.encryption.decryptString(stored.noteEncrypted, this.key)
          : undefined;

        return {
          id: stored.id,
          mood: stored.mood,
          additionalMoods: stored.additionalMoods,
          note,
          timestamp: stored.timestamp,
          dateStr: stored.dateStr,
        };
      })
    );

    return decrypted.sort((a, b) => b.timestamp - a.timestamp);
  }

  async delete(id: string): Promise<void> {
    await this.driver.moods.delete(id);
  }

  async count(): Promise<number> {
    return this.driver.moods.count();
  }
}
