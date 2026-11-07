import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NetworkTelemetryService } from '../networkService';

describe('NetworkTelemetryService', () => {
  let service: NetworkTelemetryService;

  beforeEach(() => {
    service = new NetworkTelemetryService({
      reachabilityEndpoint: 'https://connectivitycheck.gstatic.com/generate_204',
      minCheckIntervalMs: 1000,
      reachabilityTimeoutMs: 500,
    });
  });

  afterEach(async () => {
    await service.teardown();
    vi.restoreAllMocks();
  });

  it('initializes with expected network telemetry snapshot', async () => {
    const snapshot = await service.initialize();
    expect(snapshot).toHaveProperty('state');
    expect(snapshot).toHaveProperty('connected');
    expect(snapshot).toHaveProperty('connectionType');
    expect(snapshot).toHaveProperty('isReachable');
  });

  it('updates state and notifies subscribers when connection is lost', () => {
    const states: string[] = [];
    service.subscribe((snap) => states.push(snap.state));

    service.setMockStateForTesting({ connected: false, state: 'OFFLINE' });

    expect(service.isConnected()).toBe(false);
    expect(service.getState()).toBe('OFFLINE');
    expect(states).toContain('OFFLINE');
  });

  it('transitions to CONNECTED_UNVERIFIED before probe verification on reconnection', () => {
    service.setMockStateForTesting({ connected: false, state: 'OFFLINE' });
    expect(service.getState()).toBe('OFFLINE');

    service.setMockStateForTesting({ connected: true, state: 'CONNECTED_UNVERIFIED' });
    expect(service.isConnected()).toBe(true);
    expect(service.getState()).toBe('CONNECTED_UNVERIFIED');
  });

  it('performs reachability probe and marks ONLINE_REACHABLE upon successful fetch', async () => {
    // Mock successful fetch
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }));

    service.setMockStateForTesting({ connected: true, state: 'CONNECTED_UNVERIFIED' });
    const snap = await service.checkReachable(true);

    expect(snap.state).toBe('ONLINE_REACHABLE');
    expect(snap.isReachable).toBe(true);
  });

  it('handles probe abortion / timeout gracefully without crashing', async () => {
    // Mock fetch abort / timeout
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(abortError);

    service.setMockStateForTesting({ connected: true, state: 'CONNECTED_UNVERIFIED' });
    const snap = await service.checkReachable(true);

    expect(snap.state).toBe('SERVICE_UNAVAILABLE');
    expect(snap.isReachable).toBe(false);
  });

  it('does not send any request when network is already offline', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    service.setMockStateForTesting({ connected: false, state: 'OFFLINE' });

    const snap = await service.checkReachable(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(snap.state).toBe('OFFLINE');
  });

  it('pauses and resumes network monitoring according to app lifecycle', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

    service.pauseNetworkMonitoring();
    await service.checkReachable(true);
    // When paused, no network probes occur
    expect(fetchSpy).not.toHaveBeenCalled();

    service.resumeNetworkMonitoring();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('cleans up listeners on teardown', async () => {
    let callCount = 0;
    service.subscribe(() => {
      callCount++;
    });

    await service.teardown();
    service.setMockStateForTesting({ connected: false, state: 'OFFLINE' });

    // Listener was removed on teardown, so callCount didn't increment after setMockStateForTesting
    expect(callCount).toBe(1); // Only initial subscribe call
  });

  describe('Phase 3 carryover: local asset vs remote endpoint reachability', () => {
    it('does NOT establish ONLINE_REACHABLE when reachability endpoint is a local asset (/favicon.ico)', async () => {
      const localService = new NetworkTelemetryService({
        reachabilityEndpoint: '/favicon.ico',
        minCheckIntervalMs: 1000,
        reachabilityTimeoutMs: 500,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      localService.setMockStateForTesting({ connected: true, state: 'CONNECTED_UNVERIFIED' });

      const snap = await localService.checkReachable(true);

      // Local asset must not be fetched to establish internet reachability, and must retain CONNECTED_UNVERIFIED
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(snap.state).toBe('CONNECTED_UNVERIFIED');
      expect(snap.isReachable).toBe(true);

      await localService.teardown();
    });

    it('does NOT establish ONLINE_REACHABLE for localhost or relative URLs', async () => {
      const localService = new NetworkTelemetryService({
        reachabilityEndpoint: 'http://localhost:3000/health',
        minCheckIntervalMs: 1000,
      });

      localService.setMockStateForTesting({ connected: true, state: 'CONNECTED_UNVERIFIED' });
      const snap = await localService.checkReachable(true);

      expect(snap.state).toBe('CONNECTED_UNVERIFIED');
      await localService.teardown();
    });
  });
});
