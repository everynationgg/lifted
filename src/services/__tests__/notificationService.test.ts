import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  NotificationService,
  calculateThirdCalendarDayFollowUp,
  DAILY_CHECKIN_NOTIFICATION_ID,
  PRAYER_NOTIFICATION_MIN_ID,
  DAILY_CHANNEL_ID,
  PRAYER_CHANNEL_ID,
  STORAGE_METADATA_KEY,
} from '../notificationService';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { IDatabaseDriver } from '../../storage/databaseDriver';
import type { UserPreferences, PrayerRequest } from '../../types';

// Mock Capacitor plugins
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    createChannel: vi.fn(),
    schedule: vi.fn(),
    cancel: vi.fn(),
    getPending: vi.fn(),
    addListener: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn(),
  },
}));

describe('NotificationService & Local Calendar Calculations', () => {
  let service: NotificationService;
  let mockDriver: IDatabaseDriver;
  let metadataStore: Map<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    metadataStore = new Map<string, string>();

    mockDriver = {
      getMetadata: vi.fn(async (key: string) => metadataStore.get(key) || null),
      setMetadata: vi.fn(async (key: string, value: string) => {
        metadataStore.set(key, value);
      }),
    } as unknown as IDatabaseDriver;

    // Default to native platform (Android) for test suite
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

    // Default permission granted
    vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'granted' });
    vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' });
    vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [] });
    vi.mocked(LocalNotifications.schedule).mockResolvedValue({ notifications: [] });
    vi.mocked(LocalNotifications.cancel).mockResolvedValue();
    vi.mocked(LocalNotifications.addListener).mockResolvedValue({ remove: vi.fn().mockResolvedValue(undefined) });

    service = new NotificationService();
    service.setDatabaseDriver(mockDriver);
  });

  afterEach(async () => {
    await service.teardown();
    vi.restoreAllMocks();
  });

  describe('Section 5: Third-Calendar-Day Follow-Up Calculations', () => {
    it('schedules at exactly 9:00 AM on the 3rd calendar day, not 72 elapsed hours', () => {
      // Tuesday 11:45 PM (23:45)
      const tuesdayNight = new Date(2026, 9, 20, 23, 45, 0).getTime();
      const followUp = calculateThirdCalendarDayFollowUp(tuesdayNight, 9, 0);

      // Friday 9:00 AM (only ~57.25 elapsed hours, NOT 72 hours)
      expect(followUp.getFullYear()).toBe(2026);
      expect(followUp.getMonth()).toBe(9); // October
      expect(followUp.getDate()).toBe(23); // Friday (20 + 3)
      expect(followUp.getHours()).toBe(9);
      expect(followUp.getMinutes()).toBe(0);
      expect(followUp.getSeconds()).toBe(0);

      // Tuesday 1:15 AM
      const tuesdayMorning = new Date(2026, 9, 20, 1, 15, 0).getTime();
      const followUpMorning = calculateThirdCalendarDayFollowUp(tuesdayMorning, 9, 0);
      // Still Friday 9:00 AM (~79.75 elapsed hours, NOT 72 hours)
      expect(followUpMorning.getDate()).toBe(23);
      expect(followUpMorning.getHours()).toBe(9);
    });

    it('correctly handles month boundaries (Oct 30 -> Nov 2 at 9:00 AM)', () => {
      const oct30 = new Date(2026, 9, 30, 14, 0, 0).getTime();
      const target = calculateThirdCalendarDayFollowUp(oct30, 9, 0);

      expect(target.getMonth()).toBe(10); // November
      expect(target.getDate()).toBe(2);
      expect(target.getHours()).toBe(9);
      expect(target.getMinutes()).toBe(0);
    });

    it('correctly handles year boundaries (Dec 30 -> Jan 2 at 9:00 AM)', () => {
      const dec30 = new Date(2026, 11, 30, 10, 0, 0).getTime();
      const target = calculateThirdCalendarDayFollowUp(dec30, 9, 0);

      expect(target.getFullYear()).toBe(2027);
      expect(target.getMonth()).toBe(0); // January
      expect(target.getDate()).toBe(2);
      expect(target.getHours()).toBe(9);
    });

    it('correctly handles leap year transition (Feb 27, 2028 -> Mar 1, 2028)', () => {
      const leapFeb27 = new Date(2028, 1, 27, 12, 0, 0).getTime();
      const target = calculateThirdCalendarDayFollowUp(leapFeb27, 9, 0);

      // 2028 is a leap year (Feb 29 exists: 27 + 3 days = 28, 29, Mar 1)
      expect(target.getMonth()).toBe(2); // March
      expect(target.getDate()).toBe(1);
      expect(target.getHours()).toBe(9);
    });
  });

  describe('Section 3: Opt-in Consent and Permission Boundaries', () => {
    it('returns unavailable on web/PWA and does not schedule fake native alarms', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);

      const perm = await service.checkPermissions();
      expect(perm).toBe('unavailable');

      const reqPerm = await service.requestPermissions();
      expect(reqPerm).toBe('unavailable');

      const scheduleRes = await service.enableDailyReminders('08:00');
      expect(scheduleRes.success).toBe(false);
      expect(scheduleRes.error).toBe('unsupported_platform');
      expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    });

    it('rejects scheduling when OS permission is denied and provides clear status', async () => {
      vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' });

      const scheduleRes = await service.enableDailyReminders('08:00');
      expect(scheduleRes.success).toBe(false);
      expect(scheduleRes.error).toBe('permission_denied');
      expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    });

    it('requests permission only on explicit user initiation', async () => {
      vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'prompt' });
      vi.mocked(LocalNotifications.requestPermissions).mockResolvedValue({ display: 'granted' });

      const reqRes = await service.requestPermissions();
      expect(LocalNotifications.requestPermissions).toHaveBeenCalledTimes(1);
      expect(reqRes).toBe('granted');
    });
  });

  describe('Section 4: Daily Sanctuary Check-in Scheduling', () => {
    it('schedules daily recurring reminder with inexact battery-conscious policy', async () => {
      const res = await service.enableDailyReminders('08:30');
      expect(res.success).toBe(true);
      expect(res.notificationId).toBe(DAILY_CHECKIN_NOTIFICATION_ID);

      expect(LocalNotifications.schedule).toHaveBeenCalledWith({
        notifications: [
          expect.objectContaining({
            id: DAILY_CHECKIN_NOTIFICATION_ID,
            title: 'A gentle moment with LIFTED',
            body: "Your daily check-in is here whenever you're ready.",
            channelId: DAILY_CHANNEL_ID,
            isExactNotification: false,
            isExactMandatory: false,
            schedule: {
              on: { hour: 8, minute: 30 },
              repeats: true,
              allowWhileIdle: true,
            },
          }),
        ],
      });
    });

    it('cancels previous daily notification before rescheduling to prevent duplicates', async () => {
      await service.enableDailyReminders('08:00');
      expect(LocalNotifications.cancel).toHaveBeenCalledWith({
        notifications: [{ id: DAILY_CHECKIN_NOTIFICATION_ID }],
      });
    });

    it('disables daily reminder by cancelling the reserved ID in OS', async () => {
      await service.disableDailyReminders();
      expect(LocalNotifications.cancel).toHaveBeenCalledWith({
        notifications: [{ id: DAILY_CHECKIN_NOTIFICATION_ID }],
      });
    });

    it('preserves lock-screen privacy by never exposing sensitive reflection content in payload', async () => {
      await service.enableDailyReminders('09:00');
      const call = vi.mocked(LocalNotifications.schedule).mock.calls[0][0];
      const notif = call.notifications[0];

      expect(notif.title).not.toContain('Cherie');
      expect(notif.title).not.toContain('Trauma');
      expect(notif.body).not.toContain('mood');
      expect(notif.body).not.toContain('journal');
    });
  });

  describe('Section 5 & 8: Three-Day Prayer Follow-up & Persistent ID Allocation', () => {
    it('schedules prayer follow-up with unique non-colliding ID and privacy-safe content', async () => {
      const now = Date.now();
      const res = await service.schedulePrayerFollowUp('prayer-123', now);

      expect(res.success).toBe(true);
      expect(res.notificationId).toBeGreaterThanOrEqual(PRAYER_NOTIFICATION_MIN_ID);

      expect(LocalNotifications.schedule).toHaveBeenCalledWith({
        notifications: [
          expect.objectContaining({
            id: res.notificationId,
            title: 'A gentle prayer check-in',
            body: 'Would you like to revisit your prayer today?',
            channelId: PRAYER_CHANNEL_ID,
            isExactNotification: false,
            isExactMandatory: false,
            extra: {
              type: 'prayer_followup',
              prayerId: 'prayer-123',
            },
          }),
        ],
      });

      // Sensitive prayer text must NOT appear in notification payload
      const call = vi.mocked(LocalNotifications.schedule).mock.calls[0][0];
      const notif = call.notifications[0];
      expect(notif.body).not.toContain('pastoral review');
      expect(notif.body).not.toContain('Cherie');
    });

    it('is idempotent: scheduling same prayer multiple times reuses assigned ID', async () => {
      const now = Date.now();
      const first = await service.schedulePrayerFollowUp('prayer-repeat', now);
      const second = await service.schedulePrayerFollowUp('prayer-repeat', now);

      expect(first.notificationId).toBe(second.notificationId);
      expect(service.getPrayerMappings().size).toBe(1);
    });

    it('allocates distinct, sequential IDs for multiple prayers without collision', async () => {
      const now = Date.now();
      const p1 = await service.schedulePrayerFollowUp('prayer-alpha', now);
      const p2 = await service.schedulePrayerFollowUp('prayer-beta', now);

      expect(p1.notificationId).not.toBe(p2.notificationId);
      expect(p2.notificationId).toBe(p1.notificationId! + 1);
    });

    it('rejects scheduling if target date is in the past', async () => {
      // Prayer created 10 days ago
      const tenDaysAgo = Date.now() - 10 * 24 * 60 * 60 * 1000;
      const res = await service.schedulePrayerFollowUp('prayer-old', tenDaysAgo);

      expect(res.success).toBe(false);
      expect(res.error).toBe('past_date');
      expect(LocalNotifications.schedule).not.toHaveBeenCalled();
    });

    it('persists prayer notification mappings to database metadata and reloads upon restart', async () => {
      const now = Date.now();
      const p = await service.schedulePrayerFollowUp('prayer-persist', now);

      // Verify setMetadata was called
      expect(mockDriver.setMetadata).toHaveBeenCalledWith(
        STORAGE_METADATA_KEY,
        expect.stringContaining('prayer-persist')
      );

      // Simulate app restart with a fresh service instance
      const freshService = new NotificationService();
      freshService.setDatabaseDriver(mockDriver);
      await freshService.initialize();

      const restoredMappings = freshService.getPrayerMappings();
      expect(restoredMappings.has('prayer-persist')).toBe(true);
      expect(restoredMappings.get('prayer-persist')?.notificationId).toBe(p.notificationId);

      await freshService.teardown();
    });

    it('cancels pending notification and removes mapping when prayer is answered or deleted', async () => {
      const now = Date.now();
      const p = await service.schedulePrayerFollowUp('prayer-cancel', now);

      await service.cancelPrayerFollowUp('prayer-cancel');
      expect(LocalNotifications.cancel).toHaveBeenCalledWith({
        notifications: [{ id: p.notificationId }],
      });
      expect(service.getPrayerMappings().has('prayer-cancel')).toBe(false);
    });

    it('cancels all prayer notifications in batch when prayer reminders are disabled', async () => {
      const now = Date.now();
      await service.schedulePrayerFollowUp('prayer-1', now);
      await service.schedulePrayerFollowUp('prayer-2', now);

      await service.cancelAllPrayerFollowUps();
      expect(service.getPrayerMappings().size).toBe(0);
      expect(LocalNotifications.cancel).toHaveBeenCalled();
    });
  });

  describe('Section 9: Schedule Reconciliation Engine', () => {
    it('schedules daily reminder if enabled in preferences but missing from OS pending list', async () => {
      vi.mocked(LocalNotifications.getPending).mockResolvedValue({ notifications: [] });

      const prefs: UserPreferences = {
        name: 'Test',
        dailyDevotionalReminders: true,
        dailyReminderTime: '08:00',
        prayerFollowUpReminders: false,
        notificationsEnabled: true,
        language: 'en',
        currency: 'USD',
      };

      const result = await service.reconcileSchedules(prefs, []);
      expect(result.dailyScheduled).toBe(true);
      expect(LocalNotifications.schedule).toHaveBeenCalledWith(
        expect.objectContaining({
          notifications: [expect.objectContaining({ id: DAILY_CHECKIN_NOTIFICATION_ID })],
        })
      );
    });

    it('cancels daily reminder if disabled in preferences but present in OS pending list', async () => {
      vi.mocked(LocalNotifications.getPending).mockResolvedValue({
        notifications: [
          {
            id: DAILY_CHECKIN_NOTIFICATION_ID,
            title: 'Test',
            body: 'Test',
          },
        ],
      });

      const prefs: UserPreferences = {
        name: 'Test',
        dailyDevotionalReminders: false,
        prayerFollowUpReminders: false,
        notificationsEnabled: false,
        language: 'en',
        currency: 'USD',
      };

      const result = await service.reconcileSchedules(prefs, []);
      expect(result.dailyCancelled).toBe(true);
      expect(LocalNotifications.cancel).toHaveBeenCalledWith({
        notifications: [{ id: DAILY_CHECKIN_NOTIFICATION_ID }],
      });
    });

    it('cancels pending prayer follow-ups for prayers marked answered during reconciliation', async () => {
      const now = Date.now();
      await service.schedulePrayerFollowUp('prayer-active', now);

      const answeredPrayer: PrayerRequest = {
        id: 'prayer-active',
        title: 'Healing',
        body: 'Prayer body',
        visibility: 'private',
        createdAt: 'Oct 31, 2026',
        createdAtTimestamp: now,
        followUpScheduledDays: 3,
        intercessorsCount: 1,
        isPrayedByMe: true,
        followUpTriggered: false,
        followUpStatus: 'answered',
        isAnswered: true,
      };

      const prefs: UserPreferences = {
        name: 'Test',
        dailyDevotionalReminders: false,
        prayerFollowUpReminders: true,
        notificationsEnabled: true,
        language: 'en',
        currency: 'USD',
      };

      const result = await service.reconcileSchedules(prefs, [answeredPrayer]);
      expect(result.prayersCancelled).toBe(1);
      expect(service.getPrayerMappings().has('prayer-active')).toBe(false);
    });

    it('cancels all pending alarms when OS permission is revoked', async () => {
      vi.mocked(LocalNotifications.checkPermissions).mockResolvedValue({ display: 'denied' });

      const prefs: UserPreferences = {
        name: 'Test',
        dailyDevotionalReminders: true,
        prayerFollowUpReminders: true,
        notificationsEnabled: true,
        language: 'en',
        currency: 'USD',
      };

      const result = await service.reconcileSchedules(prefs, []);
      expect(result.permissionState).toBe('denied');
      expect(LocalNotifications.cancel).toHaveBeenCalledWith({
        notifications: [{ id: DAILY_CHECKIN_NOTIFICATION_ID }],
      });
    });
  });

  describe('Section 10: Notification Action Events & Navigation', () => {
    it('notifies action listeners on notification interaction without duplicate triggers', () => {
      const actions: string[] = [];
      const unsubscribe = service.onNotificationAction((event) => {
        actions.push(event.type);
      });

      // Simulate native notification click event
      // @ts-expect-error accessing private handler for testing
      service.handleNotificationAction({
        actionId: 'tap',
        notification: {
          id: DAILY_CHECKIN_NOTIFICATION_ID,
          title: 'Daily Check-in',
          body: 'Gentle check-in',
          extra: { type: 'daily_checkin' },
        },
      });

      expect(actions).toEqual(['daily_checkin']);
      unsubscribe();
    });

    it('handles prayer follow-up deep-link action with prayerId payload', () => {
      let capturedPrayerId: string | undefined;
      const unsubscribe = service.onNotificationAction((event) => {
        capturedPrayerId = event.prayerId;
      });

      // @ts-expect-error accessing private handler for testing
      service.handleNotificationAction({
        actionId: 'tap',
        notification: {
          id: 20005,
          title: 'Prayer Check-in',
          body: 'Revisit your prayer',
          extra: { type: 'prayer_followup', prayerId: 'prayer-target-99' },
        },
      });

      expect(capturedPrayerId).toBe('prayer-target-99');
      unsubscribe();
    });
  });

  describe('Section 13: Development Runtime Test Notification', () => {
    it('schedules isolated development test reminder with ID 9999 and inexact policy', async () => {
      const res = await service.scheduleDevelopmentTestNotification(5);
      expect(res.success).toBe(true);
      expect(res.notificationId).toBe(9999);

      expect(LocalNotifications.schedule).toHaveBeenCalledWith({
        notifications: [
          expect.objectContaining({
            id: 9999,
            title: 'LIFTED Test Reminder',
            body: 'Development test notification delivered successfully.',
            isExactNotification: false,
            isExactMandatory: false,
          }),
        ],
      });
    });
  });
});
