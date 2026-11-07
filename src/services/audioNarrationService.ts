import { useState, useEffect, useCallback } from 'react';
import { lifecycleManager } from './lifecycleManager';

export type PlaybackState = 'IDLE' | 'PLAYING' | 'PAUSED' | 'LOADING' | 'UNSUPPORTED' | 'ERROR';

export interface AudioNarrationStatus {
  state: PlaybackState;
  activeTextTitle?: string;
  hasSpeechSynthesis: boolean;
  availableVoiceCount: number;
  errorMessage?: string;
}

export class AudioNarrationService {
  private state: PlaybackState = 'IDLE';
  private activeTextTitle?: string;
  private errorMessage?: string;
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private currentAudioElement: HTMLAudioElement | null = null;
  private listeners: Set<(status: AudioNarrationStatus) => void> = new Set();
  private voices: SpeechSynthesisVoice[] = [];
  private hasSpeechSynthesis = false;

  constructor() {
    this.checkSpeechSupport();
    // Register lifecycle background listener: stop audio on app backgrounding
    lifecycleManager.registerOnBackground(() => {
      this.stop();
    });
  }

  private checkSpeechSupport(): void {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      this.hasSpeechSynthesis = true;
      this.loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => this.loadVoices();
      }
    } else {
      this.hasSpeechSynthesis = false;
    }
  }

  private loadVoices(): void {
    try {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        this.voices = window.speechSynthesis.getVoices() || [];
        this.notify();
      }
    } catch {
      this.voices = [];
    }
  }

  getStatus(): AudioNarrationStatus {
    return {
      state: this.state,
      activeTextTitle: this.activeTextTitle,
      hasSpeechSynthesis: this.hasSpeechSynthesis,
      availableVoiceCount: this.voices.length,
      errorMessage: this.errorMessage,
    };
  }

  getActiveUtterance(): SpeechSynthesisUtterance | null {
    return this.currentUtterance;
  }

  isPlaying(): boolean {
    return this.state === 'PLAYING';
  }

  isPaused(): boolean {
    return this.state === 'PAUSED';
  }

  subscribe(listener: (status: AudioNarrationStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.getStatus());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    const status = this.getStatus();
    for (const listener of this.listeners) {
      try {
        listener(status);
      } catch (err) {
        console.error('AudioNarrationService listener error:', err);
      }
    }
  }

  /**
   * Starts devotional audio narration using audio file or Web Speech API
   */
  async play(title: string, textToNarrate: string, audioUrl?: string): Promise<void> {
    // 1. Teardown any active session first to prevent overlapping playback
    this.stop();

    this.activeTextTitle = title;
    this.errorMessage = undefined;

    // A. Priority 1: Direct Hosted Audio File (if provided)
    if (audioUrl && audioUrl.trim()) {
      try {
        this.state = 'LOADING';
        this.notify();

        const audio = new Audio(audioUrl);
        this.currentAudioElement = audio;

        audio.onplay = () => {
          this.state = 'PLAYING';
          this.notify();
        };

        audio.onpause = () => {
          if (this.state === 'PLAYING') {
            this.state = 'PAUSED';
            this.notify();
          }
        };

        audio.onended = () => {
          this.state = 'IDLE';
          this.activeTextTitle = undefined;
          this.currentAudioElement = null;
          this.notify();
        };

        audio.onerror = () => {
          // If audio file playback fails, fallback to speech synthesis
          this.currentAudioElement = null;
          this.playSpeech(textToNarrate);
        };

        await audio.play();
        return;
      } catch {
        // Fallback to speech synthesis
        this.currentAudioElement = null;
      }
    }

    // B. Priority 2: Web Speech API Narration
    this.playSpeech(textToNarrate);
  }

  private playSpeech(text: string): void {
    if (!this.hasSpeechSynthesis || typeof window === 'undefined' || !window.speechSynthesis) {
      this.state = 'UNSUPPORTED';
      this.errorMessage = 'Voice narration is not supported on this browser or platform.';
      this.notify();
      return;
    }

    try {
      window.speechSynthesis.cancel(); // Reset any queued speech

      const UtteranceClass =
        typeof SpeechSynthesisUtterance !== 'undefined'
          ? SpeechSynthesisUtterance
          : class MockUtterance {
              text: string;
              rate = 1;
              pitch = 1;
              voice: any = null;
              onstart: any = null;
              onend: any = null;
              onerror: any = null;
              onpause: any = null;
              onresume: any = null;
              constructor(t: string) {
                this.text = t;
              }
            };

      const utterance = new UtteranceClass(text) as SpeechSynthesisUtterance;
      this.currentUtterance = utterance;

      // Trauma-informed calm cadence: 0.90x pacing, warm tone
      utterance.rate = 0.90;
      utterance.pitch = 1.0;

      // Select natural English voice if available
      if (this.voices.length > 0) {
        const preferredVoice = this.voices.find(
          (v) =>
            (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')) &&
            v.lang.startsWith('en')
        ) || this.voices.find((v) => v.lang.startsWith('en'));

        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
      }

      utterance.onstart = () => {
        this.state = 'PLAYING';
        this.notify();
      };

      utterance.onpause = () => {
        this.state = 'PAUSED';
        this.notify();
      };

      utterance.onresume = () => {
        this.state = 'PLAYING';
        this.notify();
      };

      utterance.onend = () => {
        this.state = 'IDLE';
        this.activeTextTitle = undefined;
        this.currentUtterance = null;
        this.notify();
      };

      utterance.onerror = (e) => {
        if (e.error !== 'canceled' && e.error !== 'interrupted') {
          this.state = 'ERROR';
          this.errorMessage = `Speech narration failed (${e.error}).`;
        } else {
          this.state = 'IDLE';
        }
        this.currentUtterance = null;
        this.notify();
      };

      this.state = 'PLAYING';
      this.notify();
      window.speechSynthesis.speak(utterance);
    } catch (err: unknown) {
      this.state = 'ERROR';
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.notify();
    }
  }

  pause(): void {
    if (this.state !== 'PLAYING') return;

    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
    } else if (this.hasSpeechSynthesis && window.speechSynthesis) {
      window.speechSynthesis.pause();
    }

    this.state = 'PAUSED';
    this.notify();
  }

  resume(): void {
    if (this.state !== 'PAUSED') return;

    if (this.currentAudioElement) {
      this.currentAudioElement.play().catch(console.error);
    } else if (this.hasSpeechSynthesis && window.speechSynthesis) {
      window.speechSynthesis.resume();
    }

    this.state = 'PLAYING';
    this.notify();
  }

  stop(): void {
    if (this.currentAudioElement) {
      this.currentAudioElement.pause();
      this.currentAudioElement.currentTime = 0;
      this.currentAudioElement = null;
    }

    if (this.hasSpeechSynthesis && typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* Ignore */
      }
    }

    this.currentUtterance = null;
    this.activeTextTitle = undefined;
    this.state = 'IDLE';
    this.notify();
  }
}

export const audioNarrationService = new AudioNarrationService();

/**
 * Custom React Hook for devotional audio narration
 */
export function useAudioNarration(): {
  status: AudioNarrationStatus;
  play: (title: string, text: string, url?: string) => Promise<void>;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  isPlaying: boolean;
  isPaused: boolean;
} {
  const [status, setStatus] = useState<AudioNarrationStatus>(() => audioNarrationService.getStatus());

  useEffect(() => {
    return audioNarrationService.subscribe(setStatus);
  }, []);

  const play = useCallback(
    (title: string, text: string, url?: string) => audioNarrationService.play(title, text, url),
    []
  );
  const pause = useCallback(() => audioNarrationService.pause(), []);
  const resume = useCallback(() => audioNarrationService.resume(), []);
  const stop = useCallback(() => audioNarrationService.stop(), []);

  return {
    status,
    play,
    pause,
    resume,
    stop,
    isPlaying: status.state === 'PLAYING',
    isPaused: status.state === 'PAUSED',
  };
}
