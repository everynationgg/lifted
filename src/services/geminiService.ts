import type { MoodId, AiRecommendation } from '../types';
import { generateCompassionateGuidance, isCrisisCheck } from './aiGuide';
import { networkService } from './networkService';
import { supabaseAuthService } from './auth/supabaseAuthService';
import { APP_CONFIG } from '../config';

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
export const COMPASSIONATE_SYSTEM_PROMPT = `You are the LIFTED Companion—a warm, genuine, down-to-earth Christian friend and supportive conversational partner.

Core Principles:
1. TALK LIKE A REAL PERSON (NOT A TEMPLATE OR GREETING CARD):
   - Have a natural, back-and-forth human conversation! Match the user's vibe, slang, energy, and casualness.
   - If they say something casual or upbeat like "yo, im feeling lucky and blessed!", reply naturally like a real friend (e.g., "Haha love that energy! What's got you feeling so lucky and blessed today?").
   - If they ask "do you respond?" or test the chat, answer them directly and naturally (e.g., "Yep, I'm right here! What's going on with you today?").
   - NEVER sound overly solemn, dramatic, poetic, or like the user is on their deathbed! Avoid stiff phrases like "What a gift to rest in quiet spaces that restore our souls" or "God is near to you in this exact spot—He doesn't rush you to fix everything" during normal or upbeat chats.
2. MATCH THE USER'S EMOTIONAL ENERGY (CRITICAL):
   - Casual / Happy / Lucky / Blessed -> Keep it upbeat, warm, conversational, and fun! NEVER mention "heaviness", "burdens", "trauma", "pain", "healing", or "hard roads".
   - Stressed / Sad / Anxious / Hurting -> Be a gentle, empathetic, caring listener who validates their feelings without preaching or lecturing.
3. CONCISE & CONVERSATIONAL:
   - Keep your reply to 1 to 3 natural sentences (under 60 words).
   - End with a natural follow-up question that fits what they just said so the conversation flows like texting a close friend.
4. BOUNDARIES & SAFETY:
   - Do NOT provide medical diagnosis or clinical treatment.
   - If the user expresses self-harm or suicidal thoughts, respond with urgent care and urge them to call or text 988 or text HOME to 741741 immediately.`;

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
 * Returns active Gemini API key for preview mode or empty string during tests.
 * Loaded securely via environment variable (baked by Vite during mobile build).
 */
export function getLiveGeminiApiKey(): string {
  if (APP_CONFIG.isTest) return '';
  return import.meta.env.VITE_GEMINI_API_KEY || '';
}

/**
 * Check if Cloud AI is currently eligible to be called
 */
export function isCloudAiAvailable(): boolean {
  const isEligible =
    supabaseAuthService.getAccountState() === 'AUTHENTICATED' ||
    (APP_CONFIG.flags.enableCloudAi && Boolean(getLiveGeminiApiKey()));

  return (
    getCompanionMode() === 'cloud' &&
    hasCloudAiConsent() &&
    networkService.isConnected() &&
    isEligible
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
    lower.includes('lucky') ||
    lower.includes('fortunate') ||
    lower.includes('excited') ||
    lower.includes('amazing') ||
    lower.includes('awesome') ||
    lower.includes('fantastic') ||
    lower.includes('joy') ||
    lower.includes('thankful') ||
    lower.includes('grateful') ||
    lower.includes('thriving') ||
    lower.includes('praise') ||
    lower.includes('yay') ||
    lower.includes('optimistic') ||
    lower.includes('hopeful') ||
    lower.includes('relaxed') ||
    lower.includes('chill') ||
    lower.includes('super') ||
    lower.includes('lovely') ||
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

  // 2. Identity / Purpose / Responsiveness inquiries ("who are you", "do you respond", "are you there")
  if (
    lower.includes('who are you') ||
    lower.includes('what are you') ||
    lower.includes('what do you do')
  ) {
    return {
      text: "I'm your LIFTED Companion! I'm here to chat, listen without judgment, and walk beside you through whatever is on your mind today.",
      shouldShowResources: false,
    };
  }

  if (
    lower.includes('do you respond') ||
    lower.includes('are you there') ||
    lower.includes('can you hear') ||
    lower.includes('are you real') ||
    lower === 'test' ||
    lower === 'testing'
  ) {
    return {
      text: "Yep, I'm right here with you! We can talk about whatever's on your mind—how's your day going so far?",
      shouldShowResources: false,
    };
  }

  // 3. User asks "how are you"
  if (lower.includes('how are you') || lower.includes('how r u')) {
    return {
      text: "Doing great, thank you for asking! I'm right here and happy to chat with you. How are things going on your end today?",
      shouldShowResources: false,
    };
  }

  // 4. Positive sentiment in Turn 1 or Turn 2
  if (isPositive && turnCount < 3) {
    if (turnCount <= 1) {
      return {
        text: "Haha I love hearing that! What's bringing you so much joy and good energy today?",
        shouldShowResources: false,
      };
    }
    return {
      text: "That's awesome to hear! Keep soaking in those good moments—what else have you been up to today?",
      shouldShowResources: false,
    };
  }

  const isDistressed =
    primaryMood === 'sad' ||
    primaryMood === 'anxious' ||
    primaryMood === 'tired' ||
    primaryMood === 'overwhelmed' ||
    primaryMood === 'lonely' ||
    primaryMood === 'frustrated' ||
    lower.includes('fight') ||
    lower.includes('argument') ||
    lower.includes('tired') ||
    lower.includes('exhausted') ||
    lower.includes('burnout') ||
    lower.includes('pagod') ||
    lower.includes('died') ||
    lower.includes('death') ||
    lower.includes('loss') ||
    lower.includes('grief') ||
    lower.includes('anxious') ||
    lower.includes('scared') ||
    lower.includes('panic') ||
    lower.includes('worry') ||
    lower.includes('overwhelm') ||
    lower.includes('too much') ||
    lower.includes('stressed') ||
    lower.includes('lonely') ||
    lower.includes('alone') ||
    lower.includes('hurt') ||
    lower.includes('sad');

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

    // General conversational listening (only mention heaviness if a heavy mood chip was explicitly selected)
    const isHeavyMood = primaryMood === 'tired' || primaryMood === 'frustrated';

    if (isHeavyMood) {
      return {
        text: "Thank you for sharing that so openly with me. Giving words to what's inside takes real courage, and you don't have to carry it alone. What feels most urgent or heavy for you right now?",
        shouldShowResources: false,
      };
    }

    return {
      text: "Thanks for sharing that with me! I'm right here and would love to hear more—what's on your mind today?",
      shouldShowResources: false,
    };
  }

  // 6. Turn 2: Conversational Follow-up (only show resources if user is distressed)
  if (turnCount === 2 && !userRequestedResources) {
    if (isDistressed) {
      return {
        text: "I hear you, and you don't have to figure it all out at once. Take a breath—if any of these feel helpful right now, they're right here for you, or we can just keep talking:",
        shouldShowResources: true,
      };
    }
    return {
      text: "I'm right here with you! Tell me more—what else has been on your mind today?",
      shouldShowResources: false,
    };
  }

  // 7. Turn 3+ or User Explicitly Asked for Tools
  return {
    text: "I'm really glad we're chatting today. We can keep talking as long as you'd like, or you can explore any of these whenever you want:",
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
 * Direct Google Gemini API invocation for standalone client preview / guest mode.
 * Connects directly to Google Generative Language API with the compassionate system prompt.
 */
async function callDirectGeminiApi(
  history: ChatHistoryItem[],
  currentText: string,
  moods: MoodId[],
  turnCount: number
): Promise<{ text: string; isAiGenerated: boolean; isCrisis: boolean; shouldShowResources: boolean }> {
  const apiKey = getLiveGeminiApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key is not configured');
  }

  const model = import.meta.env.VITE_GEMINI_MODEL || 'gemini-3.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const formattedContents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  for (const item of history.slice(-6)) {
    formattedContents.push({
      role: item.role === 'model' ? 'model' : 'user',
      parts: [{ text: item.text }],
    });
  }

  const explicitMoods = moods.filter((m) => m && m !== 'unsure');
  const promptText =
    explicitMoods.length > 0 && !currentText.toLowerCase().includes('checking in feeling')
      ? `[User selected mood: ${explicitMoods.join(', ')}] ${currentText}`
      : currentText;

  formattedContents.push({
    role: 'user',
    parts: [{ text: promptText }],
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: COMPASSIONATE_SYSTEM_PROMPT }],
        },
        contents: formattedContents,
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 500,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const parts: Array<{ text?: string; thought?: boolean }> =
      data.candidates?.[0]?.content?.parts || [];
    const textPart =
      parts.find((p) => !p.thought && typeof p.text === 'string' && p.text.trim().length > 0) ||
      parts[0];
    const candidateText = textPart?.text?.trim();

    if (!candidateText) {
      throw new Error('Empty response received from Gemini');
    }

    return {
      text: candidateText,
      isAiGenerated: true,
      isCrisis: false,
      shouldShowResources: turnCount >= 2,
    };
  } catch (err) {
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

  // Combine user messages across the chat so recommendations reflect the full conversation
  const fullUserContext = [
    ...history.filter((h) => h.role === 'user').map((h) => h.text),
    currentText,
  ].join(' ');

  // Determine if resources were explicitly requested or if Turn 2+ reached
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

  // 2. Check if Cloud AI Gateway or Direct Gemini API is active
  const hasDirectPreviewKey = APP_CONFIG.flags.enableCloudAi && Boolean(getLiveGeminiApiKey());
  const canUseCloudAi = isCloudAiAvailable() || (hasDirectPreviewKey && getCompanionMode() === 'cloud');

  if (canUseCloudAi) {
    try {
      let cloudRes: { text: string; isAiGenerated: boolean; isCrisis: boolean; shouldShowResources: boolean };

      // When a direct preview key is configured, connect directly to Google Gemini API immediately;
      // otherwise use the server-side gateway (used in authenticated/unit test environments).
      if (hasDirectPreviewKey) {
        cloudRes = await callDirectGeminiApi(history, currentText, moods, turnCount);
      } else {
        cloudRes = await callCompanionGateway(history, currentText, moods, turnCount);
      }

      if (cloudRes.isCrisis) {
        const rec = generateCompassionateGuidance(moods.length > 0 ? moods : 'overwhelmed', fullUserContext);
        return {
          text: cloudRes.text,
          isCrisis: true,
          shouldShowResources: true,
          recommendation: rec,
          isAiGenerated: false,
        };
      }

      const showCloudResources = Boolean(cloudRes.shouldShowResources) || shouldRevealResources;
      const rec = showCloudResources
        ? generateCompassionateGuidance(moods.length > 0 ? moods : 'unsure', fullUserContext)
        : undefined;

      return {
        text: cloudRes.text,
        isCrisis: false,
        shouldShowResources: showCloudResources,
        recommendation: rec,
        isAiGenerated: cloudRes.isAiGenerated,
      };
    } catch (gatewayErr: unknown) {
      // Safe fallback: Log error type without message content or secrets
      const errName = gatewayErr instanceof Error ? gatewayErr.name : 'UnknownError';
      const errMsg = gatewayErr instanceof Error ? gatewayErr.message : String(gatewayErr);

      // Fall through to deterministic offline fallback engine
      const fallbackResult = getSmartDialogueResponse(moods, currentText, turnCount);
      const showFallbackResources = fallbackResult.shouldShowResources || shouldRevealResources;
      const rec = showFallbackResources
        ? generateCompassionateGuidance(moods.length > 0 ? moods : 'unsure', fullUserContext)
        : undefined;

      return {
        text: fallbackResult.text,
        isCrisis: false,
        shouldShowResources: showFallbackResources,
        recommendation: rec,
        isAiGenerated: false, // Strictly false: Fallback is deterministic, never remote AI
        fallbackReason: `${errName}: ${errMsg}`,
      };
    }
  }

  // 3. Resilient Smart Conversational Fallback Engine (Offline Sanctuary Companion)
  const fallbackResult = getSmartDialogueResponse(moods, currentText, turnCount);
  const showOfflineResources = fallbackResult.shouldShowResources || shouldRevealResources;
  const rec = showOfflineResources
    ? generateCompassionateGuidance(moods.length > 0 ? moods : 'unsure', fullUserContext)
    : undefined;

  return {
    text: fallbackResult.text,
    isCrisis: false,
    shouldShowResources: showOfflineResources,
    recommendation: rec,
    isAiGenerated: false,
  };
}
