import React, { useState, useEffect } from 'react';
import {
  Bell,
  Clock,
  Info,
  ShieldCheck,
  Lock,
  Sparkles,
  Key,
  Download,
  Trash2,
} from 'lucide-react';
import { dataExportService, type ExportSummary } from '../../services/dataExportService';
import { notificationService, type NotificationPermissionState } from '../../services/notificationService';
import {
  sanctuaryPrivacyManager,
  useSanctuaryLock,
} from '../../services/privacy/SanctuaryPrivacyManager';
import type { UserPreferences } from '../../types';

export interface JourneyPreferencesPanelProps {
  userName: string;
  onUpdateUserName: (name: string) => void;
  userPreferences: UserPreferences;
  onUpdatePreferences: (prefs: Partial<UserPreferences>) => void;
  hasRecoveryKey: boolean;
  isSyncConsentGiven: boolean;
  onOpenRecoveryModal: () => void;
  onRevokeSyncConsent: () => void;
  onClearAllData: () => void;
  onOpenAdminLogin?: () => void;
}

export const JourneyPreferencesPanel: React.FC<JourneyPreferencesPanelProps> = ({
  userName,
  onUpdateUserName,
  userPreferences,
  onUpdatePreferences,
  hasRecoveryKey,
  isSyncConsentGiven,
  onOpenRecoveryModal,
  onRevokeSyncConsent,
  onClearAllData,
  onOpenAdminLogin,
}) => {
  const [editingName, setEditingName] = useState(userName);

  // User-initiated local data export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  // Offline native notification permission tracking
  const [permissionState, setPermissionState] = useState<NotificationPermissionState>('prompt');
  const [permissionNotice, setPermissionNotice] = useState<string | null>(null);

  // Sanctuary Privacy Lock State & Handlers
  const sanctuaryLock = useSanctuaryLock();
  const [lockErrorMessage, setLockErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    notificationService.checkPermissions().then(setPermissionState).catch(() => {});
  }, []);

  const handleToggleDailyReminders = async (enabled: boolean) => {
    setPermissionNotice(null);
    if (!enabled) {
      onUpdatePreferences({ dailyDevotionalReminders: false });
      return;
    }

    if (!notificationService.isNativePlatform()) {
      onUpdatePreferences({ dailyDevotionalReminders: true });
      setPermissionNotice('Web preview: Scheduled local notifications require the native Android or iOS application.');
      return;
    }

    let perm = await notificationService.checkPermissions();
    if (perm !== 'granted') {
      perm = await notificationService.requestPermissions();
    }
    setPermissionState(perm);

    if (perm === 'granted') {
      onUpdatePreferences({ dailyDevotionalReminders: true, notificationsEnabled: true });
    } else {
      setPermissionNotice('Notifications are disabled in device settings. To receive reminders, please enable notifications in your system settings.');
      onUpdatePreferences({ dailyDevotionalReminders: false });
    }
  };

  const handleTogglePrayerReminders = async (enabled: boolean) => {
    setPermissionNotice(null);
    if (!enabled) {
      onUpdatePreferences({ prayerFollowUpReminders: false });
      return;
    }

    if (!notificationService.isNativePlatform()) {
      onUpdatePreferences({ prayerFollowUpReminders: true });
      setPermissionNotice('Web preview: Scheduled local notifications require the native Android or iOS application.');
      return;
    }

    let perm = await notificationService.checkPermissions();
    if (perm !== 'granted') {
      perm = await notificationService.requestPermissions();
    }
    setPermissionState(perm);

    if (perm === 'granted') {
      onUpdatePreferences({ prayerFollowUpReminders: true, notificationsEnabled: true });
    } else {
      setPermissionNotice('Notifications are disabled in device settings. To receive reminders, please enable notifications in your system settings.');
      onUpdatePreferences({ prayerFollowUpReminders: false });
    }
  };

  const handleToggleSanctuaryLock = async (enabled: boolean) => {
    setLockErrorMessage(null);
    if (enabled) {
      const res = await sanctuaryPrivacyManager.enableLock(userPreferences.sanctuaryAutoLockInterval ?? 0);
      if (res.success) {
        onUpdatePreferences({ sanctuaryLockEnabled: true });
      } else if (res.error !== 'cancelled') {
        setLockErrorMessage(res.error || 'Authentication required to enable Sanctuary Lock.');
      }
    } else {
      const res = await sanctuaryPrivacyManager.disableLock();
      if (res.success) {
        onUpdatePreferences({ sanctuaryLockEnabled: false });
      } else {
        setLockErrorMessage('Authentication required to disable Sanctuary Lock.');
      }
    }
  };

  const handleExportData = async () => {
    setIsExporting(true);
    setExportError(null);
    setExportSummary(null);

    try {
      const summary = await dataExportService.triggerLocalDownload();
      setExportSummary(summary);
      setTimeout(() => setExportSummary(null), 8000);
    } catch (err: unknown) {
      setExportError(err instanceof Error ? err.message : 'Unable to complete local data export.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleNameSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingName.trim()) {
      onUpdateUserName(editingName.trim());
    }
  };

  return (
    <div className="powder-card" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <h3 style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        Personal Preferences & Data Controls
      </h3>

      <form onSubmit={handleNameSave} style={{ display: 'flex', gap: '8px' }}>
        <div style={{ flex: 1 }}>
          <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
            Your Name (for personal greetings)
          </label>
          <input
            type="text"
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            placeholder="Your name"
            style={{
              width: '100%',
              padding: '7px 10px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.84rem',
              background: '#FFFFFF',
            }}
          />
        </div>
        <button
          type="submit"
          className="btn-primary"
          style={{ alignSelf: 'flex-end', fontSize: '0.78rem', padding: '7px 14px' }}
        >
          Update
        </button>
      </form>

      {/* Notification toggles */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Bell size={13} color="var(--blue-accent)" />
            <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>Offline Reminders</span>
          </div>
          <span
            style={{
              fontSize: '0.68rem',
              padding: '2px 8px',
              borderRadius: '10px',
              background:
                permissionState === 'granted'
                  ? 'rgba(16, 185, 129, 0.12)'
                  : permissionState === 'denied'
                  ? 'rgba(239, 68, 68, 0.12)'
                  : 'var(--bg-card)',
              color:
                permissionState === 'granted'
                  ? '#059669'
                  : permissionState === 'denied'
                  ? '#DC2626'
                  : 'var(--text-secondary)',
              fontWeight: 600,
              border: '1px solid var(--border-subtle)',
            }}
          >
            {permissionState === 'granted'
              ? 'OS Allowed'
              : permissionState === 'denied'
              ? 'OS Blocked'
              : permissionState === 'unavailable'
              ? 'Web Mode'
              : 'Opt-in Required'}
          </span>
        </div>

        {permissionNotice && (
          <div
            style={{
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--blue-light-sky)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '6px',
              fontSize: '0.74rem',
              color: 'var(--text-primary)',
              lineHeight: 1.35,
            }}
          >
            <Info size={14} color="var(--blue-accent)" style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{permissionNotice}</span>
          </div>
        )}

        {/* Daily Sanctuary Check-in Reminder */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-card)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <span style={{ fontWeight: 500 }}>Daily Sanctuary Check-in</span>
            <input
              type="checkbox"
              aria-label="Toggle daily sanctuary check-in reminder"
              checked={userPreferences.dailyDevotionalReminders}
              onChange={(e) => handleToggleDailyReminders(e.target.checked)}
            />
          </label>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            Gentle morning reminder for your daily check-in and Scripture reflection.
          </div>
          {userPreferences.dailyDevotionalReminders && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '4px', borderTop: '1px dashed var(--border-subtle)', marginTop: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                <Clock size={12} color="var(--blue-accent)" />
                <span>Reminder Time (Local)</span>
              </div>
              <input
                type="time"
                aria-label="Daily reminder time"
                value={userPreferences.dailyReminderTime || '08:00'}
                onChange={(e) => onUpdatePreferences({ dailyReminderTime: e.target.value })}
                style={{
                  fontSize: '0.75rem',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  background: '#FFFFFF',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          )}
        </div>

        {/* 3-Day Prayer Follow-up Reminder */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', background: 'var(--bg-card)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)' }}>
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
            <span style={{ fontWeight: 500 }}>3-Day Prayer Follow-Ups</span>
            <input
              type="checkbox"
              aria-label="Toggle 3-day prayer follow-up reminders"
              checked={userPreferences.prayerFollowUpReminders}
              onChange={(e) => handleTogglePrayerReminders(e.target.checked)}
            />
          </label>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            Automated check-in at 9:00 AM on the 3rd calendar day to revisit your prayers.
          </div>
        </div>

        {/* Lock-screen privacy badge */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.70rem', color: 'var(--text-secondary)', padding: '2px 4px' }}>
          <ShieldCheck size={12} color="var(--blue-accent)" style={{ flexShrink: 0 }} />
          <span>Reminders never show private prayer titles or reflections on your lock screen.</span>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
          <span>Sensory Haptic Trauma Grounding</span>
          <input
            type="checkbox"
            aria-label="Toggle sensory haptic trauma grounding"
            checked={userPreferences.hapticsEnabled ?? true}
            onChange={(e) => onUpdatePreferences({ hapticsEnabled: e.target.checked })}
          />
        </label>

        {/* Sanctuary Privacy Lock Settings */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            background: 'var(--bg-card)',
            padding: '10px 12px',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border-subtle)',
            marginTop: '4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Lock size={13} color="var(--blue-accent)" />
              <span style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Sanctuary Privacy Lock
              </span>
            </div>
            <input
              type="checkbox"
              aria-label="Toggle sanctuary privacy lock"
              checked={userPreferences.sanctuaryLockEnabled ?? false}
              onChange={(e) => handleToggleSanctuaryLock(e.target.checked)}
            />
          </div>

          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            Require biometric authentication (Face ID, Fingerprint, or device PIN) to access your private journals, prayers, and reflections.
          </div>

          {lockErrorMessage && (
            <div
              style={{
                padding: '6px 8px',
                borderRadius: '6px',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                fontSize: '0.72rem',
                color: '#991B1B',
              }}
            >
              {lockErrorMessage}
            </div>
          )}

          {userPreferences.sanctuaryLockEnabled && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingTop: '6px', borderTop: '1px dashed var(--border-subtle)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>Auto-Lock When Away</span>
                <select
                  aria-label="Sanctuary auto-lock interval"
                  value={userPreferences.sanctuaryAutoLockInterval ?? 0}
                  onChange={(e) => onUpdatePreferences({ sanctuaryAutoLockInterval: Number(e.target.value) })}
                  style={{
                    fontSize: '0.74rem',
                    padding: '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--border-subtle)',
                    background: '#FFFFFF',
                    color: 'var(--text-primary)',
                  }}
                >
                  <option value={0}>Immediately</option>
                  <option value={1}>After 1 minute</option>
                  <option value={5}>After 5 minutes</option>
                </select>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '2px' }}>
                <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                  {sanctuaryLock.biometricAvailability.isAvailable
                    ? `Biometrics Active (${sanctuaryLock.biometricAvailability.biometryType})`
                    : sanctuaryPrivacyManager.isNativePlatform()
                    ? 'Device PIN/Pattern Supported'
                    : 'Web Mode: Session Protection'}
                </span>
                <button
                  type="button"
                  onClick={() => sanctuaryPrivacyManager.lockImmediately()}
                  style={{
                    fontSize: '0.72rem',
                    padding: '3px 8px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--blue-light-sky)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--blue-accent-dark)',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Lock Now
                </button>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.82rem', color: 'var(--text-primary)', paddingTop: '4px' }}>
          <span>Daily Check-in State</span>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem('lifted_last_checkin_date');
              sessionStorage.removeItem('lifted_active_chat');
              sessionStorage.removeItem('lifted_active_turn');
              window.location.reload();
            }}
            style={{
              fontSize: '0.72rem',
              padding: '3px 10px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--blue-light-sky)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--blue-accent-dark)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
            title="Reset check-in state to re-experience opening check-in"
          >
            Reset Check-in (Demo)
          </button>
        </div>
      </div>

      {/* Sanctuary Companion Status */}
      <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Sparkles size={14} color="var(--blue-accent-dark)" />
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Sanctuary Companion
            </span>
          </div>
          <span
            style={{
              fontSize: '0.68rem',
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: '#E0F2FE',
              color: '#0284C7',
              fontWeight: 600,
            }}
          >
            Offline Active
          </span>
        </div>

        <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
          Offline Sanctuary Companion active. Cloud AI proxy integration planned in Phase 7.
        </p>
      </div>

      {/* Account Key Recovery & E2EE Sync Setup */}
      <div
        style={{
          paddingTop: '8px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Key size={14} color="var(--blue-accent-dark)" />
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Account Key Recovery & E2EE Sync
            </span>
          </div>
          <span
            style={{
              fontSize: '0.68rem',
              padding: '2px 8px',
              borderRadius: 'var(--radius-full)',
              background: hasRecoveryKey ? '#DCFCE7' : '#F1F5F9',
              color: hasRecoveryKey ? '#166534' : '#64748B',
              fontWeight: 600,
            }}
          >
            {hasRecoveryKey ? 'Enrolled (29-symbol AEK)' : 'Not Enrolled'}
          </span>
        </div>

        <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.4 }}>
          Your private reflections are always encrypted locally with your hardware key. Generate a zero-knowledge Account Recovery Key to prepare for cross-device encrypted synchronization.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {!hasRecoveryKey ? (
            <button
              type="button"
              id="btn-open-recovery-enrollment"
              onClick={onOpenRecoveryModal}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--blue-accent)',
                color: '#FFFFFF',
                border: 'none',
                fontSize: '0.76rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
              }}
            >
              <Key size={13} />
              Set Up Account Recovery Key
            </button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                <span>Cloud Sync Consent:</span>
                <strong style={{ color: isSyncConsentGiven ? '#166534' : '#991B1B' }}>
                  {isSyncConsentGiven ? 'Granted (Live Sync Inactive)' : 'Consent Not Granted'}
                </strong>
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  type="button"
                  id="btn-reverify-recovery-key"
                  onClick={onOpenRecoveryModal}
                  style={{
                    flex: 1,
                    padding: '5px 10px',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--blue-light-sky)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--blue-accent-dark)',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Re-verify Recovery Key
                </button>

                {isSyncConsentGiven && (
                  <button
                    type="button"
                    id="btn-revoke-sync-consent"
                    onClick={onRevokeSyncConsent}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 'var(--radius-sm)',
                      background: '#FEF2F2',
                      border: '1px solid #FECACA',
                      color: '#991B1B',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    Revoke Consent
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Local Data Export (Client-side JSON Backup) */}
      <div
        style={{
          paddingTop: '8px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Personal Data Export
            </span>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Download an unencrypted local JSON backup of your reflections and prayers.
            </p>
          </div>

          <button
            type="button"
            onClick={handleExportData}
            disabled={isExporting}
            aria-label="Download personal local data backup"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '0.76rem',
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--blue-light-sky)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--blue-accent-dark)',
              cursor: isExporting ? 'not-allowed' : 'pointer',
              opacity: isExporting ? 0.7 : 1,
              whiteSpace: 'nowrap',
            }}
          >
            <Download size={13} />
            <span>{isExporting ? 'Exporting...' : 'Export JSON'}</span>
          </button>
        </div>

        {exportSummary && (
          <div
            role="status"
            style={{
              fontSize: '0.74rem',
              color: '#15803D',
              background: '#DCFCE7',
              border: '1px solid #BBF7D0',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              marginTop: '4px',
            }}
          >
            ✓ Export complete: {exportSummary.journalCount} journal reflections, {exportSummary.prayerCount} prayers, and {exportSummary.moodCount} check-ins saved to your downloads.
          </div>
        )}

        {exportError && (
          <div
            role="alert"
            style={{
              fontSize: '0.74rem',
              color: '#B91C1C',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              marginTop: '4px',
            }}
          >
            {exportError}
          </div>
        )}
      </div>

      {/* Privacy & Local Data Reset */}
      <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.80rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Local Device Data Reset
            </span>
            <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Purges all encrypted journals, prayers, and mood history stored on this device.
            </p>
          </div>
          <button
            onClick={() => {
              if (window.confirm('Are you sure you want to reset your local journal and prayer history? This will permanently delete encrypted records stored on this device.')) {
                onClearAllData();
              }
            }}
            style={{
              fontSize: '0.76rem',
              color: 'var(--rose-text)',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontWeight: 600,
              padding: '6px 10px',
              borderRadius: 'var(--radius-sm)',
              background: '#FFF1F2',
              border: '1px solid #FFE4E6',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            <Trash2 size={13} />
            <span>Reset Local Data</span>
          </button>
        </div>
        <p style={{ fontSize: '0.70rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.3 }}>
          Note: This action clears on-device encrypted storage only. To request complete deletion of an authenticated online cloud account and server records, please submit an Account Deletion Request through the LIFTED web portal.
        </p>
      </div>

      {/* Version Info */}
      <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <span>LIFTED Application</span>
        <span style={{ fontWeight: 600, color: 'var(--blue-accent-dark)' }}>v1.0.0 (Release Build 1)</span>
      </div>

      {/* Discreet Staff / Admin Entry */}
      {onOpenAdminLogin && (
        <div style={{ paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', textAlign: 'center' }}>
          <button
            onClick={onOpenAdminLogin}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.72rem',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Lock size={11} />
            <span>Staff & Admin Portal</span>
          </button>
        </div>
      )}
    </div>
  );
};
