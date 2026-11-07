/**
 * Google Play Billing Adapter Stub (Android Store Compliance)
 * LIFTED Phase 11: Mobile Store Compliance
 *
 * Implements Google Play Billing Policy:
 * - Developers offering digital content (such as workbooks) consumed inside Android apps
 *   must use Google Play Billing as the payment method.
 * - Non-charitable donations or financial tips are governed by Play Payments policy.
 * - Voluntary contributions to recognized charitable organizations are exempt from Play Billing
 *   and must be processed via web checkout.
 *
 * Status: Purchases remain DISABLED until production Google Play Console merchant registration.
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

export class GooglePlayBillingAdapterStub implements IPaymentAdapter {
  readonly providerId = 'google_play';
  readonly isSynthetic = false;

  canPurchase(platform: PlatformType): boolean {
    return platform === 'android' && false;
  }

  getComplianceNotice(platform: PlatformType): StoreComplianceNotice {
    return {
      platform,
      isPurchaseEnabled: false,
      complianceRule: 'GOOGLE_PLAY_BILLING_POLICY',
      noticeTitle: 'Google Play Billing Policy Notice',
      noticeDescription:
        'Digital workbooks consumed in-app must use Google Play Billing. Billing integration is currently inactive pending Google Play Console merchant and product setup.',
      actionRecommendation:
        'To test workbook checkout safely, please use the Synthetic Sandbox Simulator.',
    };
  }

  async initiateOrder(
    _productCode: string,
    _currency?: string,
    _options?: CheckoutOptions
  ): Promise<Order> {
    throw new Error(
      'STORE_POLICY_RESTRICTION: Google Play Billing is currently disabled. Live purchases cannot be processed.'
    );
  }

  async processCheckout(
    _orderId: string,
    _options?: CheckoutOptions
  ): Promise<CheckoutResult> {
    throw new Error(
      'STORE_POLICY_RESTRICTION: Google Play Billing purchase processing is disabled.'
    );
  }

  async processDonation(_request: DonationRequest): Promise<Donation> {
    throw new Error(
      'GOOGLE_PLAY_POLICY: Voluntary charitable donations are exempt from Play Billing and must be directed to an approved nonprofit web endpoint.'
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
      'GOOGLE_PLAY_POLICY: Play Store refunds are managed through Google Play Store order management.'
    );
  }
}
