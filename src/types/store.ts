/**
 * Store & Generosity Domain Types
 * LIFTED Phase 11: Generosity, Donations, Digital Workbooks & Store
 */

export type OrderStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'expired';

export type PaymentProviderType =
  | 'synthetic'
  | 'stripe_web'
  | 'apple_iap'
  | 'google_play';

export type ProductType = 'workbook' | 'audio_series' | 'curated_bundle';

export type EntitlementStatus = 'active' | 'revoked' | 'refunded' | 'expired';

export type DonationFrequency = 'one_time' | 'monthly';

export interface DigitalProduct {
  id: string;
  productCode: string;
  title: string;
  subtitle?: string;
  description: string;
  productType: ProductType;
  version: string;
  authorName: string;
  coverImageUrl?: string;
  fileSizeBytes: number;
  checksumSha256: string;
  isActive: boolean;
  pricing: ProductPricing[];
}

export interface ProductPricing {
  id: string;
  productId: string;
  currency: string;
  amountCents: number;
  isActive: boolean;
}

export interface Order {
  id: string;
  userId: string;
  orderNumber: string;
  productId: string;
  productTitle?: string;
  currency: string;
  amountCents: number;
  status: OrderStatus;
  provider: PaymentProviderType;
  providerSessionId?: string;
  providerPaymentId?: string;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseEntitlement {
  id: string;
  userId: string;
  productId: string;
  productCode?: string;
  productTitle?: string;
  orderId?: string;
  status: EntitlementStatus;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revocationReason?: string;
}

export interface DownloadTokenResult {
  downloadToken: string;
  expiresAt: string;
  fileName: string;
  fileSizeBytes: number;
  checksumSha256: string;
  productTitle: string;
}

export interface VerifiedDownloadResult {
  valid: boolean;
  productId: string;
  filePath: string;
  fileSizeBytes: number;
  checksumSha256: string;
}

export interface Donation {
  id: string;
  userId?: string;
  donationNumber: string;
  donorEmail?: string;
  donorName?: string;
  amountCents: number;
  currency: string;
  frequency: DonationFrequency;
  designation: string;
  status: OrderStatus;
  provider: PaymentProviderType;
  receiptUrl?: string;
  createdAt: string;
}

export interface DonationRequest {
  amountCents: number;
  currency: string;
  frequency: DonationFrequency;
  designation: string;
  donorEmail?: string;
  donorName?: string;
  simulatedOutcome?: 'succeeded' | 'failed' | 'cancelled';
}

export interface CheckoutResult {
  orderId: string;
  orderNumber: string;
  status: OrderStatus;
  entitlementGranted: boolean;
  isIdempotent: boolean;
  errorMessage?: string;
}

export type PlatformType = 'web' | 'ios' | 'android';

export interface StoreComplianceNotice {
  platform: PlatformType;
  isPurchaseEnabled: boolean;
  complianceRule: string;
  noticeTitle: string;
  noticeDescription: string;
  actionRecommendation: string;
}
