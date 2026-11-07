import React, { useState, useEffect } from 'react';
import {
  X,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Square,
  Bookmark,
  Share2,
  Check,
  Sparkles,
} from 'lucide-react';
import { useAudioNarration, audioNarrationService } from '../services/audioNarrationService';
import { sanitizeMarkdown, sanitizePlainText } from '../services/contentSanitizer';
import type { Devotional, ContentItem } from '../types';

interface ContentDetailModalProps {
  devotional?: Devotional | null;
  contentItem?: ContentItem | null;
  onClose: () => void;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
}

export const ContentDetailModal: React.FC<ContentDetailModalProps> = ({
  devotional,
  contentItem,
  onClose,
  isBookmarked,
  onToggleBookmark,
}) => {
  const {
    status: audioStatus,
    play: playAudio,
    pause: pauseAudio,
    resume: resumeAudio,
    stop: stopAudio,
    isPlaying: isAudioPlaying,
    isPaused: isAudioPaused,
  } = useAudioNarration();

  const [copiedText, setCopiedText] = useState(false);
  const [reflectionNote, setReflectionNote] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);

  // Stop narration on unmount
  useEffect(() => {
    return () => {
      audioNarrationService.stop();
    };
  }, []);

  const handleClose = () => {
    stopAudio();
    onClose();
  };

  if (!devotional && !contentItem) return null;

  const rawTitle = devotional?.title || contentItem?.title || '';
  const title = sanitizePlainText(rawTitle);
  const scriptureRef = devotional?.scriptureRef || contentItem?.scriptureRef;
  const scriptureText = sanitizeMarkdown(devotional?.scriptureText || contentItem?.scriptureText || '');
  const bodyText = sanitizeMarkdown(devotional?.reflection || contentItem?.contentBody || contentItem?.description || '');
  const prayerText = devotional?.prayer ? sanitizeMarkdown(devotional.prayer) : undefined;
  const promptText = devotional?.reflectionPrompt ? sanitizeMarkdown(devotional.reflectionPrompt) : undefined;
  const duration = devotional?.readingTimeMinutes || contentItem?.durationMinutes || 3;

  // Editorial metadata extraction
  const devotionalMetadata = devotional as unknown as {
    authorName?: string;
    editorName?: string;
    reviewerName?: string;
    sourceName?: string;
    copyrightOwner?: string;
    licenseType?: string;
    attributionText?: string;
    version?: number;
  } | null;

  const authorAttribution = devotionalMetadata?.authorName || contentItem?.authorOrSource || devotionalMetadata?.sourceName;
  const reviewerAttribution = devotionalMetadata?.reviewerName || (devotionalMetadata?.editorName ? `Reviewed by ${devotionalMetadata.editorName}` : undefined);
  const licensingAttribution = devotionalMetadata?.attributionText || devotionalMetadata?.copyrightOwner || devotionalMetadata?.licenseType;

  const handleShare = () => {
    const textToCopy = scriptureRef
      ? `"${scriptureText || title}" — ${scriptureRef}\nFrom LIFTED`
      : `${title} — From LIFTED`;
    navigator.clipboard?.writeText?.(textToCopy);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2500);
  };

  const handleSaveNote = () => {
    if (!reflectionNote.trim()) return;
    setNoteSaved(true);
    setTimeout(() => setNoteSaved(false), 3000);
  };

  const fullTextToNarrate = [
    title,
    scriptureRef ? `Scripture from ${scriptureRef}: ${scriptureText || ''}` : '',
    bodyText,
    prayerText ? `Closing Prayer: ${prayerText}` : '',
  ]
    .filter(Boolean)
    .join('. ');

  const handleTogglePlay = () => {
    if (isAudioPlaying) {
      pauseAudio();
    } else if (isAudioPaused) {
      resumeAudio();
    } else {
      playAudio(title, fullTextToNarrate, contentItem?.audioUrl);
    }
  };

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        className="modal-content"
        style={{ maxWidth: 520, maxHeight: '92vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 700,
                color: 'var(--blue-accent-dark)',
                background: 'var(--blue-light-sky)',
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)',
                textTransform: 'uppercase',
              }}
            >
              {devotional ? 'Daily Devotional' : contentItem?.category?.replace('_', ' ')}
            </span>
            <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
              • {duration} min read
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onToggleBookmark}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.78rem',
                fontWeight: 600,
                color: isBookmarked ? 'var(--blue-accent-dark)' : 'var(--text-secondary)',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                background: isBookmarked ? 'var(--blue-powder)' : 'var(--bg-secondary)',
              }}
              title="Save to My Journey"
            >
              <Bookmark size={15} fill={isBookmarked ? 'var(--blue-accent-dark)' : 'none'} />
              <span>{isBookmarked ? 'Saved' : 'Save'}</span>
            </button>

            <button
              onClick={handleShare}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
                padding: '4px 8px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-secondary)',
              }}
              title="Share"
            >
              {copiedText ? <Check size={14} color="var(--sage-text)" /> : <Share2 size={14} />}
              <span>{copiedText ? 'Copied' : 'Share'}</span>
            </button>

            <button onClick={handleClose} style={{ color: 'var(--text-secondary)', padding: 4 }} aria-label="Close modal">
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Title */}
        <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
          {title}
        </h1>

        {/* Audio Player Bar */}
        <div
          role="region"
          aria-label="Audio reflection narration"
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            margin: '12px 0',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={handleTogglePlay}
              disabled={audioStatus.state === 'UNSUPPORTED'}
              aria-label={
                isAudioPlaying
                  ? 'Pause audio narration'
                  : isAudioPaused
                  ? 'Resume audio narration'
                  : 'Play audio reflection narration'
              }
              style={{
                width: 34,
                height: 34,
                borderRadius: '50%',
                background: 'var(--blue-powder)',
                border: '1px solid var(--blue-accent)',
                color: 'var(--text-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: audioStatus.state === 'UNSUPPORTED' ? 'not-allowed' : 'pointer',
                opacity: audioStatus.state === 'UNSUPPORTED' ? 0.5 : 1,
              }}
              title={
                isAudioPlaying
                  ? 'Pause audio narration'
                  : isAudioPaused
                  ? 'Resume audio narration'
                  : 'Play audio reflection narration'
              }
            >
              {isAudioPlaying ? (
                <Pause size={16} />
              ) : (
                <Play size={16} style={{ marginLeft: isAudioPaused ? 0 : 2 }} />
              )}
            </button>

            {(isAudioPlaying || isAudioPaused) && (
              <button
                onClick={stopAudio}
                aria-label="Stop audio narration"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'transparent',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
                title="Stop audio narration"
              >
                <Square size={12} />
              </button>
            )}

            <div>
              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {audioStatus.state === 'PLAYING'
                  ? 'Listening: Gentle Voice Reading'
                  : audioStatus.state === 'PAUSED'
                  ? 'Narration Paused'
                  : audioStatus.state === 'LOADING'
                  ? 'Preparing Audio...'
                  : audioStatus.state === 'UNSUPPORTED'
                  ? 'Voice Narration Unavailable'
                  : audioStatus.state === 'ERROR'
                  ? 'Audio Narration Error'
                  : 'Listen to Audio Reflection'}
              </div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                {audioStatus.state === 'PLAYING'
                  ? 'Paced reflection speech narration'
                  : audioStatus.state === 'PAUSED'
                  ? 'Tap play to resume reading'
                  : audioStatus.state === 'UNSUPPORTED'
                  ? 'Speech synthesis not supported on this browser'
                  : audioStatus.state === 'ERROR'
                  ? (audioStatus.errorMessage || 'Unable to play speech')
                  : `Peaceful ~${duration} min guided voice narration`}
              </div>
            </div>
          </div>
          {isAudioPlaying ? (
            <Volume2 size={18} color="var(--blue-accent-dark)" />
          ) : (
            <VolumeX size={16} color="var(--text-muted)" />
          )}
        </div>

        {/* Scripture Citation Box */}
        {scriptureRef && (
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 14px',
              margin: '10px 0',
            }}
          >
            <div className="scripture-ref">{scriptureRef}</div>
            {scriptureText && (
              <blockquote className="devotional-quote">
                "{scriptureText}"
              </blockquote>
            )}
          </div>
        )}

        {/* Content Body */}
        <div style={{ margin: '14px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ fontSize: '0.92rem', lineHeight: 1.7, color: 'var(--text-primary)' }}>
            {bodyText}
          </p>

          {/* Surrender Prayer */}
          {prayerText && (
            <div
              style={{
                background: 'var(--blue-light-sky)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
              }}
            >
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--blue-accent-dark)', textTransform: 'uppercase' }}>
                Surrender Prayer
              </span>
              <p style={{ fontSize: '0.86rem', fontStyle: 'italic', color: 'var(--text-primary)', marginTop: '4px', lineHeight: 1.55 }}>
                "{prayerText}"
              </p>
            </div>
          )}

          {/* Personal Reflection Prompt */}
          {promptText && (
            <div
              style={{
                background: '#FFFFFF',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={15} color="var(--blue-accent-dark)" />
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Personal Healing Reflection
                </span>
              </div>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                {promptText}
              </p>

              <textarea
                rows={3}
                value={reflectionNote}
                onChange={(e) => setReflectionNote(e.target.value)}
                placeholder="Quiet thoughts... (stored privately)"
                style={{
                  width: '100%',
                  marginTop: '8px',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border-subtle)',
                  fontSize: '0.84rem',
                }}
              />

              <button
                onClick={handleSaveNote}
                className="btn-primary"
                style={{ marginTop: '8px', fontSize: '0.78rem', padding: '6px 14px' }}
              >
                {noteSaved ? 'Saved to Journey!' : 'Save Reflection'}
              </button>
            </div>
          )}

          {/* Editorial Attribution & Licensing Notice */}
          <div
            style={{
              marginTop: '12px',
              paddingTop: '12px',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.72rem',
              color: 'var(--text-muted)',
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
            }}
          >
            {authorAttribution && (
              <div>
                <span style={{ fontWeight: 600 }}>Attribution: </span>
                <span>{authorAttribution}</span>
              </div>
            )}
            {reviewerAttribution && (
              <div>
                <span style={{ fontWeight: 600 }}>Reviewed by: </span>
                <span>{reviewerAttribution}</span>
              </div>
            )}
            {licensingAttribution && (
              <div>
                <span style={{ fontWeight: 600 }}>Licensing & Rights: </span>
                <span>{licensingAttribution}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
