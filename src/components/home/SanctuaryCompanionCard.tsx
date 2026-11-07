import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Send,
  RotateCcw,
  X,
  BookOpen,
  HeartHandshake,
  Wind,
  Heart,
  PhoneCall,
  MessageSquare,
  Mic,
  MicOff,
  AlertCircle,
  WifiOff,
} from 'lucide-react';
import type {
  MoodId,
  Devotional,
  AiRecommendation,
  DiscoverPillarId,
} from '../../types';
import { useEncryptedDraft } from '../../storage/useEncryptedDraft';
import { TODAY_DEVOTIONAL } from '../../data/mockData';
import {
  sendCompanionMessage,
  getCompanionMode,
  setCompanionMode,
  hasCloudAiConsent,
  setCloudAiConsent,
  type CompanionMode,
  type ChatHistoryItem,
} from '../../services/geminiService';
import { supabaseAuthService } from '../../services/auth/supabaseAuthService';
import { CloudAiConsentModal } from '../CloudAiConsentModal';
import { haptics } from '../../services/hapticsService';
import { voiceService } from '../../services/voiceService';
import { formatLocalTime, generateMessageId } from '../../utils/dateUtils';
import type { PrimaryTabId } from '../Navigation';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  moodTags?: MoodId[];
  recommendation?: AiRecommendation;
  timestamp: string;
  isCrisis?: boolean;
  shouldShowResources?: boolean;
  isAiGenerated?: boolean;
}

const FEELING_PILLS: { id: MoodId; label: string }[] = [
  { id: 'peaceful', label: 'Peaceful' },
  { id: 'anxious', label: 'Anxious' },
  { id: 'sad', label: 'Grieving' },
  { id: 'overwhelmed', label: 'Overwhelmed' },
  { id: 'tired', label: 'Burnout / Tired' },
  { id: 'hopeful', label: 'Hopeful' },
  { id: 'grateful', label: 'Grateful' },
  { id: 'lonely', label: 'Lonely' },
  { id: 'frustrated', label: 'Frustrated' },
  { id: 'okay', label: 'Holding Steady' },
  { id: 'unsure', label: 'Unsure' },
];

const QUICK_PROMPTS = [
  "It feels really heavy today",
  "I'm feeling worn down and tired",
  "Could you share a comforting scripture?",
  "Can you pray with me right now?",
];

export interface SanctuaryCompanionCardProps {
  onSelectMood: (mood: MoodId | MoodId[] | null, note?: string) => void;
  onNavigateTab: (tab: PrimaryTabId) => void;
  onOpenDevotional: (devotional: Devotional) => void;
  onNavigateDiscoverPillar?: (pillar: DiscoverPillarId, topicTag?: string) => void;
  onCheckInComplete?: () => void;
  onConversationStateChange?: (isActive: boolean) => void;
}

export const SanctuaryCompanionCard: React.FC<SanctuaryCompanionCardProps> = ({
  onSelectMood,
  onNavigateTab,
  onOpenDevotional,
  onNavigateDiscoverPillar,
  onCheckInComplete,
  onConversationStateChange,
}) => {
  const [customText, setCustomText] = useState('');

  // Encrypted Draft Recovery for Sanctuary check-in
  const checkInDraft = useEncryptedDraft({
    draftKey: 'draft_sanctuary_checkin',
    currentValue: customText,
    onRestore: (text) => setCustomText(text),
  });

  // Multi-emotion selection: users can choose multiple concurrent feelings
  const [selectedTags, setSelectedTags] = useState<MoodId[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => {
    const saved = sessionStorage.getItem('lifted_active_chat');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        return [];
      }
    }
    return [];
  });
  const [isAiThinking, setIsAiThinking] = useState(false);
  const [conversationTurn, setConversationTurn] = useState<number>(() => {
    const saved = sessionStorage.getItem('lifted_active_turn');
    return saved ? Number(saved) : 0;
  });

  useEffect(() => {
    sessionStorage.setItem('lifted_active_chat', JSON.stringify(chatMessages));
    sessionStorage.setItem('lifted_active_turn', String(conversationTurn));
    onConversationStateChange?.(chatMessages.length > 0);
  }, [chatMessages, conversationTurn, onConversationStateChange]);

  // Speech Recognition state & Zero-Latency Live Streaming Engine
  const [isListening, setIsListening] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);

  // Companion Mode & Cloud AI Consent State
  const [companionMode, setCompanionModeState] = useState<CompanionMode>(getCompanionMode());
  const [isConsentModalOpen, setIsConsentModalOpen] = useState(false);
  const [cloudAiNotice, setCloudAiNotice] = useState<string | null>(null);

  const handleToggleCompanionMode = () => {
    if (companionMode === 'offline') {
      const isAuthed = supabaseAuthService.getAccountState() === 'AUTHENTICATED';
      if (!isAuthed) {
        setCloudAiNotice('Sanctuary operates 100% privately and offline on your device. Live Gemini Cloud AI is planned for a future release with user consent.');
        setTimeout(() => setCloudAiNotice(null), 5000);
        return;
      }
      if (!hasCloudAiConsent()) {
        setIsConsentModalOpen(true);
        return;
      }
      setCompanionMode('cloud');
      setCompanionModeState('cloud');
    } else {
      setCompanionMode('offline');
      setCompanionModeState('offline');
    }
  };

  const handleConfirmConsent = () => {
    setCloudAiConsent(true);
    setCompanionMode('cloud');
    setCompanionModeState('cloud');
  };

  const handleDeclineConsent = () => {
    setCloudAiConsent(false);
    setCompanionMode('offline');
    setCompanionModeState('offline');
  };

  useEffect(() => {
    return () => {
      voiceService.stopListening();
    };
  }, []);

  const isTogglingRef = useRef(false);

  const toggleListening = async () => {
    if (isTogglingRef.current) return;
    isTogglingRef.current = true;

    try {
      if (isListening) {
        setIsListening(false);
        await haptics.light();
        await voiceService.stopListening();
        return;
      }

      setVoiceNotice(null);
      const started = await voiceService.startListening({
        onPartialText: (streamedText) => {
          setCustomText(streamedText);
          if (inputRef.current) {
            inputRef.current.scrollLeft = inputRef.current.scrollWidth;
          }
        },
        onFinalText: (finalText) => {
          setCustomText(finalText);
          if (inputRef.current) {
            inputRef.current.scrollLeft = inputRef.current.scrollWidth;
          }
        },
        onStateChange: (listening) => {
          setIsListening(listening);
        },
        onError: (errMsg) => {
          setVoiceNotice(errMsg);
          setTimeout(() => setVoiceNotice(null), 4000);
        },
      });

      if (!started) {
        setIsListening(false);
      }
    } finally {
      setTimeout(() => {
        isTogglingRef.current = false;
      }, 250);
    }
  };

  const chatBottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll when chat messages or thinking updates
  useEffect(() => {
    if (chatMessages.length > 0 || isAiThinking) {
      chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isAiThinking]);

  // Toggle emotion chip in multi-selection (allows up to 4 simultaneous feelings)
  const handleTagToggle = (tagId: MoodId) => {
    haptics.light();
    setSelectedTags((prev) => {
      if (prev.includes(tagId)) {
        return prev.filter((id) => id !== tagId);
      }
      if (prev.length >= 4) {
        return [...prev.slice(1), tagId];
      }
      return [...prev, tagId];
    });
    inputRef.current?.focus();
  };

  // Submit chat message with multi-turn companion pacing
  const handleChatSubmit = async (e?: React.FormEvent, directText?: string) => {
    if (e) e.preventDefault();
    const rawText = directText !== undefined ? directText : customText;
    const textToSend = rawText.trim();
    if (!textToSend && selectedTags.length === 0) return;

    if (isListening) {
      voiceService.stopListening();
      setIsListening(false);
    }

    haptics.success();

    const currentTags = [...selectedTags];
    const effectiveMoods = currentTags.length > 0 ? currentTags : (['unsure'] as MoodId[]);

    // Log check-in to journey history
    if (currentTags.length > 0) {
      onSelectMood(currentTags, textToSend);
    }

    const timeStr = formatLocalTime();
    const tagNames = currentTags.map(
      (id) => FEELING_PILLS.find((p) => p.id === id)?.label || id
    );

    const defaultText =
      tagNames.length > 0
        ? `Checking in feeling ${tagNames.join(' and ')}`
        : 'Checking in';

    const messageText = textToSend || defaultText;

    const userMsg: ChatMessage = {
      id: generateMessageId('user'),
      sender: 'user',
      text: messageText,
      moodTags: currentTags.length > 0 ? currentTags : undefined,
      timestamp: timeStr,
    };

    const nextTurn = conversationTurn + 1;
    setConversationTurn(nextTurn);
    setChatMessages((prev) => [...prev, userMsg]);
    setCustomText('');
    checkInDraft.clearDraft().catch(console.error);
    setSelectedTags([]);
    setIsAiThinking(true);

    const history: ChatHistoryItem[] = chatMessages.map((m) => ({
      role: m.sender === 'user' ? 'user' : 'model',
      text: m.text,
    }));

    try {
      const companionResponse = await sendCompanionMessage(
        history,
        messageText,
        effectiveMoods,
        nextTurn
      );

      const aiMsg: ChatMessage = {
        id: generateMessageId('ai'),
        sender: 'ai',
        text: companionResponse.text,
        recommendation: companionResponse.recommendation,
        isCrisis: companionResponse.isCrisis,
        shouldShowResources: companionResponse.shouldShowResources,
        isAiGenerated: companionResponse.isAiGenerated,
        timestamp: formatLocalTime(),
      };

      setChatMessages((prev) => [...prev, aiMsg]);
      if (nextTurn >= 2) {
        onCheckInComplete?.();
      }
    } catch {
      const fallbackMsg: ChatMessage = {
        id: generateMessageId('ai'),
        sender: 'ai',
        text: "I am holding space for you right now. You don't have to carry this alone. What is feeling most tender for your heart today?",
        timestamp: formatLocalTime(),
        shouldShowResources: nextTurn >= 2,
      };
      setChatMessages((prev) => [...prev, fallbackMsg]);
      if (nextTurn >= 2) {
        onCheckInComplete?.();
      }
    } finally {
      setIsAiThinking(false);
    }
  };

  const handleResetCheckIn = () => {
    setChatMessages([]);
    setSelectedTags([]);
    setCustomText('');
    checkInDraft.clearDraft().catch(console.error);
    setIsAiThinking(false);
    setConversationTurn(0);
    sessionStorage.removeItem('lifted_active_chat');
    sessionStorage.removeItem('lifted_active_turn');
  };

  const getPlaceholderText = () => {
    if (selectedTags.length === 0) {
      if (conversationTurn >= 1) {
        return "Reply or share how you're feeling...";
      }
      return "Share what's on your heart, or choose feelings below...";
    }
    const labels = selectedTags.map(
      (id) => FEELING_PILLS.find((p) => p.id === id)?.label.toLowerCase() || id
    );
    if (labels.length === 1) {
      return `Tell me more about feeling ${labels[0]} (or press send)...`;
    }
    if (labels.length === 2) {
      return `Tell me more about feeling ${labels[0]} and ${labels[1]} (or press send)...`;
    }
    return `Tell me more about what your heart is carrying (or press send)...`;
  };

  const isConversationActive = chatMessages.length > 0;

  return (
    <>
      {/* Active Chat Stream */}
      {isConversationActive && (
        <div className="home-chat-thread">
          <div className="chat-thread-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--blue-accent-dark)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Compassionate Guide
              </span>
              <button
                type="button"
                onClick={handleToggleCompanionMode}
                title="Tap to toggle between Offline Sanctuary and Cloud AI"
                style={{
                  fontSize: '0.66rem',
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: '12px',
                  border: companionMode === 'cloud' ? '1px solid #7DD3FC' : '1px solid #CBD5E1',
                  background: companionMode === 'cloud' ? '#E0F2FE' : '#F8FAFC',
                  color: companionMode === 'cloud' ? '#0369A1' : '#64748B',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {companionMode === 'cloud' ? (
                  <>
                    <Sparkles size={11} color="#0284C7" />
                    <span>Cloud AI (Gemini)</span>
                  </>
                ) : (
                  <>
                    <WifiOff size={11} color="#64748B" />
                    <span>Sanctuary (Offline)</span>
                  </>
                )}
              </button>
            </div>
            <button
              onClick={handleResetCheckIn}
              style={{
                fontSize: '0.72rem',
                color: 'var(--text-secondary)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <RotateCcw size={12} />
              <span>New Check-in</span>
            </button>
          </div>

          {chatMessages.map((msg) => (
            <React.Fragment key={msg.id}>
              {msg.sender === 'user' ? (
                <div className="chat-bubble-user">
                  {msg.moodTags && msg.moodTags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '2px' }}>
                      {msg.moodTags.map((tagId) => (
                        <span key={tagId} className="chat-tag-pill">
                          {FEELING_PILLS.find((p) => p.id === tagId)?.label || tagId}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: '0.88rem', lineHeight: 1.45 }}>{msg.text}</div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', alignSelf: 'flex-end', marginTop: '2px' }}>
                    {msg.timestamp}
                  </span>
                </div>
              ) : (
                <div className="chat-bubble-ai">
                  <div className="chat-ai-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Sparkles size={14} color="var(--blue-accent-dark)" />
                      <span className="chat-ai-avatar">Compassionate Guide</span>
                      {msg.isAiGenerated ? (
                        <span
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 600,
                            background: '#E0F2FE',
                            color: '#0369A1',
                            padding: '1px 6px',
                            borderRadius: '8px',
                            letterSpacing: '0.02em',
                          }}
                        >
                          Cloud Reflection
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 500,
                            background: '#F1F5F9',
                            color: '#64748B',
                            padding: '1px 6px',
                            borderRadius: '8px',
                            letterSpacing: '0.02em',
                          }}
                        >
                          Sanctuary Companion
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{msg.timestamp}</span>
                  </div>

                  <p className="chat-ai-text">"{msg.text}"</p>

                  {/* Immediate Crisis Support Card if crisis keywords triggered */}
                  {msg.isCrisis && (
                    <div style={{ marginTop: '10px', padding: '10px 12px', background: '#FEF2F2', borderRadius: 'var(--radius-md)', border: '1px solid #FECACA' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#B91C1C', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <PhoneCall size={14} />
                        <span>Immediate 24/7 Crisis Support Available</span>
                      </div>
                      <p style={{ fontSize: '0.78rem', color: '#7F1D1D', lineHeight: 1.4, margin: '0 0 8px 0' }}>
                        You are deeply valued and not alone. Free, confidential support is available right now:
                      </p>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                        <a
                          href="tel:988"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#DC2626',
                            color: '#FFFFFF',
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            textDecoration: 'none',
                          }}
                        >
                          <PhoneCall size={12} />
                          <span>Call or Text 988</span>
                        </a>
                        <a
                          href="sms:741741?body=HOME"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#FFFFFF',
                            color: '#B91C1C',
                            border: '1px solid #FECACA',
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            textDecoration: 'none',
                          }}
                        >
                          <MessageSquare size={12} />
                          <span>Text HOME to 741741</span>
                        </a>
                        <button
                          type="button"
                          onClick={() => onNavigateTab('support')}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: '#7F1D1D',
                            color: '#FFFFFF',
                            border: 'none',
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-full)',
                            fontSize: '0.76rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <Heart size={12} />
                          <span>International Crisis Directory (PH 1553, UK 111, AU 131114, CA 988)</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Suggestions after talking */}
                  {msg.shouldShowResources && (
                    <div className="chat-actions-container">
                      <span className="chat-actions-label">Gentle Suggestions After Our Chat:</span>
                      <div className="chat-actions-wrap">
                        <button
                          onClick={() => onNavigateDiscoverPillar?.('professional')}
                          className="chat-action-btn"
                        >
                          <Wind size={13} />
                          <span>4-7-8 Breathing Calm</span>
                        </button>

                        <button
                          onClick={() => onOpenDevotional(TODAY_DEVOTIONAL)}
                          className="chat-action-btn"
                        >
                          <BookOpen size={13} />
                          <span>Daily Scripture</span>
                        </button>

                        <button
                          onClick={() => onNavigateTab('support')}
                          className="chat-action-btn"
                        >
                          <Heart size={13} />
                          <span>Request Prayer</span>
                        </button>

                        <button
                          onClick={() => onNavigateTab('discover')}
                          className="chat-action-btn"
                        >
                          <HeartHandshake size={13} />
                          <span>Helping Hands</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </React.Fragment>
          ))}

          {isAiThinking && (
            <div className="chat-thinking-bubble">
              <Sparkles size={14} color="var(--blue-accent-dark)" />
              <span>Compassionate Guide is reflecting with grace...</span>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>
      )}

      {/* Cloud AI Notice Banner */}
      {cloudAiNotice && (
        <div
          role="alert"
          style={{
            background: '#FEF3C7',
            border: '1px solid #FDE68A',
            borderRadius: 'var(--radius-md, 10px)',
            padding: '8px 12px',
            fontSize: '0.78rem',
            color: '#92400E',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '8px',
            margin: '0 4px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <AlertCircle size={14} color="#D97706" style={{ flexShrink: 0 }} />
            <span>{cloudAiNotice}</span>
          </div>
          <button
            onClick={() => setCloudAiNotice(null)}
            aria-label="Dismiss notice"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#92400E', padding: '2px' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Mode Selector Pill before conversation starts */}
      {!isConversationActive && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', margin: '2px 0 6px 0' }}>
          <button
            type="button"
            onClick={handleToggleCompanionMode}
            style={{
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '4px 12px',
              borderRadius: 'var(--radius-full, 9999px)',
              border: companionMode === 'cloud' ? '1px solid #7DD3FC' : '1px solid #E2E8F0',
              background: companionMode === 'cloud' ? '#E0F2FE' : '#FFFFFF',
              color: companionMode === 'cloud' ? '#0369A1' : '#64748B',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            {companionMode === 'cloud' ? (
              <>
                <Sparkles size={12} color="#0284C7" />
                <span>Mode: Cloud AI Guide (Gemini)</span>
              </>
            ) : (
              <>
                <WifiOff size={12} color="#64748B" />
                <span>Mode: Sanctuary Companion (Offline)</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Quick starter prompts before conversation starts */}
      {!isConversationActive && (
        <div className="chat-quick-prompts-carousel">
          {QUICK_PROMPTS.map((promptText) => (
            <button
              key={promptText}
              type="button"
              onClick={() => handleChatSubmit(undefined, promptText)}
              className="chat-quick-prompt-pill"
            >
              {promptText}
            </button>
          ))}
        </div>
      )}

      {/* Chat Input Card + Feeling Chips */}
      {conversationTurn < 2 ? (
        <div className="home-chat-card">
          {selectedTags.length > 0 && (
            <div className="chat-selected-ribbon">
              {selectedTags.map((tagId) => {
                const label = FEELING_PILLS.find((p) => p.id === tagId)?.label || tagId;
                return (
                  <div key={tagId} className="chat-selected-feeling-chip">
                    <span>{label}</span>
                    <button
                      type="button"
                      onClick={() => handleTagToggle(tagId)}
                      className="chat-selected-tag-remove"
                      title={`Remove ${label}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {voiceNotice && (
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                color: '#991B1B',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                fontSize: '0.74rem',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <AlertCircle size={13} color="#DC2626" style={{ flexShrink: 0 }} />
              <span>{voiceNotice}</span>
            </div>
          )}

          {isListening && (
            <div
              onClick={toggleListening}
              role="button"
              tabIndex={0}
              style={{
                background: '#EFF6FF',
                border: '1px solid #BFDBFE',
                color: 'var(--blue-accent-dark)',
                borderRadius: 'var(--radius-sm)',
                padding: '7px 12px',
                fontSize: '0.74rem',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                userSelect: 'none',
              }}
              title="Click anywhere on this bar to stop listening"
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
                <span className="voice-listening-dot" />
                <span>Listening... Speak your reflection</span>
              </div>
              <span style={{ fontSize: '0.70rem', color: '#DC2626', fontWeight: 700 }}>Tap to stop</span>
            </div>
          )}

          <form onSubmit={handleChatSubmit} style={{ margin: 0 }}>
            {checkInDraft.hasDraft && (
              <div
                style={{
                  background: 'var(--blue-light-sky, #e0f2fe)',
                  border: '1px solid var(--border-subtle, #bae6fd)',
                  borderRadius: 'var(--radius-sm, 8px)',
                  padding: '6px 12px',
                  fontSize: '0.78rem',
                  color: 'var(--blue-accent-dark, #0284c7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                  marginBottom: '8px',
                }}
              >
                <span>Restored unfinished check-in draft.</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={checkInDraft.restoreDraft}
                    style={{
                      fontSize: '0.76rem',
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
                    onClick={() => checkInDraft.discardDraft()}
                    style={{
                      fontSize: '0.76rem',
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
            <div className="home-chat-input-row">
              <input
                ref={inputRef}
                id="home-mood-text"
                type="text"
                value={customText}
                onChange={(e) => {
                  if (isListening) {
                    setIsListening(false);
                    voiceService.stopListening();
                  }
                  setCustomText(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleChatSubmit(e);
                  }
                }}
                enterKeyHint="send"
                placeholder={isListening ? 'Listening... Speak from your heart' : getPlaceholderText()}
                className="home-chat-input"
              />
              <button
                type="button"
                onClick={toggleListening}
                className={`btn-chat-mic ${isListening ? 'active' : ''}`}
                title={isListening ? 'Stop listening' : 'Speak your check-in'}
              >
                {isListening ? <MicOff size={15} color="#DC2626" /> : <Mic size={15} />}
              </button>
              <button
                id="btn-submit-mood-text"
                type="submit"
                disabled={!customText.trim() && selectedTags.length === 0}
                className={`btn-chat-send ${customText.trim() || selectedTags.length > 0 ? 'ready' : 'disabled'}`}
                title="Send message"
              >
                <Send size={15} />
              </button>
            </div>
          </form>

          {/* Emotion Pills */}
          <div className="feeling-pills-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="feeling-pills-label">How are you feeling?</span>
              {selectedTags.length > 0 && (
                <button
                  onClick={() => setSelectedTags([])}
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcw size={11} />
                  <span>Clear ({selectedTags.length})</span>
                </button>
              )}
            </div>
            <div className="feeling-pills-wrap">
              {FEELING_PILLS.map((pill) => {
                const isSelected = selectedTags.includes(pill.id);
                return (
                  <button
                    key={pill.id}
                    id={`mood-chip-${pill.id}`}
                    type="button"
                    onClick={() => handleTagToggle(pill.id)}
                    className={`feeling-pill ${isSelected ? 'active' : ''}`}
                  >
                    <span className="feeling-pill-dot" />
                    <span>{pill.label}</span>
                  </button>
                );
              })}
            </div>

            {selectedTags.length > 0 && !customText.trim() && (
              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
                <button
                  type="button"
                  onClick={() => handleChatSubmit()}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '8px',
                    background: 'var(--blue-accent-dark)',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: 'var(--radius-full)',
                    padding: '8px 18px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 2px 10px rgba(2, 132, 199, 0.28)',
                  }}
                >
                  <Send size={13} />
                  <span>Check In with {selectedTags.length === 1 ? 'this feeling' : 'these feelings'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="home-chat-completed-card">
          <div>
            <div style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Sanctuary check-in complete
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Holding space for your day. You can explore all paths below.
            </div>
          </div>
          <button
            type="button"
            onClick={handleResetCheckIn}
            className="btn-sanctuary-reset"
            title="Start a new check-in"
          >
            <RotateCcw size={12} />
            <span>Start New Check-in</span>
          </button>
        </div>
      )}

      {/* Cloud AI Informed Consent Modal */}
      <CloudAiConsentModal
        isOpen={isConsentModalOpen}
        onClose={() => setIsConsentModalOpen(false)}
        onConfirmConsent={handleConfirmConsent}
        onDeclineConsent={handleDeclineConsent}
      />
    </>
  );
};
