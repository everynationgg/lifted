import React, { useState } from 'react';
import { ShieldCheck, X, Eye, EyeOff, Lock, Info, AlertTriangle, Loader2 } from 'lucide-react';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';

interface AdminLoginModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoginSuccess: (isDemoPreview?: boolean) => void;
}

export const AdminLoginModal: React.FC<AdminLoginModalProps> = ({
  isOpen,
  onClose,
  onLoginSuccess,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Please provide both staff email and password.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const result = await supabaseAuthService.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (!result.success) {
        setErrorMessage(result.error || 'Authentication failed. Please verify credentials.');
        setIsLoggingIn(false);
        return;
      }

      // Check editorial authority
      const isEditor = await supabaseAuthService.isEditor();
      const role = await supabaseAuthService.getUserRole();
      const isStaff = isEditor || role === 'admin' || role === 'moderator' || role === 'editor';

      if (!isStaff) {
        await supabaseAuthService.signOut();
        setErrorMessage(
          'PERMISSION_DENIED: Account is authenticated, but lacks editorial/administrator privileges.'
        );
        setIsLoggingIn(false);
        return;
      }

      // Success: Enter authenticated staff portal
      setIsLoggingIn(false);
      onLoginSuccess(false);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Authentication error: ${msg}`);
      setIsLoggingIn(false);
    }
  };

  const handleEnterPreview = () => {
    // Read-only UI preview demonstration mode
    onLoginSuccess(true);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '440px', padding: '24px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: '#EFF6FF',
                color: '#0284C7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <ShieldCheck size={22} />
            </div>
            <div>
              <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Staff & Admin Portal
              </h2>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                Secure Editorial Management • Supabase Auth
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '4px' }}
            aria-label="Close modal"
          >
            <X size={20} />
          </button>
        </div>

        {/* Security Notice */}
        <div
          style={{
            background: '#F0F9FF',
            border: '1px solid #BAE6FD',
            color: '#0369A1',
            padding: '10px 12px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.78rem',
            lineHeight: 1.45,
            marginBottom: '16px',
            display: 'flex',
            gap: '8px',
          }}
        >
          <Info size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>
            <strong>Verified Staff Access:</strong> Enter your authorized Every Nation / LIFTED staff credentials to manage videos, devotionals, and articles. Or explore the interface layout in Read-Only Demo mode below.
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div
            style={{
              background: '#FEF2F2',
              border: '1px solid #FECACA',
              color: '#991B1B',
              padding: '10px 12px',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.78rem',
              lineHeight: 1.4,
              marginBottom: '14px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
            }}
          >
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Staff Email Address
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cherie@lifted.app"
              disabled={isLoggingIn}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-subtle)',
                fontSize: '0.86rem',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                disabled={isLoggingIn}
                style={{
                  width: '100%',
                  padding: '9px 38px 9px 12px',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.86rem',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '4px',
                }}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px' }}>
            <button
              type="submit"
              disabled={isLoggingIn}
              className="btn-primary dark-accent"
              style={{
                width: '100%',
                fontSize: '0.86rem',
                padding: '10px 14px',
                justifyContent: 'center',
                gap: '8px',
                cursor: isLoggingIn ? 'not-allowed' : 'pointer',
                opacity: isLoggingIn ? 0.8 : 1,
              }}
            >
              {isLoggingIn ? (
                <>
                  <Loader2 size={16} className="spin" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <Lock size={16} />
                  <span>Sign In as Staff</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleEnterPreview}
              className="btn-secondary"
              style={{
                width: '100%',
                fontSize: '0.80rem',
                padding: '9px 12px',
                justifyContent: 'center',
                background: '#F8FAFC',
                border: '1px solid #E2E8F0',
                color: '#64748B',
              }}
            >
              Enter UI Preview (Read-Only Demo)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
