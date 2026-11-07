/**
 * LIFTED Supabase Authentication Service
 * Phase 6: Optional Cloud Authentication, Zero-Trust Access & Offline Guest Isolation
 *
 * Implements ISupabaseAuthService using @supabase/supabase-js with:
 * - Pure offline guest mode preservation (zero background network calls on startup)
 * - Safe session persistence via SupabaseSessionStorageAdapter
 * - Server-controlled role verification (RPC is_admin)
 * - Strict token privacy (zero token leakage in console logs)
 * - Zero automatic upload of offline journals or prayers
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, AppRole } from '../../types/database.types';
import type {
  ISupabaseAuthService,
  AuthAccountState,
  AuthSessionUser,
  AuthActionResult,
  SignInWithOtpParams,
  VerifyOtpParams,
  SignInWithPasswordParams,
} from './types';
import { supabaseSessionStorage } from './supabaseStorageAdapter';
import { networkService, type INetworkTelemetryService } from '../networkService';
import { vaultManager, type VaultManager } from '../../storage/vaultManager';

export class SupabaseAuthService implements ISupabaseAuthService {
  private client: SupabaseClient<Database> | null = null;
  private accountState: AuthAccountState = 'GUEST';
  private currentUser: AuthSessionUser | null = null;
  private cachedRole: AppRole | null = null;
  private network: INetworkTelemetryService;
  private vault: VaultManager;
  private listeners: Set<(state: AuthAccountState, user: AuthSessionUser | null) => void> = new Set();
  private isConfigured = false;

  constructor(
    network: INetworkTelemetryService = networkService,
    vault: VaultManager = vaultManager,
    customClient?: SupabaseClient<Database>
  ) {
    this.network = network;
    this.vault = vault;

    if (customClient) {
      this.client = customClient;
      this.isConfigured = true;
      this.initSessionFromClient();
    } else {
      this.initializeClientSafely();
    }
  }

  /**
   * Initializes the Supabase client safely without making network requests.
   * Supabase Auth is configured with custom storage and autoRefreshToken.
   */
  private initializeClientSafely(): void {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      // Unconfigured environment: remains purely offline guest mode
      this.isConfigured = false;
      this.accountState = 'GUEST';
      return;
    }

    try {
      this.client = createClient<Database>(supabaseUrl, supabaseAnonKey, {
        auth: {
          storage: supabaseSessionStorage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false, // Prevent URL token hijacking on mobile
        },
      });
      this.isConfigured = true;
      this.initSessionFromClient();
    } catch {
      this.isConfigured = false;
      this.accountState = 'GUEST';
    }
  }

  /**
   * Inspects client session state without blocking or throwing
   */
  private async initSessionFromClient(): Promise<void> {
    if (!this.client) return;

    try {
      const { data } = await this.client.auth.getSession();
      if (data?.session?.user) {
        this.currentUser = {
          id: data.session.user.id,
          email: data.session.user.email ?? '',
          isAnonymous: data.session.user.is_anonymous ?? false,
        };
        this.accountState = 'AUTHENTICATED';
        this.notifyListeners();
      }
    } catch {
      // Retain GUEST state if session cannot be retrieved
      this.accountState = 'GUEST';
    }
  }

  getAccountState(): AuthAccountState {
    return this.accountState;
  }

  getCurrentUser(): AuthSessionUser | null {
    return this.currentUser;
  }

  /**
   * Pure Offline Guest Mode Preservation:
   * Returns authenticated user ID if signed in, or local guest UUID if offline guest.
   * Never forces cloud sign-in.
   */
  async getEffectiveUserId(): Promise<string> {
    if (this.currentUser?.id) {
      return this.currentUser.id;
    }
    const guestIdentity = await this.vault.identity.getOrCreateIdentity();
    return guestIdentity.localUserId;
  }

  /**
   * User-initiated Sign-in with Email OTP / Magic Link.
   * Requires user consent and active network connection.
   */
  async signInWithOtp(params: SignInWithOtpParams): Promise<AuthActionResult> {
    if (!this.isConfigured || !this.client) {
      return {
        success: false,
        error: 'CONFIG_ERROR: Supabase cloud environment is not configured.',
      };
    }

    if (!this.network.isConnected()) {
      return {
        success: false,
        error: 'OFFLINE_ERROR: An active internet connection is required to sign in.',
      };
    }

    if (!params.email || !params.email.includes('@')) {
      return {
        success: false,
        error: 'VALIDATION_ERROR: A valid email address is required.',
      };
    }

    this.accountState = 'AUTHENTICATING';
    this.notifyListeners();

    try {
      const { error } = await this.client.auth.signInWithOtp({
        email: params.email.trim().toLowerCase(),
        options: {
          emailRedirectTo: params.emailRedirectTo,
          shouldCreateUser: params.shouldCreateUser ?? true,
        },
      });

      if (error) {
        this.accountState = 'GUEST';
        this.notifyListeners();
        return {
          success: false,
          error: error.message,
        };
      }

      return {
        success: true,
        message: 'A verification code or magic link has been sent to your email.',
      };
    } catch (err: unknown) {
      this.accountState = 'GUEST';
      this.notifyListeners();
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: msg,
      };
    }
  }

  /**
   * Verify Email OTP Code
   */
  async verifyOtp(params: VerifyOtpParams): Promise<AuthActionResult> {
    if (!this.isConfigured || !this.client) {
      return {
        success: false,
        error: 'CONFIG_ERROR: Supabase cloud environment is not configured.',
      };
    }

    if (!this.network.isConnected()) {
      return {
        success: false,
        error: 'OFFLINE_ERROR: An active internet connection is required to verify code.',
      };
    }

    try {
      const { data, error } = await this.client.auth.verifyOtp({
        email: params.email.trim().toLowerCase(),
        token: params.token.trim(),
        type: 'email',
      });

      if (error || !data.session) {
        return {
          success: false,
          error: error?.message || 'Verification failed. Please check the code.',
        };
      }

      this.currentUser = {
        id: data.session.user.id,
        email: data.session.user.email ?? '',
        isAnonymous: data.session.user.is_anonymous ?? false,
      };
      this.accountState = 'AUTHENTICATED';
      this.cachedRole = null; // Clear cached role on account switch

      // Fetch role in background
      await this.getUserRole();

      this.notifyListeners();

      return {
        success: true,
        message: 'Successfully authenticated.',
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
          user: this.currentUser,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err) ? String((err as any).message) : JSON.stringify(err);
      return {
        success: false,
        error: msg,
      };
    }
  }

  /**
   * User-initiated Sign-in with Email and Password for authorized staff.
   */
  async signInWithPassword(params: SignInWithPasswordParams): Promise<AuthActionResult> {
    if (!this.isConfigured || !this.client) {
      return {
        success: false,
        error: 'CONFIG_ERROR: Supabase cloud environment is not configured.',
      };
    }

    if (!this.network.isConnected()) {
      return {
        success: false,
        error: 'OFFLINE_ERROR: An active internet connection is required to sign in.',
      };
    }

    if (!params.email || !params.email.includes('@')) {
      return {
        success: false,
        error: 'VALIDATION_ERROR: Please enter a valid email address.',
      };
    }

    if (!params.password || params.password.length < 6) {
      return {
        success: false,
        error: 'VALIDATION_ERROR: Password must be at least 6 characters.',
      };
    }

    try {
      const { data, error } = await this.client.auth.signInWithPassword({
        email: params.email.trim().toLowerCase(),
        password: params.password,
      });

      if (error || !data.session) {
        return {
          success: false,
          error: error?.message || 'Authentication failed. Please verify your credentials.',
        };
      }

      this.currentUser = {
        id: data.session.user.id,
        email: data.session.user.email ?? '',
        isAnonymous: data.session.user.is_anonymous ?? false,
      };
      this.accountState = 'AUTHENTICATED';
      this.cachedRole = null;

      // Verify staff role
      const role = await this.getUserRole(true);
      const isEditor = await this.isEditor();
      if (!isEditor && role !== 'admin' && role !== 'moderator' && role !== 'editor') {
        // Fail-closed: not staff
        await this.signOut();
        return {
          success: false,
          error: 'PERMISSION_DENIED: Account is authenticated, but lacks editorial/administrator privileges.',
        };
      }

      this.notifyListeners();

      return {
        success: true,
        message: 'Staff authentication successful.',
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
          user: {
            ...this.currentUser,
            role: role || undefined,
          },
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err) ? String((err as any).message) : JSON.stringify(err);
      return {
        success: false,
        error: msg,
      };
    }
  }

  /**
   * Explicit Sign Out.
   * Does NOT alter, relabel, or delete local guest vault records.
   */
  async signOut(): Promise<AuthActionResult> {
    try {
      if (this.client) {
        await this.client.auth.signOut();
      }
    } catch {
      // Continue cleanup even if server sign-out fails
    }

    this.currentUser = null;
    this.cachedRole = null;
    this.accountState = 'SIGNED_OUT';
    this.notifyListeners();

    // Revert account state cleanly to local guest context
    this.accountState = 'GUEST';
    this.notifyListeners();

    return {
      success: true,
      message: 'Successfully signed out.',
    };
  }

  /**
   * Fetch user role from server-controlled public.user_roles table.
   */
  async getUserRole(forceRefresh = false): Promise<AppRole | null> {
    if (!this.client || !this.currentUser) {
      return null;
    }

    if (!forceRefresh && this.cachedRole) {
      return this.cachedRole;
    }

    try {
      const { data, error } = await this.client
        .from('user_roles')
        .select('role')
        .eq('user_id', this.currentUser.id)
        .maybeSingle();

      if (error || !data) {
        this.cachedRole = 'member';
        return 'member';
      }

      this.cachedRole = (data as { role: AppRole }).role;
      return this.cachedRole;
    } catch {
      return 'member';
    }
  }

  /**
   * Server-Verified Administrator Authority.
   * Queries SECURITY INVOKER check_is_admin() RPC.
   * Prevents client-metadata spoofing.
   */
  async isAdmin(): Promise<boolean> {
    if (!this.client || !this.currentUser) {
      return false;
    }

    try {
      const { data, error } = await this.client.rpc('check_is_admin');
      if (error) {
        return false;
      }
      return Boolean(data);
    } catch {
      return false;
    }
  }

  /**
   * Server-Verified Editor Authority.
   * Queries SECURITY INVOKER check_is_editor() RPC.
   */
  async isEditor(): Promise<boolean> {
    if (!this.client || !this.currentUser) {
      return false;
    }

    try {
      const { data, error } = await (this.client.rpc as any)('check_is_editor');
      if (error) {
        return false;
      }
      return Boolean(data);
    } catch {
      return false;
    }
  }

  /**
   * Server-Verified Publisher Authority.
   * Queries SECURITY INVOKER check_is_publisher() RPC.
   */
  async isPublisher(): Promise<boolean> {
    if (!this.client || !this.currentUser) {
      return false;
    }

    try {
      const { data, error } = await (this.client.rpc as any)('check_is_publisher');
      if (error) {
        return false;
      }
      return Boolean(data);
    } catch {
      return false;
    }
  }

  /**
   * Safe Second-Device Recovery Bootstrap:
   * Retrieves the wrapped AEK escrow envelope for an authenticated session
   * prior to device enrollment, using the narrowly scoped security invoker RPC.
   * Does NOT expose journal contents, and never transmits the recovery secret.
   */
  async getRecoveryBootstrapEnvelope(): Promise<unknown | null> {
    if (!this.client || !this.currentUser) {
      return null;
    }

    try {
      const { data, error } = await this.client.rpc('get_recovery_bootstrap_envelope' as any);
      if (error || !data) {
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Secure Account Deletion Request Mechanism:
   * When authenticated, requests deletion of the user's cloud account and server-side data.
   * If running as an offline guest, confirms that only local records exist.
   */
  async requestAccountDeletion(): Promise<AuthActionResult> {
    if (this.accountState !== 'AUTHENTICATED' || !this.client || !this.currentUser) {
      return {
        success: true,
        message: 'No active cloud account found. Local guest records are managed strictly on-device.',
      };
    }

    if (!this.network.isConnected()) {
      return {
        success: false,
        error: 'OFFLINE_ERROR: An active internet connection is required to submit an account deletion request.',
      };
    }

    try {
      const { error } = await this.client.rpc('delete_user_account' as any);
      if (error) {
        return {
          success: false,
          error: error.message || 'Failed to delete server account. Please use the web deletion request form.',
        };
      }

      await this.signOut();
      return {
        success: true,
        message: 'Your cloud account and associated server records have been successfully deleted.',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (typeof err === 'object' && err !== null && 'message' in err) ? String((err as any).message) : JSON.stringify(err);
      return {
        success: false,
        error: msg,
      };
    }
  }

  onAuthStateChange(
    callback: (state: AuthAccountState, user: AuthSessionUser | null) => void
  ): () => void {
    this.listeners.add(callback);
    callback(this.accountState, this.currentUser);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.accountState, this.currentUser);
      } catch {
        // Safe listener failure isolation
      }
    }
  }

  getClient(): SupabaseClient<Database> | null {
    return this.client;
  }
}

export const supabaseAuthService = new SupabaseAuthService();
