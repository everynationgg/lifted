import { Capacitor } from '@capacitor/core';
import { openDB, type IDBPDatabase } from 'idb';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { encryptionService, type IEncryptionService } from './encryptionService';
import type { KeyLifecycleState } from './types';

const WEB_KEY_DB_NAME = 'lifted_security_vault';
const WEB_KEY_STORE_NAME = 'keys';
const MASTER_KEY_ID = 'master_dek_v1';
const NATIVE_KEY_ALIAS = 'lifted_master_key_v1';

export interface KeyLoadResult {
  key: CryptoKey | null;
  state: KeyLifecycleState;
}

export interface IKeyStorage {
  loadOrCreateKey(databaseExists: boolean): Promise<KeyLoadResult>;
  clearKey(): Promise<void>;
  hasKey(): Promise<boolean>;
}

/**
 * Web Platform Key Storage Adapter
 * Stores a non-extractable CryptoKey inside an isolated IndexedDB object store.
 * The non-extractable flag prevents JavaScript from exporting raw bytes via WebCrypto exportKey().
 */
export class WebKeyStorage implements IKeyStorage {
  private encryption: IEncryptionService;

  constructor(encryption: IEncryptionService = encryptionService) {
    this.encryption = encryption;
  }

  private async getDB(): Promise<IDBPDatabase> {
    return openDB(WEB_KEY_DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(WEB_KEY_STORE_NAME)) {
          db.createObjectStore(WEB_KEY_STORE_NAME);
        }
      },
    });
  }

  async hasKey(): Promise<boolean> {
    try {
      const db = await this.getDB();
      const existing = await db.get(WEB_KEY_STORE_NAME, MASTER_KEY_ID);
      return Boolean(existing);
    } catch {
      return false;
    }
  }

  async loadOrCreateKey(databaseExists: boolean): Promise<KeyLoadResult> {
    const db = await this.getDB();
    const existingKey = (await db.get(WEB_KEY_STORE_NAME, MASTER_KEY_ID)) as CryptoKey | undefined;

    if (existingKey) {
      return {
        key: existingKey,
        state: 'READY',
      };
    }

    // Safeguard: If the database exists but the key is missing, halt to prevent data loss!
    if (databaseExists) {
      return {
        key: null,
        state: 'KEY_MISSING',
      };
    }

    // Clean initial installation: generate a new non-extractable CryptoKey
    const newKey = await this.encryption.generateKey(false);
    await db.put(WEB_KEY_STORE_NAME, newKey, MASTER_KEY_ID);

    return {
      key: newKey,
      state: 'FIRST_INSTALL',
    };
  }

  async clearKey(): Promise<void> {
    const db = await this.getDB();
    await db.delete(WEB_KEY_STORE_NAME, MASTER_KEY_ID);
  }
}

/**
 * Native Platform Key Storage Adapter (iOS & Android)
 * Integrates with @aparajita/capacitor-secure-storage:
 * - iOS: System Keychain with kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly.
 * - Android: Encrypted with hardware-backed Android KeyStore AES-GCM in SharedPreferences.
 */
export class NativeKeyStorage implements IKeyStorage {
  private encryption: IEncryptionService;

  constructor(encryption: IEncryptionService = encryptionService) {
    this.encryption = encryption;
  }

  async hasKey(): Promise<boolean> {
    try {
      const res = await SecureStorage.getItem(NATIVE_KEY_ALIAS);
      return Boolean(res);
    } catch {
      return false;
    }
  }

  async loadOrCreateKey(databaseExists: boolean): Promise<KeyLoadResult> {
    try {
      let rawKeyHex: string | null = null;
      try {
        const result = await SecureStorage.getItem(NATIVE_KEY_ALIAS);
        if (result && typeof result === 'string' && result.trim()) {
          rawKeyHex = result.trim();
        }
      } catch {
        rawKeyHex = null;
      }

      if (rawKeyHex) {
        // Convert hex string back to 32 bytes
        const bytes = new Uint8Array(
          rawKeyHex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || []
        );
        const importedKey = await this.encryption.importRawKey(bytes, false);
        return {
          key: importedKey,
          state: 'READY',
        };
      }

      // Safeguard: Database exists but native key missing from Keychain/Keystore
      if (databaseExists) {
        return {
          key: null,
          state: 'KEY_MISSING',
        };
      }

      // First install: generate 32 random bytes and persist into SecureStorage
      const rawBytes = new Uint8Array(32);
      window.crypto.getRandomValues(rawBytes);
      const hexString = Array.from(rawBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      await SecureStorage.setItem(NATIVE_KEY_ALIAS, hexString);

      const key = await this.encryption.importRawKey(rawBytes, false);
      return {
        key,
        state: 'FIRST_INSTALL',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Native key storage failure';
      throw new Error(`Native secure storage error: ${msg}`);
    }
  }

  async clearKey(): Promise<void> {
    try {
      await SecureStorage.removeItem(NATIVE_KEY_ALIAS);
    } catch {
      // Ignore if key did not exist
    }
  }
}

/**
 * Factory helper selecting the appropriate key storage adapter
 */
export function getKeyStorage(forceAdapter?: 'web' | 'native'): IKeyStorage {
  if (forceAdapter === 'native' || (forceAdapter !== 'web' && Capacitor.isNativePlatform())) {
    return new NativeKeyStorage();
  }
  return new WebKeyStorage();
}
