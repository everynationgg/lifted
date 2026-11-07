/**
 * LIFTED Supabase Storage Adapter
 * Phase 6: Secure Token Storage for Native and Web Platforms
 *
 * Implements Supabase's SupportedStorage interface.
 * - On Native (Android / iOS): Routes session tokens to @aparajita/capacitor-secure-storage
 *   (hardware-backed Android KeyStore / iOS Keychain).
 * - On Web: Routes to isolated browser storage with documented threat boundary.
 */

import { Capacitor } from '@capacitor/core';
import { SecureStorage } from '@aparajita/capacitor-secure-storage';

export interface ISupabaseStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export class SupabaseSessionStorageAdapter implements ISupabaseStorageAdapter {
  private inMemoryFallback: Map<string, string> = new Map();

  async getItem(key: string): Promise<string | null> {
    if (Capacitor.isNativePlatform()) {
      try {
        const item = await SecureStorage.getItem(key);
        return typeof item === 'string' ? item : null;
      } catch {
        return null;
      }
    }

    // Web fallback
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return this.inMemoryFallback.get(key) ?? null;
      }
    }

    return this.inMemoryFallback.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        await SecureStorage.setItem(key, value);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        // Fall back to in-memory if hardware storage fails
        this.inMemoryFallback.set(key, value);
        throw new Error(`NATIVE_STORAGE_ERROR: Failed to securely store session token: ${msg}`);
      }
    }

    // Web fallback
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.setItem(key, value);
        return;
      } catch {
        this.inMemoryFallback.set(key, value);
        return;
      }
    }

    this.inMemoryFallback.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    if (Capacitor.isNativePlatform()) {
      try {
        await SecureStorage.removeItem(key);
      } catch {
        // Ignore if key did not exist
      }
      return;
    }

    // Web fallback
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore
      }
    }

    this.inMemoryFallback.delete(key);
  }
}

export const supabaseSessionStorage = new SupabaseSessionStorageAdapter();
