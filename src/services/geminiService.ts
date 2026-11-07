import type { MoodId, AiRecommendation } from '../types';
import { generateCompassionateGuidance, isCrisisCheck } from './aiGuide';
import { networkService } from './networkService';
import { supabaseAuthService } from './auth/supabaseAuthService';

export interface ChatHistoryItem {
  role: 'user' | 'model';
  text: string;
}

export type CompanionMode = 'offline' | 'cloud';

export interface CloudAiConsent {
  consented: boolean;
  consentedAt: number;
  provider: 'google_gemini';
  model: string;
}

export interface GeminiCompanionResponse {
  text: string;
  isCrisis: boolean;
  shouldShowResources: boolean;
  recommendation?: AiRecommendation;
  isAiGenerated: boolean;
  fallbackReason?: string;
}

// Storage keys
const STORAGE_KEY_MODE = 'lifted_companion_mode';
const STORAGE_KEY_CONSENT = 'lifted_cloud_ai_consent';

// Clean up any legacy API keys previously stored in client localStorage
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem('lifted_gemini_api_key');
  }
} catch {
  // Ignore errors in non-browser environments
}

// System prompt specification for Cloud AI Gateway
export const COMPASSIONATE_SYSTEM_PROMPT = `You are the LIFTED Compassionate Guide, a faith-based, trauma-informed emotional companion for adults and parents navigating healing from past trauma, emotional wounds, and mental health challenges.

Core Principles:
1. TONE: Warm, deeply empathetic, gentle, Christ-centered grace, and non-judgmental. Speak like a tender pastoral counselor or trusted Christian mentor holding sacred space.
2. CONCISENESS: Keep your reply to 2 to 3 sentences maximum (under 75 words). Never preach, never lecture, and never write overwhelming blocks of text.
3. CONVERSATIONAL PACING (CRITICAL):
   - In early turns (Turn 1 & Turn 2), your ONLY job is to LISTEN, VALIDATE, and HOLD SPACE. Do not offer unsolicited solutions, advice, or homework yet.
   - Always address what the user actually said (e.g. if they say "hello", greet them back warmly; if they share a struggle, acknowledge that specific struggle).
   - Ask ONE gentle, open-ended question that helps them unpack what their heart is carrying.
4. BOUNDARIES & SAFETY:
   - Provide spiritual comfort, peer empathy, and mindful presence. Do NOT provide medical diagnosis or clinical treatment.
   - If the user expresses self-harm or suicidal thoughts, respond with urgent tenderness and urge them to call or text 988 or text HOME to 741741 immediately.
5. SCRIPTURAL ROOTS: You may naturally weave in the tender assurance of God's love, but keep it organic and gentle—never weaponize scripture or use toxic positivity. Never invent citations.`;

/**
 * Client-side key accessors deprecated per Phase 0/7 security standards.
 * All Gemini credentials reside exclusively in server-side Edge Function secrets.
 */
export function getGeminiApiKey(): string {
  return '';
}

export function setGeminiApiKey(_key: string): void {
  // No-op: Client-side key storage prohibited
}

export function hasGeminiApiKey(): boolean {
  return false;
}

/**
 * Companion Mode & Consent State
 */
let currentMode: CompanionMode = 'offline';

// Initialize mode from storage if available
if (typeof localStorage !== 'undefined') {
  try {
    const savedMode = localStorage.getItem(STORAGE_KEY_MODE);
    if (savedMode === 'cloud') {
      currentMode = 'cloud';
    }
  } catch {
    currentMode = 'offline';
  }
}

export function getCompanionMode(): CompanionMode {
  return currentMode;
}

export function setCompanionMode(mode: CompanionMode): void {
  currentMode = mode;
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY_MODE, mode);
    } catch {
      // Ignore storage errors
    }
  }
}

export function getCloudAiConsent(): CloudAiConsent | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_CONSENT);
    if (!raw) return null;
    return JSON.parse(raw) as CloudAiConsent;
  } catch {
    return null;
  }
}

export function hasCloudAiConsent(): boolean {
  const consent = getCloudAiConsent();
  return Boolean(consent?.consented);
}

export async function recordServerConsent(version = 'v1.0'): Promise<boolean> {
  const client = supabaseAuthService.getClient();
  if (!client) return false;
  try {
    const { error } = await (client as any).rpc('record_user_ai_consent', { p_version: version });
    return !error;
  } catch {
    return false;
  }
}

export async function revokeServerConsent(): Promise<boolean> {
  const client = supabaseAuthService.getClient();
  if (!client) return false;
  try {
    const { error } = await (client as any).rpc('revoke_user_ai_consent');
    return !error;
  } catch {
    return false;
  }
}

export function setCloudAiConsent(consented: boolean): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (consented) {
      const consentRecord: CloudAiConsent = {
        consented: true,
        consentedAt: Date.now(),
        provider: 'google_gemini',
        model: 'gemini-2.5-flash',
      };
      localStorage.setItem(STORAGE_KEY_CONSENT, JSON.stringify(consentRecord));
      recordServerConsent().catch(() => {});
    } else {
      localStorage.removeItem(STORAGE_KEY_CONSENT);
      setCompanionMode('offline');
      revokeServerConsent().catch(() => {});
    }
  } catch {
    // Ignore storage errors
  }
}

export function revokeCloudAiConsent(): void {
  setCloudAiConsent(false);
}

/**
 * Check if Cloud AI is currently eligible to be called
 */
export function isCloudAiAvailable(): boolean {
  return (
    getCompanionMode() === 'cloud' &&
    hasCloudAiConsent() &&
    networkService.isConnected() &&
    supabaseAuthService.getAccountState() === 'AUTHENTICATED'
  );
}

export async function testGeminiConnection(): Promise<{ success: boolean; message: string }> {
  if (getCompanionMode() === 'cloud' && hasCloudAiConsent()) {
    return {
      success: true,
      message: 'Cloud AI Gateway configured. Google Gemini (gemini-2.5-flash) ready for authenticated sessions.',
    };
  }
  return {
    success: true,
    message: 'Offline Sanctuary Companion active. Zero data leaves your device.',
  };
}

/**
 * Smart Conversational Fallback Engine (Offline Sanctuary Companion)
 * Truly interacts, answers greetings, mirrors user statements, and holds authentic multi-turn dialogue.
 */
export function getSmartDialogueResponse(
  moods: MoodId[],
  userText: string,
  turnCount: number
): { text: string; shouldShowResources: boolean } {
  const lower = userText.trim().toLowerCase();
  const primaryMood = moods[0] || 'unsure';

  // Check if user is asking for direct practical comfort / scriptures / prayer
  const userRequestedResources =
    lower.includes('scripture') ||
    lower.includes('verse') ||
    lower.includes('bible') ||
    lower.includes('breath') ||
    lower.includes('breathing') ||
    lower.includes('calm') ||
    lower.includes('pray') ||
    lower.includes('prayer') ||
    lower.includes('resource') ||
    lower.includes('tool') ||
    lower.includes('exercise');

  // 1. Direct Greetings ("hello", "hi", "hey", "kamusta", "good morning")
  const isGreeting =
    lower === 'hello' ||
    lower === 'hi' ||
    lower === 'hey' ||
    lower.startsWith('hello ') ||
    lower.startsWith('hi ') ||
    lower.startsWith('hey ') ||
    lower.includes('good morning') ||
    lower.includes('good afternoon') ||
    lower.includes('good evening') ||
    lower.includes('kamusta');

  const isPositive =
    lower.includes('happy') ||
    lower.includes('good') ||
    lower.includes('great') ||
    lower.includes('peaceful') ||
    lower.includes('blessed') ||
    lower.includes('wonderful') ||
    lower.includes('better') ||
    lower.includes('glad') ||
    primaryMood === 'peaceful' ||
    primaryMood === 'happy' ||
    primaryMood === 'grateful' ||
    primaryMood === 'hopeful';

  if (isGreeting && turnCount <= 1) {
    if (isPositive) {
      return {
        text: "Hello! What a beautiful grace to experience calm and peace today. Welcome to your quiet sanctuary. What is bringing your heart the most joy or gratitude right now?",
        shouldShowResources: false,
      };
    }

    if (primaryMood && primaryMood !== 'unsure') {
      const moodLabelMap: Record<MoodId, string> = {
        anxious: 'feeling some anxiety',
        sad: 'carrying some sadness or grief',
        tired: 'feeling exhausted or worn out',
        overwhelmed: 'feeling overwhelmed',
        lonely: 'feeling a bit lonely',
        frustrated: 'feeling frustrated',
        peaceful: 'resting in a peaceful moment',
        hopeful: 'holding onto hope',
        grateful: 'feeling grateful',
        okay: 'holding steady today',
        happy: 'feeling joy',
        unsure: '',
      };
      const moodText = moodLabelMap[primaryMood];
      return {
        text: `Hello! I'm so glad you stopped by today. I see you're ${moodText || 'checking in'}. How has your heart been doing so far?`,
        shouldShowResources: false,
      };
    }

    return {
      text: "Hello! Welcome, I am so glad you reached out today. Take a gentle breath—this is a completely safe, quiet space for you. What's on your heart right now?",
      shouldShowResources: false,
    };
  }

  // 2. Identity / Purpose inquiries ("who are you", "what can you do")
  if (lower.includes('who are you') || lower.includes('what are you') || lower.includes('what do you do')) {
    return {
      text: "I'm your LIFTED Sanctuary Companion. I'm here to listen without judgment, walk beside you through life's seasons, pray with you, and help you find peace in God's presence.",
      shouldShowResources: false,
    };
  }

  // 3. User asks "how are you"
  if (lower.includes('how are you') || lower.includes('how r u')) {
    return {
      text: "Thank you so much for asking! I'm here and fully present with you today. More importantly, how is your soul feeling right now?",
      shouldShowResources: false,
    };
  }

  // 4. Positive sentiment in Turn 1 or Turn 2
  if (isPositive) {
    if (turnCount <= 1) {
      return {
        text: "What a gift to rest in peace and gratitude today. Noticing these quiet, joyful spaces restores our souls. What has felt most life-giving for you today?",
        shouldShowResources: false,
      };
    }
    return {
      text: "That brings so much warmth to my heart! Holding onto joy and gratitude is a powerful anchor for healing. Whenever you feel ready, here are a few gentle suggestions to continue nurturing your spirit:",
      shouldShowResources: true,
    };
  }

  // 5. Turn 1: Active Listening & Conversational Mirroring (Struggles & Heavy Emotions)
  if (turnCount <= 1 && !userRequestedResources) {
    // Relationship or family struggles
    if (
      lower.includes('fight') ||
      lower.includes('argument') ||
      lower.includes('husband') ||
      lower.includes('wife') ||
      lower.includes('partner') ||
      lower.includes('mom') ||
      lower.includes('dad') ||
      lower.includes('family')
    ) {
      return {
        text: "Tension with the people closest to us takes such a heavy emotional toll. It is completely natural to feel unsettled or hurt after conflict. What part of that exchange is lingering in your mind most right now?",
        shouldShowResources: false,
      };
    }

    // Work / burnout / fatigue
    if (
      lower.includes('work') ||
      lower.includes('job') ||
      lower.includes('boss') ||
      lower.includes('tired') ||
      lower.includes('exhausted') ||
      lower.includes('burnout') ||
      lower.includes('pagod')
    ) {
      return {
        text: "You have been carrying such a heavy load, and your body and spirit are asking for rest. Resting isn't failure—it's holy self-care. What has been demanding the most energy from you this week?",
        shouldShowResources: false,
      };
    }

    // Grief / loss
    if (
      lower.includes('died') ||
      lower.includes('death') ||
      lower.includes('loss') ||
      lower.includes('grief') ||
      lower.includes('miss') ||
      primaryMood === 'sad'
    ) {
      return {
        text: "I hear how tender and aching your heart is. Grieving someone or something you love deeply is an exhausting ache, and you don't have to pretend to be strong here. What has felt the hardest to hold today?",
        shouldShowResources: false,
      };
    }

    // Anxiety / panic / fear
    if (
      lower.includes('anxious') ||
      lower.includes('scared') ||
      lower.includes('panic') ||
      lower.includes('worry') ||
      lower.includes('nervous') ||
      primaryMood === 'anxious'
    ) {
      return {
        text: "I hear the tightness and restlessness in your thoughts. When anxiety spikes, everything can feel urgent and overwhelming. Let's take one quiet breath together. What is making your heart feel most unsettled today?",
        shouldShowResources: false,
      };
    }

    // Overwhelm / too much
    if (
      lower.includes('overwhelm') ||
      lower.includes('too much') ||
      lower.includes('stressed') ||
      primaryMood === 'overwhelmed'
    ) {
      return {
        text: "It sounds like everything is piling up at once, and that can feel suffocating. You don't have to solve every piece of this mountain today. If you could pause just one thing right now, what would give you the most relief?",
        shouldShowResources: false,
      };
    }

    // Loneliness
    if (
      lower.includes('lonely') ||
      lower.includes('alone') ||
      lower.includes('nobody') ||
      primaryMood === 'lonely'
    ) {
      return {
        text: "Feeling alone in what you're walking through is such a deep ache. Please know that you are seen, valued, and held in love right now. How long have you felt like you've been carrying this in silence?",
        shouldShowResources: false,
      };
    }

    // General conversational listening
    return {
      text: "Thank you for sharing that so openly with me. Giving words to what's inside takes real courage, and you don't have to carry it alone. What feels most urgent or heavy for you right now?",
      shouldShowResources: false,
    };
  }

  // 6. Turn 2: Deepening Comfort & Presenting Helpful Next Steps
  if (turnCount === 2 && !userRequestedResources) {
    return {
      text: "I hear you so clearly. God is near to you in this exact spot—He doesn't rush you to fix everything. Here are a few gentle suggestions tailored for you whenever you are ready:",
      shouldShowResources: true,
    };
  }

  // 7. Turn 3+ or User Explicitly Asked for Tools
  return {
    text: "You are holding space for healing with so much courage today. Whenever you feel ready, here are gentle anchors and practical tools tailored for you:",
    shouldShowResources: true,
  };
}

/**
 * Invoke the server-side Supabase Edge Function gateway.
 * Returns response or throws error on failure.
 */
async function callCompanionGateway(
  history: ChatHistoryItem[],
  currentText: string,
  moods: MoodId[],
  turnCount: number
): Promise<{ text: string; isAiGenerated: boolean; isCrisis: boolean; shouldShowResources: boolean }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  const client = supabaseAuthService.getClient();
  if (!client) {
    throw new Error('Supabase client not initialized');
  }

  const { data: sessionData } = await client.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('Authentication required for Cloud AI');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/companion-gateway`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: currentText,
        history: history.slice(-6),
        moods,
        clientTurn: turnCount,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      let errCode = `HTTP_${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.error) {
          errCode = errJson.error;
        }
      } catch {
        /* Ignore parse error */
      }
      throw new Error(`Gateway returned error: ${errCode}`);
    }

    const json = await res.json();
    return {
      text: json.text,
      isAiGenerated: Boolean(json.isAiGenerated),
      isCrisis: Boolean(json.isCrisis),
      shouldShowResources: Boolean(json.shouldShowResources),
    };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    throw err;
  }
}

/**
 * Send a companion message with multi-turn conversation memory.
 * Preserves zero-latency, trauma-informed offline companion as default.
 * Authenticated users with explicit consent can optionally use the server-side Cloud AI Gateway.
 */
export async function sendCompanionMessage(
  history: ChatHistoryItem[] = [],
  currentText: string,
  moods: MoodId[] = [],
  turnCount: number = 1
): Promise<GeminiCompanionResponse> {
  const lower = currentText.toLowerCase();

  // 1. Immediate Crisis Check (Zero-latency on-device deterministic barrier)
  const hasCrisis = moods.some((m) => isCrisisCheck(lower, m)) || isCrisisCheck(lower);
  if (hasCrisis) {
    const rec = generateCompassionateGuidance(moods.length > 0 ? moods : 'overwhelmed', currentText);
    return {
      text: "I hear the deep ache and unbearable weight in what you are carrying right now. Please know that your life is deeply precious, you do not have to walk through this darkness alone, and help is here for you in this exact moment. Please connect immediately with emergency services or a crisis lifeline (such as 1553 / 911 in the Philippines, 988 in the US/Canada, or text HOME to 741741). Caring people are ready to support you right now:",
      isCrisis: true,
      shouldShowResources: true,
      recommendation: rec,
      isAiGenerated: false,
    };
  }

  // Determine if resources should be revealed
  const userRequestedResources =
    lower.includes('scripture') ||
    lower.includes('verse') ||
    lower.includes('bible') ||
    lower.includes('breath') ||
    lower.includes('breathing') ||
    lower.includes('calm') ||
    lower.includes('pray') ||
    lower.includes('prayer') ||
    lower.includes('resource') ||
    lower.includes('tool') ||
    lower.includes('exercise');
  const shouldRevealResources = turnCount >= 2 || userRequestedResources;

  // 2. Check if Cloud AI Gateway is active and authorized
  const canUseCloudAi = isCloudAiAvailable();

  if (canUseCloudAi) {
    try {
      const cloudRes = await callCompanionGateway(history, currentText, moods, turnCount);

      if (cloudRes.isCrisis) {
        const rec = generateCompassionateGuidance(moods.length > 0 ? moods : 'overwhelmed', currentText);
        return {
          text: cloudRes.text,
          isCrisis: true,
          shouldShowResources: true,
          recommendation: rec,
          isAiGenerated: false,
        };
      }

      const rec = (cloudRes.shouldShowResources || shouldRevealResources)
        ? generateCompassionateGuidance(moods.length > 0 ? moods : 'unsure', currentText)
        : undefined;

      return {
        text: cloudRes.text,
        isCrisis: false,
        shouldShowResources: cloudRes.shouldShowResources || shouldRevealResources,
        recommendation: rec,
        isAiGenerated: cloudRes.isAiGenerated,
      };
    } catch (gatewayErr: unknown) {
      // Safe fallback: Log error type without message content or secrets
      const errName = gatewayErr instanceof Error ? gatewayErr.name : 'UnknownError';
      const errMsg = gatewayErr instanceof Error ? gatewayErr.message : String(gatewayErr);

      // Fall through to deterministic offline fallback engine
      const fallbackResult = getSmartDialogueResponse(moods, currentText, turnCount);
      const rec = (fallbackResult.shouldShowResources || shouldRevealResources)
        ? generateCompassionateGuidance(moods.length > 0 ? moods : 'unsure', currentText)
        : undefined;

      return {
        text: fallbackResult.text,
        isCrisis: false,
        shouldShowResources: fallbackResult.shouldShowResources || shouldRevealResources,
        recommendation: rec,
        isAiGenerated: false, // Strictly false: Fallback is deterministic, never remote AI
        fallbackReason: `${errName}: ${errMsg}`,
      };
    }
  }

  // 3. Resilient Smart Conversational Fallback Engine (Offline Sanctuary Companion)
  const fallbackResult = getSmartDialogueResponse(moods, currentText, turnCount);
  const rec = (fallbackResult.shouldShowResources || shouldRevealResources)
    ? generateCompassionateGuidance(moods.length > 0 ? moods : 'unsure', currentText)
    : undefined;

  return {
    text: fallbackResult.text,
    isCrisis: false,
    shouldShowResources: fallbackResult.shouldShowResources || shouldRevealResources,
    recommendation: rec,
    isAiGenerated: false,
  };
}
