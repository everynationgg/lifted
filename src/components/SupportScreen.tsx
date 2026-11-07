import React, { useState } from 'react';
import type { PrayerRequest, JournalEntry } from '../types';
import {
  PrayerRequestsSection,
  CrisisSupportSection,
  JournalingSection,
} from './support';

export type SupportSubTab = 'prayers' | 'alone' | 'journal';

export interface SupportScreenProps {
  userName: string;
  prayerRequests: PrayerRequest[];
  onAddPrayerRequest: (
    req: Omit<PrayerRequest, 'id' | 'createdAt' | 'createdAtTimestamp' | 'intercessorsCount' | 'isPrayedByMe' | 'followUpTriggered'>
  ) => Promise<boolean> | void;
  onPrayForRequest: (id: string) => void;
  onSimulateFollowUp: (id: string) => void;
  onAnswerFollowUp: (id: string, status: 'still_praying' | 'experiencing_peace' | 'answered') => void;
  onToggleReminder: (id: string) => void;
  journalEntries: JournalEntry[];
  onAddJournalEntry: (content: string, prompt?: string) => Promise<boolean> | void;
}

export const SupportScreen: React.FC<SupportScreenProps> = ({
  userName,
  prayerRequests,
  onAddPrayerRequest,
  onPrayForRequest,
  onSimulateFollowUp,
  onAnswerFollowUp,
  onToggleReminder,
  journalEntries,
  onAddJournalEntry,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<SupportSubTab>('prayers');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Screen Title */}
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
          Care & Reflection
        </span>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
          Support & Reflection
        </h1>
        <p style={{ fontSize: '0.86rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Bring personal burdens into prayer, reflect privately in your journal, and find gentle reassurance.
        </p>
      </div>

      {/* Sub Tabs */}
      <div className="pill-filter-bar">
        <button
          onClick={() => setActiveSubTab('prayers')}
          className={`pill-button ${activeSubTab === 'prayers' ? 'active' : ''}`}
        >
          Prayer Requests
        </button>
        <button
          onClick={() => setActiveSubTab('alone')}
          className={`pill-button ${activeSubTab === 'alone' ? 'active' : ''}`}
        >
          You're Not Alone
        </button>
        <button
          onClick={() => setActiveSubTab('journal')}
          className={`pill-button ${activeSubTab === 'journal' ? 'active' : ''}`}
        >
          Private Journal
        </button>
      </div>

      {/* SUB-SECTION 1: PRAYER REQUESTS */}
      {activeSubTab === 'prayers' && (
        <PrayerRequestsSection
          userName={userName}
          prayerRequests={prayerRequests}
          onAddPrayerRequest={onAddPrayerRequest}
          onPrayForRequest={onPrayForRequest}
          onSimulateFollowUp={onSimulateFollowUp}
          onAnswerFollowUp={onAnswerFollowUp}
          onToggleReminder={onToggleReminder}
        />
      )}

      {/* SUB-SECTION 2: YOU'RE NOT ALONE (CRISIS & SAFETY) */}
      {activeSubTab === 'alone' && <CrisisSupportSection />}

      {/* SUB-SECTION 3: PRIVATE JOURNAL & REFLECTION */}
      {activeSubTab === 'journal' && (
        <JournalingSection
          journalEntries={journalEntries}
          onAddJournalEntry={onAddJournalEntry}
        />
      )}
    </div>
  );
};
