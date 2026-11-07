import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { haptics } from './hapticsService';

export interface VoiceServiceCallbacks {
  onPartialText: (text: string) => void;
  onFinalText: (text: string) => void;
  onError?: (error: string) => void;
  onStateChange?: (isListening: boolean) => void;
}

class VoiceService {
  private isCurrentlyListening: boolean = false;
  private partialListenerHandle: PluginListenerHandle | null = null;
  private stateListenerHandle: PluginListenerHandle | null = null;
  private webSpeechRecognition: any = null;
  private activeCallbacks: VoiceServiceCallbacks | null = null;
  private currentTranscript: string = '';

  /**
   * Determine if speech recognition is available on the current device platform.
   */
  public async isAvailable(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try {
        const { available } = await SpeechRecognition.available();
        return available;
      } catch {
        return false;
      }
    }

    // Web fallback check
    return !!(
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition
    );
  }

  /**
   * Check if audio recording and speech permissions are granted.
   */
  public async checkPermissions(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await SpeechRecognition.checkPermissions();
        return status.speechRecognition === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Request OS runtime permissions for audio capture.
   */
  public async requestPermissions(): Promise<boolean> {
    if (Capacitor.isNativePlatform()) {
      try {
        const status = await SpeechRecognition.requestPermissions();
        return status.speechRecognition === 'granted';
      } catch {
        return false;
      }
    }
    return true;
  }

  /**
   * Start clean, stable hands-free speech recognition session.
   * Leverages native Android SpeechRecognizer in dictation mode with zero thread collisions.
   */
  public async startListening(callbacks: VoiceServiceCallbacks): Promise<boolean> {
    // If already active, cleanly stop first
    if (this.isCurrentlyListening) {
      await this.stopListening();
    }

    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      callbacks.onError?.('Microphone permission was denied. Please grant microphone access in device settings.');
      return false;
    }

    this.activeCallbacks = callbacks;
    this.currentTranscript = '';

    try {
      await haptics.medium();

      if (Capacitor.isNativePlatform()) {
        const isAvail = await this.isAvailable();
        if (!isAvail) {
          callbacks.onError?.('Speech recognition service is not available on this device.');
          return false;
        }

        await this.cleanupListeners();

        // 1. Partial stream listener: Dispatches incremental words live as they are spoken
        this.partialListenerHandle = await SpeechRecognition.addListener('partialResults', (data: { matches?: string[] }) => {
          if (data && data.matches && data.matches.length > 0) {
            const match = data.matches[0];
            if (match && match.trim() !== this.currentTranscript) {
              this.currentTranscript = match.trim();
              callbacks.onPartialText(this.currentTranscript);
            }
          }
        });

        // 2. Listening state listener: Syncs UI listening indicator
        this.stateListenerHandle = await SpeechRecognition.addListener('listeningState', (data: { status?: 'started' | 'stopped' }) => {
          const active = data?.status === 'started';
          this.isCurrentlyListening = active;
          callbacks.onStateChange?.(active);
          if (!active && this.currentTranscript) {
            callbacks.onFinalText(this.currentTranscript);
          }
        });

        this.isCurrentlyListening = true;
        callbacks.onStateChange?.(true);

        // Start listening natively with DICTATION_MODE enabled on a single, stable session
        await SpeechRecognition.start({
          language: 'en-US',
          maxResults: 1,
          prompt: 'Speak your reflection...',
          popup: false,
          partialResults: true,
        });

        return true;
      } else {
        // Desktop / Web Browser Fallback
        const SpeechRecognitionCtor =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

        if (!SpeechRecognitionCtor) {
          callbacks.onError?.('Speech recognition is not supported in this browser.');
          return false;
        }

        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onstart = () => {
          this.isCurrentlyListening = true;
          callbacks.onStateChange?.(true);
        };

        recognition.onresult = (event: any) => {
          let interimTranscript = '';
          let finalTranscript = '';

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              finalTranscript += transcript;
            } else {
              interimTranscript += transcript;
            }
          }

          const combined = (finalTranscript || interimTranscript).trim();
          if (combined && combined !== this.currentTranscript) {
            this.currentTranscript = combined;
            callbacks.onPartialText(combined);
          }
          if (finalTranscript.trim()) {
            callbacks.onFinalText(finalTranscript.trim());
          }
        };

        recognition.onerror = (event: any) => {
          this.isCurrentlyListening = false;
          callbacks.onStateChange?.(false);
          callbacks.onError?.(event.error || 'Speech recognition encountered an issue.');
        };

        recognition.onend = () => {
          this.isCurrentlyListening = false;
          callbacks.onStateChange?.(false);
        };

        this.webSpeechRecognition = recognition;
        recognition.start();
        return true;
      }
    } catch (err: any) {
      this.isCurrentlyListening = false;
      callbacks.onStateChange?.(false);
      callbacks.onError?.(err?.message || 'Unable to start speech recognition.');
      return false;
    }
  }

  /**
   * Stop the active listening session immediately.
   * Guarantees non-blocking execution via bounded Promise race and immediate optimistic state release.
   */
  public async stopListening(): Promise<void> {
    this.isCurrentlyListening = false;

    if (this.activeCallbacks) {
      if (this.currentTranscript.trim()) {
        this.activeCallbacks.onFinalText(this.currentTranscript.trim());
      }
      this.activeCallbacks.onStateChange?.(false);
    }

    try {
      if (Capacitor.isNativePlatform()) {
        await Promise.race([
          SpeechRecognition.stop().catch(() => {}),
          new Promise((resolve) => setTimeout(resolve, 400)),
        ]);
        await this.cleanupListeners();
      } else if (this.webSpeechRecognition) {
        this.webSpeechRecognition.stop();
        this.webSpeechRecognition = null;
      }
    } catch {
      // Ignore background audio shutdown exceptions
    } finally {
      this.currentTranscript = '';
      this.isCurrentlyListening = false;
    }
  }

  private async cleanupListeners(): Promise<void> {
    try {
      if (this.partialListenerHandle) {
        await this.partialListenerHandle.remove();
        this.partialListenerHandle = null;
      }
      if (this.stateListenerHandle) {
        await this.stateListenerHandle.remove();
        this.stateListenerHandle = null;
      }
    } catch {
      // Ignore cleanup error
    }
  }

  public isListening(): boolean {
    return this.isCurrentlyListening;
  }
}

export const voiceService = new VoiceService();
