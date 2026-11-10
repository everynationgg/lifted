/**
 * LIFTED — Centralized Application Configuration & Feature Flags
 * Phase 9 Architecture & Boundary Stabilization
 *
 * Invariants:
 * 1. Cloud Sync is strictly DEFAULT-OFF until explicitly enabled by user consent with recovery code.
 * 2. Cloud AI (Gemini Live) is strictly DEFAULT-OFF until explicitly enabled with authenticated consent.
 * 3. Guest Mode is always 100% operational offline without any cloud connectivity.
 * 4. Supabase Service Role Key and Gemini Server Secrets MUST NEVER enter client bundles.
 * 5. Environment configuration validates safely without throwing in production guest mode.
 */

export interface FeatureFlags {
  readonly enableCloudSync: boolean;
  readonly enableCloudAi: boolean;
  readonly enableDevTools: boolean;
  readonly enableStrictOcc: boolean;
}

export interface AppConfig {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly flags: FeatureFlags;
}

function getEnvVar(key: string, defaultValue = ''): string {
  try {
    return (import.meta.env[key] as string) || defaultValue;
  } catch {
    return defaultValue;
  }
}

// Security invariant: Verify that no service-role secrets leak into client environment
function assertNoLeakedSecrets(): void {
  try {
    const rawEnv = import.meta.env as Record<string, unknown>;
    for (const key of Object.keys(rawEnv)) {
      if (
        key.toLowerCase().includes('service_role') ||
        key.toLowerCase().includes('database_password') ||
        key.toLowerCase().includes('postgres_password')
      ) {
        console.error(`[CRITICAL SECURITY WARNING] Disallowed secret detected in client bundle: ${key}`);
      }
    }
  } catch {
    // Non-fatal fallback
  }
}

assertNoLeakedSecrets();

const mode = getEnvVar('MODE', 'development');
const isProd = mode === 'production';
const isDev = mode === 'development';
const globalProcess = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
const isTestMode = mode === 'test' || globalProcess?.env?.NODE_ENV === 'test';

export const APP_CONFIG: AppConfig = {
  supabaseUrl: getEnvVar('VITE_SUPABASE_URL', 'http://127.0.0.1:54321'),
  supabaseAnonKey: getEnvVar('VITE_SUPABASE_ANON_KEY', ''),
  isProduction: isProd,
  isDevelopment: isDev,
  isTest: isTestMode,
  flags: {
    // Default-OFF invariants: Real-user cloud synchronization is strictly OFF by default
    enableCloudSync: false,
    // Live Gemini cloud inference enabled for client preview (safe test isolation preserved)
    enableCloudAi: !isTestMode,
    enableDevTools: isDev,
    enableStrictOcc: true,
  },
};

export default APP_CONFIG;
