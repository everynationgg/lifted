import React, { useState } from 'react';
import { Sliders } from 'lucide-react';
import { RecoveryEnrollmentModal } from './RecoveryEnrollmentModal';
import { supabaseAuthService } from '../services/auth/supabaseAuthService';
import type { WrappedAekEnvelope } from '../sync/types';
import type {
  MoodCheckInRecord,
  Devotional,
  HelpingHandsModule,
  PrayerRequest,
  JournalEntry,
  UserPreferences,
  ContentItem,
} from '../types';
import {
  JourneyPreferencesPanel,
  JourneyOverviewTab,
  JourneyRecordsTabs,
} from './journey';

export interface JourneyScreenProps {
  userName: string;
  onUpdateUserName: (name: string) => void;
  moodHistory: MoodCheckInRecord[];
  savedDevotionals: Devotional[];
  savedContentItems: ContentItem[];
  helpingHandsModules: HelpingHandsModule[];
  prayerRequests: PrayerRequest[];
  journalEntries: JournalEntry[];
  userPreferences: UserPreferences;
  onUpdatePreferences: (prefs: Partial<UserPreferences>) => void;
  onOpenDevotional: (devotional: Devotional) => void;
  onOpenContentItem: (item: ContentItem) => void;
  onClearAllData: () => void;
  onOpenAdminLogin?: () => void;
}

export const JourneyScreen: React.FC<JourneyScreenProps> = ({
  userName,
  onUpdateUserName,
  moodHistory,
  savedDevotionals,
  savedContentItems,
  helpingHandsModules,
  prayerRequests,
  journalEntries,
  userPreferences,
  onUpdatePreferences,
  onOpenDevotional,
  onOpenContentItem,
  onClearAllData,
  onOpenAdminLogin,
}) => {
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'saved' | 'completed' | 'journal' | 'history'>('overview');
  const [expandedPrayerIds, setExpandedPrayerIds] = useState<string[]>([]);

  // Account Recovery Key & Sync Consent State
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [hasRecoveryKey, setHasRecoveryKey] = useState<boolean>(() => !!userPreferences.recoveryKeyEnrolled);
  const [isSyncConsentGiven, setIsSyncConsentGiven] = useState<boolean>(() => !!userPreferences.syncConsentGranted);

  const handleOpenRecoveryModal = () => {
    setIsRecoveryModalOpen(true);
  };

  const handleCompleteRecoveryEnrollment = (_wrappedEnvelope: WrappedAekEnvelope, syncConsent: boolean) => {
    setHasRecoveryKey(true);
    setIsSyncConsentGiven(syncConsent);
    onUpdatePreferences({
      recoveryKeyEnrolled: true,
      syncConsentGranted: syncConsent,
    });
    setIsRecoveryModalOpen(false);
  };

  const handleRevokeSyncConsent = () => {
    setIsSyncConsentGiven(false);
    onUpdatePreferences({ syncConsentGranted: false });
  };

  const toggleExpandPrayer = (id: string) => {
    setExpandedPrayerIds((prev) =>
      prev.includes(id) ? prev.filter((pId) => pId !== id) : [...prev, id]
    );
  };

  // Completed Helping Hands steps
  const completedSteps = helpingHandsModules.flatMap((m) =>
    m.steps.filter((s) => s.isCompleted).map((s) => ({ ...s, moduleTitle: m.title }))
  );

  // Answered prayer count
  const answeredPrayers = prayerRequests.filter((p) => p.followUpStatus === 'answered' || p.isAnswered);

  // Group moods for simple gentle reflection (no punitive scores)
  const moodCounts = moodHistory.reduce<Record<string, number>>((acc, curr) => {
    acc[curr.mood] = (acc[curr.mood] || 0) + 1;
    if (curr.additionalMoods && Array.isArray(curr.additionalMoods)) {
      curr.additionalMoods.forEach((m) => {
        acc[m] = (acc[m] || 0) + 1;
      });
    }
    return acc;
  }, {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <span
            style={{
              fontSize: '0.76rem',
              fontWeight: 700,
              color: 'var(--blue-accent-dark)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            Personal Milestones & Peace
          </span>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
            My Journey
          </h1>
          <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            A gentle record of your reflections, prayers, and growth with God over time.
          </p>
        </div>

        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            padding: '6px 12px',
            borderRadius: 'var(--radius-full)',
            background: showSettings ? 'var(--blue-powder)' : 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            fontSize: '0.78rem',
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            color: 'var(--text-primary)',
          }}
        >
          <Sliders size={13} />
          <span>{showSettings ? 'Hide Settings' : 'Preferences'}</span>
        </button>
      </div>

      {/* Settings / Preferences Panel (when expanded) */}
      {showSettings && (
        <JourneyPreferencesPanel
          userName={userName}
          onUpdateUserName={onUpdateUserName}
          userPreferences={userPreferences}
          onUpdatePreferences={onUpdatePreferences}
          hasRecoveryKey={hasRecoveryKey}
          isSyncConsentGiven={isSyncConsentGiven}
          onOpenRecoveryModal={handleOpenRecoveryModal}
          onRevokeSyncConsent={handleRevokeSyncConsent}
          onClearAllData={onClearAllData}
          onOpenAdminLogin={onOpenAdminLogin}
        />
      )}

      {/* Gentle Non-Punitive Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
        <div className="white-card" style={{ padding: '12px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--blue-accent-dark)' }}>
            {moodHistory.length}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '2px' }}>
            Check-Ins
          </div>
        </div>

        <div className="white-card" style={{ padding: '12px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--sage-text)' }}>
            {completedSteps.length}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '2px' }}>
            Steps Finished
          </div>
        </div>

        <div className="white-card" style={{ padding: '12px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {journalEntries.length}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '2px' }}>
            Reflections
          </div>
        </div>

        <div className="white-card" style={{ padding: '12px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--blue-accent-dark)' }}>
            {answeredPrayers.length}/{prayerRequests.length}
          </div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: '2px' }}>
            Answered
          </div>
        </div>
      </div>

      {/* Philosophy Banner: No Streaks, No Failure */}
      <div
        style={{
          background: 'var(--bg-secondary)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 14px',
          border: '1px solid var(--border-subtle)',
          fontSize: '0.78rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
          fontStyle: 'italic',
        }}
      >
        "Emotional healing does not follow a rigid timeline or a daily streak. You can pause, return whenever you need, and know you are welcomed here with open arms."
      </div>

      {/* Sub Tabs */}
      <div className="pill-filter-bar">
        <button
          onClick={() => setActiveTab('overview')}
          className={`pill-button ${activeTab === 'overview' ? 'active' : ''}`}
        >
          Mood Reflections
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          className={`pill-button ${activeTab === 'saved' ? 'active' : ''}`}
        >
          Saved Resources ({savedDevotionals.length + savedContentItems.length})
        </button>
        <button
          onClick={() => setActiveTab('completed')}
          className={`pill-button ${activeTab === 'completed' ? 'active' : ''}`}
        >
          Healing Steps ({completedSteps.length})
        </button>
        <button
          onClick={() => setActiveTab('journal')}
          className={`pill-button ${activeTab === 'journal' ? 'active' : ''}`}
        >
          Journal Entries ({journalEntries.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pill-button ${activeTab === 'history' ? 'active' : ''}`}
        >
          Prayer Records ({prayerRequests.length})
        </button>
      </div>

      {/* 1. Mood Reflections & Simple Trends */}
      {activeTab === 'overview' && (
        <JourneyOverviewTab
          moodHistory={moodHistory}
          moodCounts={moodCounts}
        />
      )}

      {/* 2 - 5. Records Tabs */}
      {activeTab !== 'overview' && (
        <JourneyRecordsTabs
          activeTab={activeTab}
          savedDevotionals={savedDevotionals}
          savedContentItems={savedContentItems}
          completedSteps={completedSteps}
          journalEntries={journalEntries}
          prayerRequests={prayerRequests}
          expandedPrayerIds={expandedPrayerIds}
          onToggleExpandPrayer={toggleExpandPrayer}
          onOpenDevotional={onOpenDevotional}
          onOpenContentItem={onOpenContentItem}
        />
      )}

      {/* App Version Footer */}
      <div style={{ textAlign: 'center', marginTop: '28px', marginBottom: '20px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
        <div>LIFTED • Faith-Based Holistic Healing</div>
        <div style={{ fontWeight: 600, marginTop: '2px', color: 'var(--text-secondary)' }}>Version 1.0.0 (Release Build 1)</div>
      </div>

      {isRecoveryModalOpen && (
        <RecoveryEnrollmentModal
          userId={supabaseAuthService.getCurrentUser()?.id || 'guest-user-local'}
          isOpen={isRecoveryModalOpen}
          onClose={() => setIsRecoveryModalOpen(false)}
          onComplete={handleCompleteRecoveryEnrollment}
        />
      )}
    </div>
  );
};
