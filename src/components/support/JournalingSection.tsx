import React, { useState } from 'react';
import {
  Lock,
  Calendar,
  X,
  AlertCircle,
} from 'lucide-react';
import { useEncryptedDraft } from '../../storage/useEncryptedDraft';
import type { JournalEntry } from '../../types';
import { INITIAL_JOURNAL_PROMPTS } from '../../data/mockData';

export interface JournalingSectionProps {
  journalEntries: JournalEntry[];
  onAddJournalEntry: (content: string, prompt?: string) => Promise<boolean> | void;
}

export const JournalingSection: React.FC<JournalingSectionProps> = ({
  journalEntries,
  onAddJournalEntry,
}) => {
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [journalContent, setJournalContent] = useState('');
  const [journalSavedNotice, setJournalSavedNotice] = useState(false);

  // Persistence failure and in-flight states
  const [isSavingJournal, setIsSavingJournal] = useState(false);
  const [journalSaveError, setJournalSaveError] = useState<string | null>(null);

  // Encrypted Draft Recovery
  const journalDraft = useEncryptedDraft({
    draftKey: 'draft_journal_composition',
    currentValue: journalContent,
    onRestore: (text) => setJournalContent(text),
  });

  const handleSaveJournal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!journalContent.trim() || isSavingJournal) return;

    setIsSavingJournal(true);
    setJournalSaveError(null);

    try {
      const res = await onAddJournalEntry(journalContent.trim(), selectedPrompt || undefined);

      if (res === false) {
        setJournalSaveError('We could not save your journal entry safely. Your reflection has been preserved in draft so nothing is lost. Please try again.');
        return;
      }

      await journalDraft.clearDraft().catch(console.error);
      setJournalContent('');
      setSelectedPrompt('');
      setJournalSavedNotice(true);
      setTimeout(() => setJournalSavedNotice(false), 3000);
    } catch {
      setJournalSaveError('We could not save your journal entry safely. Your reflection has been preserved in draft so nothing is lost. Please try again.');
    } finally {
      setIsSavingJournal(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="white-card">
        <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Private Journal & Reflection
        </h3>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
          Free-form reflections or guided prompts. 100% private to your device.
        </p>

        {/* Prompt Selector */}
        <div style={{ marginTop: '12px' }}>
          <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
            Choose an optional reflection prompt:
          </span>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', padding: '6px 0', scrollbarWidth: 'none' }}>
            {INITIAL_JOURNAL_PROMPTS.map((prompt, pIdx) => (
              <button
                key={pIdx}
                type="button"
                onClick={() => setSelectedPrompt(prompt === selectedPrompt ? '' : prompt)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '0.74rem',
                  whiteSpace: 'nowrap',
                  background: selectedPrompt === prompt ? 'var(--blue-powder)' : 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: selectedPrompt === prompt ? '1px solid var(--blue-accent)' : '1px solid var(--border-subtle)',
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Journal Input */}
        <form onSubmit={handleSaveJournal} style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {journalSaveError && (
            <div
              role="alert"
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 'var(--radius-md)',
                padding: '10px 14px',
                color: '#B91C1C',
                fontSize: '0.82rem',
                lineHeight: 1.45,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{journalSaveError}</span>
              <button
                type="button"
                onClick={() => setJournalSaveError(null)}
                style={{ background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer', padding: '2px' }}
                aria-label="Dismiss error"
              >
                <X size={14} />
              </button>
            </div>
          )}
          {journalDraft.hasDraft && (
            <div
              style={{
                background: 'var(--blue-light-sky, #e0f2fe)',
                border: '1px solid var(--border-subtle, #bae6fd)',
                borderRadius: 'var(--radius-sm, 8px)',
                padding: '8px 12px',
                fontSize: '0.8rem',
                color: 'var(--blue-accent-dark, #0284c7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
              }}
            >
              <span>Restored unsaved reflection draft.</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={journalDraft.restoreDraft}
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: 'var(--blue-accent-dark, #0284c7)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Use Draft
                </button>
                <button
                  type="button"
                  onClick={() => journalDraft.discardDraft()}
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--text-muted, #94a3b8)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          )}
          {selectedPrompt && (
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--blue-accent-dark)' }}>
              Prompt: "{selectedPrompt}"
            </div>
          )}
          <textarea
            rows={5}
            value={journalContent}
            onChange={(e) => setJournalContent(e.target.value)}
            placeholder="Pour out your heart freely here..."
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.86rem',
              background: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              lineHeight: 1.5,
            }}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Lock size={12} />
              <span>Encrypted locally</span>
            </span>
            <button
              type="submit"
              disabled={isSavingJournal}
              className="btn-primary"
              style={{
                fontSize: '0.82rem',
                padding: '8px 16px',
                opacity: isSavingJournal ? 0.7 : 1,
                cursor: isSavingJournal ? 'not-allowed' : 'pointer',
              }}
            >
              {isSavingJournal ? 'Saving...' : journalSavedNotice ? 'Saved!' : 'Save Journal Entry'}
            </button>
          </div>
        </form>
      </div>

      {/* Past Journal Entries */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Past Reflections ({journalEntries.length})
        </h3>
        {journalEntries.length === 0 ? (
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
            No journal entries yet. Write your first reflection above.
          </div>
        ) : (
          journalEntries.map((entry) => (
            <div key={entry.id} className="white-card" style={{ padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                <Calendar size={12} />
                <span>{entry.date}</span>
              </div>
              {entry.promptQuestion && (
                <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--blue-accent-dark)', marginTop: '4px' }}>
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
    </div>
  );
};
