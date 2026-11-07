import type { MoodId, AiRecommendation, AiPathwayRecommendations } from '../types';
import {
  CONTENT_CATALOG,
  CURATED_VIDEOS,
  COMMUNITY_TESTIMONIES,
  PROFESSIONAL_ARTICLES,
} from '../data/mockData';

// Crisis safety keywords check (Zero-latency immediate safety barrier)
const CRISIS_KEYWORDS = [
  'suicide',
  'suiside',
  'suicid',
  'kill myself',
  'kil myself',
  'killing myself',
  'end my life',
  'ending my life',
  'end it all',
  'cannot go on',
  'cant go on',
  "can't go on",
  'want to die',
  'give up on living',
  'gave up on living',
  'hurt myself',
  'hurting myself',
  'no reason to live',
  'no point in living',
  'self harm',
  'self-harm',
  'take my own life',
  'taking my own life',
  'wish i were dead',
  'wish i was dead',
  'better off dead',
  'better off without me',
  "don't want to wake up",
  'dont want to wake up',
  'overdose',
  'cut myself',
  'cutting myself',
  'slit my wrist',
  'hanging myself',
  'jump off a bridge',
  // Tagalog / Filipino crisis indicators
  'magpakamatay',
  'gusto ko nang mamatay',
  'gusto ko ng mamatay',
  'ayoko na mabuhay',
  'ayaw ko na mabuhay',
  'wakasan ang buhay',
];

export function isCrisisCheck(text: string, mood?: MoodId): boolean {
  if (mood === 'overwhelmed' || mood === 'sad' || mood === 'lonely') {
    const lower = text.toLowerCase();
    return CRISIS_KEYWORDS.some((kw) => lower.includes(kw));
  }
  const lower = text.toLowerCase();
  return CRISIS_KEYWORDS.some((kw) => lower.includes(kw));
}

export function generateTriagePathways(
  mood: MoodId,
  userText: string = ''
): AiPathwayRecommendations {
  const lower = userText.toLowerCase();

  // 1. Loss, Grief, Death, Heartbreak
  if (
    lower.includes('namatay') ||
    lower.includes('died') ||
    lower.includes('grief') ||
    lower.includes('loss') ||
    lower.includes('passed away') ||
    lower.includes('heartbreak') ||
    lower.includes('breakup') ||
    lower.includes('partner') ||
    mood === 'sad'
  ) {
    const video = CURATED_VIDEOS.find((v) => v.id === 'vid-grief-01') || CURATED_VIDEOS[0];
    const testimony = COMMUNITY_TESTIMONIES.find((t) => t.id === 'test-01') || COMMUNITY_TESTIMONIES[0];
    const prof = PROFESSIONAL_ARTICLES.find((p) => p.id === 'prof-01') || PROFESSIONAL_ARTICLES[0];

    return {
      compassionateAcknowledgment:
        "I hear how heavy and tender your heart is right now. Grieving the loss of someone you love is an overwhelming ache, and you don't have to carry it alone or pretend to be strong today. God is close to the brokenhearted, and every tear is seen.",
      detectedTheme: 'Grief & Loss',
      biblePathway: {
        title: 'He Binds the Brokenhearted',
        scriptureRef: 'Psalm 34:18 (ESV)',
        scriptureText: 'The Lord is near to the brokenhearted and saves the crushed in spirit.',
        excerpt: 'God does not rush your grief. He sits with you in the ache and binds up your sore heart with tender mercy.',
        devotionalId: 'dev-004',
      },
      videoPathway: video,
      testimonyPathway: testimony,
      professionalPathway: prof,
    };
  }

  // 2. Burnout, Exhaustion, Overwork
  if (
    lower.includes('burnout') ||
    lower.includes('burnt out') ||
    lower.includes('exhausted') ||
    lower.includes('drained') ||
    lower.includes('tired') ||
    lower.includes('overworked') ||
    lower.includes('pagod') ||
    mood === 'tired'
  ) {
    const video = CURATED_VIDEOS.find((v) => v.id === 'vid-burnout-01') || CURATED_VIDEOS[1];
    const testimony = COMMUNITY_TESTIMONIES.find((t) => t.id === 'test-02') || COMMUNITY_TESTIMONIES[1];
    const prof = PROFESSIONAL_ARTICLES.find((p) => p.id === 'prof-02') || PROFESSIONAL_ARTICLES[1];

    return {
      compassionateAcknowledgment:
        "You are carrying so much, and it is completely understandable that your body and mind are feeling exhausted. Resting is not a sign of failure—it is holy self-care and permission to lay down burdens you were never meant to carry alone.",
      detectedTheme: 'Burnout & Rest',
      biblePathway: {
        title: 'Rest for the Weary Soul',
        scriptureRef: 'Matthew 11:28 (NIV)',
        scriptureText: 'Come to me, all you who are weary and burdened, and I will give you rest.',
        excerpt: 'True peace comes when you realize your worth is not measured by relentless productivity, but in being loved by God.',
        devotionalId: 'dev-002',
      },
      videoPathway: video,
      testimonyPathway: testimony,
      professionalPathway: prof,
    };
  }

  // 3. Parenting, Anger, Generational Triggers
  if (
    lower.includes('parenting') ||
    lower.includes('child') ||
    lower.includes('kids') ||
    lower.includes('mom') ||
    lower.includes('dad') ||
    lower.includes('yell') ||
    lower.includes('temper') ||
    lower.includes('angry') ||
    mood === 'frustrated'
  ) {
    const video = CURATED_VIDEOS.find((v) => v.id === 'vid-parenting-01') || CURATED_VIDEOS[3];
    const testimony = COMMUNITY_TESTIMONIES.find((t) => t.id === 'test-03') || COMMUNITY_TESTIMONIES[2];
    const prof = PROFESSIONAL_ARTICLES.find((p) => p.id === 'prof-03') || PROFESSIONAL_ARTICLES[2];

    return {
      compassionateAcknowledgment:
        "Breaking cycles of anger and past family dysfunction is courageous, but it can also be exhausting when triggers spike. Give yourself grace today: repair and gentle patience are always possible through God’s steady hands.",
      detectedTheme: 'Parenting & Generational Healing',
      biblePathway: {
        title: 'Slow to Anger, Rich in Mercy',
        scriptureRef: 'James 1:19 (NIV)',
        scriptureText: 'Everyone should be quick to listen, slow to speak and slow to become angry.',
        excerpt: 'When reactive feelings rise from old memories, take a sacred pause to breathe in Christ’s gentle patience.',
        devotionalId: 'dev-today',
      },
      videoPathway: video,
      testimonyPathway: testimony,
      professionalPathway: prof,
    };
  }

  // 4. Anxiety, Panic, Restlessness, Fear (Default Fallback)
  const video = CURATED_VIDEOS.find((v) => v.id === 'vid-anxiety-01') || CURATED_VIDEOS[2];
  const testimony = COMMUNITY_TESTIMONIES.find((t) => t.id === 'test-02') || COMMUNITY_TESTIMONIES[1];
  const prof = PROFESSIONAL_ARTICLES.find((p) => p.id === 'prof-02') || PROFESSIONAL_ARTICLES[1];

  return {
    compassionateAcknowledgment:
      "I hear the tension and restlessness you are feeling. Racing thoughts and an unsettled nervous system can be overwhelming, but you are in a safe space right now. Let us take this moment one gentle breath at a time.",
    detectedTheme: 'Anxiety & Nervous System Calm',
    biblePathway: {
      title: 'Peace Guarding Your Heart',
      scriptureRef: 'Philippians 4:6-7 (NIV)',
      scriptureText: 'Do not be anxious about anything... and the peace of God will guard your hearts and your minds in Christ Jesus.',
      excerpt: 'God’s peace acts as a protective shield around your thoughts when the world feels unpredictable.',
      devotionalId: 'dev-003',
    },
    videoPathway: video,
    testimonyPathway: testimony,
    professionalPathway: prof,
  };
}

export function generateCompassionateGuidance(
  moodInput: MoodId | MoodId[],
  userText: string = ''
): AiRecommendation {
  const moods = Array.isArray(moodInput) ? moodInput : [moodInput];
  const primaryMood = moods[0] || 'unsure';
  const trimmed = userText.trim();
  const lowerText = trimmed.toLowerCase();

  // 1. Immediate Crisis priority
  const hasCrisis = moods.some((m) => isCrisisCheck(lowerText, m)) || isCrisisCheck(lowerText);
  if (hasCrisis) {
    const crisisItem = CONTENT_CATALOG.find((c) => c.category === 'crisis') || CONTENT_CATALOG[0];
    const breathItem = CONTENT_CATALOG.find((c) => c.id === 'cat-breath-478') || CONTENT_CATALOG[1];
    const devItem = CONTENT_CATALOG.find((c) => c.id === 'cat-dev-today') || CONTENT_CATALOG[0];

    return {
      compassionateAcknowledgment:
        "I hear the deep weight and pain in what you're carrying right now. Please know that your life is deeply valued, you do not have to walk through this dark valley alone, and help is here for you in this very moment.",
      primaryRecommendation: crisisItem,
      primaryReason: 'Direct access to free, immediate 24/7 crisis support and gentle grounding guidance.',
      alternativeRecommendations: [
        {
          item: breathItem,
          reason: 'A gentle somatic breathing pacer to steady your racing nervous system.',
        },
        {
          item: devItem,
          reason: 'A short scripture reflection reminding you of God’s nearness to the brokenhearted.',
        },
      ],
      triagePathways: generateTriagePathways(primaryMood, userText),
    };
  }

  // 2. Standard Triage with Multi-Emotion Synthesis
  const triage = generateTriagePathways(primaryMood, userText);
  const breathItem = CONTENT_CATALOG.find((c) => c.id === 'cat-breath-478') || CONTENT_CATALOG[1];
  const devItem = CONTENT_CATALOG.find((c) => c.id === 'cat-dev-today') || CONTENT_CATALOG[0];

  let acknowledgment = triage.compassionateAcknowledgment;

  // Synthesize multi-mood acknowledgment if more than 1 emotion selected
  if (moods.length > 1) {
    const moodNameMap: Record<MoodId, string> = {
      sad: 'grief',
      anxious: 'anxiety',
      tired: 'exhaustion',
      overwhelmed: 'feeling overwhelmed',
      lonely: 'loneliness',
      frustrated: 'frustration',
      hopeful: 'hope',
      grateful: 'gratitude',
      peaceful: 'peace',
      okay: 'holding steady',
      happy: 'joy',
      unsure: 'uncertainty',
    };
    const mapped = moods.map((m) => moodNameMap[m] || m);
    const combinedString =
      mapped.length === 2
        ? `${mapped[0]} and ${mapped[1]}`
        : `${mapped.slice(0, -1).join(', ')}, and ${mapped[mapped.length - 1]}`;

    acknowledgment = `I hear how much your heart is holding right now, carrying both ${combinedString} at the same time. Holding complex, layered feelings is deeply human and exhausting—you don't have to carry them alone or force yourself to have it all figured out today. God meets you with open arms in every single layer.`;
  }

  return {
    compassionateAcknowledgment: acknowledgment,
    primaryRecommendation: devItem,
    primaryReason: `Curated reflection and practical tools for ${triage.detectedTheme}.`,
    alternativeRecommendations: [
      {
        item: breathItem,
        reason: 'Somatic 4-7-8 breathing to regulate your nervous system.',
      },
    ],
    triagePathways: triage,
  };
}
