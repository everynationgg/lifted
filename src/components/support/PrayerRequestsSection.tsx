import React, { useState } from 'react';
import {
  Plus,
  BellRing,
  BellOff,
  Clock,
  Heart,
  CheckCircle2,
  X,
  AlertCircle,
} from 'lucide-react';
import { useEncryptedDraft } from '../../storage/useEncryptedDraft';
import type { PrayerRequest } from '../../types';

export interface PrayerRequestsSectionProps {
  userName: string;
  prayerRequests: PrayerRequest[];
  onAddPrayerRequest: (
    req: Omit<PrayerRequest, 'id' | 'createdAt' | 'createdAtTimestamp' | 'intercessorsCount' | 'isPrayedByMe' | 'followUpTriggered'>
  ) => Promise<boolean> | void;
  onPrayForRequest: (id: string) => void;
  onSimulateFollowUp: (id: string) => void;
  onAnswerFollowUp: (id: string, status: 'still_praying' | 'experiencing_peace' | 'answered') => void;
  onToggleReminder: (id: string) => void;
}

export const PrayerRequestsSection: React.FC<PrayerRequestsSectionProps> = ({
  userName,
  prayerRequests,
  onAddPrayerRequest,
  onPrayForRequest,
  onSimulateFollowUp,
  onAnswerFollowUp,
  onToggleReminder,
}) => {
  // Modal state
  const [showPrayerModal, setShowPrayerModal] = useState(false);
  const [prayerTitle, setPrayerTitle] = useState('');
  const [prayerBody, setPrayerBody] = useState('');
  const [prayerVisibility, setPrayerVisibility] = useState<'private' | 'confidential' | 'community'>('private');
  const [prayerSubmittedNotice, setPrayerSubmittedNotice] = useState(false);
  const [expandedPrayerIds, setExpandedPrayerIds] = useState<string[]>([]);

  // Persistence failure and in-flight states
  const [isSavingPrayer, setIsSavingPrayer] = useState(false);
  const [prayerSaveError, setPrayerSaveError] = useState<string | null>(null);

  // Encrypted Draft Recovery for Prayer Request
  const prayerDraft = useEncryptedDraft({
    draftKey: 'draft_prayer_request',
    currentValue: prayerBody,
    onRestore: (text) => setPrayerBody(text),
  });

  const toggleExpandPrayer = (id: string) => {
    setExpandedPrayerIds((prev) =>
      prev.includes(id) ? prev.filter((pId) => pId !== id) : [...prev, id]
    );
  };

  const handleCreatePrayer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prayerTitle.trim() || !prayerBody.trim() || isSavingPrayer) return;

    setIsSavingPrayer(true);
    setPrayerSaveError(null);

    try {
      const res = await onAddPrayerRequest({
        title: prayerTitle.trim(),
        body: prayerBody.trim(),
        visibility: prayerVisibility,
        followUpScheduledDays: 3,
        remindersEnabled: true,
      });

      if (res === false) {
        setPrayerSaveError('We could not save your prayer safely. Your reflection has been preserved in draft so nothing is lost. Please try again.');
        return;
      }

      await prayerDraft.clearDraft().catch(console.error);
      setPrayerTitle('');
      setPrayerBody('');
      setShowPrayerModal(false);
      setPrayerSubmittedNotice(true);
      setTimeout(() => setPrayerSubmittedNotice(false), 5000);
    } catch {
      setPrayerSaveError('We could not save your prayer safely. Your reflection has been preserved in draft so nothing is lost. Please try again.');
    } finally {
      setIsSavingPrayer(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Reassurance Alert on submission */}
      {prayerSubmittedNotice && (
        <div
          className="white-card"
          style={{
            background: 'linear-gradient(135deg, #F0FDF4 0%, #FFFFFF 100%)',
            borderColor: '#BBF7D0',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <CheckCircle2 size={22} color="var(--sage-text)" />
          <div>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: '#166534' }}>
              Your prayer was received and lifted up
            </div>
            <div style={{ fontSize: '0.78rem', color: '#15803D', marginTop: '2px' }}>
              A gentle follow-up check-in has been scheduled for you in approximately 3 days.
            </div>
          </div>
        </div>
      )}

      {/* Action to create new prayer */}
      <div className="powder-card support-prayer-card">
        <div className="support-prayer-card-content">
          <div style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--text-primary)' }}>
            Need Prayer for Your Heart?
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
            Private by default with an automated 3-day reminder.
          </div>
        </div>
        <button
          id="btn-new-prayer-request"
          onClick={() => setShowPrayerModal(true)}
          className="btn-primary support-prayer-card-btn"
        >
          <Plus size={16} />
          <span>New Prayer</span>
        </button>
      </div>

      {/* 3-Day Engine Explanatory Note */}
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px dashed var(--border-focus)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}
      >
        <BellRing size={18} color="var(--blue-accent-dark)" style={{ flexShrink: 0 }} />
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.45 }}>
          <strong>3-Day Prayer Follow-Up Engine:</strong> Every prayer request is scheduled for a gentle follow-up in 3 days ("Just checking in. Would you like to revisit your prayer request today?"). You can update status, mark answered, or dismiss.
        </p>
      </div>

      {/* Prayer Requests List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h2 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Active Prayer Requests ({prayerRequests.length})
        </h2>

        {prayerRequests.map((req) => (
          <div key={req.id} className="white-card" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                      background:
                        req.visibility === 'private'
                          ? 'var(--bg-secondary)'
                          : req.visibility === 'confidential'
                          ? '#FEF3C7'
                          : 'var(--blue-light-sky)',
                      color:
                        req.visibility === 'private'
                          ? 'var(--text-secondary)'
                          : req.visibility === 'confidential'
                          ? '#B45309'
                          : 'var(--blue-accent-dark)',
                      textTransform: 'uppercase',
                    }}
                  >
                    {req.visibility === 'private'
                      ? 'Private'
                      : req.visibility === 'confidential'
                      ? 'Pastoral Confidential'
                      : 'Community Shared'}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{req.createdAt}</span>
                </div>

                <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '4px' }}>
                  {req.title}
                </h3>
              </div>
            </div>

            {/* 1-Line Clamped Body Preview with Clean Toggle */}
            <div style={{ marginTop: '2px' }}>
              <p
                style={{
                  fontSize: '0.84rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.5,
                  margin: 0,
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
                  onClick={() => toggleExpandPrayer(req.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: '2px 0',
                    fontSize: '0.74rem',
                    color: 'var(--blue-accent-dark)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    marginTop: '3px',
                  }}
                >
                  {expandedPrayerIds.includes(req.id) ? 'Show less' : 'Read more'}
                </button>
              )}
            </div>

            {/* 3-Day Follow-up Reminder Status Card */}
            {req.followUpTriggered ? (
              req.followUpStatus ? (
                <div className="followup-compact-badge">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary)' }}>
                    <BellRing size={13} color="var(--blue-accent-dark)" />
                    <span style={{ fontWeight: 600 }}>3-Day Check-in:</span>
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--sage-text)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={13} />
                    <span>
                      Status: {req.followUpStatus === 'experiencing_peace'
                        ? 'Experiencing Peace'
                        : req.followUpStatus === 'still_praying'
                        ? 'Still Praying'
                        : 'Answered'}
                    </span>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    background: 'var(--blue-light-sky)',
                    border: '1px solid var(--border-focus)',
                    borderRadius: 'var(--radius-md)',
                    padding: '12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.82rem' }}>
                    <BellRing size={15} color="var(--blue-accent-dark)" />
                    <span>3-Day Follow-Up Check-in:</span>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', fontStyle: 'italic' }}>
                    "Hi {userName ? `${userName}, ` : ''}just checking in. Would you like to revisit your prayer request today?"
                  </p>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => onAnswerFollowUp(req.id, 'experiencing_peace')}
                      className="btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                    >
                      Experiencing Peace
                    </button>
                    <button
                      onClick={() => onAnswerFollowUp(req.id, 'still_praying')}
                      className="btn-secondary"
                      style={{ fontSize: '0.76rem', padding: '5px 10px' }}
                    >
                      Still Praying
                    </button>
                    <button
                      onClick={() => onAnswerFollowUp(req.id, 'answered')}
                      className="btn-primary"
                      style={{ fontSize: '0.76rem', padding: '5px 12px' }}
                    >
                      Answered
                    </button>
                  </div>
                </div>
              )
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 12px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-subtle)',
                  marginTop: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: '0.76rem',
                      color: 'var(--text-secondary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <Clock size={13} color="var(--blue-accent-dark)" />
                    <span>3-day reminder</span>
                  </span>

                  <button
                    onClick={() => onToggleReminder(req.id)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-full)',
                      background: req.remindersEnabled !== false ? 'var(--blue-light-sky)' : '#FFFFFF',
                      border: '1px solid var(--border-subtle)',
                      color: req.remindersEnabled !== false ? 'var(--blue-accent-dark)' : 'var(--text-muted)',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                    }}
                    title={req.remindersEnabled !== false ? 'Reminder active (tap to turn off)' : 'Reminder paused (tap to turn on)'}
                  >
                    {req.remindersEnabled !== false ? <BellRing size={12} /> : <BellOff size={12} />}
                    <span>{req.remindersEnabled !== false ? 'Active' : 'Paused'}</span>
                  </button>
                </div>

                {/* Simulation trigger */}
                <button
                  onClick={() => onSimulateFollowUp(req.id)}
                  style={{
                    fontSize: '0.74rem',
                    fontWeight: 600,
                    color: 'var(--blue-accent-dark)',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    background: '#FFFFFF',
                    border: '1px solid var(--border-focus)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  title="Simulate 3 days passing"
                >
                  Test Follow-Up
                </button>
              </div>
            )}

            {/* Footer Intercession Count */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                {req.intercessorsCount} {req.intercessorsCount === 1 ? 'person' : 'people'} holding in prayer
              </span>
              <button
                onClick={() => onPrayForRequest(req.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-full)',
                  background: req.isPrayedByMe ? 'var(--blue-powder)' : 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                }}
              >
                <Heart size={13} fill={req.isPrayedByMe ? 'var(--blue-accent-dark)' : 'none'} color="var(--blue-accent-dark)" />
                <span>{req.isPrayedByMe ? 'Prayed' : 'Pray for This'}</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Prayer Request Modal */}
      {showPrayerModal && (
        <div className="modal-backdrop">
          <div className="modal-container">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Request Prayer
              </h2>
              <button
                onClick={() => setShowPrayerModal(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreatePrayer} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {prayerSaveError && (
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
                  <span style={{ flex: 1 }}>{prayerSaveError}</span>
                  <button
                    type="button"
                    onClick={() => setPrayerSaveError(null)}
                    style={{ background: 'none', border: 'none', color: '#B91C1C', cursor: 'pointer', padding: '2px' }}
                    aria-label="Dismiss error"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Title / Core Need
                </label>
                <input
                  type="text"
                  required
                  value={prayerTitle}
                  onChange={(e) => setPrayerTitle(e.target.value)}
                  placeholder="e.g. Healing from parenting anxiety"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.86rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Description
                </label>
                {prayerDraft.hasDraft && (
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
                      marginBottom: '8px',
                    }}
                  >
                    <span>Restored encrypted prayer draft.</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={prayerDraft.restoreDraft}
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
                        onClick={() => prayerDraft.discardDraft()}
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
                <textarea
                  rows={4}
                  required
                  value={prayerBody}
                  onChange={(e) => setPrayerBody(e.target.value)}
                  placeholder="Share what's on your heart... God hears every whisper."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.86rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  Privacy Control
                </label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="privacy"
                      checked={prayerVisibility === 'private'}
                      onChange={() => setPrayerVisibility('private')}
                    />
                    <span>Private (Only you and your device)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="privacy"
                      checked={prayerVisibility === 'confidential'}
                      onChange={() => setPrayerVisibility('confidential')}
                    />
                    <span>Pastoral Intercessors Only (Confidential)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                    <input
                      type="radio"
                      name="privacy"
                      checked={prayerVisibility === 'community'}
                      onChange={() => setPrayerVisibility('community')}
                    />
                    <span>Community Shared (Anonymous)</span>
                  </label>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowPrayerModal(false)}
                  className="btn-secondary"
                  style={{ flex: 1, fontSize: '0.84rem' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingPrayer}
                  className="btn-primary"
                  style={{
                    flex: 1,
                    fontSize: '0.84rem',
                    opacity: isSavingPrayer ? 0.7 : 1,
                    cursor: isSavingPrayer ? 'not-allowed' : 'pointer',
                  }}
                >
                  {isSavingPrayer ? 'Saving...' : 'Lift Up Prayer'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
