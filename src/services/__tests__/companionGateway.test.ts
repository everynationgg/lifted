import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  handleCompanionGatewayRequest,
  isCrisisText,
  GATEWAY_SYSTEM_INSTRUCTION,
  type GatewayEnvironment,
  type GatewayDependencies,
} from '../../../supabase/functions/companion-gateway/handler';

describe('companion-gateway Edge Function (Phase 7 Server-Side AI Gateway)', () => {
  const defaultEnv: GatewayEnvironment = {
    CLOUD_AI_ENABLED: 'true',
    GEMINI_API_KEY: 'test-server-gemini-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: 'test-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
    ALLOWED_ORIGINS: 'http://localhost:5173,capacitor://localhost',
  };

  const mockValidUser = { id: 'usr-1111-2222-3333-4444', email: 'seeker@lifted.app' };

  let mockDeps: GatewayDependencies;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockDeps = {
      verifyAuth: vi.fn().mockResolvedValue(mockValidUser),
      checkConsent: vi.fn().mockResolvedValue(true),
      checkQuota: vi.fn().mockResolvedValue({
        allowed: true,
        rejectionReason: 'ALLOWED',
        minuteCount: 1,
        dayCount: 1,
        globalDayCount: 1,
      }),
      fetchProvider: vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [{ text: 'I hear what a heavy burden that has been for your heart today.' }],
                    role: 'model',
                  },
                  finishReason: 'STOP',
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
      ),
    };
  });

  describe('1. Method, Master Kill Switch & CORS Enforcement', () => {
    it('handles OPTIONS preflight with 204 and CORS headers for allowed web origin', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:5173' },
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('handles OPTIONS preflight for native Capacitor origin', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'OPTIONS',
        headers: { Origin: 'capacitor://localhost' },
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost');
    });

    it('does not reflect unlisted origins in CORS headers', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'OPTIONS',
        headers: { Origin: 'https://evil-unauthorized-proxy.com' },
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    it('rejects GET requests with 405 Method Not Allowed', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'GET',
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(405);
      const json = await res.json();
      expect(json.error).toBe('METHOD_NOT_ALLOWED');
    });

    it('rejects DELETE requests with 405 Method Not Allowed', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'DELETE',
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(405);
    });

    it('MASTER KILL SWITCH: returns 503 CLOUD_AI_DISABLED when CLOUD_AI_ENABLED is false or unset', async () => {
      const disabledEnv: GatewayEnvironment = {
        ...defaultEnv,
        CLOUD_AI_ENABLED: 'false',
      };

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Hello guide' }),
      });

      const res = await handleCompanionGatewayRequest(req, disabledEnv, mockDeps);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('CLOUD_AI_DISABLED');
      expect(json.message).toContain('disabled by administrator');

      // Provider and quota are NOT called when kill switch is active
      expect(mockDeps.fetchProvider).not.toHaveBeenCalled();
      expect(mockDeps.checkQuota).not.toHaveBeenCalled();
    });
  });

  describe('2. Payload Size & JSON Schema Validation', () => {
    it('rejects oversized Content-Length (>32KB) with 413 Payload Too Large', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Length': '40000',
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'test' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(413);
      const json = await res.json();
      expect(json.error).toBe('PAYLOAD_TOO_LARGE');
    });

    it('rejects malformed JSON with 400 INVALID_JSON', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: '{ malformed json: not valid',
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_JSON');
    });

    it('rejects empty message with 400 INVALID_INPUT', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: '   ' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_INPUT');
    });

    it('rejects message exceeding 1000 characters with 400 INVALID_INPUT', async () => {
      const longMessage = 'A'.repeat(1001);
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: longMessage }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('INVALID_INPUT');
    });
  });

  describe('3. Verified Caller Authentication', () => {
    it('rejects missing Authorization header with 401 UNAUTHORIZED', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('UNAUTHORIZED');
    });

    it('rejects invalid or expired token with 401 UNAUTHORIZED', async () => {
      mockDeps.verifyAuth = vi.fn().mockResolvedValue(null);

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer expired-or-forged-jwt',
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBe('UNAUTHORIZED');
    });
  });

  describe('4. Server-Side Crisis Interception Barrier', () => {
    it('intercepts crisis messages on server without calling external Gemini provider', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'I want to kill myself, I cannot go on' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.isCrisis).toBe(true);
      expect(json.shouldShowResources).toBe(true);
      expect(json.text).toContain('988');
      expect(json.text).toContain('741741');
      expect(json.isAiGenerated).toBe(false);

      // Verify Gemini was NOT called
      expect(mockDeps.fetchProvider).not.toHaveBeenCalled();
    });

    it('identifies various crisis phrases accurately', () => {
      expect(isCrisisText('I want to end my life')).toBe(true);
      expect(isCrisisText('thinking of self harm')).toBe(true);
      expect(isCrisisText('slit my wrist')).toBe(true);
      expect(isCrisisText('I feel overwhelmed with work')).toBe(false);
      expect(isCrisisText('Can we pray together?')).toBe(false);
    });
  });

  describe('5. Server-Side Authoritative Consent Verification', () => {
    it('rejects requests when user has no active server-side consent record with 403 CONSENT_REQUIRED', async () => {
      mockDeps.checkConsent = vi.fn().mockResolvedValue(false);

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Hello guide' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('CONSENT_REQUIRED');
      expect(mockDeps.fetchProvider).not.toHaveBeenCalled();
    });

    it('ignores client-supplied consentGiven: true when server consent is missing', async () => {
      mockDeps.checkConsent = vi.fn().mockResolvedValue(false);

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        // Client attempts to spoof consent via payload
        body: JSON.stringify({ message: 'Hello guide', consentGiven: true }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('CONSENT_REQUIRED');
      expect(mockDeps.fetchProvider).not.toHaveBeenCalled();
    });

    it('allows request when user has verified server-side consent in PostgreSQL', async () => {
      mockDeps.checkConsent = vi.fn().mockResolvedValue(true);

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Hello guide' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(200);
      expect(mockDeps.checkConsent).toHaveBeenCalledWith(mockValidUser.id, defaultEnv);
    });
  });

  describe('6. Fail-Closed Rate Limiting, Daily Quotas & Spending Ceilings', () => {
    it('FAILS CLOSED: returns 503 QUOTA_SERVICE_UNAVAILABLE when database quota service is down', async () => {
      mockDeps.checkQuota = vi.fn().mockResolvedValue({
        allowed: false,
        rejectionReason: 'QUOTA_SERVICE_UNAVAILABLE',
        minuteCount: 0,
        dayCount: 0,
      });

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Need some comfort' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('QUOTA_SERVICE_UNAVAILABLE');
      // Must NOT invoke the provider when quota service is unavailable
      expect(mockDeps.fetchProvider).not.toHaveBeenCalled();
    });

    it('returns 429 RATE_LIMIT_EXCEEDED when burst limit (5 req/min) is exceeded', async () => {
      mockDeps.checkQuota = vi.fn().mockResolvedValue({
        allowed: false,
        rejectionReason: 'BURST_LIMIT_EXCEEDED',
        minuteCount: 5,
        dayCount: 10,
      });

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Need some comfort' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('60');
      const json = await res.json();
      expect(json.error).toBe('RATE_LIMIT_EXCEEDED');
      expect(json.message).toContain('Burst rate limit reached');
      expect(mockDeps.fetchProvider).not.toHaveBeenCalled();
    });

    it('returns 429 RATE_LIMIT_EXCEEDED when daily quota (30 req/day) is reached', async () => {
      mockDeps.checkQuota = vi.fn().mockResolvedValue({
        allowed: false,
        rejectionReason: 'DAILY_QUOTA_EXCEEDED',
        minuteCount: 1,
        dayCount: 30,
      });

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Need some comfort' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('3600');
      const json = await res.json();
      expect(json.error).toBe('RATE_LIMIT_EXCEEDED');
      expect(json.message).toContain('Daily request quota reached');
    });

    it('returns 429 GLOBAL_CEILING_EXCEEDED when project spending/usage ceiling is reached', async () => {
      mockDeps.checkQuota = vi.fn().mockResolvedValue({
        allowed: false,
        rejectionReason: 'GLOBAL_CEILING_EXCEEDED',
        minuteCount: 1,
        dayCount: 5,
        globalDayCount: 1000,
      });

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Need some comfort' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe('GLOBAL_CEILING_EXCEEDED');
      expect(json.message).toContain('Daily project AI usage ceiling reached');
      expect(mockDeps.fetchProvider).not.toHaveBeenCalled();
    });
  });

  describe('7. Server-Side Gemini API Invocation & Provider Robustness', () => {
    it('returns 503 PROVIDER_NOT_CONFIGURED when GEMINI_API_KEY is missing', async () => {
      const envNoKey: GatewayEnvironment = {
        ...defaultEnv,
        GEMINI_API_KEY: undefined,
      };

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      const res = await handleCompanionGatewayRequest(req, envNoKey, mockDeps);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('PROVIDER_NOT_CONFIGURED');
    });

    it('handles mock Gemini API key cleanly for offline mock testing', async () => {
      const mockEnv: GatewayEnvironment = {
        ...defaultEnv,
        GEMINI_API_KEY: 'mock',
      };

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Hello guide' }),
      });

      const res = await handleCompanionGatewayRequest(req, mockEnv, mockDeps);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.text).toContain('[Mock Guide]');
      expect(json.isAiGenerated).toBe(true);
    });

    it('returns 504 PROVIDER_TIMEOUT when Google Gemini provider times out', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      mockDeps.fetchProvider = vi.fn().mockRejectedValue(abortError);

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Heavy day' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(504);
      const json = await res.json();
      expect(json.error).toBe('PROVIDER_TIMEOUT');
    });

    it('returns 502 PROVIDER_RATE_LIMITED when Google Gemini returns 429', async () => {
      mockDeps.fetchProvider = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'RESOURCE_EXHAUSTED' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Hello' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(502);
      const json = await res.json();
      expect(json.error).toBe('PROVIDER_RATE_LIMITED');
    });

    it('handles provider safety block gracefully with compassionate fallback and isAiGenerated=false', async () => {
      mockDeps.fetchProvider = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: 'SAFETY',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({ message: 'Deep grief' }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.safetyBlocked).toBe(true);
      expect(json.isAiGenerated).toBe(false);
      expect(json.text).toContain('holding a gentle, peaceful space');
    });

    it('processes successful Gemini response with thinkingBudget: 0 clamped', async () => {
      const req = new Request('http://localhost:54321/functions/v1/companion-gateway', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt',
        },
        body: JSON.stringify({
          message: 'I am struggling with work fatigue',
          history: [{ role: 'user', text: 'hello' }, { role: 'model', text: 'hello' }],
        }),
      });

      const res = await handleCompanionGatewayRequest(req, defaultEnv, mockDeps);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.text).toContain('heavy burden');
      expect(json.isAiGenerated).toBe(true);
      expect(json.model).toBe('gemini-2.5-flash');

      // Verify request payload sent to Gemini API
      expect(mockDeps.fetchProvider).toHaveBeenCalledTimes(1);
      const [url, init] = (mockDeps.fetchProvider as any).mock.calls[0];
      expect(url).toContain('gemini-2.5-flash:generateContent');
      expect(init.headers['x-goog-api-key']).toBe('test-server-gemini-key');

      const payload = JSON.parse(init.body);
      expect(payload.systemInstruction.parts[0].text).toContain('Christ-centered');
      expect(payload.generationConfig.maxOutputTokens).toBe(200);
      expect(payload.generationConfig.temperature).toBe(0.4);
      // Confirms thinkingBudget is clamped to 0 to prevent runaway thinking token costs
      expect(payload.generationConfig.thinkingConfig.thinkingBudget).toBe(0);
      expect(payload.safetySettings.length).toBe(4);
    });

    it('verifies system prompt constants include strict boundaries', () => {
      expect(GATEWAY_SYSTEM_INSTRUCTION).toContain('LIFTED Compassionate Guide');
      expect(GATEWAY_SYSTEM_INSTRUCTION).toContain('Do NOT provide clinical diagnosis');
      expect(GATEWAY_SYSTEM_INSTRUCTION).toContain('988 or 741741');
      expect(GATEWAY_SYSTEM_INSTRUCTION).toContain('Never preach');
      expect(GATEWAY_SYSTEM_INSTRUCTION).toContain('Never invent scripture');
    });
  });
});
