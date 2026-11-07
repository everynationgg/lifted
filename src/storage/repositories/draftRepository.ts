import type { IDraftRepository, DraftRecord, DraftStorageRecord } from '../types';
import type { IDatabaseDriver } from '../databaseDriver';
import type { IEncryptionService } from '../encryptionService';

export class DraftRepository implements IDraftRepository {
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

  async saveDraft(key: string, content: string): Promise<DraftRecord> {
    const now = Date.now();
    const contentEncrypted = await this.encryption.encryptString(content, this.key);

    const storageRecord: DraftStorageRecord = {
      key,
      contentEncrypted,
      updatedAt: now,
    };

    await this.driver.drafts.put(storageRecord);

    return {
      key,
      content,
      updatedAt: now,
    };
  }

  async getDraft(key: string): Promise<DraftRecord | null> {
    const stored = await this.driver.drafts.get(key);
    if (!stored) return null;

    const content = await this.encryption.decryptString(stored.contentEncrypted, this.key);

    return {
      key: stored.key,
      content,
      updatedAt: stored.updatedAt,
    };
  }

  async clearDraft(key: string): Promise<void> {
    await this.driver.drafts.delete(key);
  }
}
