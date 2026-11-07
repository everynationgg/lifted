/**
 * Provider-Neutral Payment Adapter Interface
 * LIFTED Phase 11: Modular Store & Generosity Infrastructure
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

export interface CheckoutOptions {
  simulatedOutcome?: 'succeeded' | 'failed' | 'cancelled' | 'expired' | 'network_error' | 'delayed';
  idempotencyKey?: string;
}

export interface IPaymentAdapter {
  readonly providerId: string;
  readonly isSynthetic: boolean;

  canPurchase(platform: PlatformType): boolean;

  initiateOrder(
    productCode: string,
    currency?: string,
    options?: CheckoutOptions
  ): Promise<Order>;

  processCheckout(
    orderId: string,
    options?: CheckoutOptions
  ): Promise<CheckoutResult>;

  processDonation(
    request: DonationRequest
  ): Promise<Donation>;

  restorePurchases(): Promise<PurchaseEntitlement[]>;

  refundOrder(
    orderId: string,
    reason?: string
  ): Promise<{ refunded: boolean; orderId: string }>;

  getComplianceNotice(platform: PlatformType): StoreComplianceNotice;
}
