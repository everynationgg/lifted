/**
 * Payment Adapter Router & Store Policy Enforcement
 * LIFTED Phase 11: Provider-Neutral Payment Architecture
 *
 * Enforces Store Guidelines:
 * - Detects platform (Web, iOS, Android)
 * - Decouples purchase logic from specific third-party SDKs
 * - Prohibits external redirect from iOS/Android purchase UI for digital goods consumed in-app
 * - Routes to Synthetic Sandbox Simulator in development and testing
 */

import { Capacitor } from '@capacitor/core';
import type { PlatformType, StoreComplianceNotice } from '../../types/store';
import type { IPaymentAdapter } from './PaymentAdapter';
import { SyntheticPaymentAdapter } from './SyntheticPaymentAdapter';
import { StoreKitAdapterStub } from './StoreKitAdapterStub';
import { GooglePlayBillingAdapterStub } from './GooglePlayBillingAdapterStub';
import { StripeWebAdapterStub } from './StripeWebAdapterStub';
import { APP_CONFIG } from '../../config';

export class PaymentRouter {
  private syntheticAdapter: SyntheticPaymentAdapter;
  private storeKitAdapter: StoreKitAdapterStub;
  private googlePlayAdapter: GooglePlayBillingAdapterStub;
  private stripeWebAdapter: StripeWebAdapterStub;

  // Active mode: strictly disabled in production builds
  private forceSimulator = !APP_CONFIG.isProduction;

  constructor() {
    this.syntheticAdapter = new SyntheticPaymentAdapter();
    this.storeKitAdapter = new StoreKitAdapterStub();
    this.googlePlayAdapter = new GooglePlayBillingAdapterStub();
    this.stripeWebAdapter = new StripeWebAdapterStub();
  }

  /**
   * Detects current runtime platform.
   */
  getCurrentPlatform(): PlatformType {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios') return 'ios';
    if (platform === 'android') return 'android';
    return 'web';
  }

  /**
   * Toggle between Synthetic Sandbox and Production Platform Adapter.
   * Strictly blocks activation in production builds.
   */
  setSimulatorMode(enabled: boolean): void {
    if (enabled && APP_CONFIG.isProduction) {
      throw new Error(
        'SECURITY_VIOLATION: Synthetic payment simulator cannot be activated in production builds.'
      );
    }
    this.forceSimulator = enabled;
  }

  isSimulatorMode(): boolean {
    return this.forceSimulator && !APP_CONFIG.isProduction;
  }

  /**
   * Resolves the active payment adapter.
   */
  getAdapter(): IPaymentAdapter {
    if (this.forceSimulator && !APP_CONFIG.isProduction) {
      return this.syntheticAdapter;
    }

    const platform = this.getCurrentPlatform();
    switch (platform) {
      case 'ios':
        return this.storeKitAdapter;
      case 'android':
        return this.googlePlayAdapter;
      case 'web':
      default:
        return this.stripeWebAdapter;
    }
  }

  /**
   * Returns store compliance notice for the current or specified platform.
   */
  getComplianceNotice(platform?: PlatformType): StoreComplianceNotice {
    const targetPlatform = platform || this.getCurrentPlatform();
    if (this.forceSimulator && !APP_CONFIG.isProduction) {
      return this.syntheticAdapter.getComplianceNotice(targetPlatform);
    }
    const adapter = this.getAdapter();
    return adapter.getComplianceNotice(targetPlatform);
  }
}

export const paymentRouter = new PaymentRouter();
