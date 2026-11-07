/**
 * LIFTED — Safe Offline-Capable Recovery Key Enrollment Interface
 * Phase 8 Stage 2: Account Key Recovery & Verified User Possession
 *
 * Safety Invariants:
 * 1. Zero automatic generation: Secret is generated ONLY after explicit user initiation.
 * 2. Clear cryptographic explanation of DEK (device-local) vs AEK (account multi-device).
 * 3. Accurate warning: Loss of all enrolled devices + recovery code = permanent data loss.
 * 4. User-initiated printout or manual copy (NO automatic plaintext PDF generation).
 * 5. Mandatory proof-of-possession: User must re-enter the code before confirmation.
 * 6. Cryptographic verification: Validates checksum, derives wrapping key, unwraps AEK,
 *    and completes a synthetic encrypted round trip before marking setup verified.
 * 7. Separate consent: Cloud sync requires distinct opt-in toggle; sync worker is NOT called.
 * 8. Zero telemetry: Recovery code is never logged, sent to analytics, or exposed to third parties.
 */

import React, { useState } from 'react';
import { Shield, Key, Copy, Check, Printer, AlertTriangle, ArrowRight, RefreshCw, X } from 'lucide-react';
import { RecoveryKeyService } from '../sync/recoveryKeyService';
import type { WrappedAekEnvelope, AekAssociatedData } from '../sync/types';

export interface RecoveryEnrollmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId: string;
  onComplete?: (wrappedAek: WrappedAekEnvelope, syncConsent: boolean) => void;
  onEnrollmentComplete?: (wrappedAek: WrappedAekEnvelope, syncConsent: boolean) => void;
}

type Step = 'intro' | 'generate' | 'verify' | 'confirmed';

export const RecoveryEnrollmentModal: React.FC<RecoveryEnrollmentModalProps> = ({
  isOpen,
  onClose,
  userId,
  onComplete,
  onEnrollmentComplete,
}) => {
  const [step, setStep] = useState<Step>('intro');
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [rawEntropy, setRawEntropy] = useState<Uint8Array | null>(null);
  const [wrappedEnvelope, setWrappedEnvelope] = useState<WrappedAekEnvelope | null>(null);
  const [confirmationInput, setConfirmationInput] = useState('');
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [separateSyncConsent, setSeparateSyncConsent] = useState(false);

  const recoveryService = new RecoveryKeyService();

  if (!isOpen) return null;

  const handleGenerate = async () => {
    try {
      const { code, rawEntropy: entropy } = await recoveryService.generateRecoveryCode();
      const aek = await recoveryService.generateAEK();
      const salt = new Uint8Array(32);
      globalThis.crypto.getRandomValues(salt);

      const wrappingKey = await recoveryService.deriveWrappingKey(entropy, salt, 'HKDF');
      const aadData: AekAssociatedData = {
        userId,
        keyVersion: 1,
        domain: 'LIFTED-AEK',
      };

      const envelope = await recoveryService.wrapAEK(aek, wrappingKey, aadData, salt, 'HKDF-SHA256');

      setRecoveryCode(code);
      setRawEntropy(entropy);
      setWrappedEnvelope(envelope);
      setStep('generate');
    } catch {
      setVerificationError('Failed to generate cryptographic recovery key. Please try again.');
    }
  };

  const handleCopy = () => {
    if (recoveryCode) {
      navigator.clipboard.writeText(recoveryCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleVerifyPossession = async () => {
    setVerificationError(null);
    setIsVerifying(true);

    try {
      // 1. Validate recovery code checksum and normalization
      const validation = await recoveryService.validateRecoveryCode(confirmationInput);
      if (!validation.valid || !rawEntropy || !wrappedEnvelope) {
        setVerificationError(validation.error || 'Checksum validation failed. Please check the code.');
        setIsVerifying(false);
        return;
      }

      // 2. Decode user input entropy
      const decodedEntropy = recoveryService.decodeCanonicalBase32(
        confirmationInput.trim().toUpperCase().replace(/[\s-]|LIFT/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
      ).slice(0, 16);

      // Verify that user input matches the generated entropy
      const saltBinary = atob(wrappedEnvelope.salt);
      const salt = new Uint8Array(saltBinary.length);
      for (let i = 0; i < saltBinary.length; i++) salt[i] = saltBinary.charCodeAt(i);

      const userWrappingKey = await recoveryService.deriveWrappingKey(decodedEntropy, salt, 'HKDF');

      // 3. Attempt unwrapping AEK with derived key
      const unwrappedAek = await recoveryService.unwrapAEK(
        wrappedEnvelope,
        userWrappingKey,
        wrappedEnvelope.aad
      );

      // 4. Complete synthetic roundtrip verification
      const testSecret = 'LIFTED_SYNTHETIC_VERIFICATION_PROBE';
      const enc = new TextEncoder();
      const iv = new Uint8Array(12);
      globalThis.crypto.getRandomValues(iv);

      const ct = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        unwrappedAek,
        enc.encode(testSecret)
      );

      const pt = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        unwrappedAek,
        ct
      );

      const dec = new TextDecoder();
      if (dec.decode(pt) !== testSecret) {
        throw new Error('Synthetic roundtrip verification failed.');
      }

      // Verification fully succeeded!
      setStep('confirmed');
    } catch (err: unknown) {
      setVerificationError(
        err instanceof Error ? err.message : 'Cryptographic verification failed. Check the entered code.'
      );
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px',
      }}
    >
      <div
        className="powder-card"
        style={{
          width: '100%',
          maxWidth: '520px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#FFFFFF',
          borderRadius: '16px',
          padding: '24px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Shield size={22} color="#0284C7" />
            <h2 id="recovery-modal-title" style={{ fontSize: '1.15rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
              Account Key Recovery Setup
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
          >
            <X size={20} />
          </button>
        </div>

        {/* STEP 1: Introduction & Architecture Education */}
        {step === 'intro' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '0.88rem', color: '#334155', lineHeight: 1.5 }}>
              LIFTED uses <strong>zero-knowledge end-to-end encryption</strong>. To enable optional encrypted backup or sync to a second device, you must set up an Account Recovery Key.
            </p>

            <div style={{ backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '10px', padding: '14px' }}>
              <h4 style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0369A1', marginBottom: '6px' }}>
                How Your Keys Work:
              </h4>
              <ul style={{ fontSize: '0.78rem', color: '#0C4A6E', margin: 0, paddingLeft: '18px', lineHeight: 1.4 }}>
                <li><strong>Device Key (DEK):</strong> Stored locally on this phone. Protects your offline vault.</li>
                <li><strong>Account Key (AEK):</strong> Used to synchronize reflections across devices without the server reading them.</li>
                <li><strong>Recovery Code:</strong> A 29-symbol secret that only YOU hold. The server never sees it.</li>
              </ul>
            </div>

            <div style={{ backgroundColor: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: '10px', padding: '14px', display: 'flex', gap: '10px' }}>
              <AlertTriangle size={20} color="#D97706" style={{ flexShrink: 0 }} />
              <p style={{ fontSize: '0.78rem', color: '#92400E', margin: 0, lineHeight: 1.4 }}>
                <strong>Zero-Knowledge Policy:</strong> If you lose all your enrolled devices AND your recovery code, your cloud-backed encrypted records are <strong>permanently unrecoverable</strong>. LIFTED and Every Nation GG administrators cannot bypass this encryption.
              </p>
            </div>

            <button
              onClick={handleGenerate}
              style={{
                marginTop: '8px',
                padding: '12px 18px',
                backgroundColor: '#0284C7',
                color: '#FFFFFF',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.9rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <Key size={18} />
              <span>Generate My Recovery Code</span>
            </button>
          </div>
        )}

        {/* STEP 2: Display & Secure Storage */}
        {step === 'generate' && recoveryCode && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ fontSize: '0.86rem', color: '#334155', lineHeight: 1.4 }}>
              Here is your 29-character cryptographic recovery code. Write it down or print it, and keep it in a secure physical location.
            </p>

            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '2px dashed #94A3B8',
                borderRadius: '10px',
                padding: '16px',
                textAlign: 'center',
                userSelect: 'all',
              }}
            >
              <code
                style={{
                  fontFamily: 'monospace',
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  color: '#0F172A',
                  letterSpacing: '1px',
                  display: 'block',
                  wordBreak: 'break-all',
                }}
              >
                {recoveryCode}
              </code>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                onClick={handleCopy}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  backgroundColor: copied ? '#DCFCE7' : '#FFFFFF',
                  color: copied ? '#15803D' : '#334155',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                <span>{copied ? 'Copied to Clipboard' : 'Copy Code'}</span>
              </button>

              <button
                onClick={handlePrint}
                style={{
                  flex: 1,
                  padding: '10px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  backgroundColor: '#FFFFFF',
                  color: '#334155',
                  fontSize: '0.82rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                <Printer size={16} />
                <span>Print Recovery Sheet</span>
              </button>
            </div>

            <div style={{ backgroundColor: '#F1F5F9', borderRadius: '8px', padding: '10px', fontSize: '0.76rem', color: '#475569' }}>
              * For safety, LIFTED never creates an automatic unencrypted PDF in your downloads folder.
            </div>

            <button
              onClick={() => setStep('verify')}
              style={{
                padding: '12px',
                backgroundColor: '#0284C7',
                color: '#FFFFFF',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.88rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <span>I Have Safely Saved My Code</span>
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {/* STEP 3: Mandatory Proof-of-Possession */}
        {step === 'verify' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '0.86rem', color: '#334155', lineHeight: 1.4 }}>
              To ensure you can restore your data if your device is lost, please type or paste your complete 29-character recovery code below.
            </p>

            <div>
              <label htmlFor="confirm-recovery-input" style={{ fontSize: '0.78rem', fontWeight: 600, color: '#475569', display: 'block', marginBottom: '6px' }}>
                Enter Recovery Code
              </label>
              <input
                id="confirm-recovery-input"
                type="text"
                placeholder="LIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXXX"
                value={confirmationInput}
                onChange={(e) => {
                  setConfirmationInput(e.target.value);
                  setVerificationError(null);
                }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: verificationError ? '2px solid #EF4444' : '1px solid #CBD5E1',
                  fontFamily: 'monospace',
                  fontSize: '0.92rem',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {verificationError && (
              <div style={{ color: '#B91C1C', fontSize: '0.78rem', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <AlertTriangle size={14} />
                <span>{verificationError}</span>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
              <button
                onClick={() => setStep('generate')}
                style={{
                  padding: '10px 14px',
                  borderRadius: '8px',
                  border: '1px solid #CBD5E1',
                  backgroundColor: '#FFFFFF',
                  color: '#475569',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Back to Code
              </button>

              <button
                onClick={handleVerifyPossession}
                disabled={isVerifying || !confirmationInput.trim()}
                style={{
                  flex: 1,
                  padding: '10px',
                  backgroundColor: isVerifying ? '#94A3B8' : '#0284C7',
                  color: '#FFFFFF',
                  borderRadius: '8px',
                  border: 'none',
                  fontWeight: 600,
                  fontSize: '0.88rem',
                  cursor: isVerifying ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                }}
              >
                {isVerifying && <RefreshCw size={14} className="spin" />}
                <span>{isVerifying ? 'Verifying Key...' : 'Verify Possession'}</span>
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: Confirmed & Explicit Consent */}
        {step === 'confirmed' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'center' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                backgroundColor: '#DCFCE7',
                color: '#16A34A',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto',
              }}
            >
              <Check size={26} />
            </div>

            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0F172A', margin: 0 }}>
              Account Key Verified Successfully
            </h3>

            <p style={{ fontSize: '0.84rem', color: '#475569', lineHeight: 1.4, margin: 0 }}>
              Your Account Encryption Key has been securely wrapped and validated with your Recovery Code.
            </p>

            <div
              style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                padding: '14px',
                textAlign: 'left',
              }}
            >
              <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  aria-label="Authorize encrypted synchronization"
                  checked={separateSyncConsent}
                  onChange={(e) => setSeparateSyncConsent(e.target.checked)}
                  style={{ marginTop: '3px' }}
                />
                <span style={{ fontSize: '0.78rem', color: '#334155', lineHeight: 1.4 }}>
                  I explicitly authorize future encrypted synchronization between my authenticated devices. I understand that live sync remains subject to connection availability.
                </span>
              </label>
            </div>

            <button
              onClick={() => {
                const cb = onComplete || onEnrollmentComplete;
                if (wrappedEnvelope && cb) {
                  cb(wrappedEnvelope, separateSyncConsent);
                }
                onClose();
              }}
              style={{
                padding: '12px',
                backgroundColor: '#0284C7',
                color: '#FFFFFF',
                borderRadius: '8px',
                border: 'none',
                fontWeight: 600,
                fontSize: '0.88rem',
                cursor: 'pointer',
              }}
            >
              Finish Setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
