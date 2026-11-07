import {
  LocalNotifications,
  type PermissionStatus,
  type ActionPerformed,
  type PendingResult,
} from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import type { UserPreferences, PrayerRequest } from '../types';
import type { IDatabaseDriver } from '../storage/databaseDriver';
import { lifecycleManager } from './lifecycleManager';

export const DAILY_CHECKIN_NOTIFICATION_ID = 1001;
export const DEV_TEST_NOTIFICATION_ID = 9999;
export const PRAYER_NOTIFICATION_MIN_ID = 20000;
export const PRAYER_NOTIFICATION_MAX_ID = 2147483647;

export const DAILY_CHANNEL_ID = 'lifted_daily_reminders';
export const PRAYER_CHANNEL_ID = 'lifted_prayer_reminders';
export const STORAGE_METADATA_KEY = 'prayer_notification_mappings';

export type NotificationPermissionState = 'granted' | 'denied' | 'prompt' | 'unavailable';

export interface PrayerNotificationMapping {
  prayerId: string;
  notificationId: number;
  scheduledForTimestamp: number;
  createdAtTimestamp: number;
}

export interface NotificationScheduleResult {
  success: boolean;
  error?: 'permission_denied' | 'unsupported_platform' | 'past_date' | 'schedule_failed';
  notificationId?: number;
  scheduledTime?: number;
}

export interface ReconciliationResult {
  dailyScheduled: boolean;
  dailyCancelled: boolean;
  prayersScheduled: number;
  prayersCancelled: number;
  permissionState: NotificationPermissionState;
}

export interface NotificationActionEvent {
  type: 'daily_checkin' | 'prayer_followup';
  prayerId?: string;
  actionId?: string;
}

/**
 * Calculates 9:00 AM local time on the third calendar day following creation.
 * Local calendar arithmetic respects month/year boundaries and DST changes.
 * (e.g. Tuesday any time -> Friday 9:00 AM local device time, not 72 elapsed hours).
 */
export function calculateThirdCalendarDayFollowUp(
  createdAtTimestamp: number,
  targetHour = 9,
  targetMinute = 0
): Date {
  const created = new Date(createdAtTimestamp);
  return new Date(
    created.getFullYear(),
    created.getMonth(),
    created.getDate() + 3,
    targetHour,
    targetMinute,
    0,
    0
  );
}

/**
 * Durable, offline, privacy-first notification scheduler service for LIFTED.
 * Manages daily sanctuary check-in reminders and 3-day prayer follow-ups.
 */
export class NotificationService {
  private driver: IDatabaseDriver | null = null;
  private prayerMappings: Map<string, PrayerNotificationMapping> = new Map();
  private isInitialized = false;
  private actionListeners: Set<(event: NotificationActionEvent) => void> = new Set();
  private lastHandledActionKey: string | null = null;
  private nativeActionHandle: { remove: () => Promise<void> } | null = null;
  private unregisterForeground: (() => void) | null = null;

  /**
   * Sets the database driver for persistent notification mapping storage
   */
  setDatabaseDriver(driver: IDatabaseDriver): void {
    this.driver = driver;
  }

  /**
   * Checks whether the current runtime environment supports native scheduled alarms
   */
  isNativePlatform(): boolean {
    return Capacitor.isNativePlatform();
  }

  /**
   * Initializes notification channels, action listeners, and loads mappings
   */
  async initialize(driver?: IDatabaseDriver): Promise<void> {
    if (driver) {
      this.driver = driver;
    }

    if (this.isInitialized) {
      return;
    }

    await this.ensureNotificationChannels();
    await this.loadMappingsFromStorage();

    // Register native notification click/action listener
    if (this.isNativePlatform()) {
      try {
        this.nativeActionHandle = await LocalNotifications.addListener(
          'localNotificationActionPerformed',
          (action: ActionPerformed) => {
            this.handleNotificationAction(action);
          }
        );
      } catch (err) {
        console.warn('Could not register local notification action listener:', err);
      }
    }

    // Register foreground lifecycle callback to recheck permissions on return from settings
    this.unregisterForeground = lifecycleManager.registerOnForeground(() => {
      this.checkPermissions().catch(() => {});
    });

    this.isInitialized = true;
  }

  /**
   * Tears down notification listeners and lifecycle subscriptions
   */
  async teardown(): Promise<void> {
    if (this.nativeActionHandle) {
      await this.nativeActionHandle.remove();
      this.nativeActionHandle = null;
    }
    if (this.unregisterForeground) {
      this.unregisterForeground();
      this.unregisterForeground = null;
    }
    this.actionListeners.clear();
    this.isInitialized = false;
  }

  /**
   * Configures Android notification channels with private lock-screen visibility
   */
  async ensureNotificationChannels(): Promise<void> {
    if (!this.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return;
    }

    try {
      await LocalNotifications.createChannel({
        id: DAILY_CHANNEL_ID,
        name: 'Daily Sanctuary Check-in',
        description: 'Gentle daily check-in reminders for your healing journey',
        importance: 3, // IMPORTANCE_DEFAULT
        visibility: 0, // VISIBILITY_PRIVATE (sensitive reflection details hidden)
        vibration: true,
      });

      await LocalNotifications.createChannel({
        id: PRAYER_CHANNEL_ID,
        name: 'Prayer Follow-Ups',
        description: 'Gentle follow-up reminders to revisit your prayers',
        importance: 3,
        visibility: 0,
        vibration: true,
      });
    } catch (err) {
      console.warn('Could not create Android notification channels:', err);
    }
  }

  /**
   * Checks current OS notification permission without prompting
   */
  async checkPermissions(): Promise<NotificationPermissionState> {
    if (!this.isNativePlatform()) {
      return 'unavailable';
    }

    try {
      const status: PermissionStatus = await LocalNotifications.checkPermissions();
      if (status.display === 'granted') return 'granted';
      if (status.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Explicitly requests OS notification permission initiated by user interaction
   */
  async requestPermissions(): Promise<NotificationPermissionState> {
    if (!this.isNativePlatform()) {
      return 'unavailable';
    }

    try {
      const status: PermissionStatus = await LocalNotifications.requestPermissions();
      return status.display === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'unavailable';
    }
  }

  /**
   * Schedules or reschedules the optional Daily Sanctuary check-in reminder
   */
  async enableDailyReminders(timeStr = '08:00'): Promise<NotificationScheduleResult> {
    if (!this.isNativePlatform()) {
      return { success: false, error: 'unsupported_platform' };
    }

    const permission = await this.checkPermissions();
    if (permission !== 'granted') {
      return { success: false, error: 'permission_denied' };
    }

    const [hourStr, minuteStr] = timeStr.split(':');
    const hour = Math.min(Math.max(parseInt(hourStr, 10) || 8, 0), 23);
    const minute = Math.min(Math.max(parseInt(minuteStr, 10) || 0, 0), 59);

    try {
      // Cancel previous daily reminder to avoid duplicates
      await this.disableDailyReminders();

      await LocalNotifications.schedule({
        notifications: [
          {
            id: DAILY_CHECKIN_NOTIFICATION_ID,
            title: 'A gentle moment with LIFTED',
            body: "Your daily check-in is here whenever you're ready.",
            channelId: DAILY_CHANNEL_ID,
            // Battery & alarm policy: Explicitly inexact for gentle wellness reminders
            isExactNotification: false,
            isExactMandatory: false,
            smallIcon: 'ic_launcher_round',
            schedule: {
              on: {
                hour,
                minute,
              },
              repeats: true,
              allowWhileIdle: true,
            },
            extra: {
              type: 'daily_checkin',
              scheduledTime: timeStr,
            },
          },
        ],
      });

      return { success: true, notificationId: DAILY_CHECKIN_NOTIFICATION_ID };
    } catch (err) {
      console.error('Failed to schedule daily reminder:', err);
      return { success: false, error: 'schedule_failed' };
    }
  }

  /**
   * Cancels the scheduled Daily Sanctuary reminder
   */
  async disableDailyReminders(): Promise<void> {
    if (!this.isNativePlatform()) return;
    try {
      await LocalNotifications.cancel({
        notifications: [{ id: DAILY_CHECKIN_NOTIFICATION_ID }],
      });
    } catch (err) {
      console.warn('Failed to cancel daily reminder:', err);
    }
  }

  /**
   * Updates the scheduled time for the daily reminder if active
   */
  async updateDailyReminderTime(timeStr: string): Promise<NotificationScheduleResult> {
    return this.enableDailyReminders(timeStr);
  }

  /**
   * Schedules a gentle 3-day prayer follow-up reminder for a durably saved prayer
   */
  async schedulePrayerFollowUp(
    prayerId: string,
    createdAtTimestamp: number
  ): Promise<NotificationScheduleResult> {
    if (!this.isNativePlatform()) {
      return { success: false, error: 'unsupported_platform' };
    }

    const permission = await this.checkPermissions();
    if (permission !== 'granted') {
      return { success: false, error: 'permission_denied' };
    }

    const targetDate = calculateThirdCalendarDayFollowUp(createdAtTimestamp);
    if (targetDate.getTime() <= Date.now()) {
      // Third calendar day has already elapsed
      return { success: false, error: 'past_date' };
    }

    try {
      const notificationId = await this.allocateNotificationId(prayerId);

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notificationId,
            title: 'A gentle prayer check-in',
            body: 'Would you like to revisit your prayer today?',
            channelId: PRAYER_CHANNEL_ID,
            // Inexact battery-conscious scheduling
            isExactNotification: false,
            isExactMandatory: false,
            smallIcon: 'ic_launcher_round',
            schedule: {
              at: targetDate,
              allowWhileIdle: true,
            },
            extra: {
              type: 'prayer_followup',
              prayerId,
            },
          },
        ],
      });

      this.prayerMappings.set(prayerId, {
        prayerId,
        notificationId,
        scheduledForTimestamp: targetDate.getTime(),
        createdAtTimestamp,
      });

      await this.persistMappingsToStorage();

      return {
        success: true,
        notificationId,
        scheduledTime: targetDate.getTime(),
      };
    } catch (err) {
      console.error('Failed to schedule prayer follow-up:', err);
      return { success: false, error: 'schedule_failed' };
    }
  }

  /**
   * Cancels a pending prayer follow-up reminder and removes its mapping
   */
  async cancelPrayerFollowUp(prayerId: string): Promise<void> {
    const mapping = this.prayerMappings.get(prayerId);
    if (mapping) {
      if (this.isNativePlatform()) {
        try {
          await LocalNotifications.cancel({
            notifications: [{ id: mapping.notificationId }],
          });
        } catch (err) {
          console.warn(`Failed to cancel notification ${mapping.notificationId}:`, err);
        }
      }
      this.prayerMappings.delete(prayerId);
      await this.persistMappingsToStorage();
    }
  }

  /**
   * Cancels all pending prayer follow-up notifications and clears mappings
   */
  async cancelAllPrayerFollowUps(): Promise<void> {
    if (this.prayerMappings.size === 0) return;

    if (this.isNativePlatform()) {
      const idsToCancel = Array.from(this.prayerMappings.values()).map((m) => ({
        id: m.notificationId,
      }));
      try {
        await LocalNotifications.cancel({ notifications: idsToCancel });
      } catch (err) {
        console.warn('Failed to batch cancel prayer notifications:', err);
      }
    }

    this.prayerMappings.clear();
    await this.persistMappingsToStorage();
  }

  /**
   * Reconciles persisted reminder intent with pending OS notifications
   */
  async reconcileSchedules(
    preferences: UserPreferences,
    activePrayers: PrayerRequest[] = []
  ): Promise<ReconciliationResult> {
    const result: ReconciliationResult = {
      dailyScheduled: false,
      dailyCancelled: false,
      prayersScheduled: 0,
      prayersCancelled: 0,
      permissionState: await this.checkPermissions(),
    };

    if (!this.isNativePlatform() || result.permissionState !== 'granted') {
      if (this.isNativePlatform() && result.permissionState === 'denied') {
        // If permission was revoked at the OS level, cancel all pending reminders
        await this.disableDailyReminders();
        await this.cancelAllPrayerFollowUps();
      }
      return result;
    }

    const pendingResult = await this.getPendingNotifications();
    const pendingIds = new Set(pendingResult.notifications.map((n) => n.id));

    // 1. Reconcile Daily Sanctuary Check-in
    const hasDailyPending = pendingIds.has(DAILY_CHECKIN_NOTIFICATION_ID);
    if (preferences.dailyDevotionalReminders) {
      const targetTime = preferences.dailyReminderTime || '08:00';
      const dailyPending = pendingResult.notifications.find((n) => n.id === DAILY_CHECKIN_NOTIFICATION_ID);
      const isTimeMismatch = dailyPending?.extra?.scheduledTime !== targetTime;

      if (!hasDailyPending || isTimeMismatch) {
        const scheduleRes = await this.enableDailyReminders(targetTime);
        if (scheduleRes.success) result.dailyScheduled = true;
      }
    } else if (hasDailyPending) {
      await this.disableDailyReminders();
      result.dailyCancelled = true;
    }

    // 2. Reconcile 3-Day Prayer Follow-ups
    if (!preferences.prayerFollowUpReminders) {
      if (this.prayerMappings.size > 0 || pendingResult.notifications.some((n) => n.id >= PRAYER_NOTIFICATION_MIN_ID)) {
        await this.cancelAllPrayerFollowUps();
        result.prayersCancelled = this.prayerMappings.size;
      }
    } else {
      const activePrayerMap = new Map<string, PrayerRequest>();
      for (const p of activePrayers) {
        activePrayerMap.set(p.id, p);
      }

      // Prune mappings for prayers that were answered, deleted, or disabled
      const mappingsToRemove: string[] = [];
      for (const [pId] of this.prayerMappings.entries()) {
        const prayer = activePrayerMap.get(pId);
        if (!prayer || prayer.isAnswered || prayer.followUpStatus === 'answered' || prayer.remindersEnabled === false) {
          mappingsToRemove.push(pId);
        }
      }

      for (const pId of mappingsToRemove) {
        await this.cancelPrayerFollowUp(pId);
        result.prayersCancelled++;
      }

      // Schedule follow-ups for active prayers that are not yet pending
      for (const prayer of activePrayers) {
        if (
          !prayer.isAnswered &&
          prayer.followUpStatus !== 'answered' &&
          prayer.remindersEnabled !== false
        ) {
          const mapping = this.prayerMappings.get(prayer.id);
          const isPending = mapping ? pendingIds.has(mapping.notificationId) : false;

          if (!isPending) {
            const sched = await this.schedulePrayerFollowUp(prayer.id, prayer.createdAtTimestamp);
            if (sched.success) {
              result.prayersScheduled++;
            }
          }
        }
      }
    }

    return result;
  }

  /**
   * Queries pending local notifications scheduled in the OS
   */
  async getPendingNotifications(): Promise<PendingResult> {
    if (!this.isNativePlatform()) {
      return { notifications: [] };
    }
    try {
      return await LocalNotifications.getPending();
    } catch {
      return { notifications: [] };
    }
  }

  /**
   * Subscribes to notification click/action events
   */
  onNotificationAction(listener: (event: NotificationActionEvent) => void): () => void {
    this.actionListeners.add(listener);
    return () => {
      this.actionListeners.delete(listener);
    };
  }

  /**
   * Handles local notification action events and dispatches to registered listeners
   */
  private handleNotificationAction(action: ActionPerformed): void {
    const extra = action.notification.extra;
    const type = extra?.type;
    const actionKey = `${action.notification.id}_${action.actionId || 'tap'}_${Date.now()}`;

    // Prevent duplicate processing of the same action event
    if (this.lastHandledActionKey === actionKey) return;
    this.lastHandledActionKey = actionKey;

    if (type === 'daily_checkin') {
      this.dispatchActionEvent({ type: 'daily_checkin', actionId: action.actionId });
    } else if (type === 'prayer_followup') {
      this.dispatchActionEvent({
        type: 'prayer_followup',
        prayerId: extra?.prayerId,
        actionId: action.actionId,
      });
    }
  }

  private dispatchActionEvent(event: NotificationActionEvent): void {
    for (const listener of this.actionListeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('Error handling notification action:', err);
      }
    }
  }

  /**
   * Allocates a deterministic, collision-free notification ID for a prayer
   */
  private async allocateNotificationId(prayerId: string): Promise<number> {
    const existing = this.prayerMappings.get(prayerId);
    if (existing) {
      return existing.notificationId;
    }

    const assignedIds = new Set<number>();
    for (const mapping of this.prayerMappings.values()) {
      assignedIds.add(mapping.notificationId);
    }

    if (this.isNativePlatform()) {
      const pending = await this.getPendingNotifications();
      for (const notif of pending.notifications) {
        assignedIds.add(notif.id);
      }
    }

    let candidate = PRAYER_NOTIFICATION_MIN_ID;
    while (assignedIds.has(candidate) && candidate < PRAYER_NOTIFICATION_MAX_ID) {
      candidate++;
    }

    return candidate;
  }

  /**
   * Loads prayer-to-notification mappings from encrypted database metadata
   */
  async loadMappingsFromStorage(): Promise<void> {
    if (!this.driver) return;
    try {
      const raw = await this.driver.getMetadata(STORAGE_METADATA_KEY);
      if (raw) {
        const parsed: PrayerNotificationMapping[] = JSON.parse(raw);
        this.prayerMappings.clear();
        for (const m of parsed) {
          this.prayerMappings.set(m.prayerId, m);
        }
      }
    } catch (err) {
      console.warn('Failed to load prayer notification mappings:', err);
    }
  }

  /**
   * Persists prayer-to-notification mappings to database metadata
   */
  private async persistMappingsToStorage(): Promise<void> {
    if (!this.driver) return;
    try {
      const list = Array.from(this.prayerMappings.values());
      await this.driver.setMetadata(STORAGE_METADATA_KEY, JSON.stringify(list));
    } catch (err) {
      console.warn('Failed to persist prayer notification mappings:', err);
    }
  }

  /**
   * Read-only getter for current prayer mappings (used in tests and verification)
   */
  getPrayerMappings(): Map<string, PrayerNotificationMapping> {
    return new Map(this.prayerMappings);
  }

  /**
   * Development-only helper for live emulator notification verification.
   * Schedules an isolated test notification 5 seconds in the future.
   */
  async scheduleDevelopmentTestNotification(delaySeconds = 5): Promise<NotificationScheduleResult> {
    if (!this.isNativePlatform()) {
      return { success: false, error: 'unsupported_platform' };
    }

    const permission = await this.checkPermissions();
    if (permission !== 'granted') {
      return { success: false, error: 'permission_denied' };
    }

    try {
      const at = new Date(Date.now() + delaySeconds * 1000);
      await LocalNotifications.schedule({
        notifications: [
          {
            id: DEV_TEST_NOTIFICATION_ID,
            title: 'LIFTED Test Reminder',
            body: 'Development test notification delivered successfully.',
            channelId: DAILY_CHANNEL_ID,
            isExactNotification: false,
            isExactMandatory: false,
            smallIcon: 'ic_launcher_round',
            schedule: {
              at,
              allowWhileIdle: true,
            },
            extra: {
              type: 'daily_checkin',
              isDevTest: true,
            },
          },
        ],
      });

      return { success: true, notificationId: DEV_TEST_NOTIFICATION_ID, scheduledTime: at.getTime() };
    } catch {
      return { success: false, error: 'schedule_failed' };
    }
  }
}

export const notificationService = new NotificationService();
