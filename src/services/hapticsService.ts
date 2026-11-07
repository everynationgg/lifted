import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

/**
 * Robust Haptic Service for trauma grounding and sensory feedback.
 * Works seamlessly across native Android, iOS, and mobile browsers.
 */
class HapticsService {
  private isEnabled: boolean = true;

  constructor() {
    const saved = localStorage.getItem('lifted_haptics_enabled');
    this.isEnabled = saved !== 'false';
  }

  public setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    localStorage.setItem('lifted_haptics_enabled', enabled ? 'true' : 'false');
  }

  public getEnabled(): boolean {
    return this.isEnabled;
  }

  /**
   * Subtle tick for emotion chips, buttons, and countdown ticks.
   */
  public async light(): Promise<void> {
    if (!this.isEnabled) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      if ('vibrate' in navigator) {
        navigator.vibrate(15);
      }
    }
  }

  /**
   * Distinct pulse for 4-7-8 breath transitions (Inhale -> Hold -> Exhale).
   */
  public async medium(): Promise<void> {
    if (!this.isEnabled) return;
    try {
      await Haptics.impact({ style: ImpactStyle.Medium });
    } catch {
      if ('vibrate' in navigator) {
        navigator.vibrate(40);
      }
    }
  }

  /**
   * Firm grounding pulse for completion events (check-in complete, prayer sent).
   */
  public async success(): Promise<void> {
    if (!this.isEnabled) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {
      if ('vibrate' in navigator) {
        navigator.vibrate([30, 60, 30]);
      }
    }
  }
}

export const haptics = new HapticsService();
