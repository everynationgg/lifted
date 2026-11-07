import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LifecycleManager } from '../lifecycleManager';
import { voiceService } from '../voiceService';
import { networkService } from '../networkService';

describe('LifecycleManager', () => {
  let manager: LifecycleManager;

  beforeEach(() => {
    manager = new LifecycleManager();
  });

  afterEach(async () => {
    await manager.teardown();
    vi.restoreAllMocks();
  });

  it('initializes with default foreground state', () => {
    const snap = manager.getSnapshot();
    expect(snap.phase).toBe('FOREGROUND');
    expect(snap.isActive).toBe(true);
    expect(manager.isForeground()).toBe(true);
  });

  it('triggers voice teardown, network pause, and background callbacks on backgrounding', () => {
    const voiceStopSpy = vi.spyOn(voiceService, 'stopListening');
    const netPauseSpy = vi.spyOn(networkService, 'pauseNetworkMonitoring');
    const customBgSpy = vi.fn();

    manager.registerOnBackground(customBgSpy);

    manager.simulatePhaseChangeForTesting('BACKGROUND');

    expect(manager.getPhase()).toBe('BACKGROUND');
    expect(manager.isForeground()).toBe(false);
    expect(voiceStopSpy).toHaveBeenCalled();
    expect(netPauseSpy).toHaveBeenCalled();
    expect(customBgSpy).toHaveBeenCalled();
  });

  it('resumes network monitoring and invokes foreground callbacks on returning to foreground', () => {
    const netResumeSpy = vi.spyOn(networkService, 'resumeNetworkMonitoring');
    const customFgSpy = vi.fn();

    manager.simulatePhaseChangeForTesting('BACKGROUND');
    manager.registerOnForeground(customFgSpy);

    manager.simulatePhaseChangeForTesting('FOREGROUND');

    expect(manager.getPhase()).toBe('FOREGROUND');
    expect(manager.isForeground()).toBe(true);
    expect(netResumeSpy).toHaveBeenCalled();
    expect(customFgSpy).toHaveBeenCalled();
  });

  it('prevents redundant duplicate transitions in identical phase', () => {
    const customBgSpy = vi.fn();
    manager.registerOnBackground(customBgSpy);

    manager.simulatePhaseChangeForTesting('BACKGROUND');
    manager.simulatePhaseChangeForTesting('BACKGROUND');

    expect(customBgSpy).toHaveBeenCalledTimes(1);
  });

  it('cleans up callbacks and subscriptions when unregistered', () => {
    const customBgSpy = vi.fn();
    const unregister = manager.registerOnBackground(customBgSpy);

    unregister();
    manager.simulatePhaseChangeForTesting('BACKGROUND');

    expect(customBgSpy).not.toHaveBeenCalled();
  });
});
