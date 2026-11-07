import React from 'react';
import { Heart, Settings, WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../services/networkService';

interface HeaderProps {
  onOpenStoreModal: () => void;
  onOpenSettingsModal: () => void;
  onNavigateHome: () => void;
  onSecretAdminTrigger?: () => void;
  showActions?: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenStoreModal,
  onOpenSettingsModal,
  onNavigateHome,
  onSecretAdminTrigger,
  showActions = true,
}) => {
  const network = useNetworkStatus();
  const [tapCount, setTapCount] = React.useState(0);
  const lastTapRef = React.useRef<number>(0);

  const handleBrandClick = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 800) {
      const next = tapCount + 1;
      setTapCount(next);
      if (next >= 5) {
        setTapCount(0);
        if (onSecretAdminTrigger) {
          onSecretAdminTrigger();
        }
        return;
      }
    } else {
      setTapCount(1);
    }
    lastTapRef.current = now;
    onNavigateHome();
  };

  return (
    <header className="top-bar">
      <div
        className="brand-badge"
        onClick={handleBrandClick}
        style={{ cursor: 'pointer' }}
        title="Go to Home"
      >
        <div className="brand-orb-icon" aria-hidden="true">
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: '#FFFFFF',
              boxShadow: '0 0 6px rgba(255, 255, 255, 0.9)',
            }}
          />
        </div>
        <div>
          <div className="brand-title">LIFTED</div>
          <div className="brand-subtitle">Faith & Healing</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {(!network.connected || network.state === 'OFFLINE') && (
          <span
            role="status"
            aria-label="Offline Mode: All reflections, prayers, and devotionals remain fully functional on device."
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '0.68rem',
              fontWeight: 600,
              color: 'var(--text-secondary, #64748b)',
              background: 'var(--bg-secondary, #f8fafc)',
              border: '1px solid var(--border-subtle, #cbd5e1)',
              padding: '3px 8px',
              borderRadius: 'var(--radius-full, 9999px)',
            }}
          >
            <WifiOff size={11} />
            <span>Offline</span>
          </span>
        )}

        {showActions && (
        <div className="header-actions-unlocked" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Secondary Navigation: Generosity & Store */}
          <button
            id="btn-open-store-modal"
            onClick={onOpenStoreModal}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--blue-light-sky)',
              color: 'var(--text-primary)',
              padding: '6px 12px',
              borderRadius: 'var(--radius-full)',
              fontSize: '0.78rem',
              fontWeight: 600,
              border: '1px solid var(--border-subtle)',
              transition: 'all 0.2s ease',
            }}
            title="Generosity & Downloadable Workbooks"
          >
            <Heart size={14} color="var(--blue-accent-dark)" fill="var(--blue-powder)" />
            <span>Giving / Store</span>
          </button>

          {/* Settings button */}
          <button
            id="btn-open-settings"
            onClick={onOpenSettingsModal}
            title="Preferences & Settings"
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              background: 'transparent',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Settings size={16} />
          </button>
        </div>
      )}
      </div>
    </header>
  );
};
