import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SupabaseAuthService } from '../supabaseAuthService';
import type { INetworkTelemetryService, NetworkTelemetrySnapshot, NetworkState } from '../../networkService';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../types/database.types';

// Mock Network Service
class MockNetworkService implements INetworkTelemetryService {
  private connected = true;
  private state: NetworkState = 'ONLINE_REACHABLE';
  private listeners: Set<(snapshot: NetworkTelemetrySnapshot) => void> = new Set();

  isConnected(): boolean {
    return this.connected;
  }

  getState(): NetworkState {
    return this.state;
  }

  getSnapshot(): NetworkTelemetrySnapshot {
    return {
      state: this.state,
      connected: this.connected,
      connectionType: 'wifi',
      isReachable: this.connected,
      lastCheckedTimestamp: Date.now(),
    };
  }

  setOnline(status: boolean): void {
    this.connected = status;
    this.state = status ? 'ONLINE_REACHABLE' : 'OFFLINE';
    this.listeners.forEach((l) => l(this.getSnapshot()));
  }

  subscribe(listener: (snapshot: NetworkTelemetrySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

// Mock Vault Manager with local guest identity
function createMockVault(guestId = 'guest-test-uuid-1234'): any {
  return {
    identity: {
      getOrCreateIdentity: vi.fn().mockResolvedValue({
        localUserId: guestId,
        createdAt: 1730419200000,
        devicePlatform: 'web',
        schemaVersion: 1,
      }),
      getIdentity: vi.fn().mockResolvedValue({
        localUserId: guestId,
        createdAt: 1730419200000,
        devicePlatform: 'web',
        schemaVersion: 1,
      }),
    },
    journal: {
      getAll: vi.fn().mockResolvedValue([]),
    },
    prayer: {
      getAll: vi.fn().mockResolvedValue([]),
    },
  };
}

// Mock Supabase Client
function createMockSupabaseClient() {
  const mockAuth = {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ data: {}, error: null }),
    verifyOtp: vi.fn().mockResolvedValue({
      data: {
        session: {
          access_token: 'fake-jwt-token',
          refresh_token: 'fake-refresh-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user: {
            id: 'cloud-user-uuid-5678',
            email: 'seeker@lifted.app',
            is_anonymous: false,
          },
        },
      },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };

  const mockFrom = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'member' }, error: null }),
      }),
    }),
  });

  const mockRpc = vi.fn().mockResolvedValue({ data: false, error: null });

  return {
    auth: mockAuth,
    from: mockFrom,
    rpc: mockRpc,
  } as unknown as SupabaseClient<Database>;
}

describe('SupabaseAuthService (Phase 6 Optional Cloud Auth & Zero-Trust Access)', () => {
  let mockNetwork: MockNetworkService;
  let mockVault: any;
  let mockClient: any;
  let authService: SupabaseAuthService;

  beforeEach(() => {
    mockNetwork = new MockNetworkService();
    mockVault = createMockVault('guest-test-uuid-1234');
    mockClient = createMockSupabaseClient();
    authService = new SupabaseAuthService(mockNetwork, mockVault, mockClient);
  });

  describe('1. Pure Offline Guest Mode Preservation', () => {
    it('initializes in GUEST state with zero prior cloud sessions', () => {
      expect(authService.getAccountState()).toBe('GUEST');
      expect(authService.getCurrentUser()).toBeNull();
    });

    it('returns local guest UUID from vault when in GUEST state', async () => {
      const effectiveId = await authService.getEffectiveUserId();
      expect(effectiveId).toBe('guest-test-uuid-1234');
      expect(mockVault.identity.getOrCreateIdentity).toHaveBeenCalledTimes(1);
    });

    it('does not execute network or auth calls on guest startup', () => {
      expect(mockClient.auth.signInWithOtp).not.toHaveBeenCalled();
      expect(mockClient.auth.verifyOtp).not.toHaveBeenCalled();
    });
  });

  describe('2. User-Initiated Sign-in (Magic Link / OTP)', () => {
    it('rejects sign-in when device is offline without hanging', async () => {
      mockNetwork.setOnline(false);

      const result = await authService.signInWithOtp({ email: 'user@lifted.app' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('OFFLINE_ERROR');
      expect(mockClient.auth.signInWithOtp).not.toHaveBeenCalled();
      expect(authService.getAccountState()).toBe('GUEST');
    });

    it('validates email format before making cloud request', async () => {
      const result = await authService.signInWithOtp({ email: 'invalid-email' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('VALIDATION_ERROR');
      expect(mockClient.auth.signInWithOtp).not.toHaveBeenCalled();
    });

    it('initiates OTP request successfully when online and valid', async () => {
      mockClient.auth.signInWithOtp.mockResolvedValueOnce({ data: {}, error: null });

      const result = await authService.signInWithOtp({ email: 'seeker@lifted.app' });

      expect(result.success).toBe(true);
      expect(result.message).toContain('verification code or magic link has been sent');
      expect(mockClient.auth.signInWithOtp).toHaveBeenCalledWith({
        email: 'seeker@lifted.app',
        options: {
          emailRedirectTo: undefined,
          shouldCreateUser: true,
        },
      });
    });

    it('handles cloud rate limits or provider errors safely', async () => {
      mockClient.auth.signInWithOtp.mockResolvedValueOnce({
        data: null,
        error: { message: 'For security purposes, you can only request this once every 60 seconds.' },
      });

      const result = await authService.signInWithOtp({ email: 'seeker@lifted.app' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('60 seconds');
      expect(authService.getAccountState()).toBe('GUEST');
    });
  });

  describe('3. OTP Verification & Session Activation', () => {
    it('rejects OTP verification when offline', async () => {
      mockNetwork.setOnline(false);

      const result = await authService.verifyOtp({ email: 'seeker@lifted.app', token: '123456' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('OFFLINE_ERROR');
      expect(mockClient.auth.verifyOtp).not.toHaveBeenCalled();
    });

    it('successfully verifies OTP and transitions to AUTHENTICATED', async () => {
      const result = await authService.verifyOtp({ email: 'seeker@lifted.app', token: '123456' });

      expect(result.success).toBe(true);
      expect(authService.getAccountState()).toBe('AUTHENTICATED');
      expect(authService.getCurrentUser()).toEqual({
        id: 'cloud-user-uuid-5678',
        email: 'seeker@lifted.app',
        isAnonymous: false,
      });

      // getEffectiveUserId should now return the cloud user UUID
      const effectiveId = await authService.getEffectiveUserId();
      expect(effectiveId).toBe('cloud-user-uuid-5678');
    });

    it('handles invalid or expired OTP code cleanly', async () => {
      mockClient.auth.verifyOtp.mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'Token has expired or is invalid.' },
      });

      const result = await authService.verifyOtp({ email: 'seeker@lifted.app', token: '999999' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('expired or is invalid');
      expect(authService.getAccountState()).toBe('GUEST');
      expect(authService.getCurrentUser()).toBeNull();
    });
  });

  describe('4. Server-Controlled Role Verification & Privilege Checks', () => {
    it('queries public.user_roles to determine user role', async () => {
      await authService.verifyOtp({ email: 'seeker@lifted.app', token: '123456' });

      mockClient.from.mockReturnValueOnce({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { role: 'moderator' }, error: null }),
          }),
        }),
      });

      const role = await authService.getUserRole(true);
      expect(role).toBe('moderator');
    });

    it('evaluates isAdmin via server-side SECURITY INVOKER RPC check_is_admin()', async () => {
      await authService.verifyOtp({ email: 'admin@lifted.app', token: '123456' });

      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });

      const isAdmin = await authService.isAdmin();
      expect(isAdmin).toBe(true);
      expect(mockClient.rpc).toHaveBeenCalledWith('check_is_admin');
    });

    it('returns false for isAdmin when rpc returns false or throws', async () => {
      await authService.verifyOtp({ email: 'member@lifted.app', token: '123456' });

      mockClient.rpc.mockResolvedValueOnce({ data: false, error: null });
      expect(await authService.isAdmin()).toBe(false);

      mockClient.rpc.mockRejectedValueOnce(new Error('RPC network timeout'));
      expect(await authService.isAdmin()).toBe(false);
    });

    it('returns false for isAdmin when not signed in', async () => {
      expect(await authService.isAdmin()).toBe(false);
      expect(mockClient.rpc).not.toHaveBeenCalled();
    });
  });

  describe('5. Clean Logout & Account Segregation', () => {
    it('signs out cleanly and reverts back to GUEST state', async () => {
      await authService.verifyOtp({ email: 'seeker@lifted.app', token: '123456' });
      expect(authService.getAccountState()).toBe('AUTHENTICATED');

      const logoutResult = await authService.signOut();

      expect(logoutResult.success).toBe(true);
      expect(authService.getAccountState()).toBe('GUEST');
      expect(authService.getCurrentUser()).toBeNull();
      expect(mockClient.auth.signOut).toHaveBeenCalledTimes(1);

      // Subsequent getEffectiveUserId returns local guest UUID again
      const effectiveId = await authService.getEffectiveUserId();
      expect(effectiveId).toBe('guest-test-uuid-1234');
    });

    it('does not leak cached role across account switches', async () => {
      // Sign in user 1 (admin)
      await authService.verifyOtp({ email: 'admin@lifted.app', token: '123456' });
      mockClient.rpc.mockResolvedValueOnce({ data: true, error: null });
      expect(await authService.isAdmin()).toBe(true);

      // Sign out
      await authService.signOut();

      // Sign in user 2 (regular member)
      mockClient.auth.verifyOtp.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'user2-token',
            refresh_token: 'user2-refresh',
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: { id: 'user-2-uuid', email: 'member@lifted.app', is_anonymous: false },
          },
        },
        error: null,
      });

      await authService.verifyOtp({ email: 'member@lifted.app', token: '654321' });
      mockClient.rpc.mockResolvedValueOnce({ data: false, error: null });

      expect(await authService.isAdmin()).toBe(false);
      expect(authService.getCurrentUser()?.id).toBe('user-2-uuid');
    });
  });

  describe('6. Zero Data Leakage & Offline Vault Protection', () => {
    it('never automatically uploads local vault records upon authentication', async () => {
      await authService.verifyOtp({ email: 'seeker@lifted.app', token: '123456' });

      // Ensure no vault records were exported or mutated
      expect(mockVault.journal.getAll).not.toHaveBeenCalled();
      expect(mockVault.prayer.getAll).not.toHaveBeenCalled();
    });

    it('notifies subscribers of auth state transitions', async () => {
      const listener = vi.fn();
      const unsubscribe = authService.onAuthStateChange(listener);

      // Initial call
      expect(listener).toHaveBeenCalledWith('GUEST', null);

      await authService.verifyOtp({ email: 'seeker@lifted.app', token: '123456' });
      expect(listener).toHaveBeenCalledWith('AUTHENTICATED', expect.objectContaining({ email: 'seeker@lifted.app' }));

      await authService.signOut();
      expect(listener).toHaveBeenCalledWith('GUEST', null);

      unsubscribe();
    });
  });
});
