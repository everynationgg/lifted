/**
 * Stripe Web Payment Adapter Stub (Web Browser Payments & Disclosures)
 * LIFTED Phase 11: Payment Platform & Merchant Eligibility
 *
 * Implements Web Checkout considerations:
 * - Legal Merchant: Cherie Magsanoc (LIFTED) / Every Nation GG
 * - Country of Incorporation & Bank Account: Philippines
 * - Stripe Availability: Direct standard Stripe accounts are not available in the Philippines
 *   without Stripe Atlas or local payment orchestrators (e.g. PayMongo).
 * - Receipt Obligations: Official donation acknowledgment required under BIR/tax guidelines.
 *
 * Status: Web checkout remains in Sandbox/Test Mode. Live charges are strictly disabled.
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

export class StripeWebAdapterStub implements IPaymentAdapter {
  readonly providerId = 'stripe_web';
  readonly isSynthetic = false;

  canPurchase(platform: PlatformType): boolean {
    // Disabled until production legal entity decisions and live Stripe credentials are provided
    return platform === 'web' && false;
  }

  getComplianceNotice(platform: PlatformType): StoreComplianceNotice {
    return {
      platform,
      isPurchaseEnabled: false,
      complianceRule: 'MERCHANT_ELIGIBILITY_REQUIREMENT',
      noticeTitle: 'Web Payment Merchant Notice',
      noticeDescription:
        'Direct web checkout via Stripe requires an eligible merchant entity. In the Philippines, Stripe standard accounts require Stripe Atlas or a local aggregator. Live card processing is therefore disabled.',
      actionRecommendation:
        'Please utilize the Synthetic Sandbox Simulator to evaluate the checkout flow.',
    };
  }

  async initiateOrder(
    _productCode: string,
    _currency?: string,
    _options?: CheckoutOptions
  ): Promise<Order> {
    throw new Error(
      'MERCHANT_ELIGIBILITY_ERROR: Production Stripe Web checkout is not authorized. Live credentials are not configured.'
    );
  }

  async processCheckout(
    _orderId: string,
    _options?: CheckoutOptions
  ): Promise<CheckoutResult> {
    throw new Error(
      'MERCHANT_ELIGIBILITY_ERROR: Live Stripe payment processing is disabled.'
    );
  }

  async processDonation(_request: DonationRequest): Promise<Donation> {
    throw new Error(
      'MERCHANT_ELIGIBILITY_ERROR: Live donation processing is disabled pending merchant tax status determination.'
    );
  }

  async restorePurchases(): Promise<PurchaseEntitlement[]> {
    return [];
  }

  async refundOrder(
    _orderId: string,
    _reason?: string
  ): Promise<{ refunded: boolean; orderId: string }> {
    throw new Error('MERCHANT_ELIGIBILITY_ERROR: Live refund processing is disabled.');
  }
}
