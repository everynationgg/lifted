/**
 * Store & Generosity Service
 * LIFTED Phase 11: Generosity, Donations, Digital Workbooks & Store
 */

import type {
  DigitalProduct,
  Order,
  PurchaseEntitlement,
  Donation,
  DonationRequest,
  CheckoutResult,
  StoreComplianceNotice,
} from '../types/store';
import type { Database } from '../types/database.types';
import { supabaseAuthService } from './auth/supabaseAuthService';
import { paymentRouter } from './payment/PaymentRouter';
import { digitalDeliveryService, type CachedWorkbookContent } from './digitalDeliveryService';
import type { CheckoutOptions } from './payment/PaymentAdapter';

export const BUNDLED_DIGITAL_PRODUCTS: DigitalProduct[] = [
  {
    id: '11111111-2222-3333-4444-555555555551',
    productCode: 'wb-trauma-healing-v1',
    title: 'Restoring the Broken: A 30-Day Christian Trauma Recovery Guide',
    subtitle: 'Clinical Somatic Grounding Combined with Contemplative Scripture',
    description:
      'A comprehensive 140-page interactive workbook integrating somatic grounding, polyvagal regulation, and gospel-centered lament practices for adults navigating trauma recovery.',
    productType: 'workbook',
    version: '1.0.0',
    authorName: 'Cherie Magsanoc & LIFTED Clinical Team',
    fileSizeBytes: 4850000,
    checksumSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    isActive: true,
    pricing: [
      {
        id: 'price-wb1-usd',
        productId: '11111111-2222-3333-4444-555555555551',
        currency: 'USD',
        amountCents: 1499,
        isActive: true,
      },
      {
        id: 'price-wb1-php',
        productId: '11111111-2222-3333-4444-555555555551',
        currency: 'PHP',
        amountCents: 79900,
        isActive: true,
      },
    ],
  },
  {
    id: '11111111-2222-3333-4444-555555555552',
    productCode: 'wb-grounding-anxiety-v1',
    title: 'Anchored in Grace: Daily Practices for Overcoming Severe Anxiety',
    subtitle: 'Trauma-Informed Breath Pacers and Guided Reflections',
    description:
      'An interactive 80-page workbook offering 4-7-8 breath pacer exercises, bilateral stimulation prompts, and scripture affirmations designed for high-stress and panic moments.',
    productType: 'workbook',
    version: '1.0.0',
    authorName: 'LIFTED Pastoral Care',
    fileSizeBytes: 3200000,
    checksumSha256: 'a2c1b44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b866',
    isActive: true,
    pricing: [
      {
        id: 'price-wb2-usd',
        productId: '11111111-2222-3333-4444-555555555552',
        currency: 'USD',
        amountCents: 999,
        isActive: true,
      },
      {
        id: 'price-wb2-php',
        productId: '11111111-2222-3333-4444-555555555552',
        currency: 'PHP',
        amountCents: 49900,
        isActive: true,
      },
    ],
  },
  {
    id: '11111111-2222-3333-4444-555555555553',
    productCode: 'wb-grief-recovery-v1',
    title: 'Walking Through the Valley: The Courage to Grieve with Hope',
    subtitle: 'Honoring Loss, Navigating Complicated Grief, and Discovering Renewal',
    description:
      'A gentle 96-page guided journal for individuals and parents processing acute loss, miscarriage, or bereavement through community lament and faith-based resilience.',
    productType: 'workbook',
    version: '1.0.0',
    authorName: 'Every Nation GG & LIFTED Care',
    fileSizeBytes: 3900000,
    checksumSha256: 'f4d2c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b877',
    isActive: true,
    pricing: [
      {
        id: 'price-wb3-usd',
        productId: '11111111-2222-3333-4444-555555555553',
        currency: 'USD',
        amountCents: 1199,
        isActive: true,
      },
      {
        id: 'price-wb3-php',
        productId: '11111111-2222-3333-4444-555555555553',
        currency: 'PHP',
        amountCents: 59900,
        isActive: true,
      },
    ],
  },
];

export class StoreService {
  /**
   * Loads products and pricing (remote database with synthetic fixture fallback).
   */
  async getProducts(): Promise<DigitalProduct[]> {
    const client = supabaseAuthService.getClient();

    if (client) {
      try {
        const [prodRes, priceRes] = await Promise.all([
          client.from('digital_products').select('*').eq('is_active', true),
          client.from('product_pricing').select('*').eq('is_active', true),
        ]);

        if (!prodRes.error && prodRes.data && prodRes.data.length > 0) {
          const rawProds = prodRes.data as Array<Database['public']['Tables']['digital_products']['Row']>;
          const prices = (priceRes.data || []) as Array<{
            id: string;
            product_id: string;
            currency: string;
            amount_cents: number;
            is_active: boolean;
          }>;

          return rawProds.map((p) => ({
            id: p.id,
            productCode: p.product_code,
            title: p.title,
            subtitle: p.subtitle || undefined,
            description: p.description,
            productType: p.product_type,
            version: p.version,
            authorName: p.author_name,
            coverImageUrl: p.cover_image_url || undefined,
            fileSizeBytes: p.file_size_bytes,
            checksumSha256: p.checksum_sha256,
            isActive: p.is_active,
            pricing: prices
              .filter((pr) => pr.product_id === p.id)
              .map((pr) => ({
                id: pr.id,
                productId: pr.product_id,
                currency: pr.currency,
                amountCents: pr.amount_cents,
                isActive: pr.is_active,
              })),
          }));
        }
      } catch (err) {
        console.warn('Failed to query remote digital_products, using bundled fixtures:', err);
      }
    }

    return BUNDLED_DIGITAL_PRODUCTS;
  }

  /**
   * Fetches active user entitlements.
   */
  async getUserEntitlements(): Promise<PurchaseEntitlement[]> {
    const adapter = paymentRouter.getAdapter();
    return adapter.restorePurchases();
  }

  /**
   * Initiates an order for a digital product.
   */
  async createOrder(
    productCode: string,
    currency = 'USD',
    options?: CheckoutOptions
  ): Promise<Order> {
    const adapter = paymentRouter.getAdapter();
    return adapter.initiateOrder(productCode, currency, options);
  }

  /**
   * Processes checkout simulation for an order.
   */
  async processCheckout(
    orderId: string,
    options?: CheckoutOptions
  ): Promise<CheckoutResult> {
    const adapter = paymentRouter.getAdapter();
    return adapter.processCheckout(orderId, options);
  }

  /**
   * Processes a voluntary donation contribution.
   */
  async processDonation(request: DonationRequest): Promise<Donation> {
    const adapter = paymentRouter.getAdapter();
    return adapter.processDonation(request);
  }

  /**
   * Initiates digital fulfillment and downloads workbook for offline reading.
   */
  async downloadAndStoreWorkbook(
    productId: string,
    productCode: string,
    productTitle: string
  ): Promise<CachedWorkbookContent> {
    const tokenResult = await digitalDeliveryService.generateDownloadToken(productId);
    return digitalDeliveryService.fulfillAndCacheWorkbook(
      productId,
      productCode,
      productTitle,
      tokenResult.downloadToken
    );
  }

  /**
   * Requests order refund and revokes entitlement.
   */
  async refundOrder(orderId: string, reason?: string): Promise<{ refunded: boolean; orderId: string }> {
    const adapter = paymentRouter.getAdapter();
    return adapter.refundOrder(orderId, reason);
  }

  /**
   * Returns store compliance notice for the current platform.
   */
  getComplianceNotice(): StoreComplianceNotice {
    return paymentRouter.getComplianceNotice();
  }
}

export const storeService = new StoreService();
