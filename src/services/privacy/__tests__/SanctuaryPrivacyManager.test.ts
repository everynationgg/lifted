import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SanctuaryPrivacyManager,
} from '../SanctuaryPrivacyManager';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { Capacitor } from '@capacitor/core';
import type { UserPreferences } from '../../../types';
import { DataExportService } from '../../dataExportService';
import type { VaultManager } from '../../../storage/vaultManager';

// Mock Capacitor plugins
vi.mock('@aparajita/capacitor-biometric-auth', () => ({
  BiometricAuth: {
    checkBiometry: vi.fn(),
    authenticate: vi.fn(),
  },
  BiometryType: {
    none: 0,
    touchId: 1,
    faceId: 2,
    fingerprintAuthentication: 3,
    faceAuthentication: 4,
    irisAuthentication: 5,
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn(),
  },
}));

describe('SanctuaryPrivacyManager - Section 4, 5, 7, 8, 9, 10', () => {
  let manager: SanctuaryPrivacyManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

    vi.mocked(BiometricAuth.checkBiometry).mockResolvedValue({
      isAvailable: true,
      biometryType: BiometryType.fingerprintAuthentication,
      biometryTypes: [BiometryType.fingerprintAuthentication],
      deviceIsSecure: true,
      strongBiometryIsAvailable: true,
      reason: '',
      code: '' as unknown as never,
    });

    vi.mocked(BiometricAuth.authenticate).mockResolvedValue();

    manager = new SanctuaryPrivacyManager();
  });

  afterEach(async () => {
    await manager.teardown();
    vi.restoreAllMocks();
  });

  describe('Section 3 & 4: Initial Opt-in State & Cold-Start Privacy', () => {
    it('defaults to DISABLED and isLocked is false for new users (Default: OFF)', async () => {
      const snap = await manager.initialize({
        name: 'Test User',
        sanctuaryLockEnabled: false,
        prayerFollowUpReminders: false,
        dailyDevotionalReminders: false,
        notificationsEnabled: false,
        language: 'en',
        currency: 'USD',
      });

      expect(snap.state).toBe('DISABLED');
      expect(snap.isLocked).toBe(false);
      expect(manager.isLocked()).toBe(false);
    });

    it('enforces cold-start privacy: sets state to LOCKED immediately on app launch when enabled', async () => {
      const prefs: UserPreferences = {
        name: 'Protected User',
        sanctuaryLockEnabled: true,
        sanctuaryAutoLockInterval: 0,
        prayerFollowUpReminders: false,
        dailyDevotionalReminders: false,
        notificationsEnabled: false,
        language: 'en',
        currency: 'USD',
      };

      const snap = await manager.initialize(prefs);

      // Must be LOCKED immediately before any decrypted records can flash in the UI
      expect(snap.state).toBe('LOCKED');
      expect(snap.isLocked).toBe(true);
      expect(manager.isLocked()).toBe(true);
    });
  });

  describe('Section 5: Native Biometric Authentication & Device Credential Fallback', () => {
    it('detects native biometric sensor status and maps fingerprint biometry', async () => {
      await manager.initialize();
      const capabilities = await manager.refreshBiometricCapabilities();

      expect(capabilities.isAvailable).toBe(true);
      expect(capabilities.biometryType).toBe('fingerprint');
      expect(capabilities.deviceIsSecure).toBe(true);
    });

    it('distinguishes iOS Face ID biometry accurately', async () => {
      vi.mocked(BiometricAuth.checkBiometry).mockResolvedValueOnce({
        isAvailable: true,
        biometryType: BiometryType.faceId,
        biometryTypes: [BiometryType.faceId],
        deviceIsSecure: true,
        strongBiometryIsAvailable: true,
        reason: '',
        code: '' as unknown as never,
      });

      const capabilities = await manager.refreshBiometricCapabilities();
      expect(capabilities.biometryType).toBe('faceId');
      expect(capabilities.isAvailable).toBe(true);
    });

    it('reports native biometrics as unavailable on web without simulating fake security', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      const capabilities = await manager.refreshBiometricCapabilities();
      expect(capabilities.isAvailable).toBe(false);
      expect(capabilities.biometryType).toBe('none');
      expect(capabilities.reason).toContain('mobile application');
    });

    it('invokes native authenticate with allowDeviceCredential: true for fallback recovery', async () => {
      await manager.initialize({
        name: 'Test',
        sanctuaryLockEnabled: true,
        prayerFollowUpReminders: false,
        dailyDevotionalReminders: false,
        notificationsEnabled: false,
        language: 'en',
        currency: 'USD',
      });

      const res = await manager.authenticate('Unlock Sanctuary');
      expect(res.success).toBe(true);
      expect(manager.getState()).toBe('UNLOCKED');

      expect(BiometricAuth.authenticate).toHaveBeenCalledWith(
        expect.objectContaining({
          allowDeviceCredential: true,
          cancelTitle: 'Cancel',
          androidTitle: 'Unlock Sanctuary',
          iosFallbackTitle: 'Use Device Passcode',
        })
      );
    });

    it('handles user cancellation gracefully without permanent lockout', async () => {
      vi.mocked(BiometricAuth.authenticate).mockRejectedValueOnce(new Error('User cancelled'));

      manager.setMockStateForTesting({ state: 'LOCKED' });
      const res = await manager.authenticate();

      expect(res.success).toBe(false);
      expect(res.error).toBe('cancelled');
      // Remains LOCKED for privacy, but user can retry
      expect(manager.getState()).toBe('LOCKED');
      expect(manager.getSnapshot().failedAttempts).toBe(0);
    });

    it('tracks authentication failure when biometric verification is rejected', async () => {
      vi.mocked(BiometricAuth.authenticate).mockRejectedValueOnce(new Error('Biometric not recognized'));

      manager.setMockStateForTesting({ state: 'LOCKED' });
      const res = await manager.authenticate();

      expect(res.success).toBe(false);
      expect(manager.getState()).toBe('AUTHENTICATION_FAILED');
      expect(manager.getSnapshot().failedAttempts).toBe(1);
    });
  });

  describe('Section 7: Sanctuary Privacy Settings & Disabling Protections', () => {
    it('enables Sanctuary Lock with immediate authentication verification', async () => {
      const res = await manager.enableLock(1);
      expect(res.success).toBe(true);
      expect(manager.getState()).toBe('UNLOCKED');
      expect(manager.getSnapshot().autoLockIntervalMinutes).toBe(1);
    });

    it('requires successful authentication before disabling Sanctuary Lock when active', async () => {
      manager.setMockStateForTesting({ state: 'LOCKED' });

      // When authentication fails, lock cannot be disabled
      vi.mocked(BiometricAuth.authenticate).mockRejectedValueOnce(new Error('Auth failed'));
      const failRes = await manager.disableLock();
      expect(failRes.success).toBe(false);
      expect(manager.isLocked()).toBe(true);

      // When authentication succeeds, lock is disabled
      vi.mocked(BiometricAuth.authenticate).mockResolvedValueOnce();
      const successRes = await manager.disableLock();
      expect(successRes.success).toBe(true);
      expect(manager.getState()).toBe('DISABLED');
    });

    it('allows immediate manual lock via lockImmediately()', () => {
      manager.setMockStateForTesting({ state: 'UNLOCKED' });
      manager.lockImmediately();
      expect(manager.getState()).toBe('LOCKED');
    });
  });

  describe('Section 9: Lifecycle Timing & Elapsed Auto-Lock Intervals', () => {
    it('locks immediately on background when autoLockInterval is 0', () => {
      manager.setMockStateForTesting({
        state: 'UNLOCKED',
        autoLockIntervalMinutes: 0,
      });

      // @ts-expect-error accessing private handler for lifecycle test
      manager.handleBackground();
      expect(manager.getState()).toBe('LOCKED');
    });

    it('does NOT lock immediately on background when autoLockInterval is 5 minutes', () => {
      manager.setMockStateForTesting({
        state: 'UNLOCKED',
        autoLockIntervalMinutes: 5,
      });

      // @ts-expect-error accessing private handler for lifecycle test
      manager.handleBackground();
      expect(manager.getState()).toBe('UNLOCKED');
    });

    it('locks upon foreground resume if elapsed background time exceeds the interval', () => {
      manager.setMockStateForTesting({
        state: 'UNLOCKED',
        autoLockIntervalMinutes: 5,
      });

      const now = Date.now();
      // Simulate backgrounding 6 minutes ago (6 * 60 * 1000 = 360,000ms > 300,000ms threshold)
      // @ts-expect-error accessing private property for elapsed time test
      manager.backgroundTimestamp = now - 6 * 60 * 1000;

      // @ts-expect-error accessing private handler for lifecycle test
      manager.handleForeground();
      expect(manager.getState()).toBe('LOCKED');
    });

    it('remains UNLOCKED upon foreground resume if elapsed background time is within interval', () => {
      manager.setMockStateForTesting({
        state: 'UNLOCKED',
        autoLockIntervalMinutes: 5,
      });

      const now = Date.now();
      // Simulate backgrounding 2 minutes ago (< 5 minute threshold)
      // @ts-expect-error accessing private property for elapsed time test
      manager.backgroundTimestamp = now - 2 * 60 * 1000;

      // @ts-expect-error accessing private handler for lifecycle test
      manager.handleForeground();
      expect(manager.getState()).toBe('UNLOCKED');
    });
  });

  describe('Section 10: Deep-Link Queuing & Personal Data Export Protection', () => {
    it('queues notification deep links while locked and does not expose destination before unlock', () => {
      manager.setMockStateForTesting({ state: 'LOCKED' });

      const wasQueued = manager.queueDeepLink({
        type: 'prayer_followup',
        prayerId: 'prayer-sensitive-77',
        timestamp: Date.now(),
      });

      expect(wasQueued).toBe(true);
      expect(manager.getPendingDeepLink()?.prayerId).toBe('prayer-sensitive-77');
    });

    it('blocks plaintext personal data export while Sanctuary Lock is active', async () => {
      manager.setMockStateForTesting({ state: 'LOCKED' });

      const mockVault = {
        isReady: () => true,
        initialize: vi.fn(),
      } as unknown as VaultManager;

      const exportService = new DataExportService(mockVault, manager);

      await expect(exportService.generateExportPayload()).rejects.toThrow(
        'Sanctuary Lock is active. Please authenticate before exporting personal data.'
      );
    });

    it('allows personal data export when Sanctuary Lock is UNLOCKED', async () => {
      manager.setMockStateForTesting({ state: 'UNLOCKED' });

      const mockVault = {
        isReady: () => true,
        initialize: vi.fn(),
        journals: { getAll: vi.fn().mockResolvedValue([]) },
        prayers: { getAll: vi.fn().mockResolvedValue([]) },
        moods: { getAll: vi.fn().mockResolvedValue([]) },
        getUserPreferences: vi.fn().mockResolvedValue(null),
      } as unknown as VaultManager;

      const exportService = new DataExportService(mockVault, manager);
      const payload = await exportService.generateExportPayload();

      expect(payload).toBeDefined();
      expect(payload.summary.journalCount).toBe(0);
    });
  });
});
