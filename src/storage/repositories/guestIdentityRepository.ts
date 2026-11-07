import { Capacitor } from '@capacitor/core';
import type { IGuestIdentityRepository, GuestIdentityRecord } from '../types';
import type { IDatabaseDriver } from '../databaseDriver';

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback RFC4122 v4 UUID generator using crypto.getRandomValues
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class GuestIdentityRepository implements IGuestIdentityRepository {
  private driver: IDatabaseDriver;

  constructor(driver: IDatabaseDriver) {
    this.driver = driver;
  }

  async getIdentity(): Promise<GuestIdentityRecord | null> {
    const records = await this.driver.identity.getAll();
    return records[0] || null;
  }

  async getOrCreateIdentity(): Promise<GuestIdentityRecord> {
    const existing = await this.getIdentity();
    if (existing) {
      return existing;
    }

    const platform = Capacitor.getPlatform() as 'web' | 'android' | 'ios';
    const newIdentity: GuestIdentityRecord = {
      localUserId: `guest-${generateUUID()}`,
      createdAt: Date.now(),
      devicePlatform: platform === 'android' || platform === 'ios' ? platform : 'web',
      schemaVersion: 1,
    };

    await this.driver.identity.put(newIdentity);
    return newIdentity;
  }
}
