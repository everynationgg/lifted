/**
 * LIFTED Cloud Authentication Types & Contracts
 * Phase 6: Optional Cloud Authentication & Zero-Trust Access
 */

import type { AppRole } from '../../types/database.types';

export type AuthAccountState =
  | 'GUEST'           // Pure offline guest, local UUID only, zero cloud calls
  | 'AUTHENTICATING'  // OTP / Magic link dispatch or verification in progress
  | 'AUTHENTICATED'   // Signed in to verified Supabase account with valid session
  | 'EXPIRED'         // Session expired / refresh token rejected
  | 'SIGNED_OUT';     // Explicitly signed out, reverted to local guest

export interface AuthSessionUser {
  id: string;
  email: string;
  role?: AppRole;
  displayName?: string;
  isAnonymous?: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  user: AuthSessionUser;
}

export interface SignInWithOtpParams {
  email: string;
  emailRedirectTo?: string;
  shouldCreateUser?: boolean;
}

export interface VerifyOtpParams {
  email: string;
  token: string;
}

export interface SignInWithPasswordParams {
  email: string;
  password: string;
}

export interface AuthActionResult {
  success: boolean;
  message?: string;
  error?: string;
  session?: AuthSession | null;
}

export interface ISupabaseAuthService {
  /**
   * Current high-level account state
   */
  getAccountState(): AuthAccountState;

  /**
   * Currently authenticated user (null if guest or signed out)
   */
  getCurrentUser(): AuthSessionUser | null;

  /**
   * Returns current user ID if signed in, or local guest UUID if offline guest
   */
  getEffectiveUserId(): Promise<string>;

  /**
   * Request email Magic Link / OTP. Requires explicit user consent and network.
   */
  signInWithOtp(params: SignInWithOtpParams): Promise<AuthActionResult>;

  /**
   * Authenticate staff user with email and password.
   */
  signInWithPassword(params: SignInWithPasswordParams): Promise<AuthActionResult>;

  /**
   * Verify received OTP code.
   */
  verifyOtp(params: VerifyOtpParams): Promise<AuthActionResult>;

  /**
   * Sign out of current cloud account. Does NOT delete or alter local records.
   */
  signOut(): Promise<AuthActionResult>;

  /**
   * Fetch current user roles from public.user_roles
   */
  getUserRole(forceRefresh?: boolean): Promise<AppRole | null>;

  /**
   * Check if current user has administrator authority verified by backend
   */
  isAdmin(): Promise<boolean>;

  /**
   * Check if current user has editor authority verified by backend RPC
   */
  isEditor(): Promise<boolean>;

  /**
   * Check if current user has publisher authority verified by backend RPC
   */
  isPublisher(): Promise<boolean>;

  /**
   * Safe Second-Device Recovery Bootstrap:
   * Retrieves the wrapped AEK escrow envelope for an authenticated session
   * prior to device enrollment, using the narrowly scoped security invoker RPC.
   * Does NOT expose journal contents, and never transmits the recovery secret.
   */
  getRecoveryBootstrapEnvelope(): Promise<unknown | null>;

  /**
   * Secure Account Deletion Request Mechanism:
   * When authenticated, requests deletion of the user's cloud account and server-side data.
   * If running as an offline guest, confirms that only local records exist.
   */
  requestAccountDeletion(): Promise<AuthActionResult>;

  /**
   * Subscribe to auth state transitions
   */
  onAuthStateChange(callback: (state: AuthAccountState, user: AuthSessionUser | null) => void): () => void;
}
