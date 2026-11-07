import { Network, type ConnectionStatus, type ConnectionType } from '@capacitor/network';
import { useState, useEffect } from 'react';

export type NetworkState =
  | 'OFFLINE'
  | 'CONNECTED_UNVERIFIED'
  | 'ONLINE_REACHABLE'
  | 'SERVICE_UNAVAILABLE'
  | 'UNKNOWN';

export interface NetworkTelemetrySnapshot {
  state: NetworkState;
  connected: boolean;
  connectionType: ConnectionType | 'unknown';
  isReachable: boolean;
  lastCheckedTimestamp: number;
}

export interface NetworkServiceOptions {
  reachabilityEndpoint?: string;
  reachabilityTimeoutMs?: number;
  minCheckIntervalMs?: number;
}

export interface INetworkTelemetryService {
  isConnected(): boolean;
  getState(): NetworkState;
  getSnapshot(): NetworkTelemetrySnapshot;
  subscribe(listener: (snapshot: NetworkTelemetrySnapshot) => void): () => void;
}

/**
 * Validates whether an endpoint is an explicitly configured remote URL.
 * Local assets (e.g., /favicon.ico, relative paths, capacitor://, localhost) must never establish ONLINE_REACHABLE.
 */
export function isRemoteEndpoint(urlStr?: string): boolean {
  if (!urlStr || typeof urlStr !== 'string') return false;
  const trimmed = urlStr.trim();
  if (trimmed.startsWith('/') || trimmed.startsWith('.')) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '') return false;
    return true;
  } catch {
    return false;
  }
}

export class NetworkTelemetryService {
  private state: NetworkState = 'UNKNOWN';
  private connected = true;
  private connectionType: ConnectionType | 'unknown' = 'unknown';
  private isReachable = true;
  private lastCheckedTimestamp = 0;
  private isSuspended = false;

  private reachabilityEndpoint: string;
  private reachabilityTimeoutMs: number;
  private minCheckIntervalMs: number;

  private listeners: Set<(snapshot: NetworkTelemetrySnapshot) => void> = new Set();
  private networkListenerHandle: { remove: () => Promise<void> } | null = null;
  private inFlightCheck: Promise<NetworkTelemetrySnapshot> | null = null;

  constructor(options?: NetworkServiceOptions) {
    this.reachabilityEndpoint =
      options?.reachabilityEndpoint || 'https://connectivitycheck.gstatic.com/generate_204';
    this.reachabilityTimeoutMs = options?.reachabilityTimeoutMs || 3000;
    this.minCheckIntervalMs = options?.minCheckIntervalMs || 15000;
  }

  getSnapshot(): NetworkTelemetrySnapshot {
    return {
      state: this.state,
      connected: this.connected,
      connectionType: this.connectionType,
      isReachable: this.isReachable,
      lastCheckedTimestamp: this.lastCheckedTimestamp,
    };
  }

  getState(): NetworkState {
    return this.state;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Initializes network monitoring and event listeners
   */
  async initialize(): Promise<NetworkTelemetrySnapshot> {
    try {
      const status: ConnectionStatus = await Network.getStatus();
      this.connected = status.connected;
      this.connectionType = status.connectionType;
      this.state = status.connected ? 'CONNECTED_UNVERIFIED' : 'OFFLINE';
      this.isReachable = status.connected;
    } catch {
      // Fallback to browser navigator if plugin call fails
      const navOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
      this.connected = navOnline;
      this.connectionType = 'unknown';
      this.state = navOnline ? 'CONNECTED_UNVERIFIED' : 'OFFLINE';
      this.isReachable = navOnline;
    }

    // Attach native network change listener
    try {
      this.networkListenerHandle = await Network.addListener(
        'networkStatusChange',
        (status: ConnectionStatus) => {
          this.handleStatusChange(status);
        }
      );
    } catch {
      // Fallback for mock/test environments
      if (typeof window !== 'undefined') {
        const onOnline = () => this.handleStatusChange({ connected: true, connectionType: 'wifi' });
        const onOffline = () => this.handleStatusChange({ connected: false, connectionType: 'none' });
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        this.networkListenerHandle = {
          remove: async () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
          },
        };
      }
    }

    this.notify();

    // Perform an initial reachability probe if connected
    if (this.connected && !this.isSuspended) {
      this.checkReachable(true).catch(() => {
        /* Ignore background probe failure */
      });
    }

    return this.getSnapshot();
  }

  /**
   * Cleans up listeners to prevent memory leaks
   */
  async teardown(): Promise<void> {
    if (this.networkListenerHandle) {
      await this.networkListenerHandle.remove();
      this.networkListenerHandle = null;
    }
    this.listeners.clear();
  }

  /**
   * Subscribes a listener to network telemetry changes
   */
  subscribe(listener: (snapshot: NetworkTelemetrySnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (err) {
        console.error('NetworkTelemetry listener error:', err);
      }
    }
  }

  private handleStatusChange(status: ConnectionStatus): void {
    this.connected = status.connected;
    this.connectionType = status.connectionType;

    if (!status.connected) {
      this.state = 'OFFLINE';
      this.isReachable = false;
      this.lastCheckedTimestamp = Date.now();
      this.notify();
      return;
    }

    // When connection returns, mark as UNVERIFIED first, then test reachability
    this.state = 'CONNECTED_UNVERIFIED';
    this.notify();

    if (!this.isSuspended) {
      this.checkReachable(true).catch(() => {
        /* Handled inside checkReachable */
      });
    }
  }

  /**
   * Performs an active, non-intrusive probe to confirm real internet reachability
   */
  async checkReachable(force = false): Promise<NetworkTelemetrySnapshot> {
    if (this.isSuspended) {
      return this.getSnapshot();
    }

    if (!this.connected) {
      this.state = 'OFFLINE';
      this.isReachable = false;
      this.notify();
      return this.getSnapshot();
    }

    const now = Date.now();
    if (!force && now - this.lastCheckedTimestamp < this.minCheckIntervalMs) {
      return this.getSnapshot();
    }

    // Phase 3 carryover correction:
    // If reachability endpoint is not an explicitly configured remote endpoint (e.g. /favicon.ico,
    // relative paths, localhost), a local asset must never establish ONLINE_REACHABLE.
    // In this case, retain CONNECTED_UNVERIFIED.
    if (!isRemoteEndpoint(this.reachabilityEndpoint)) {
      this.state = 'CONNECTED_UNVERIFIED';
      this.isReachable = true;
      this.lastCheckedTimestamp = now;
      this.notify();
      return this.getSnapshot();
    }

    if (this.inFlightCheck) {
      return this.inFlightCheck;
    }

    this.inFlightCheck = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.reachabilityTimeoutMs);

      try {
        // Zero-PII reachability check using no-cors mode to avoid cross-origin rejection
        await fetch(this.reachabilityEndpoint, {
          method: 'HEAD',
          mode: 'no-cors',
          cache: 'no-store',
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        this.isReachable = true;
        this.state = 'ONLINE_REACHABLE';
        this.lastCheckedTimestamp = Date.now();
      } catch (err: unknown) {
        clearTimeout(timeoutId);
        this.lastCheckedTimestamp = Date.now();

        // If fetch aborted or failed, mark as unverified or service unavailable
        if (err instanceof Error && err.name === 'AbortError') {
          this.isReachable = false;
          this.state = 'SERVICE_UNAVAILABLE';
        } else {
          // If in browser and navigator.onLine is true, keep as connected unverified
          this.isReachable = typeof navigator !== 'undefined' ? navigator.onLine : false;
          this.state = this.isReachable ? 'CONNECTED_UNVERIFIED' : 'OFFLINE';
        }
      } finally {
        this.inFlightCheck = null;
        this.notify();
      }

      return this.getSnapshot();
    })();

    return this.inFlightCheck;
  }

  /**
   * Called by Native App Lifecycle Manager on app suspension/backgrounding
   */
  pauseNetworkMonitoring(): void {
    this.isSuspended = true;
  }

  /**
   * Called by Native App Lifecycle Manager on app resume/foregrounding
   */
  resumeNetworkMonitoring(): void {
    this.isSuspended = false;
    this.checkReachable(true).catch(() => {
      /* Handled */
    });
  }

  /**
   * Test helper to simulate network states
   */
  setMockStateForTesting(snapshot: Partial<NetworkTelemetrySnapshot>): void {
    if (snapshot.state !== undefined) this.state = snapshot.state;
    if (snapshot.connected !== undefined) this.connected = snapshot.connected;
    if (snapshot.connectionType !== undefined) this.connectionType = snapshot.connectionType;
    if (snapshot.isReachable !== undefined) this.isReachable = snapshot.isReachable;
    if (snapshot.lastCheckedTimestamp !== undefined) this.lastCheckedTimestamp = snapshot.lastCheckedTimestamp;
    this.notify();
  }
}

export const networkService = new NetworkTelemetryService();

/**
 * Custom React Hook for live network telemetry
 */
export function useNetworkStatus(): NetworkTelemetrySnapshot {
  const [snapshot, setSnapshot] = useState<NetworkTelemetrySnapshot>(() => networkService.getSnapshot());

  useEffect(() => {
    return networkService.subscribe(setSnapshot);
  }, []);

  return snapshot;
}
