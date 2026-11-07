/**
 * Apple StoreKit Payment Adapter Stub (iOS Store Compliance)
 * LIFTED Phase 11: Mobile Store Compliance
 *
 * Implements Apple App Store Guidelines:
 * - Guideline 3.1.1 (In-App Purchase): Digital content (workbooks) consumed within the app
 *   must use Apple In-App Purchase (StoreKit). External web checkout links are strictly prohibited.
 * - Guideline 3.2.2(iv) (Charitable Contributions): Voluntary donations must be conducted
 *   via Safari / external web link, NOT through In-App Purchase, and only if the entity is an
 *   approved nonprofit.
 *
 * Status: Purchases remain DISABLED until production Apple Developer Program merchant registration.
 */

import type {
  PlatformType,
  Order,
  CheckoutResult,
  DonationRequest,
  Donation,
  PurchaseEntitlement,
  StoreComplianceNotice,
} from '../../types/store';
import type { IPaymentAdapter, CheckoutOptions } from './PaymentAdapter';

export class StoreKitAdapterStub implements IPaymentAdapter {
  readonly providerId = 'apple_iap';
  readonly isSynthetic = false;

  canPurchase(platform: PlatformType): boolean {
    // Disabled in development/sandbox until Apple IAP products are configured
    return platform === 'ios' && false;
  }

  getComplianceNotice(platform: PlatformType): StoreComplianceNotice {
    return {
      platform,
      isPurchaseEnabled: false,
      complianceRule: 'APPLE_APP_STORE_GUIDELINE_3_1_1',
      noticeTitle: 'Apple In-App Purchase Policy Notice',
      noticeDescription:
        'Digital workbooks consumed inside the iOS application must use Apple In-App Purchase (StoreKit). In-app purchasing is currently inactive pending Apple Developer account merchant configuration. External web checkout links are strictly prohibited for digital in-app content.',
      actionRecommendation:
        'To test the purchase experience safely, please switch to the Synthetic Sandbox Simulator.',
    };
  }

  async initiateOrder(
    _productCode: string,
    _currency?: string,
    _options?: CheckoutOptions
  ): Promise<Order> {
    throw new Error(
      'STORE_POLICY_RESTRICTION: Apple In-App Purchase is not activated on this device. Live transactions are disabled.'
    );
  }

  async processCheckout(
    _orderId: string,
    _options?: CheckoutOptions
  ): Promise<CheckoutResult> {
    throw new Error(
      'STORE_POLICY_RESTRICTION: Native StoreKit payment processing is disabled pending Apple merchant registration.'
    );
  }

  async processDonation(_request: DonationRequest): Promise<Donation> {
    throw new Error(
      'APPLE_POLICY_NOTICE: Under Apple Guideline 3.2.2(iv), charitable contributions cannot use In-App Purchase and must be completed via an approved external web portal.'
    );
  }

  async restorePurchases(): Promise<PurchaseEntitlement[]> {
    return [];
  }

  async refundOrder(
    _orderId: string,
    _reason?: string
  ): Promise<{ refunded: boolean; orderId: string }> {
    throw new Error(
      'APPLE_POLICY_NOTICE: StoreKit refunds must be requested directly through Apple Support (reportaproblem.apple.com).'
    );
  }
}
