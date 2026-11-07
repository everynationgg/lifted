import React from 'react';
import type { MoodCheckInRecord } from '../../types';
import { MOOD_OPTIONS } from '../../data/mockData';

export interface JourneyOverviewTabProps {
  moodHistory: MoodCheckInRecord[];
  moodCounts: Record<string, number>;
}

export const JourneyOverviewTab: React.FC<JourneyOverviewTabProps> = ({
  moodHistory,
  moodCounts,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div className="white-card">
        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Emotional States Noticed
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
          Recognizing patterns without self-criticism.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '12px' }}>
          {Object.entries(moodCounts).map(([mId, count]) => {
            const opt = MOOD_OPTIONS.find((m) => m.id === mId);
            return (
              <span
                key={mId}
                style={{
                  background: 'var(--blue-light-sky)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-full)',
                  padding: '4px 10px',
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <span>{opt?.label || mId}</span>
                <span style={{ color: 'var(--blue-accent-dark)', fontWeight: 800 }}>({count})</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* Recent Check-In Timeline */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Recent Check-Ins ({moodHistory.length})
        </h3>
        {moodHistory.map((rec) => (
          <div key={rec.id} className="white-card" style={{ padding: '10px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {[rec.mood, ...(rec.additionalMoods || [])]
                  .map((m) => MOOD_OPTIONS.find((opt) => opt.id === m)?.label || m)
                  .join(' • ')}
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{rec.dateStr}</span>
            </div>
            {rec.note && (
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                "{rec.note}"
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
