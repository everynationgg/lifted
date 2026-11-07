/**
 * Supabase Edge Function: companion-gateway
 * LIFTED Phase 7: Secure Server-Side Gemini Gateway
 *
 * Runs on Deno 2 in Supabase Edge Runtime.
 */

// @ts-ignore: Deno runtime types
import { handleCompanionGatewayRequest, GatewayEnvironment } from './handler.ts';

// @ts-ignore: Deno global
if (typeof Deno !== 'undefined' && Deno.serve) {
  // @ts-ignore: Deno global
  Deno.serve(async (req: Request) => {
    const env: GatewayEnvironment = {
      // @ts-ignore: Deno global
      CLOUD_AI_ENABLED: Deno.env.get('CLOUD_AI_ENABLED') || 'false',
      // @ts-ignore: Deno global
      GEMINI_API_KEY: Deno.env.get('GEMINI_API_KEY'),
      // @ts-ignore: Deno global
      GEMINI_MODEL: Deno.env.get('GEMINI_MODEL') || 'gemini-2.5-flash',
      // @ts-ignore: Deno global
      SUPABASE_URL: Deno.env.get('SUPABASE_URL'),
      // @ts-ignore: Deno global
      SUPABASE_ANON_KEY: Deno.env.get('SUPABASE_ANON_KEY'),
      // @ts-ignore: Deno global
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      // @ts-ignore: Deno global
      ALLOWED_ORIGINS: Deno.env.get('ALLOWED_ORIGINS'),
    };

    return handleCompanionGatewayRequest(req, env);
  });
}

export { handleCompanionGatewayRequest };
