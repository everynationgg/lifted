import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryType, type CheckBiometryResult } from '@aparajita/capacitor-biometric-auth';
import { useState, useEffect } from 'react';
import type { UserPreferences } from '../../types';
import { lifecycleManager } from '../lifecycleManager';

export type SanctuaryLockState =
  | 'DISABLED'
  | 'LOCKED'
  | 'AUTHENTICATING'
  | 'UNLOCKED'
  | 'AUTHENTICATION_FAILED'
  | 'UNAVAILABLE'
  | 'RECOVERY_REQUIRED';

export interface BiometricAvailability {
  isAvailable: boolean;
  biometryType: 'faceId' | 'touchId' | 'fingerprint' | 'none';
  deviceIsSecure: boolean;
  strongBiometryIsAvailable: boolean;
  reason: string;
}

export interface SanctuaryPrivacySnapshot {
  state: SanctuaryLockState;
  isLocked: boolean;
  autoLockIntervalMinutes: number;
  useBiometrics: boolean;
  biometricAvailability: BiometricAvailability;
  failedAttempts: number;
}

export interface PendingDeepLink {
  type: 'daily_checkin' | 'prayer_followup';
  prayerId?: string;
  timestamp: number;
}

/**
 * Authoritative security manager for LIFTED's Sanctuary Privacy Lock.
 * Enforces cold-start privacy, native biometric / device credential authentication,
 * background masking, and sensitive data access gating without altering underlying encryption keys.
 */
export class SanctuaryPrivacyManager {
  private state: SanctuaryLockState = 'DISABLED';
  private autoLockIntervalMinutes = 0; // 0 = immediately, 1 = 1m, 5 = 5m
  private useBiometrics = true;
  private isEnabled = false;
  private backgroundTimestamp = 0;
  private failedAttempts = 0;
  private pendingDeepLink: PendingDeepLink | null = null;
  private isInitialized = false;

  private biometricAvailability: BiometricAvailability = {
    isAvailable: false,
    biometryType: 'none',
    deviceIsSecure: false,
    strongBiometryIsAvailable: false,
    reason: 'Not initialized',
  };

  private listeners: Set<(snapshot: SanctuaryPrivacySnapshot) => void> = new Set();
  private unregisterBackground: (() => void) | null = null;
  private unregisterForeground: (() => void) | null = null;

  constructor() {
    this.handleBackground = this.handleBackground.bind(this);
    this.handleForeground = this.handleForeground.bind(this);
  }

  getSnapshot(): SanctuaryPrivacySnapshot {
    return {
      state: this.state,
      isLocked: this.isLocked(),
      autoLockIntervalMinutes: this.autoLockIntervalMinutes,
      useBiometrics: this.useBiometrics,
      biometricAvailability: this.biometricAvailability,
      failedAttempts: this.failedAttempts,
    };
  }

  isLocked(): boolean {
    return (
      this.state === 'LOCKED' ||
      this.state === 'AUTHENTICATING' ||
      this.state === 'AUTHENTICATION_FAILED' ||
      this.state === 'RECOVERY_REQUIRED'
    );
  }

  getState(): SanctuaryLockState {
    return this.state;
  }

  isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Initializes privacy manager with user preferences and lifecycle observers
   */
  async initialize(preferences?: UserPreferences): Promise<SanctuaryPrivacySnapshot> {
    if (this.isInitialized) {
      if (preferences) {
        this.updateFromPreferences(preferences);
      }
      return this.getSnapshot();
    }

    if (preferences) {
      this.updateFromPreferences(preferences);
    }

    // Query native biometric hardware capabilities
    await this.refreshBiometricCapabilities();

    // Attach lifecycle listeners
    this.unregisterBackground = lifecycleManager.registerOnBackground(this.handleBackground);
    this.unregisterForeground = lifecycleManager.registerOnForeground(this.handleForeground);

    this.isInitialized = true;
    this.notify();
    return this.getSnapshot();
  }

  /**
   * Updates lock configuration from persisted user preferences
   */
  updateFromPreferences(preferences: UserPreferences): void {
    this.isEnabled = Boolean(preferences.sanctuaryLockEnabled);
    this.autoLockIntervalMinutes =
      typeof preferences.sanctuaryAutoLockInterval === 'number'
        ? preferences.sanctuaryAutoLockInterval
        : 0;
    this.useBiometrics = preferences.useBiometrics ?? true;

    if (!this.isEnabled) {
      this.state = 'DISABLED';
      this.failedAttempts = 0;
    } else if (this.state === 'DISABLED') {
      // Cold start with lock enabled: enforce privacy before records are rendered
      this.state = 'LOCKED';
    }

    this.notify();
  }

  /**
   * Inspects native biometric sensor status and hardware availability
   */
  async refreshBiometricCapabilities(): Promise<BiometricAvailability> {
    if (!this.isNativePlatform()) {
      this.biometricAvailability = {
        isAvailable: false,
        biometryType: 'none',
        deviceIsSecure: false,
        strongBiometryIsAvailable: false,
        reason: 'Native biometrics require the installed mobile application',
      };
      this.notify();
      return this.biometricAvailability;
    }

    try {
      const result: CheckBiometryResult = await BiometricAuth.checkBiometry();
      let type: 'faceId' | 'touchId' | 'fingerprint' | 'none' = 'none';

      if (result.biometryType === BiometryType.faceId || result.biometryType === BiometryType.faceAuthentication) {
        type = 'faceId';
      } else if (result.biometryType === BiometryType.touchId) {
        type = 'touchId';
      } else if (result.biometryType === BiometryType.fingerprintAuthentication) {
        type = 'fingerprint';
      }

      this.biometricAvailability = {
        isAvailable: Boolean(result.isAvailable),
        biometryType: type,
        deviceIsSecure: Boolean(result.deviceIsSecure),
        strongBiometryIsAvailable: Boolean(result.strongBiometryIsAvailable),
        reason: result.reason || '',
      };
    } catch (err) {
      this.biometricAvailability = {
        isAvailable: false,
        biometryType: 'none',
        deviceIsSecure: false,
        strongBiometryIsAvailable: false,
        reason: err instanceof Error ? err.message : 'Biometric check failed',
      };
    }

    this.notify();
    return this.biometricAvailability;
  }

  /**
   * Requests authentication via native biometrics or system device credentials
   */
  async authenticate(reason = 'Unlock your LIFTED Sanctuary'): Promise<{ success: boolean; error?: string }> {
    if (!this.isEnabled) {
      this.state = 'DISABLED';
      this.notify();
      return { success: true };
    }

    this.state = 'AUTHENTICATING';
    this.notify();

    if (!this.isNativePlatform()) {
      // Web environment fallback: intentional session unlock action
      this.state = 'UNLOCKED';
      this.failedAttempts = 0;
      this.notify();
      this.consumePendingDeepLink();
      return { success: true };
    }

    try {
      // Authenticate using native prompt with device PIN/pattern fallback enabled
      await BiometricAuth.authenticate({
        reason,
        cancelTitle: 'Cancel',
        allowDeviceCredential: true,
        androidTitle: 'Unlock Sanctuary',
        androidSubtitle: 'Authenticate to access your private reflections',
        iosFallbackTitle: 'Use Device Passcode',
      });

      this.state = 'UNLOCKED';
      this.failedAttempts = 0;
      this.notify();
      this.consumePendingDeepLink();
      return { success: true };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isCancelled =
        errorMsg.toLowerCase().includes('cancel') ||
        errorMsg.toLowerCase().includes('usercancel') ||
        errorMsg.toLowerCase().includes('userfallback');

      if (isCancelled) {
        // User aborted the prompt: retain privacy without permanent lockout
        this.state = 'LOCKED';
      } else {
        this.failedAttempts++;
        this.state = 'AUTHENTICATION_FAILED';
      }

      this.notify();
      return { success: false, error: isCancelled ? 'cancelled' : errorMsg };
    }
  }

  /**
   * Immediately locks the Sanctuary session
   */
  lockImmediately(): void {
    if (this.isEnabled) {
      this.state = 'LOCKED';
      this.notify();
    }
  }

  /**
   * Enables Sanctuary Lock with verified authentication check
   */
  async enableLock(intervalMinutes = 0): Promise<{ success: boolean; error?: string }> {
    this.isEnabled = true;
    this.autoLockIntervalMinutes = intervalMinutes;

    // Test authentication capability immediately
    const authRes = await this.authenticate('Confirm authentication to enable Sanctuary Lock');
    if (!authRes.success && authRes.error !== 'cancelled') {
      this.isEnabled = false;
      this.state = 'DISABLED';
      this.notify();
      return { success: false, error: authRes.error || 'Authentication verification failed' };
    }

    this.state = 'UNLOCKED';
    this.notify();
    return { success: true };
  }

  /**
   * Disables Sanctuary Lock (requires authentication if currently active)
   */
  async disableLock(): Promise<{ success: boolean; error?: string }> {
    if (this.isLocked()) {
      const auth = await this.authenticate('Authenticate to disable Sanctuary Lock');
      if (!auth.success) {
        return { success: false, error: 'Authentication required to disable Sanctuary Lock' };
      }
    }

    this.isEnabled = false;
    this.state = 'DISABLED';
    this.failedAttempts = 0;
    this.notify();
    return { success: true };
  }

  /**
   * Queues an incoming notification action or deep-link until authentication succeeds
   */
  queueDeepLink(event: PendingDeepLink): boolean {
    if (!this.isLocked()) {
      return false; // Not locked, can process immediately
    }
    this.pendingDeepLink = event;
    return true; // Queued for post-authentication
  }

  getPendingDeepLink(): PendingDeepLink | null {
    return this.pendingDeepLink;
  }

  private consumePendingDeepLink(): PendingDeepLink | null {
    const link = this.pendingDeepLink;
    this.pendingDeepLink = null;
    return link;
  }

  /**
   * Handles app backgrounding: records timestamp and locks if interval is 0
   */
  private handleBackground(): void {
    if (!this.isEnabled) return;
    this.backgroundTimestamp = Date.now();

    if (this.autoLockIntervalMinutes === 0) {
      this.state = 'LOCKED';
      this.notify();
    }
  }

  /**
   * Handles app foregrounding: calculates elapsed time and locks if threshold is reached
   */
  private handleForeground(): void {
    if (!this.isEnabled) return;

    // Recheck biometric hardware availability on resume
    this.refreshBiometricCapabilities().catch(() => {});

    if (this.state === 'UNLOCKED' && this.backgroundTimestamp > 0) {
      const elapsedMs = Date.now() - this.backgroundTimestamp;
      const thresholdMs = this.autoLockIntervalMinutes * 60 * 1000;

      if (elapsedMs >= thresholdMs) {
        this.state = 'LOCKED';
        this.notify();
      }
    }
  }

  subscribe(listener: (snapshot: SanctuaryPrivacySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snap = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snap);
      } catch (err) {
        console.error('SanctuaryPrivacyManager listener error:', err);
      }
    }
  }

  /**
   * Test helper to set explicit states during automated testing
   */
  setMockStateForTesting(snapshot: Partial<SanctuaryPrivacySnapshot>): void {
    if (snapshot.state !== undefined) this.state = snapshot.state;
    if (snapshot.autoLockIntervalMinutes !== undefined) {
      this.autoLockIntervalMinutes = snapshot.autoLockIntervalMinutes;
    }
    if (snapshot.useBiometrics !== undefined) this.useBiometrics = snapshot.useBiometrics;
    if (snapshot.failedAttempts !== undefined) this.failedAttempts = snapshot.failedAttempts;
    if (snapshot.biometricAvailability !== undefined) {
      this.biometricAvailability = snapshot.biometricAvailability;
    }
    this.isEnabled = this.state !== 'DISABLED';
    this.notify();
  }

  async teardown(): Promise<void> {
    if (this.unregisterBackground) {
      this.unregisterBackground();
      this.unregisterBackground = null;
    }
    if (this.unregisterForeground) {
      this.unregisterForeground();
      this.unregisterForeground = null;
    }
    this.listeners.clear();
    this.isInitialized = false;
  }
}

export const sanctuaryPrivacyManager = new SanctuaryPrivacyManager();

/**
 * Custom React hook for live sanctuary privacy state
 */
export function useSanctuaryLock(): SanctuaryPrivacySnapshot {
  const [snapshot, setSnapshot] = useState<SanctuaryPrivacySnapshot>(() =>
    sanctuaryPrivacyManager.getSnapshot()
  );

  useEffect(() => {
    return sanctuaryPrivacyManager.subscribe(setSnapshot);
  }, []);

  return snapshot;
}
