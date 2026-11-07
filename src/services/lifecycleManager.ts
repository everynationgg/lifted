import { App, type AppState } from '@capacitor/app';
import { useState, useEffect } from 'react';
import { networkService } from './networkService';
import { voiceService } from './voiceService';

export type AppLifecyclePhase = 'FOREGROUND' | 'BACKGROUND' | 'SUSPENDED';

export interface LifecycleSnapshot {
  phase: AppLifecyclePhase;
  isActive: boolean;
  lastPhaseChangeTimestamp: number;
}

export type LifecycleCallback = (phase: AppLifecyclePhase) => void;

export class LifecycleManager {
  private phase: AppLifecyclePhase = 'FOREGROUND';
  private isActive = true;
  private lastPhaseChangeTimestamp = Date.now();

  private listeners: Set<(snapshot: LifecycleSnapshot) => void> = new Set();
  private backgroundCallbacks: Set<() => void | Promise<void>> = new Set();
  private foregroundCallbacks: Set<() => void | Promise<void>> = new Set();
  private appListenerHandles: { remove: () => Promise<void> }[] = [];

  getSnapshot(): LifecycleSnapshot {
    return {
      phase: this.phase,
      isActive: this.isActive,
      lastPhaseChangeTimestamp: this.lastPhaseChangeTimestamp,
    };
  }

  getPhase(): AppLifecyclePhase {
    return this.phase;
  }

  isForeground(): boolean {
    return this.phase === 'FOREGROUND';
  }

  /**
   * Initializes Capacitor App lifecycle listeners and browser visibility fallbacks
   */
  async initialize(): Promise<LifecycleSnapshot> {
    try {
      // 1. Initial state probe
      const state: AppState = await App.getState();
      this.isActive = state.isActive;
      this.phase = state.isActive ? 'FOREGROUND' : 'BACKGROUND';
    } catch {
      // Browser fallback
      if (typeof document !== 'undefined') {
        const isHidden = document.visibilityState === 'hidden';
        this.isActive = !isHidden;
        this.phase = isHidden ? 'BACKGROUND' : 'FOREGROUND';
      }
    }

    // 2. Attach Capacitor App listeners
    try {
      const stateChangeHandle = await App.addListener('appStateChange', (state: AppState) => {
        if (state.isActive) {
          this.handleForegroundTransition();
        } else {
          this.handleBackgroundTransition();
        }
      });
      this.appListenerHandles.push(stateChangeHandle);
    } catch {
      /* Fallback to document visibilitychange */
    }

    // 3. Attach Web visibility and beforeunload fallbacks
    if (typeof document !== 'undefined') {
      const onVisibilityChange = () => {
        if (document.visibilityState === 'hidden') {
          this.handleBackgroundTransition();
        } else {
          this.handleForegroundTransition();
        }
      };

      const onBeforeUnload = () => {
        this.handleBackgroundTransition();
      };

      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('beforeunload', onBeforeUnload);

      this.appListenerHandles.push({
        remove: async () => {
          document.removeEventListener('visibilitychange', onVisibilityChange);
          window.removeEventListener('beforeunload', onBeforeUnload);
        },
      });
    }

    this.notify();
    return this.getSnapshot();
  }

  /**
   * Teardown all listeners and subscriptions
   */
  async teardown(): Promise<void> {
    for (const handle of this.appListenerHandles) {
      try {
        await handle.remove();
      } catch {
        /* Ignore removal errors */
      }
    }
    this.appListenerHandles = [];
    this.listeners.clear();
    this.backgroundCallbacks.clear();
    this.foregroundCallbacks.clear();
  }

  /**
   * Registers a cleanup callback to be executed when app transitions to background
   */
  registerOnBackground(callback: () => void | Promise<void>): () => void {
    this.backgroundCallbacks.add(callback);
    return () => this.backgroundCallbacks.delete(callback);
  }

  /**
   * Registers a resume callback to be executed when app transitions to foreground
   */
  registerOnForeground(callback: () => void | Promise<void>): () => void {
    this.foregroundCallbacks.add(callback);
    return () => this.foregroundCallbacks.delete(callback);
  }

  /**
   * Subscribes to general lifecycle phase changes
   */
  subscribe(listener: (snapshot: LifecycleSnapshot) => void): () => void {
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
        console.error('LifecycleManager listener error:', err);
      }
    }
  }

  private handleBackgroundTransition(): void {
    if (this.phase === 'BACKGROUND') return; // Prevent duplicate transitions

    this.phase = 'BACKGROUND';
    this.isActive = false;
    this.lastPhaseChangeTimestamp = Date.now();

    // 1. Core Native Resource Protections:
    // a. Stop active speech recognition & release microphone
    try {
      voiceService.stopListening();
    } catch {
      /* Ignore */
    }

    // b. Pause network telemetry polling to save battery and eliminate wake-locks
    try {
      networkService.pauseNetworkMonitoring();
    } catch {
      /* Ignore */
    }

    // 2. Execute registered subsystem background callbacks (e.g., audio pause, timer pause, draft flush)
    for (const callback of this.backgroundCallbacks) {
      try {
        const result = callback();
        if (result instanceof Promise) {
          result.catch(() => {
            /* Best-effort background flush */
          });
        }
      } catch (err) {
        console.error('LifecycleManager background callback error:', err);
      }
    }

    this.notify();
  }

  private handleForegroundTransition(): void {
    if (this.phase === 'FOREGROUND') return; // Prevent duplicate transitions

    this.phase = 'FOREGROUND';
    this.isActive = true;
    this.lastPhaseChangeTimestamp = Date.now();

    // 1. Resume network telemetry monitoring and probe reachability
    try {
      networkService.resumeNetworkMonitoring();
    } catch {
      /* Ignore */
    }

    // 2. Execute registered subsystem foreground callbacks
    for (const callback of this.foregroundCallbacks) {
      try {
        const result = callback();
        if (result instanceof Promise) {
          result.catch(() => {
            /* Handled */
          });
        }
      } catch (err) {
        console.error('LifecycleManager foreground callback error:', err);
      }
    }

    this.notify();
  }

  /**
   * Test helper to trigger simulated lifecycle events
   */
  simulatePhaseChangeForTesting(phase: AppLifecyclePhase): void {
    if (phase === 'BACKGROUND' || phase === 'SUSPENDED') {
      this.handleBackgroundTransition();
    } else {
      this.handleForegroundTransition();
    }
  }
}

export const lifecycleManager = new LifecycleManager();

/**
 * Custom React Hook for listening to native lifecycle changes
 */
export function useAppLifecycle(): LifecycleSnapshot {
  const [snapshot, setSnapshot] = useState<LifecycleSnapshot>(() => lifecycleManager.getSnapshot());

  useEffect(() => {
    return lifecycleManager.subscribe(setSnapshot);
  }, []);

  return snapshot;
}
