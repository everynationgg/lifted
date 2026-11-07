import React from 'react';
import { ShieldCheck, Cloud, WifiOff, X, Sparkles, Lock } from 'lucide-react';

interface CloudAiConsentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmConsent: () => void;
  onDeclineConsent: () => void;
}

export const CloudAiConsentModal: React.FC<CloudAiConsentModalProps> = ({
  isOpen,
  onClose,
  onConfirmConsent,
  onDeclineConsent,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-ai-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
      }}
    >
      <div
        className="white-card"
        style={{
          width: '100%',
          maxWidth: '440px',
          maxHeight: '90vh',
          overflowY: 'auto',
          borderRadius: 'var(--radius-lg, 16px)',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          position: 'relative',
        }}
      >
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close modal"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #64748B)',
            cursor: 'pointer',
            padding: '4px',
          }}
        >
          <X size={20} />
        </button>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: '#E0F2FE',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0284C7',
            }}
          >
            <Cloud size={22} />
          </div>
          <div>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: '#0284C7',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Optional AI Privacy Gate
            </span>
            <h2
              id="cloud-ai-title"
              style={{
                fontSize: '1.15rem',
                fontWeight: 700,
                color: 'var(--text-primary, #0F172A)',
                margin: '2px 0 0 0',
              }}
            >
              Enable Cloud AI Guide
            </h2>
          </div>
        </div>

        {/* Content Body */}
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary, #334155)', lineHeight: 1.5, margin: '0 0 14px 0' }}>
          LIFTED provides an immediate, trauma-informed offline companion that never touches the internet. You can optionally enable our server-side Google Gemini gateway for dynamic conversational reflections.
        </p>

        {/* Key Guarantees */}
        <div
          style={{
            backgroundColor: '#F8FAFC',
            borderRadius: 'var(--radius-md, 10px)',
            padding: '14px',
            border: '1px solid #E2E8F0',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            marginBottom: '16px',
          }}
        >
          <div style={{ display: 'flex', gap: '10px' }}>
            <Lock size={16} color="#0284C7" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.78rem', color: '#1E293B', lineHeight: 1.4 }}>
              <strong>Zero Vault Uploads:</strong> Your encrypted journals, prayers, and mood history remain exclusively on your device and are <em>never</em> sent to Google or AI services.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <Sparkles size={16} color="#0284C7" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.78rem', color: '#1E293B', lineHeight: 1.4 }}>
              <strong>Ephemeral Guidance:</strong> Only your immediate check-in message is sent securely through our server-side gateway to generate a reflection. No conversation history is permanently retained in cloud databases.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <ShieldCheck size={16} color="#0284C7" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.78rem', color: '#1E293B', lineHeight: 1.4 }}>
              <strong>Immediate Crisis Safety:</strong> Crisis thoughts (e.g. self-harm) are intercepted on-device with verified hotlines (such as 1553/911 in the Philippines or 988/741741 in North America) before ever reaching external AI.
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <WifiOff size={16} color="#0284C7" style={{ flexShrink: 0, marginTop: '2px' }} />
            <div style={{ fontSize: '0.78rem', color: '#1E293B', lineHeight: 1.4 }}>
              <strong>Always Reversible:</strong> You can return to purely offline Sanctuary Companion at any time in one tap.
            </div>
          </div>
        </div>

        <p style={{ fontSize: '0.72rem', color: 'var(--text-muted, #64748B)', lineHeight: 1.4, margin: '0 0 18px 0' }}>
          * Provider Notice: Processing occurs via Google Gemini API (gemini-2.5-flash). Google terms specify that paid API customer content is not used to train models; abuse monitoring logs may be retained by Google for up to 30 days. Offline companion remains active when offline, signed out, or unconsented.
        </p>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={() => {
              onConfirmConsent();
              onClose();
            }}
            className="btn-primary"
            style={{
              width: '100%',
              justifyContent: 'center',
              padding: '10px 16px',
              fontSize: '0.86rem',
              fontWeight: 600,
            }}
          >
            <Cloud size={16} />
            <span>I Understand &amp; Enable Cloud AI</span>
          </button>

          <button
            onClick={() => {
              onDeclineConsent();
              onClose();
            }}
            style={{
              width: '100%',
              padding: '10px 16px',
              fontSize: '0.84rem',
              color: 'var(--text-secondary, #475569)',
              background: 'transparent',
              border: '1px solid #CBD5E1',
              borderRadius: 'var(--radius-md, 8px)',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Keep Guidance Purely Offline
          </button>
        </div>
      </div>
    </div>
  );
};
