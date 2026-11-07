import React from 'react';
import { Lock, Fingerprint, Shield, AlertCircle, RefreshCw } from 'lucide-react';
import {
  sanctuaryPrivacyManager,
  useSanctuaryLock,
} from '../services/privacy/SanctuaryPrivacyManager';

interface SanctuaryLockScreenProps {
  onUnlockSuccess?: () => void;
}

export const SanctuaryLockScreen: React.FC<SanctuaryLockScreenProps> = ({ onUnlockSuccess }) => {
  const privacy = useSanctuaryLock();

  const handleUnlock = async () => {
    const res = await sanctuaryPrivacyManager.authenticate();
    if (res.success && onUnlockSuccess) {
      onUnlockSuccess();
    }
  };

  const isAuthenticating = privacy.state === 'AUTHENTICATING';
  const isFailed = privacy.state === 'AUTHENTICATION_FAILED';
  const biometryType = privacy.biometricAvailability.biometryType;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sanctuary Privacy Lock"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: 'linear-gradient(180deg, #E0F2FE 0%, #BAE6FD 50%, #F0F9FF 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '380px',
          background: 'rgba(255, 255, 255, 0.92)',
          backdropFilter: 'blur(12px)',
          borderRadius: '24px',
          padding: '36px 24px',
          boxShadow: '0 20px 40px -15px rgba(2, 132, 199, 0.25)',
          border: '1px solid rgba(255, 255, 255, 0.8)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
        }}
      >
        {/* Serene Sanctuary Emblem */}
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #0284C7 0%, #38BDF8 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#FFFFFF',
            boxShadow: '0 8px 20px -4px rgba(2, 132, 199, 0.4)',
          }}
        >
          <Lock size={32} />
        </div>

        <div>
          <h2
            style={{
              fontSize: '1.4rem',
              fontWeight: 700,
              color: '#0F172A',
              margin: '0 0 6px 0',
              letterSpacing: '-0.02em',
            }}
          >
            Sanctuary Protected
          </h2>
          <p
            style={{
              fontSize: '0.85rem',
              color: '#475569',
              margin: 0,
              lineHeight: 1.45,
            }}
          >
            Your prayers, journal entries, and personal reflections are protected by Sanctuary Lock.
          </p>
        </div>

        {/* Failed attempt warning */}
        {isFailed && (
          <div
            role="alert"
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '12px',
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '0.78rem',
              color: '#991B1B',
              textAlign: 'left',
            }}
          >
            <AlertCircle size={16} color="#DC2626" style={{ flexShrink: 0 }} />
            <span>Authentication unconfirmed. Please try again or use your device credentials.</span>
          </div>
        )}

        {/* Unlock Action Button */}
        <button
          type="button"
          onClick={handleUnlock}
          disabled={isAuthenticating}
          className="btn-primary"
          style={{
            width: '100%',
            padding: '14px 20px',
            borderRadius: '16px',
            fontSize: '0.92rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            cursor: isAuthenticating ? 'default' : 'pointer',
            opacity: isAuthenticating ? 0.7 : 1,
            boxShadow: '0 10px 20px -5px rgba(2, 132, 199, 0.35)',
          }}
        >
          {isAuthenticating ? (
            <>
              <RefreshCw size={18} className="animate-spin" />
              <span>Verifying...</span>
            </>
          ) : (
            <>
              <Fingerprint size={19} />
              <span>
                {biometryType === 'faceId'
                  ? 'Unlock with Face ID'
                  : biometryType === 'touchId' || biometryType === 'fingerprint'
                  ? 'Unlock with Fingerprint'
                  : 'Unlock Sanctuary'}
              </span>
            </>
          )}
        </button>

        {/* Security badge & device credential disclosure */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '0.72rem',
            color: '#64748B',
          }}
        >
          <Shield size={13} color="#0284C7" />
          <span>Device PIN or pattern supported as backup</span>
        </div>
      </div>
    </div>
  );
};
