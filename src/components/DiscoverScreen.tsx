import React, { useState, useEffect } from 'react';
import {
  HeartHandshake,
  Feather,
  Sparkles,
  ChevronRight,
  CheckCircle2,
  Circle,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Play,
  Heart,
  PlusCircle,
  X,
  Eye,
  ShieldCheck,
} from 'lucide-react';
import type {
  Devotional,
  HelpingHandsModule,
  ContentItem,
  DiscoverPillarId,
  VideoItem,
  TestimonyItem,
  ProfessionalArticle,
  MoodId,
} from '../types';
import {
  DEVOTIONAL_ARCHIVE,
  CURATED_VIDEOS,
  COMMUNITY_TESTIMONIES,
  PROFESSIONAL_ARTICLES,
  TODAY_DEVOTIONAL,
} from '../data/mockData';
import { contentCatalogService, type PublicCatalogSnapshot } from '../services/contentCatalogService';
import { haptics } from '../services/hapticsService';
import { lifecycleManager } from '../services/lifecycleManager';
import { parseVideoUrl } from '../utils/videoUtils';

interface DiscoverScreenProps {
  onOpenDevotional: (devotional: Devotional) => void;
  onOpenContentItem: (item: ContentItem) => void;
  helpingHandsModules: HelpingHandsModule[];
  onToggleCompleteStep: (moduleId: string, stepId: string) => void;
  onSaveStepNote: (moduleId: string, stepId: string, note: string) => void;
  initialPillar?: DiscoverPillarId;
  initialTopicTag?: string;
  onOpenAdminModal?: () => void;
  isTabVisible?: boolean;
}

const BIBLE_TOPIC_FILTERS = [
  { id: 'all', label: 'All Readings' },
  { id: 'anxiety', label: 'Anxiety & Peace', tag: 'Anxiety & Peace' },
  { id: 'burnout', label: 'Burnout & Rest', tag: 'Burnout & Rest' },
  { id: 'grief', label: 'Grief & Comfort', tag: 'Grief & Comfort' },
  { id: 'parenting', label: 'Parenting Patience', tag: 'Parenting Patience' },
  { id: 'hope', label: 'Hope & Renewal', tag: 'Hope & Renewal' },
];

const VIDEO_EMOTION_FILTERS = [
  { id: 'hopeful', label: 'Hope & Renewal' },
  { id: 'peaceful', label: 'Quiet Peace' },
  { id: 'parenting', label: 'Patience & Parenting' },
  { id: 'tired', label: 'Rest & Burnout' },
  { id: 'anxious', label: 'Anxiety & Grounding' },
  { id: 'sad', label: 'Grief & Comfort' },
  { id: 'grateful', label: 'Gratitude' },
  { id: 'all', label: 'All Clips' },
];

const CLINICAL_FILTERS = [
  { id: 'all', label: 'All Tools' },
  { id: 'anxiety', label: 'Anxiety & Panic', tag: 'Anxiety & Panic' },
  { id: 'burnout', label: 'Burnout & Rest', tag: 'Burnout & Rest' },
  { id: 'grief', label: 'Grief & Loss', tag: 'Grief & Loss' },
  { id: 'parenting', label: 'Parenting Triggers', tag: 'Parenting' },
];

export const DiscoverScreen: React.FC<DiscoverScreenProps> = ({
  onOpenDevotional,
  onOpenContentItem: _onOpenContentItem,
  helpingHandsModules,
  onToggleCompleteStep,
  onSaveStepNote,
  initialPillar = 'bible',
  initialTopicTag = 'All',
  onOpenAdminModal: _onOpenAdminModal,
  isTabVisible = true,
}) => {
  // 4 Core Pillars: Bible, Videos, Testimonies, Professional
  const [activePillar, setActivePillar] = useState<DiscoverPillarId>(initialPillar);
  const [selectedBibleTopic, setSelectedBibleTopic] = useState<string>('all');
  const [selectedVideoEmotion, setSelectedVideoEmotion] = useState<string | null>(null);
  const [selectedClinicalTopic, setSelectedClinicalTopic] = useState<string>('all');

  // Track previous prop values to synchronize state changes without cascading effect renders
  const [prevInitialPillar, setPrevInitialPillar] = useState(initialPillar);
  if (initialPillar !== prevInitialPillar) {
    setPrevInitialPillar(initialPillar);
    if (initialPillar) {
      setActivePillar(initialPillar);
    }
  }

  const [prevInitialTopicTag, setPrevInitialTopicTag] = useState(initialTopicTag);
  if (initialTopicTag !== prevInitialTopicTag) {
    setPrevInitialTopicTag(initialTopicTag);
    if (initialTopicTag && initialTopicTag !== 'All') {
      const lower = initialTopicTag.toLowerCase();
      if (lower.includes('anxiety')) {
        setSelectedBibleTopic('anxiety');
        setSelectedClinicalTopic('anxiety');
        setSelectedVideoEmotion('anxious');
      } else if (lower.includes('burnout') || lower.includes('rest')) {
        setSelectedBibleTopic('burnout');
        setSelectedClinicalTopic('burnout');
        setSelectedVideoEmotion('tired');
      } else if (lower.includes('parenting')) {
        setSelectedBibleTopic('parenting');
        setSelectedClinicalTopic('parenting');
        setSelectedVideoEmotion('parenting');
      }
    }
  }

  // Helping Hands & Step State
  const [expandedStepId, setExpandedStepId] = useState<string>('step-1-1');
  const [stepNotes, setStepNotes] = useState<Record<string, string>>({});

  // 4-7-8 Breath Pacer State
  const [isBreathingActive, setIsBreathingActive] = useState(false);
  const [breathPhase, setBreathPhase] = useState<'Inhale' | 'Hold' | 'Exhale'>('Inhale');
  const [breathSeconds, setBreathSeconds] = useState(4);

  // Synchronize tab visibility without cascading effect renders
  const [prevTabVisible, setPrevTabVisible] = useState(isTabVisible);
  if (isTabVisible !== prevTabVisible) {
    setPrevTabVisible(isTabVisible);
    if (!isTabVisible && isBreathingActive) {
      setIsBreathingActive(false);
      setBreathSeconds(4);
      setBreathPhase('Inhale');
    }
  }

  // Reduced motion preference detection
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, []);

  // Pause breathing when app is backgrounded
  useEffect(() => {
    return lifecycleManager.registerOnBackground(() => {
      setIsBreathingActive(false);
      setBreathSeconds(4);
      setBreathPhase('Inhale');
    });
  }, []);

  // P2P Testimonies Local State
  const [testimonies, setTestimonies] = useState<TestimonyItem[]>(COMMUNITY_TESTIMONIES);
  const [isShareStoryOpen, setIsShareStoryOpen] = useState(false);
  const [storyAuthor, setStoryAuthor] = useState('');
  const [storyIsAnonymous, setStoryIsAnonymous] = useState(false);
  const [storyTopic, setStoryTopic] = useState('Grief & Loss');
  const [storyStruggle, setStoryStruggle] = useState('');
  const [storyTurningPoint, setStoryTurningPoint] = useState('');
  const [storyHealing, setStoryHealing] = useState('');
  const [storyScripture, setStoryScripture] = useState('');
  const [storySubmittedBanner, setStorySubmittedBanner] = useState(false);

  // Active Video Modal
  const [activeVideo, setActiveVideo] = useState<VideoItem | null>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [resolvedVideoPlaybackUrl, setResolvedVideoPlaybackUrl] = useState<string | null>(null);

  const handleCloseVideo = () => {
    setActiveVideo(null);
    setIsVideoPlaying(false);
    setResolvedVideoPlaybackUrl(null);
  };

  useEffect(() => {
    if (!activeVideo?.videoUrl) return;
    let isMounted = true;
    contentCatalogService
      .getVideoPlaybackUrl(activeVideo.videoUrl)
      .then((url) => {
        if (isMounted) setResolvedVideoPlaybackUrl(url);
      })
      .catch(() => {
        if (isMounted) setResolvedVideoPlaybackUrl(activeVideo.videoUrl || null);
      });
    return () => {
      isMounted = false;
    };
  }, [activeVideo?.videoUrl]);

  // Active Professional Article Modal
  const [activeArticle, setActiveArticle] = useState<ProfessionalArticle | null>(null);

  // Curated Content Catalog (Offline-First, Cached)
  const [catalogSnapshot, setCatalogSnapshot] = useState<PublicCatalogSnapshot | null>(null);
  const [isCatalogRefreshing, setIsCatalogRefreshing] = useState(false);

  useEffect(() => {
    let active = true;
    contentCatalogService
      .getCatalog()
      .then((snapshot) => {
        if (active) setCatalogSnapshot(snapshot);
      })
      .catch((err) => {
        console.warn('Unable to load curated catalog:', err);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleRefreshCatalog = async () => {
    setIsCatalogRefreshing(true);
    try {
      const fresh = await contentCatalogService.getCatalog(true);
      setCatalogSnapshot(fresh);
    } catch (e) {
      console.warn('Manual catalog refresh failed:', e);
    } finally {
      setIsCatalogRefreshing(false);
    }
  };

  // Affirmations
  const affirmations = [
    {
      truth: 'I am not defined by past trauma, family dysfunction, or yesterday’s mistakes.',
      scripture: '2 Corinthians 5:17 — The old has passed away; behold, the new has come.',
    },
    {
      truth: 'God’s grace covers my parenting mistakes as I learn to respond in patience and love.',
      scripture: 'Lamentations 3:22-23 — His mercies are new every morning; great is His faithfulness.',
    },
    {
      truth: 'I am safe in God’s presence. I do not need to fight, freeze, or panic.',
      scripture: 'Psalm 46:10 — Be still, and know that I am God.',
    },
    {
      truth: 'Healing is a gentle process of small steps, not a race to perfection.',
      scripture: 'Isaiah 40:29 — He gives strength to the weary and increases the power of the weak.',
    },
  ];
  const [affirmationIdx, setAffirmationIdx] = useState(0);

  // Breath pacing interval with tactile haptic trauma grounding
  useEffect(() => {
    let interval: any = null;
    if (isBreathingActive) {
      interval = setInterval(() => {
        setBreathSeconds((prev) => {
          if (prev <= 1) {
            haptics.medium();
            if (breathPhase === 'Inhale') {
              setBreathPhase('Hold');
              return 7;
            } else if (breathPhase === 'Hold') {
              setBreathPhase('Exhale');
              return 8;
            } else {
              setBreathPhase('Inhale');
              return 4;
            }
          }
          haptics.light();
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isBreathingActive, breathPhase]);

  const handleNoteChange = (stepId: string, val: string) => {
    setStepNotes((prev) => ({ ...prev, [stepId]: val }));
  };

  const handleSaveStepReflection = (moduleId: string, stepId: string) => {
    const note = stepNotes[stepId] ?? '';
    onSaveStepNote(moduleId, stepId, note);
  };

  // Toggle Encouragement on Testimony
  const handleToggleEncourage = (id: string) => {
    setTestimonies((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const nextEncouraged = !item.isEncouragedByMe;
          return {
            ...item,
            isEncouragedByMe: nextEncouraged,
            encouragementsCount: nextEncouraged
              ? item.encouragementsCount + 1
              : item.encouragementsCount - 1,
          };
        }
        return item;
      })
    );
  };

  // Handle Share Story Submission
  const handleSubmitStory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!storyStruggle.trim() || !storyHealing.trim()) return;

    const newTestimony: TestimonyItem = {
      id: `test-${Date.now()}`,
      authorName: storyIsAnonymous || !storyAuthor.trim() ? 'Anonymous' : storyAuthor.trim(),
      authorLifeStage: 'Community Member • Shared with Consent',
      topicTag: storyTopic,
      emotionalTags: ['hopeful', 'peaceful'],
      struggle: storyStruggle.trim(),
      turningPoint: storyTurningPoint.trim() || 'Finding quiet prayer and surrender in God’s presence.',
      healingOutcome: storyHealing.trim(),
      scriptureAnchor: storyScripture.trim() || 'Psalm 147:3',
      dateStr: 'Just now',
      encouragementsCount: 1,
      isEncouragedByMe: true,
      status: 'approved',
    };

    setTestimonies([newTestimony, ...testimonies]);
    setIsShareStoryOpen(false);
    setStoryStruggle('');
    setStoryTurningPoint('');
    setStoryHealing('');
    setStoryScripture('');
    setStoryAuthor('');
    setStorySubmittedBanner(true);
    setTimeout(() => setStorySubmittedBanner(false), 5000);
  };

  // Data from Curated Catalog Service (or mock fallbacks if not yet initialized)
  const devotionalsCatalog = catalogSnapshot?.devotionals || [TODAY_DEVOTIONAL, ...DEVOTIONAL_ARCHIVE];
  const videosCatalog = catalogSnapshot?.videos || CURATED_VIDEOS;
  const articlesCatalog = catalogSnapshot?.articles || PROFESSIONAL_ARTICLES;

  const todayDevotional = devotionalsCatalog[0] || TODAY_DEVOTIONAL;
  const devotionalArchive = devotionalsCatalog.length > 1 ? devotionalsCatalog.slice(1) : devotionalsCatalog;

  // Filtering logic
  const filteredDevotionals = devotionalArchive.filter((d) => {
    if (selectedBibleTopic === 'all') return true;
    const filterObj = BIBLE_TOPIC_FILTERS.find((f) => f.id === selectedBibleTopic);
    if (!filterObj || !filterObj.tag) return true;
    return d.topicTags?.some((t) => t.toLowerCase().includes(filterObj.tag.toLowerCase()));
  });

  const filteredVideos = videosCatalog.filter((v) => {
    if (!selectedVideoEmotion) return false;
    if (selectedVideoEmotion === 'all') return true;
    if (selectedVideoEmotion === 'parenting') {
      return (
        v.topicTags.some((t) => t.toLowerCase().includes('parenting')) ||
        v.emotionalTags?.includes('frustrated')
      );
    }
    return v.emotionalTags?.includes(selectedVideoEmotion as MoodId);
  });

  const filteredTestimonies = testimonies;

  const filteredArticles = articlesCatalog.filter((a) => {
    if (selectedClinicalTopic === 'all') return true;
    const filterObj = CLINICAL_FILTERS.find((f) => f.id === selectedClinicalTopic);
    if (!filterObj || !filterObj.tag) return true;
    return a.topicTags.some((t) => t.toLowerCase().includes(filterObj.tag.toLowerCase()));
  });

  const currentAffirmation = affirmations[affirmationIdx];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      {/* Offline Curated Library Status Banner */}
      {catalogSnapshot?.isOfflineFallback && (
        <div
          data-testid="offline-catalog-indicator"
          style={{
            background: '#F1F5F9',
            border: '1px solid #CBD5E1',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.76rem',
            color: '#475569',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: '#94A3B8',
                display: 'inline-block',
              }}
            />
            <span>Offline Mode • Viewing downloaded curated resources</span>
          </div>
          <button
            onClick={handleRefreshCatalog}
            disabled={isCatalogRefreshing}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--blue-accent-dark)',
              fontWeight: 600,
              fontSize: '0.74rem',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <RefreshCw size={12} className={isCatalogRefreshing ? 'animate-spin' : ''} />
            <span>Check Updates</span>
          </button>
        </div>
      )}

      {/* Header with Title */}
      <div>
        <span
          style={{
            fontSize: '0.74rem',
            fontWeight: 700,
            color: 'var(--blue-accent-dark)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          4 Pillars of Healing
        </span>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
          Discover Resources
        </h1>
        <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
          Faith-anchored scripture, short-form video clips, peer recovery stories, and clinical tools.
        </p>
      </div>

      {/* 4 Core Pillars Navigation Bar */}
      <div className="pillar-tabs-bar">
        <button
          onClick={(e) => {
            setActivePillar('bible');
            e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }}
          className={`pillar-tab-btn ${activePillar === 'bible' ? 'active' : ''}`}
        >
          <span>Bible</span>
        </button>
        <button
          onClick={(e) => {
            setActivePillar('videos');
            e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }}
          className={`pillar-tab-btn ${activePillar === 'videos' ? 'active' : ''}`}
        >
          <span>Videos</span>
        </button>
        <button
          onClick={(e) => {
            setActivePillar('testimonies');
            e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }}
          className={`pillar-tab-btn ${activePillar === 'testimonies' ? 'active' : ''}`}
        >
          <span className="pillar-label-full">Testimonies</span>
          <span className="pillar-label-short">Stories</span>
        </button>
        <button
          onClick={(e) => {
            setActivePillar('professional');
            e.currentTarget.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
          }}
          className={`pillar-tab-btn ${activePillar === 'professional' ? 'active' : ''}`}
        >
          <span className="pillar-label-full">Professional</span>
          <span className="pillar-label-short">Clinical</span>
        </button>
      </div>

      {/* Story Submitted Success Banner */}
      {storySubmittedBanner && (
        <div
          style={{
            background: '#ECFDF5',
            border: '1px solid #A7F3D0',
            color: '#065F46',
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.86rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            animation: 'fadeIn 0.3s ease',
          }}
        >
          <CheckCircle2 size={18} color="#059669" />
          <span>Thank you for sharing your story. Your vulnerability will encourage someone today.</span>
        </div>
      )}

      {/* ======================================================== */}
      {/* 1. PILLAR: BIBLE (Devotionals & Scripture) */}
      {/* ======================================================== */}
      {activePillar === 'bible' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* Today's Featured Reading */}
          <div
            className="powder-card"
            style={{
              border: '1px solid var(--blue-accent)',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: '#FFFFFF',
                  color: 'var(--blue-accent-dark)',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                }}
              >
                Today’s Reflection Anchor
              </span>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                {todayDevotional.readingTimeMinutes} min read
              </span>
            </div>

            <div style={{ fontSize: '1.04rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {todayDevotional.title}
            </div>

            <div className="scripture-ref">{todayDevotional.scriptureRef}</div>

            <p style={{ fontSize: '0.86rem', color: 'var(--text-primary)', fontStyle: 'italic', lineHeight: 1.5 }}>
              "{todayDevotional.scriptureText}"
            </p>

            <button
              onClick={() => onOpenDevotional(todayDevotional)}
              className="btn-primary"
              style={{ alignSelf: 'flex-start', marginTop: '4px', fontSize: '0.84rem', padding: '8px 16px' }}
            >
              <span>Read Full Devotional</span>
              <ChevronRight size={15} />
            </button>
          </div>

          {/* Scripture Need Selector */}
          <div>
            <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              What scripture anchor does your soul need today?
            </div>
            <div className="emotion-filter-bar" style={{ marginBottom: '10px' }}>
              {BIBLE_TOPIC_FILTERS.map((bf) => (
                <button
                  key={bf.id}
                  type="button"
                  onClick={() => setSelectedBibleTopic(bf.id)}
                  className={`emotion-filter-btn ${selectedBibleTopic === bf.id ? 'active' : ''}`}
                >
                  {bf.label}
                </button>
              ))}
            </div>
          </div>

          {/* Devotionals Archive List */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <h2 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Scripture & Devotional Archive
              </h2>
              <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                {filteredDevotionals.length} {filteredDevotionals.length === 1 ? 'reading' : 'readings'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filteredDevotionals.map((dev) => (
                <div
                  key={dev.id}
                  className="white-card"
                  onClick={() => onOpenDevotional(dev)}
                  style={{
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 16px',
                  }}
                >
                  <div style={{ flex: 1, paddingRight: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--blue-accent-dark)', fontWeight: 600 }}>
                        {dev.date}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        • {dev.readingTimeMinutes} min
                      </span>
                    </div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                      {dev.title}
                    </div>
                    <div className="scripture-ref" style={{ marginTop: '2px' }}>
                      {dev.scriptureRef}
                    </div>
                  </div>
                  <ChevronRight size={18} color="var(--text-muted)" />
                </div>
              ))}
            </div>
          </div>

          {/* Truth Affirmation Carousel */}
          <div className="white-card" style={{ padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={16} color="var(--blue-accent-dark)" />
                <h3 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Scripture Truth Affirmation
                </h3>
              </div>
              <button
                onClick={() => setAffirmationIdx((prev) => (prev + 1) % affirmations.length)}
                style={{
                  fontSize: '0.74rem',
                  color: 'var(--text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontWeight: 600,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={12} />
                <span>Next ({affirmationIdx + 1}/{affirmations.length})</span>
              </button>
            </div>

            <div
              style={{
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius-md)',
                padding: '14px',
                marginTop: '10px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '0.94rem', fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.5 }}>
                "{currentAffirmation.truth}"
              </div>
              <div className="scripture-ref" style={{ marginTop: '8px' }}>
                {currentAffirmation.scripture}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 2. PILLAR: VIDEOS (TikTok / Short-Form Video Clips) */}
      {/* ======================================================== */}
      {activePillar === 'videos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <h2 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Short-Form Faith & Wellness Clips
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              60-second bite-sized clips tailored to your emotional state.
            </p>
          </div>

          {/* Emotion Choice Selector */}
          <div>
            <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              What does your heart need right now?
            </div>
            <div className="emotion-filter-bar">
              {VIDEO_EMOTION_FILTERS.map((ef) => (
                <button
                  key={ef.id}
                  type="button"
                  onClick={() => setSelectedVideoEmotion(ef.id)}
                  className={`emotion-filter-btn ${selectedVideoEmotion === ef.id ? 'active' : ''}`}
                >
                  {ef.label}
                </button>
              ))}
            </div>
          </div>

          {!selectedVideoEmotion ? (
            <div className="white-card" style={{ textAlign: 'center', padding: '24px 16px' }}>
              <div style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Choose What Your Heart Needs
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.45 }}>
                Select an emotional focus above to view curated 60-second clips for your healing journey.
              </p>
            </div>
          ) : (
            <>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                Showing {filteredVideos.length} {filteredVideos.length === 1 ? 'clip' : 'clips'} for {VIDEO_EMOTION_FILTERS.find((f) => f.id === selectedVideoEmotion)?.label || 'All'}.
              </div>

              <div className="video-cards-grid">
                {filteredVideos.map((video) => (
                  <div
                    key={video.id}
                    className="video-card"
                    style={{ background: video.thumbnailGradient }}
                    onClick={() => {
                      setActiveVideo(video);
                      setIsVideoPlaying(true);
                    }}
                  >
                    {/* Top Badges */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span
                        style={{
                          background: 'rgba(0,0,0,0.45)',
                          backdropFilter: 'blur(4px)',
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                        }}
                      >
                        {video.topicTags[0]}
                      </span>
                      <span
                        style={{
                          background: 'rgba(0,0,0,0.45)',
                          backdropFilter: 'blur(4px)',
                          padding: '3px 8px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                        }}
                      >
                        {video.durationSeconds}s
                      </span>
                    </div>

                    {/* Center Play Button Overlay */}
                    <div className="video-play-center">
                      <Play size={22} fill="#FFFFFF" color="#FFFFFF" style={{ marginLeft: '3px' }} />
                    </div>

                    {/* Bottom Metadata */}
                    <div>
                      <div style={{ fontSize: '0.94rem', fontWeight: 700, lineHeight: 1.35 }}>
                        {video.title}
                      </div>
                      <div style={{ fontSize: '0.74rem', opacity: 0.9, marginTop: '4px' }}>
                        By {video.creator}
                      </div>
                      <div style={{ display: 'flex', gap: '12px', fontSize: '0.72rem', opacity: 0.85, marginTop: '6px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <Eye size={12} /> {video.viewsCount}
                        </span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                          <Heart size={12} fill="#FFFFFF" /> {video.likesCount}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ======================================================== */}
      {/* 3. PILLAR: TESTIMONIES (Peer-to-Peer Community Diary) */}
      {/* ======================================================== */}
      {activePillar === 'testimonies' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Share Your Story Callout Banner */}
          <div
            style={{
              background: 'linear-gradient(135deg, #E0F2FE 0%, #BAE6FD 100%)',
              border: '1px solid var(--blue-accent)',
              borderRadius: 'var(--radius-lg)',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '10px',
            }}
          >
            <div>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--blue-accent-dark)', textTransform: 'uppercase' }}>
                Shared Journeys
              </span>
              <h2 style={{ fontSize: '1.02rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '2px' }}>
                You Are Not Walking Alone
              </h2>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.45, marginTop: '4px' }}>
                Real stories of peers in their 20s and 30s who walked through grief, marriage heartbreak, and burnout, and found God’s healing.
              </p>
            </div>

            <button
              onClick={() => setIsShareStoryOpen(true)}
              className="btn-primary dark-accent"
              style={{ alignSelf: 'flex-start', fontSize: '0.82rem', padding: '8px 16px' }}
            >
              <PlusCircle size={15} />
              <span>Share Your Story</span>
            </button>
          </div>

          {/* Testimonies Feed */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {filteredTestimonies.map((item) => (
              <div key={item.id} className="testimony-card">
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.94rem', color: 'var(--text-primary)' }}>
                      {item.authorName}
                    </div>
                    {item.authorLifeStage && (
                      <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                        {item.authorLifeStage} • {item.dateStr}
                      </div>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      background: 'var(--blue-light-sky)',
                      color: 'var(--text-primary)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                    }}
                  >
                    #{item.topicTag}
                  </span>
                </div>

                {/* Step 1: The Struggle */}
                <div className="testimony-step-box">
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--blue-accent-dark)', textTransform: 'uppercase' }}>
                    The Struggle:
                  </div>
                  <p style={{ marginTop: '2px' }}>{item.struggle}</p>
                </div>

                {/* Step 2: The Turning Point */}
                <div className="testimony-step-box" style={{ borderLeftColor: '#F59E0B' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#B45309', textTransform: 'uppercase' }}>
                    The Turning Point:
                  </div>
                  <p style={{ marginTop: '2px' }}>{item.turningPoint}</p>
                </div>

                {/* Step 3: The Healing Outcome */}
                <div className="testimony-step-box" style={{ borderLeftColor: '#10B981' }}>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#047857', textTransform: 'uppercase' }}>
                    Healing & Restoration:
                  </div>
                  <p style={{ marginTop: '2px' }}>{item.healingOutcome}</p>
                </div>

                {/* Scripture Anchor */}
                {item.scriptureAnchor && (
                  <div className="scripture-ref" style={{ fontStyle: 'italic', fontSize: '0.78rem' }}>
                    Anchor: {item.scriptureAnchor}
                  </div>
                )}

                {/* Actions: Encouraged Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-subtle)', paddingTop: '10px' }}>
                  <button
                    onClick={() => handleToggleEncourage(item.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '0.78rem',
                      color: item.isEncouragedByMe ? '#E11D48' : 'var(--text-secondary)',
                      background: item.isEncouragedByMe ? '#FFE4E6' : 'none',
                      border: '1px solid',
                      borderColor: item.isEncouragedByMe ? '#FDA4AF' : 'var(--border-subtle)',
                      borderRadius: 'var(--radius-full)',
                      padding: '5px 12px',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <Heart size={14} fill={item.isEncouragedByMe ? '#E11D48' : 'none'} />
                    <span>{item.isEncouragedByMe ? 'Prayed & Encouraged' : 'Encouraged by this'} ({item.encouragementsCount})</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 4. PILLAR: PROFESSIONAL (Trauma Clinical Guidance & Steps) */}
      {/* ======================================================== */}
      {activePillar === 'professional' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <h2 style={{ fontSize: '0.98rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              Trauma-Informed Clinical Advice
            </h2>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Insights from licensed psychologists, nervous system clinicians, and pastoral counselors.
            </p>
          </div>

          {/* Clinical Focus Selector */}
          <div>
            <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              What clinical guidance do you need today?
            </div>
            <div className="emotion-filter-bar">
              {CLINICAL_FILTERS.map((cf) => (
                <button
                  key={cf.id}
                  type="button"
                  onClick={() => setSelectedClinicalTopic(cf.id)}
                  className={`emotion-filter-btn ${selectedClinicalTopic === cf.id ? 'active' : ''}`}
                >
                  {cf.label}
                </button>
              ))}
            </div>
          </div>

          {/* Clinical Articles */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {filteredArticles.map((article) => (
              <div
                key={article.id}
                className="white-card"
                onClick={() => setActiveArticle(article)}
                style={{ cursor: 'pointer', padding: '16px' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      background: '#F3E8FF',
                      color: '#7E22CE',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-full)',
                    }}
                  >
                    {article.topicTags[0]}
                  </span>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                    {article.readingTimeMinutes} min read
                  </span>
                </div>

                <div style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '6px' }}>
                  {article.title}
                </div>
                <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  {article.author} • {article.credentials}
                </div>

                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.45 }}>
                  {article.summary}
                </p>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', color: 'var(--blue-accent-dark)', fontWeight: 600, marginTop: '10px' }}>
                  <span>Read Article & Somatic Practice</span>
                  <ChevronRight size={15} />
                </div>
              </div>
            ))}
          </div>

          {/* 4-7-8 Breath Pacer Interactive Component */}
          <div className="white-card" style={{ textAlign: 'center', padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Feather size={17} color="var(--blue-accent-dark)" />
              <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                4-7-8 Trauma-Calming Breath Pacer
              </h3>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Signals physiological safety to an overwhelmed nervous system.
            </p>

            <div
              role="timer"
              aria-live="polite"
              aria-atomic="true"
              aria-label={`4-7-8 Breathing Pacer: ${
                isBreathingActive
                  ? `${breathPhase}, ${breathSeconds} seconds remaining`
                  : 'Ready to start'
              }`}
              className={`breathing-pacer-box ${
                isBreathingActive ? breathPhase.toLowerCase() : ''
              } ${prefersReducedMotion ? 'reduced-motion' : ''}`}
            >
              <span style={{ fontSize: '0.94rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {isBreathingActive ? breathPhase : 'Ready'}
              </span>
              <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--blue-accent-dark)' }}>
                {isBreathingActive ? `${breathSeconds}s` : 'Start'}
              </span>
            </div>

            <button
              onClick={() => {
                haptics.success();
                setIsBreathingActive(!isBreathingActive);
                setBreathPhase('Inhale');
                setBreathSeconds(4);
              }}
              className="btn-primary"
              style={{ fontSize: '0.84rem', padding: '8px 20px', marginTop: '6px' }}
            >
              {isBreathingActive ? 'Pause Breath Pacer' : 'Begin 4-7-8 Breathing'}
            </button>
          </div>

          {/* Helping Hands Guided Steps */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              <HeartHandshake size={18} color="var(--blue-accent-dark)" />
              <h3 style={{ fontSize: '0.96rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Helping Hands: Step-by-Step Self-Reflection
              </h3>
            </div>

            {helpingHandsModules.map((module) => (
              <div
                key={module.id}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  background: 'var(--bg-secondary)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '14px',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--blue-accent-dark)', textTransform: 'uppercase' }}>
                    Module {module.moduleNumber}
                  </span>
                  <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {module.title}
                  </div>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                    {module.description}
                  </p>
                </div>

                {module.steps.map((step) => {
                  const isExpanded = expandedStepId === step.id;
                  const currentNote = stepNotes[step.id] !== undefined ? stepNotes[step.id] : (step.userNote || '');

                  return (
                    <div
                      key={step.id}
                      className="white-card"
                      style={{
                        padding: '12px',
                        border: isExpanded ? '1px solid var(--blue-accent)' : '1px solid var(--border-subtle)',
                      }}
                    >
                      <div
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                        onClick={() => setExpandedStepId(isExpanded ? '' : step.id)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleCompleteStep(module.id, step.id);
                            }}
                            style={{ color: step.isCompleted ? 'var(--sage-text)' : 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            {step.isCompleted ? <CheckCircle2 size={18} color="var(--sage-text)" /> : <Circle size={18} />}
                          </button>
                          <span style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Step {step.stepNumber}: {step.title}
                          </span>
                        </div>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>

                      {isExpanded && (
                        <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{step.purpose}</p>
                          <textarea
                            rows={2}
                            value={currentNote}
                            onChange={(e) => handleNoteChange(step.id, e.target.value)}
                            placeholder="Private note..."
                            style={{
                              width: '100%',
                              padding: '8px',
                              borderRadius: 'var(--radius-sm)',
                              border: '1px solid var(--border-subtle)',
                              fontSize: '0.82rem',
                            }}
                          />
                          <button
                            onClick={() => handleSaveStepReflection(module.id, step.id)}
                            className="btn-secondary"
                            style={{ alignSelf: 'flex-start', fontSize: '0.74rem', padding: '4px 12px' }}
                          >
                            Save Note
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 1: SHARE YOUR STORY (P2P SUBMISSION MODAL) */}
      {/* ======================================================== */}
      {isShareStoryOpen && (
        <div className="modal-overlay" onClick={() => setIsShareStoryOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <HeartHandshake size={20} color="var(--blue-accent-dark)" />
                <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  Share Your Story
                </h2>
              </div>
              <button
                onClick={() => setIsShareStoryOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Your story of overcoming pain, grief, or burnout can be a lifeline for someone walking through the dark right now.
            </p>

            <form onSubmit={handleSubmitStory} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: '4px' }}>
                  Author Name:
                </label>
                <input
                  type="text"
                  value={storyAuthor}
                  disabled={storyIsAnonymous}
                  onChange={(e) => setStoryAuthor(e.target.value)}
                  placeholder={storyIsAnonymous ? 'Posting as Anonymous' : 'e.g. Sarah M.'}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.86rem',
                  }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.76rem', marginTop: '6px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={storyIsAnonymous}
                    onChange={(e) => setStoryIsAnonymous(e.target.checked)}
                  />
                  <span>Post anonymously (keep my name hidden)</span>
                </label>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: '4px' }}>
                  Topic Category:
                </label>
                <select
                  value={storyTopic}
                  onChange={(e) => setStoryTopic(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.86rem',
                    background: '#FFFFFF',
                  }}
                >
                  <option value="Grief & Loss">Grief & Loss</option>
                  <option value="Career Burnout & Anxiety">Career Burnout & Anxiety</option>
                  <option value="Breaking Generational Cycles">Breaking Generational Cycles</option>
                  <option value="Heartbreak & Rebuilding Trust">Heartbreak & Rebuilding Trust</option>
                  <option value="Parenting Overwhelm">Parenting Overwhelm</option>
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: '4px' }}>
                  1. What was your struggle or heartbreak? *
                </label>
                <textarea
                  rows={3}
                  required
                  value={storyStruggle}
                  onChange={(e) => setStoryStruggle(e.target.value)}
                  placeholder="Describe what happened and how heavy it felt..."
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.84rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: '4px' }}>
                  2. What was the turning point?
                </label>
                <textarea
                  rows={2}
                  value={storyTurningPoint}
                  onChange={(e) => setStoryTurningPoint(e.target.value)}
                  placeholder="What realization, prayer, or practice helped you begin to heal?"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.84rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: '4px' }}>
                  3. How has God & healing restored you today? *
                </label>
                <textarea
                  rows={2}
                  required
                  value={storyHealing}
                  onChange={(e) => setStoryHealing(e.target.value)}
                  placeholder="Where are you now, and what hope can you share?"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.84rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.76rem', fontWeight: 700, marginBottom: '4px' }}>
                  Scripture Anchor (Optional):
                </label>
                <input
                  type="text"
                  value={storyScripture}
                  onChange={(e) => setStoryScripture(e.target.value)}
                  placeholder="e.g. Psalm 34:18 or Matthew 11:28"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.86rem',
                  }}
                />
              </div>

              <div style={{ background: '#F8FAFC', padding: '10px', borderRadius: 'var(--radius-md)', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                <ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                <span>By submitting, you give consent for your story to encourage peers in the LIFTED community.</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '6px' }}>
                <button
                  type="button"
                  onClick={() => setIsShareStoryOpen(false)}
                  className="btn-secondary"
                  style={{ fontSize: '0.82rem', padding: '8px 16px' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary dark-accent"
                  style={{ fontSize: '0.82rem', padding: '8px 18px' }}
                >
                  Publish Story
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 2: VIDEO PLAYER MODAL */}
      {/* ======================================================== */}
      {activeVideo && (
        <div className="modal-overlay" onClick={handleCloseVideo}>
          <div className="modal-content" style={{ padding: '0', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
            {/* Streamable Player (YouTube / Vimeo / Video File) or Fallback Simulation */}
            {activeVideo.videoUrl && (() => {
              const parsed = parseVideoUrl(activeVideo.videoUrl);
              if (parsed.type === 'youtube' && parsed.embedUrl) {
                return (
                  <div style={{ position: 'relative', width: '100%', height: '260px', background: '#000000' }}>
                    <iframe
                      src={parsed.embedUrl}
                      title={activeVideo.title}
                      style={{ width: '100%', height: '100%', border: 'none' }}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    />
                    <button
                      onClick={handleCloseVideo}
                      style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', color: '#fff', padding: '6px', cursor: 'pointer', zIndex: 10 }}
                      aria-label="Close video"
                    >
                      <X size={18} />
                    </button>
                  </div>
                );
              }
              if (parsed.type === 'vimeo' && parsed.embedUrl) {
                return (
                  <div style={{ position: 'relative', width: '100%', height: '260px', background: '#000000' }}>
                    <iframe
                      src={parsed.embedUrl}
                      title={activeVideo.title}
                      style={{ width: '100%', height: '100%', border: 'none' }}
                      allow="autoplay; fullscreen; picture-in-picture"
                      allowFullScreen
                    />
                    <button
                      onClick={handleCloseVideo}
                      style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', color: '#fff', padding: '6px', cursor: 'pointer', zIndex: 10 }}
                      aria-label="Close video"
                    >
                      <X size={18} />
                    </button>
                  </div>
                );
              }
              if (parsed.type === 'storage' || parsed.type === 'direct') {
                return (
                  <div style={{ position: 'relative', width: '100%', background: '#000000' }}>
                    <video
                      src={resolvedVideoPlaybackUrl || activeVideo.videoUrl}
                      controls
                      autoPlay
                      playsInline
                      style={{ width: '100%', maxHeight: '280px', display: 'block' }}
                    />
                    <button
                      onClick={handleCloseVideo}
                      style={{ position: 'absolute', top: '10px', right: '10px', background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', color: '#fff', padding: '6px', cursor: 'pointer', zIndex: 10 }}
                      aria-label="Close video"
                    >
                      <X size={18} />
                    </button>
                  </div>
                );
              }
              return null;
            })()}

            {/* Fallback Viewport (when no streaming videoUrl is present) */}
            {!activeVideo.videoUrl && (
              <div
                style={{
                  background: activeVideo.thumbnailGradient,
                  minHeight: '280px',
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  color: '#FFFFFF',
                  position: 'relative',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span
                    style={{
                      background: 'rgba(0,0,0,0.5)',
                      padding: '3px 8px',
                      borderRadius: 'var(--radius-full)',
                      fontSize: '0.74rem',
                    }}
                  >
                    {activeVideo.topicTags[0]}
                  </span>
                  <button
                    onClick={handleCloseVideo}
                    style={{ background: 'rgba(0,0,0,0.5)', border: 'none', borderRadius: '50%', color: '#fff', padding: '6px', cursor: 'pointer' }}
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Video Play Simulator */}
                <div style={{ textAlign: 'center' }}>
                  <button
                    onClick={() => setIsVideoPlaying(!isVideoPlaying)}
                    style={{
                      width: '64px',
                      height: '64px',
                      borderRadius: '50%',
                      background: 'rgba(255,255,255,0.3)',
                      backdropFilter: 'blur(8px)',
                      border: '2px solid rgba(255,255,255,0.8)',
                      color: '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      margin: '0 auto',
                      cursor: 'pointer',
                    }}
                  >
                    <Play size={28} fill="#FFFFFF" style={{ marginLeft: '4px' }} />
                  </button>
                  <div style={{ fontSize: '0.76rem', marginTop: '8px', opacity: 0.9 }}>
                    {isVideoPlaying ? '▶️ Playing video reflection...' : 'Tap to Play'}
                  </div>
                </div>

                {/* Time Scrubber simulation */}
                <div>
                  <div style={{ height: '4px', background: 'rgba(255,255,255,0.3)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: isVideoPlaying ? '65%' : '0%', height: '100%', background: '#38BDF8', transition: 'width 2s linear' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', marginTop: '4px', opacity: 0.8 }}>
                    <span>0:32</span>
                    <span>0:{activeVideo.durationSeconds}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Video Details & Transcript */}
            <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {activeVideo.title}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                Presented by {activeVideo.creator}
              </div>
              <p style={{ fontSize: '0.84rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                {activeVideo.description}
              </p>

              {activeVideo.scriptureAnchor && (
                <div
                  style={{
                    background: 'var(--bg-secondary)',
                    borderLeft: '3px solid var(--blue-accent-dark)',
                    padding: '8px 12px',
                    borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                    fontSize: '0.8rem',
                    color: 'var(--text-primary)',
                  }}
                >
                  <strong>Scripture Anchor:</strong> {activeVideo.scriptureAnchor}
                </div>
              )}

              <button
                onClick={() => setActiveVideo(null)}
                className="btn-primary"
                style={{ width: '100%', marginTop: '8px', fontSize: '0.84rem', padding: '9px' }}
              >
                Close Video
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* MODAL 3: PROFESSIONAL ARTICLE DETAIL */}
      {/* ======================================================== */}
      {activeArticle && (
        <div className="modal-overlay" onClick={() => setActiveArticle(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
              <span
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 700,
                  background: '#F3E8FF',
                  color: '#7E22CE',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)',
                }}
              >
                {activeArticle.topicTags[0]} • {activeArticle.readingTimeMinutes} min read
              </span>
              <button
                onClick={() => setActiveArticle(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}
              >
                <X size={20} />
              </button>
            </div>

            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.35 }}>
              {activeArticle.title}
            </h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              By {activeArticle.author} ({activeArticle.credentials})
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '14px', lineHeight: 1.6, fontSize: '0.88rem', color: 'var(--text-primary)' }}>
              {activeArticle.contentParagraphs.map((para, idx) => (
                <p key={idx}>{para}</p>
              ))}
            </div>

            {activeArticle.practicalExercise && (
              <div
                style={{
                  marginTop: '14px',
                  background: 'var(--blue-light-sky)',
                  border: '1px solid var(--blue-accent)',
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                }}
              >
                <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--blue-accent-dark)', textTransform: 'uppercase' }}>
                  Clinical Somatic Practice:
                </div>
                <div style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', marginTop: '2px' }}>
                  {activeArticle.practicalExercise.title}
                </div>
                <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px', lineHeight: 1.45 }}>
                  {activeArticle.practicalExercise.instruction}
                </p>
              </div>
            )}

            <button
              onClick={() => setActiveArticle(null)}
              className="btn-primary"
              style={{ width: '100%', marginTop: '16px', fontSize: '0.84rem', padding: '9px' }}
            >
              Done Reading
            </button>
          </div>
        </div>
      )}
    </div>
  );
};