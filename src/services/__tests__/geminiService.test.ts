import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sendCompanionMessage,
  getGeminiApiKey,
  hasGeminiApiKey,
  testGeminiConnection,
  getCompanionMode,
  setCompanionMode,
  hasCloudAiConsent,
  setCloudAiConsent,
  revokeCloudAiConsent,
  getCloudAiConsent,
  isCloudAiAvailable,
  type ChatHistoryItem,
} from '../geminiService';
import { supabaseAuthService } from '../auth/supabaseAuthService';
import { networkService } from '../networkService';

describe('geminiService - Sanctuary Companion & Phase 7 Cloud AI Gateway', () => {
  beforeEach(() => {
    localStorage.clear();
    setCompanionMode('offline');
    revokeCloudAiConsent();
    vi.restoreAllMocks();
  });

  describe('1. Phase 0 Deprecated Key Accessors & Strict Key Safety', () => {
    it('returns empty string for client api key', () => {
      expect(getGeminiApiKey()).toBe('');
    });

    it('returns false for hasGeminiApiKey', () => {
      expect(hasGeminiApiKey()).toBe(false);
    });

    it('testGeminiConnection reports offline companion active when in offline mode', async () => {
      const res = await testGeminiConnection();
      expect(res.success).toBe(true);
      expect(res.message).toContain('Offline Sanctuary Companion active');
    });
  });

  describe('2. Immediate Crisis Escalation Barrier (On-Device Zero-Latency)', () => {
    it('escalates acute crisis message immediately with 988 and 741741 hotlines', async () => {
      const response = await sendCompanionMessage([], 'I cannot go on, I want to kill myself', ['sad'], 1);
      expect(response.isCrisis).toBe(true);
      expect(response.shouldShowResources).toBe(true);
      expect(response.text).toContain('988');
      expect(response.text).toContain('741741');
      expect(response.isAiGenerated).toBe(false);
    });

    it('escalates crisis even when user selected peaceful mood accidentally', async () => {
      const response = await sendCompanionMessage([], 'want to die', ['peaceful'], 1);
      expect(response.isCrisis).toBe(true);
      expect(response.text).toContain('precious');
    });

    it('intercepts crisis on-device even if Cloud AI mode is active and user has consented', async () => {
      setCompanionMode('cloud');
      setCloudAiConsent(true);
      vi.spyOn(networkService, 'isConnected').mockReturnValue(true);
      vi.spyOn(supabaseAuthService, 'getAccountState').mockReturnValue('AUTHENTICATED');

      const fetchSpy = vi.spyOn(globalThis, 'fetch');

      const response = await sendCompanionMessage([], 'I want to kill myself', ['sad'], 1);
      expect(response.isCrisis).toBe(true);
      expect(response.isAiGenerated).toBe(false);
      // Zero network calls made to external AI provider
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe('3. Multi-Turn Conversational Pacing (Offline Sanctuary Companion)', () => {
    it('Turn 1: Listens and holds space without premature tool-dumping', async () => {
      const response = await sendCompanionMessage([], 'I had a terrible argument with my husband today', ['frustrated'], 1);
      expect(response.isCrisis).toBe(false);
      expect(response.shouldShowResources).toBe(false);
      expect(response.recommendation).toBeUndefined();
      expect(response.text).toContain('conflict');
    });

    it('Turn 1 with Greeting: Warmly welcomes user', async () => {
      const response = await sendCompanionMessage([], 'hello', ['peaceful'], 1);
      expect(response.isCrisis).toBe(false);
      expect(response.shouldShowResources).toBe(false);
      expect(response.text.toLowerCase()).toContain('hello');
    });

    it('Turn 1 with Explicit Tool Request: Reveals resources when requested', async () => {
      const response = await sendCompanionMessage([], 'Can you give me a scripture to pray through?', ['anxious'], 1);
      expect(response.isCrisis).toBe(false);
      expect(response.shouldShowResources).toBe(true);
      expect(response.recommendation).toBeDefined();
    });

    it('Turn 2: Deepens empathy and offers gentle suggestions', async () => {
      const history: ChatHistoryItem[] = [
        { role: 'user', text: 'I am struggling with work.' },
        { role: 'model', text: 'I hear how heavy that is.' },
      ];
      const response = await sendCompanionMessage(history, 'It feels like everything is too much', ['overwhelmed'], 2);
      expect(response.isCrisis).toBe(false);
      expect(response.shouldShowResources).toBe(true);
      expect(response.recommendation).toBeDefined();
      expect(response.isAiGenerated).toBe(false);
    });

    it('Turn 3+: Holds space with tailored anchors', async () => {
      const history: ChatHistoryItem[] = [
        { role: 'user', text: 'Turn 1' },
        { role: 'model', text: 'Response 1' },
        { role: 'user', text: 'Turn 2' },
        { role: 'model', text: 'Response 2' },
      ];
      const response = await sendCompanionMessage(history, 'I feel a little better now', ['hopeful'], 3);
      expect(response.isCrisis).toBe(false);
      expect(response.shouldShowResources).toBe(true);
      expect(response.recommendation).toBeDefined();
    });
  });

  describe('4. Phase 7 Companion Mode & Informed Consent Management', () => {
    it('defaults to offline companion mode', () => {
      expect(getCompanionMode()).toBe('offline');
      expect(hasCloudAiConsent()).toBe(false);
    });

    it('persists mode selection across sessions', () => {
      setCompanionMode('cloud');
      expect(getCompanionMode()).toBe('cloud');
      expect(localStorage.getItem('lifted_companion_mode')).toBe('cloud');

      setCompanionMode('offline');
      expect(getCompanionMode()).toBe('offline');
      expect(localStorage.getItem('lifted_companion_mode')).toBe('offline');
    });

    it('records detailed consent timestamp and provider metadata on opt-in', () => {
      setCloudAiConsent(true);
      expect(hasCloudAiConsent()).toBe(true);

      const record = getCloudAiConsent();
      expect(record).not.toBeNull();
      expect(record?.consented).toBe(true);
      expect(record?.provider).toBe('google_gemini');
      expect(record?.model).toBe('gemini-2.5-flash');
      expect(record?.consentedAt).toBeGreaterThan(0);
    });

    it('reverts mode to offline when consent is revoked', () => {
      setCompanionMode('cloud');
      setCloudAiConsent(true);
      expect(getCompanionMode()).toBe('cloud');

      revokeCloudAiConsent();
      expect(hasCloudAiConsent()).toBe(false);
      expect(getCompanionMode()).toBe('offline');
    });

    it('correctly evaluates isCloudAiAvailable only when all conditions are met', () => {
      setCompanionMode('cloud');
      setCloudAiConsent(true);
      vi.spyOn(networkService, 'isConnected').mockReturnValue(true);
      vi.spyOn(supabaseAuthService, 'getAccountState').mockReturnValue('AUTHENTICATED');

      // Fully met
      expect(isCloudAiAvailable()).toBe(true);

      // Mode is offline -> false
      setCompanionMode('offline');
      expect(isCloudAiAvailable()).toBe(false);
      setCompanionMode('cloud');

      // Consent missing -> false
      revokeCloudAiConsent();
      expect(isCloudAiAvailable()).toBe(false);
      setCloudAiConsent(true);

      // Network offline -> false
      vi.spyOn(networkService, 'isConnected').mockReturnValue(false);
      expect(isCloudAiAvailable()).toBe(false);
      vi.spyOn(networkService, 'isConnected').mockReturnValue(true);

      // Unauthenticated guest -> false
      vi.spyOn(supabaseAuthService, 'getAccountState').mockReturnValue('GUEST');
      expect(isCloudAiAvailable()).toBe(false);
    });

    it('reports Cloud AI status in testGeminiConnection when enabled and consented', async () => {
      setCompanionMode('cloud');
      setCloudAiConsent(true);
      const res = await testGeminiConnection();
      expect(res.success).toBe(true);
      expect(res.message).toContain('Cloud AI Gateway configured');
      expect(res.message).toContain('gemini-2.5-flash');
    });
  });

  describe('5. Cloud Gateway Invocation & Deterministic Fallback', () => {
    it('calls Edge Function gateway and receives AI reflection when conditions are satisfied', async () => {
      setCompanionMode('cloud');
      setCloudAiConsent(true);
      vi.spyOn(networkService, 'isConnected').mockReturnValue(true);
      vi.spyOn(supabaseAuthService, 'getAccountState').mockReturnValue('AUTHENTICATED');

      // Mock Supabase client session
      const mockClient = {
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: 'valid-test-jwt-token' } },
            error: null,
          }),
        },
      };
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(mockClient as any);

      // Mock gateway HTTP response
      const mockGatewayResponse = {
        success: true,
        text: 'God sees the tiredness in your spirit and welcomes you to rest in His quiet grace.',
        model: 'gemini-2.5-flash',
        isAiGenerated: true,
        isCrisis: false,
        shouldShowResources: false,
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockGatewayResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const response = await sendCompanionMessage([], 'I am feeling deeply exhausted from caregiving', ['tired'], 1);
      expect(response.isCrisis).toBe(false);
      expect(response.isAiGenerated).toBe(true);
      expect(response.text).toContain('tiredness in your spirit');
      expect(response.fallbackReason).toBeUndefined();
    });

    it('falls back to offline sanctuary companion when gateway returns 502/503 error', async () => {
      setCompanionMode('cloud');
      setCloudAiConsent(true);
      vi.spyOn(networkService, 'isConnected').mockReturnValue(true);
      vi.spyOn(supabaseAuthService, 'getAccountState').mockReturnValue('AUTHENTICATED');

      const mockClient = {
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: 'valid-jwt' } },
            error: null,
          }),
        },
      };
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(mockClient as any);

      // Gateway returns 502 Bad Gateway
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'PROVIDER_ERROR', message: 'Upstream provider unavailable' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const response = await sendCompanionMessage([], 'I am overwhelmed with parenting', ['overwhelmed'], 1);
      expect(response.isCrisis).toBe(false);
      // Strictly marked as NOT AI-generated because fallback generated it
      expect(response.isAiGenerated).toBe(false);
      expect(response.fallbackReason).toBeDefined();
      expect(response.fallbackReason).toContain('Gateway returned error: PROVIDER_ERROR');
      // Contains valid offline companion dialogue
      expect(response.text.length).toBeGreaterThan(20);
    });

    it('falls back to offline sanctuary companion when gateway times out', async () => {
      setCompanionMode('cloud');
      setCloudAiConsent(true);
      vi.spyOn(networkService, 'isConnected').mockReturnValue(true);
      vi.spyOn(supabaseAuthService, 'getAccountState').mockReturnValue('AUTHENTICATED');

      const mockClient = {
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: 'valid-jwt' } },
            error: null,
          }),
        },
      };
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(mockClient as any);

      // Simulate network timeout rejection
      const timeoutError = new Error('The operation was aborted');
      timeoutError.name = 'AbortError';
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(timeoutError);

      const response = await sendCompanionMessage([], 'hello', ['peaceful'], 1);
      expect(response.isCrisis).toBe(false);
      expect(response.isAiGenerated).toBe(false);
      expect(response.fallbackReason).toContain('AbortError');
      expect(response.text.toLowerCase()).toContain('hello');
    });

    it('falls back cleanly to offline companion when gateway reports 429 rate limit', async () => {
      setCompanionMode('cloud');
      setCloudAiConsent(true);
      vi.spyOn(networkService, 'isConnected').mockReturnValue(true);
      vi.spyOn(supabaseAuthService, 'getAccountState').mockReturnValue('AUTHENTICATED');

      const mockClient = {
        auth: {
          getSession: vi.fn().mockResolvedValue({
            data: { session: { access_token: 'valid-jwt' } },
            error: null,
          }),
        },
      };
      vi.spyOn(supabaseAuthService, 'getClient').mockReturnValue(mockClient as any);

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit reached' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const response = await sendCompanionMessage([], 'I feel lonely', ['lonely'], 1);
      expect(response.isCrisis).toBe(false);
      expect(response.isAiGenerated).toBe(false);
      expect(response.fallbackReason).toContain('RATE_LIMIT_EXCEEDED');
      expect(response.text).toContain('alone');
    });
  });
});
