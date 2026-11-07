import React from 'react';
import {
  CheckCircle2,
  ChevronRight,
} from 'lucide-react';
import type {
  Devotional,
  ContentItem,
  PrayerRequest,
  JournalEntry,
} from '../../types';

export interface CompletedStepItem {
  id: string;
  stepNumber: number;
  title: string;
  practicalTakeaway: string;
  userNote?: string;
  moduleTitle: string;
}

export interface JourneyRecordsTabsProps {
  activeTab: 'saved' | 'completed' | 'journal' | 'history';
  savedDevotionals: Devotional[];
  savedContentItems: ContentItem[];
  completedSteps: CompletedStepItem[];
  journalEntries: JournalEntry[];
  prayerRequests: PrayerRequest[];
  expandedPrayerIds: string[];
  onToggleExpandPrayer: (id: string) => void;
  onOpenDevotional: (devotional: Devotional) => void;
  onOpenContentItem: (item: ContentItem) => void;
}

export const JourneyRecordsTabs: React.FC<JourneyRecordsTabsProps> = ({
  activeTab,
  savedDevotionals,
  savedContentItems,
  completedSteps,
  journalEntries,
  prayerRequests,
  expandedPrayerIds,
  onToggleExpandPrayer,
  onOpenDevotional,
  onOpenContentItem,
}) => {
  if (activeTab === 'saved') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Saved Devotionals & Articles
        </h3>
        {savedDevotionals.length === 0 && savedContentItems.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No saved resources yet. Tap the bookmark icon on any devotional or article to save it here.
          </div>
        ) : (
          <>
            {savedDevotionals.map((dev) => (
              <div
                key={dev.id}
                className="white-card"
                onClick={() => onOpenDevotional(dev)}
                style={{ cursor: 'pointer', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--blue-accent-dark)' }}>
                    Devotional • {dev.date}
                  </span>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                    {dev.title}
                  </div>
                  <div className="scripture-ref">{dev.scriptureRef}</div>
                </div>
                <ChevronRight size={18} color="var(--text-muted)" />
              </div>
            ))}
            {savedContentItems.map((item) => (
              <div
                key={item.id}
                className="white-card"
                onClick={() => onOpenContentItem(item)}
                style={{ cursor: 'pointer', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--sage-text)' }}>
                    {item.category.replace('_', ' ')}
                  </span>
                  <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                    {item.title}
                  </div>
                </div>
                <ChevronRight size={18} color="var(--text-muted)" />
              </div>
            ))}
          </>
        )}
      </div>
    );
  }

  if (activeTab === 'completed') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Completed Self-Healing Steps
        </h3>
        {completedSteps.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No steps completed yet. Explore Helping Hands in Discover & Grow to walk through guided steps.
          </div>
        ) : (
          completedSteps.map((step) => (
            <div key={step.id} className="white-card" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={16} color="var(--sage-text)" />
                <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--blue-accent-dark)' }}>
                  Step {step.stepNumber}: {step.title}
                </span>
              </div>
              {step.userNote && (
                <p style={{ fontSize: '0.8rem', color: 'var(--text-primary)', marginTop: '6px', fontStyle: 'italic' }}>
                  Note: "{step.userNote}"
                </p>
              )}
              <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                Takeaway: {step.practicalTakeaway}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  if (activeTab === 'journal') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Personal Journal Entries ({journalEntries.length})
        </h3>
        {journalEntries.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No journal reflections written yet. Visit Support & Reflection to write your first entry.
          </div>
        ) : (
          journalEntries.map((entry) => (
            <div key={entry.id} className="white-card" style={{ padding: '12px 14px' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {entry.date}
              </div>
              {entry.promptQuestion && (
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--blue-accent-dark)', marginTop: '2px' }}>
                  "{entry.promptQuestion}"
                </div>
              )}
              <p style={{ fontSize: '0.84rem', color: 'var(--text-primary)', marginTop: '4px', lineHeight: 1.5 }}>
                {entry.content}
              </p>
            </div>
          ))
        )}
      </div>
    );
  }

  if (activeTab === 'history') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Prayer History & Answered Praise Reports
        </h3>
        {prayerRequests.map((req) => (
          <div key={req.id} className="white-card" style={{ padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {req.title}
              </span>
              {req.followUpStatus && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    background: 'var(--blue-light-sky)',
                    color: 'var(--text-primary)',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                  }}
                >
                  {req.followUpStatus === 'answered'
                    ? 'Answered'
                    : req.followUpStatus === 'experiencing_peace'
                    ? 'Peace'
                    : 'Still Praying'}
                </span>
              )}
            </div>
            <div style={{ marginTop: '4px' }}>
              <p
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-secondary)',
                  margin: 0,
                  lineHeight: 1.5,
                  display: expandedPrayerIds.includes(req.id) ? 'block' : '-webkit-box',
                  WebkitLineClamp: expandedPrayerIds.includes(req.id) ? 'unset' : 1,
                  WebkitBoxOrient: 'vertical',
                  overflow: expandedPrayerIds.includes(req.id) ? 'visible' : 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {req.body}
              </p>
              {req.body.length > 50 && (
                <button
                  type="button"
                  onClick={() => onToggleExpandPrayer(req.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '2px 0',
                    fontSize: '0.72rem',
                    color: 'var(--blue-accent-dark)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginTop: '2px',
                  }}
                >
                  {expandedPrayerIds.includes(req.id) ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return null;
};
