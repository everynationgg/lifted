import React from 'react';
import { Home, Compass, HeartHandshake, User } from 'lucide-react';

export type PrimaryTabId = 'home' | 'discover' | 'support' | 'journey';

interface NavigationProps {
  activeTab: PrimaryTabId;
  onSelectTab: (tab: PrimaryTabId) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ activeTab, onSelectTab }) => {
  return (
    <nav className="bottom-nav-dock" aria-label="Main Navigation">
      <button
        id="nav-tab-home"
        className={`nav-item-btn ${activeTab === 'home' ? 'active' : ''}`}
        onClick={() => onSelectTab('home')}
        aria-selected={activeTab === 'home'}
        role="tab"
      >
        <Home size={20} />
        <span>Home</span>
      </button>

      <button
        id="nav-tab-discover"
        className={`nav-item-btn ${activeTab === 'discover' ? 'active' : ''}`}
        onClick={() => onSelectTab('discover')}
        aria-selected={activeTab === 'discover'}
        role="tab"
      >
        <Compass size={20} />
        <span>Discover</span>
      </button>

      <button
        id="nav-tab-support"
        className={`nav-item-btn ${activeTab === 'support' ? 'active' : ''}`}
        onClick={() => onSelectTab('support')}
        aria-selected={activeTab === 'support'}
        role="tab"
      >
        <HeartHandshake size={20} />
        <span>Support</span>
      </button>

      <button
        id="nav-tab-journey"
        className={`nav-item-btn ${activeTab === 'journey' ? 'active' : ''}`}
        onClick={() => onSelectTab('journey')}
        aria-selected={activeTab === 'journey'}
        role="tab"
      >
        <User size={20} />
        <span>My Journey</span>
      </button>
    </nav>
  );
};
