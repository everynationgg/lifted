import React from 'react';
import { Home, Compass, HeartHandshake, User, Lock } from 'lucide-react';

export type PrimaryTabId = 'home' | 'discover' | 'support' | 'journey';

interface NavigationProps {
  activeTab: PrimaryTabId;
  onSelectTab: (tab: PrimaryTabId) => void;
  isUnlocked?: boolean;
  onLockedTabAttempt?: (tab: PrimaryTabId) => void;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  isUnlocked = true,
  onLockedTabAttempt,
}) => {
  const handleTabClick = (tab: PrimaryTabId) => {
    if (tab !== 'home' && !isUnlocked) {
      onLockedTabAttempt?.(tab);
      return;
    }
    onSelectTab(tab);
  };

  return (
    <nav className="bottom-nav-dock" aria-label="Main Navigation">
      <button
        id="nav-tab-home"
        className={`nav-item-btn ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => handleTabClick('home')}
        aria-selected={activeTab === 'home'}
        role="tab"
      >
        <Home size={20} />
        <span>Home</span>
      </button>

      <button
        id="nav-tab-discover"
        className={`nav-item-btn ${activeTab === 'discover' ? 'active' : ''}`}
        onClick={() => handleTabClick('discover')}
        aria-selected={activeTab === 'discover'}
        aria-disabled={!isUnlocked}
        style={!isUnlocked ? { opacity: 0.45 } : undefined}
        role="tab"
      >
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <Compass size={20} />
          {!isUnlocked && (
            <Lock size={10} style={{ position: 'absolute', top: -3, right: -6 }} />
          )}
        </div>
        <span>Discover</span>
      </button>

      <button
        id="nav-tab-support"
        className={`nav-item-btn ${activeTab === 'support' ? 'active' : ''}`}
        onClick={() => handleTabClick('support')}
        aria-selected={activeTab === 'support'}
        aria-disabled={!isUnlocked}
        style={!isUnlocked ? { opacity: 0.45 } : undefined}
        role="tab"
      >
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <HeartHandshake size={20} />
          {!isUnlocked && (
            <Lock size={10} style={{ position: 'absolute', top: -3, right: -6 }} />
          )}
        </div>
        <span>Support</span>
      </button>

      <button
        id="nav-tab-journey"
        className={`nav-item-btn ${activeTab === 'journey' ? 'active' : ''}`}
        onClick={() => handleTabClick('journey')}
        aria-selected={activeTab === 'journey'}
        aria-disabled={!isUnlocked}
        style={!isUnlocked ? { opacity: 0.45 } : undefined}
        role="tab"
      >
        <div style={{ position: 'relative', display: 'inline-flex' }}>
          <User size={20} />
          {!isUnlocked && (
            <Lock size={10} style={{ position: 'absolute', top: -3, right: -6 }} />
          )}
        </div>
        <span>My Journey</span>
      </button>
    </nav>
  );
};
