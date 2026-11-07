import React, { useState } from 'react';
import type { MigrationStateSnapshot } from '../storage/migration/migrationCoordinator';

interface StorageMigrationModalProps {
  snapshot: MigrationStateSnapshot;
  onConsent: () => Promise<void>;
  onDismiss: () => void;
}

export const StorageMigrationModal: React.FC<StorageMigrationModalProps> = ({
  snapshot,
  onConsent,
  onDismiss,
}) => {
  const [isMigrating, setIsMigrating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (snapshot.state === 'COMPLETED' || snapshot.state === 'NOT_STARTED' || snapshot.state === 'PREFLIGHT') {
    return null;
  }

  const handleUpgradeClick = async () => {
    setIsMigrating(true);
    setActionError(null);
    try {
      await onConsent();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Storage upgrade failed.');
    } finally {
      setIsMigrating(false);
    }
  };

  const counts = snapshot.legacyRecordCounts;
  const totalRecords =
    counts.journals +
    counts.prayers +
    counts.moods +
    (counts.hasPreferences ? 1 : 0) +
    (counts.hasHelpingHands ? 1 : 0) +
    counts.bookmarksCount;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '92%',
        maxWidth: '480px',
        zIndex: 9999,
        background: 'var(--surface-primary, #ffffff)',
        border: '1.5px solid var(--blue-accent, #0284c7)',
        borderRadius: '16px',
        boxShadow: '0 12px 32px rgba(2, 132, 199, 0.18)',
        padding: '18px 20px',
        fontFamily: 'inherit',
      }}
      role="dialog"
      aria-labelledby="migration-title"
    >
      {/* Ready for consent state */}
      {(snapshot.state === 'READY_FOR_CONSENT' || isMigrating) && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1.3rem' }} role="img" aria-label="Shield">
              🛡️
            </span>
            <h3
              id="migration-title"
              style={{
                margin: 0,
                fontSize: '1.05rem',
                fontWeight: 700,
                color: 'var(--text-primary, #0f172a)',
              }}
            >
              Secure Local Storage Upgrade
            </h3>
          </div>

          <p
            style={{
              margin: '0 0 12px 0',
              fontSize: '0.84rem',
              lineHeight: 1.45,
              color: 'var(--text-secondary, #475569)',
            }}
          >
            LIFTED now supports authenticated, hardware-backed AES-256-GCM encryption on this device.
            Upgrade your storage to secure {totalRecords} existing personal records ({counts.journals} reflections,{' '}
            {counts.prayers} prayers, {counts.moods} check-ins) locally.
          </p>

          {actionError && (
            <div
              style={{
                background: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '8px',
                padding: '8px 12px',
                fontSize: '0.78rem',
                color: '#dc2626',
                marginBottom: '12px',
              }}
            >
              {actionError}
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onDismiss}
              disabled={isMigrating}
              style={{
                padding: '8px 14px',
                fontSize: '0.82rem',
                fontWeight: 600,
                borderRadius: '8px',
                border: '1px solid var(--border-subtle, #cbd5e1)',
                background: 'transparent',
                color: 'var(--text-secondary, #64748b)',
                cursor: isMigrating ? 'not-allowed' : 'pointer',
              }}
            >
              Remind Me Later
            </button>
            <button
              type="button"
              onClick={handleUpgradeClick}
              disabled={isMigrating}
              style={{
                padding: '8px 16px',
                fontSize: '0.82rem',
                fontWeight: 700,
                borderRadius: '8px',
                border: 'none',
                background: 'var(--blue-accent, #0284c7)',
                color: '#ffffff',
                cursor: isMigrating ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              {isMigrating ? 'Encrypting & Verifying...' : 'Upgrade Now'}
            </button>
          </div>
        </div>
      )}

      {/* Recoverable failure state */}
      {snapshot.state === 'FAILED_RECOVERABLE' && !isMigrating && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>⚠️</span>
            <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#dc2626' }}>
              Storage Upgrade Incomplete
            </h4>
          </div>
          <p style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: '#475569' }}>
            {snapshot.errorMessage || 'An error occurred during verification.'} Your existing records remain safely preserved in standard storage.
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onDismiss}
              style={{
                padding: '6px 12px',
                fontSize: '0.8rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={handleUpgradeClick}
              style={{
                padding: '6px 14px',
                fontSize: '0.8rem',
                fontWeight: 600,
                borderRadius: '6px',
                border: 'none',
                background: '#0284c7',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Blocked state */}
      {snapshot.state === 'BLOCKED' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>🔒</span>
            <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 700, color: '#b91c1c' }}>
              Encrypted Vault Unavailable
            </h4>
          </div>
          <p style={{ margin: '0 0 10px 0', fontSize: '0.82rem', color: '#475569' }}>
            {snapshot.errorMessage || 'Hardware cryptographic key is unavailable on this device.'}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={onDismiss}
              style={{
                padding: '6px 12px',
                fontSize: '0.8rem',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                background: 'transparent',
                cursor: 'pointer',
              }}
            >
              Acknowledge
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
