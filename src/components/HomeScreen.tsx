import React, { useState } from 'react';
import type {
  MoodId,
  Devotional,
  ContentItem,
  DiscoverPillarId,
} from '../types';
import type { PrimaryTabId } from './Navigation';
import { HomeHeader, SanctuaryCompanionCard } from './home';

export interface HomeScreenProps {
  userName: string;
  onUpdateUserName?: (name: string) => void;
  selectedMood: MoodId | null;
  onSelectMood: (mood: MoodId | MoodId[] | null, note?: string) => void;
  onNavigateTab: (tab: PrimaryTabId) => void;
  onOpenDevotional: (devotional: Devotional) => void;
  onOpenContentItem?: (item: ContentItem) => void;
  onNavigateDiscoverPillar?: (pillar: DiscoverPillarId, topicTag?: string) => void;
  recentSavedCount?: number;
  isUnlocked?: boolean;
  onCheckInComplete?: () => void;
}

export const HomeScreen: React.FC<HomeScreenProps> = ({
  userName,
  onUpdateUserName,
  selectedMood,
  onSelectMood,
  onNavigateTab,
  onOpenDevotional,
  onOpenContentItem: _onOpenContentItem,
  onNavigateDiscoverPillar,
  recentSavedCount: _recentSavedCount = 0,
  isUnlocked: _isUnlocked = false,
  onCheckInComplete,
}) => {
  const [isConversationActive, setIsConversationActive] = useState(false);

  return (
    <div className="home-zen-wrapper" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <HomeHeader
        userName={userName}
        onUpdateUserName={onUpdateUserName}
        selectedMood={selectedMood}
        isConversationActive={isConversationActive}
      />

      <SanctuaryCompanionCard
        onSelectMood={onSelectMood}
        onNavigateTab={onNavigateTab}
        onOpenDevotional={onOpenDevotional}
        onNavigateDiscoverPillar={onNavigateDiscoverPillar}
        onCheckInComplete={onCheckInComplete}
        onConversationStateChange={setIsConversationActive}
      />
    </div>
  );
};
