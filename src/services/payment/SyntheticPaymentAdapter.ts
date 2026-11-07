/**
 * Synthetic Payment Adapter (Sandbox Simulator)
 * LIFTED Phase 11: Sandbox & Synthetic Transactions Only
 *
 * Implements a complete sandbox payment lifecycle without real financial transactions:
 * - Product selection, pricing, amount & currency validation
 * - Authoritative order creation with idempotency keys
 * - Full state-machine simulation: pending, succeeded, failed, cancelled, expired, refunded
 * - Duplicate completion event handling (idempotency)
 * - Delayed confirmation and network interruption simulation
 * - Voluntary giving (donations) strictly isolated from workbook entitlements
 * - Zero real payment credentials collected
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
import { supabaseAuthService } from '../auth/supabaseAuthService';
import { computeHmacSha256Hex } from './webhookSecurity';
import { APP_CONFIG } from '../../config';

export class SyntheticPaymentAdapter implements IPaymentAdapter {
  readonly providerId = 'synthetic';
  readonly isSynthetic = true;

  // Local in-memory / session store for synthetic transactions when client/offline
  private localOrders = new Map<string, Order>();
  private localEntitlements = new Map<string, PurchaseEntitlement>();
  private localDonations: Donation[] = [];
  private orderCounter = 1000;
  private donationCounter = 2000;

  canPurchase(_platform: PlatformType): boolean {
    // Strictly forbidden in production builds
    if (APP_CONFIG.isProduction) {
      return false;
    }
    return true;
  }

  getComplianceNotice(platform: PlatformType): StoreComplianceNotice {
    return {
      platform,
      isPurchaseEnabled: true,
      complianceRule: 'SANDBOX_SIMULATOR_ONLY',
      noticeTitle: 'Synthetic Development Sandbox',
      noticeDescription:
        'This environment runs strictly on simulated transactions. No real cards are charged, and no real financial assets are collected.',
      actionRecommendation: 'Test all payment outcomes using the sandbox simulation controls.',
    };
  }

  async initiateOrder(
    productCode: string,
    currency = 'USD',
    options?: CheckoutOptions
  ): Promise<Order> {
    if (APP_CONFIG.isProduction) {
      throw new Error(
        'PRODUCTION_SECURITY_VIOLATION: Synthetic payment processing is strictly disabled in production builds.'
      );
    }
    const client = supabaseAuthService.getClient();
    const user = supabaseAuthService.getCurrentUser();

    if (options?.simulatedOutcome === 'network_error') {
      throw new Error('NETWORK_ERROR: Simulated connection drop during order initiation.');
    }

    const idempotencyKey =
      options?.idempotencyKey || `synth_idem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Try server RPC if authenticated
    if (client && user) {
      try {
        const { data, error } = await (client.rpc as any)('store_create_order', {
          p_product_code: productCode,
          p_currency: currency,
          p_idempotency_key: idempotencyKey,
        });

        if (error) {
          throw new Error(error.message);
        }

        const res = data as unknown as {
          order_id: string;
          order_number: string;
          product_id: string;
          product_title: string;
          amount_cents: number;
          currency: string;
          status: string;
        };

        const order: Order = {
          id: res.order_id,
          userId: user.id,
          orderNumber: res.order_number,
          productId: res.product_id,
          productTitle: res.product_title,
          currency: res.currency,
          amountCents: res.amount_cents,
          status: 'pending',
          provider: 'synthetic',
          idempotencyKey,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        this.localOrders.set(order.id, order);
        return order;
      } catch (err) {
        // If server call fails, fallback to local synthetic simulation
        if ((err as Error).message?.includes('ALREADY_ENTITLED')) {
          throw err;
        }
      }
    }

    // Local synthetic fallback
    const orderId = `ord_synth_${++this.orderCounter}`;
    const orderNumber = `ORD-SYNTH-${this.orderCounter}`;
    const amountCents = currency === 'PHP' ? 79900 : 1499;

    const order: Order = {
      id: orderId,
      userId: user?.id || 'synthetic-guest-user',
      orderNumber,
      productId: '11111111-2222-3333-4444-555555555551',
      productTitle: 'Restoring the Broken: A 30-Day Christian Trauma Recovery Guide',
      currency,
      amountCents,
      status: 'pending',
      provider: 'synthetic',
      idempotencyKey,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.localOrders.set(order.id, order);
    return order;
  }

  async processCheckout(
    orderId: string,
    options?: CheckoutOptions
  ): Promise<CheckoutResult> {
    if (APP_CONFIG.isProduction) {
      throw new Error(
        'PRODUCTION_SECURITY_VIOLATION: Synthetic payment processing is strictly disabled in production builds.'
      );
    }
    const outcome = options?.simulatedOutcome || 'succeeded';

    if (outcome === 'network_error') {
      throw new Error('NETWORK_ERROR: Simulated network failure during payment settlement.');
    }

    if (outcome === 'delayed') {
      // Return pending status simulating asynchronous clearing
      const order = this.localOrders.get(orderId);
      if (order) {
        order.status = 'processing';
      }
      return {
        orderId,
        orderNumber: order?.orderNumber || 'ORD-DELAYED',
        status: 'processing',
        entitlementGranted: false,
        isIdempotent: false,
      };
    }

    const client = supabaseAuthService.getClient();
    const user = supabaseAuthService.getCurrentUser();

    if (client && user) {
      try {
        const signature = await computeHmacSha256Hex(
          'synthetic-sandbox-secret-2026',
          `${orderId}:${outcome}`
        );

        const { data, error } = await (client.rpc as any)('store_process_synthetic_checkout', {
          p_order_id: orderId,
          p_simulated_outcome: outcome,
          p_signature: signature,
        });

        if (error) {
          throw new Error(error.message);
        }

        const res = data as unknown as {
          order_id: string;
          order_number: string;
          status: string;
          entitlement_granted: boolean;
          is_idempotent: boolean;
        };

        const result: CheckoutResult = {
          orderId: res.order_id,
          orderNumber: res.order_number,
          status: res.status as Order['status'],
          entitlementGranted: res.entitlement_granted,
          isIdempotent: res.is_idempotent,
        };

        const order = this.localOrders.get(orderId);
        if (order) {
          order.status = result.status;
        }

        return result;
      } catch (err) {
        // Fallback to local simulation
        console.warn('Synthetic server RPC error, falling back locally:', err);
      }
    }

    // Local synthetic simulation
    const order = this.localOrders.get(orderId);
    if (!order) {
      throw new Error(`Order ${orderId} not found.`);
    }

    if (order.status === 'succeeded' || order.status === 'refunded') {
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        entitlementGranted: order.status === 'succeeded',
        isIdempotent: true,
      };
    }

    order.status = outcome as Order['status'];
    const entitlementGranted = outcome === 'succeeded';

    if (entitlementGranted) {
      const entitlement: PurchaseEntitlement = {
        id: `ent_synth_${order.id}`,
        userId: order.userId,
        productId: order.productId,
        orderId: order.id,
        status: 'active',
        grantedAt: new Date().toISOString(),
      };
      this.localEntitlements.set(`${order.userId}_${order.productId}`, entitlement);
    }

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      entitlementGranted,
      isIdempotent: false,
    };
  }

  async processDonation(request: DonationRequest): Promise<Donation> {
    if (APP_CONFIG.isProduction) {
      throw new Error(
        'PRODUCTION_SECURITY_VIOLATION: Synthetic donations are strictly disabled in production builds.'
      );
    }
    if (request.amountCents < 100) {
      throw new Error('INVALID_AMOUNT: Minimum voluntary contribution is 100 cents (1.00 USD/EUR).');
    }

    if (request.simulatedOutcome === 'failed') {
      throw new Error('PAYMENT_FAILED: Simulated payment processing failure.');
    }

    const client = supabaseAuthService.getClient();
    const user = supabaseAuthService.getCurrentUser();

    if (client) {
      try {
        const signature = await computeHmacSha256Hex(
          'synthetic-sandbox-secret-2026',
          `donation:${request.amountCents}:${request.currency}`
        );

        const { data, error } = await (client.rpc as any)('store_process_synthetic_donation', {
          p_amount_cents: request.amountCents,
          p_currency: request.currency,
          p_frequency: request.frequency,
          p_designation: request.designation,
          p_donor_email: request.donorEmail || null,
          p_donor_name: request.donorName || null,
          p_simulated_outcome: request.simulatedOutcome || 'succeeded',
          p_signature: signature,
        });

        if (error) {
          throw new Error(error.message);
        }

        const res = data as unknown as {
          donation_id: string;
          donation_number: string;
          amount_cents: number;
          currency: string;
          frequency: string;
          designation: string;
          status: string;
          receipt_url: string;
        };

        const donation: Donation = {
          id: res.donation_id,
          userId: user?.id,
          donationNumber: res.donation_number,
          donorEmail: request.donorEmail,
          donorName: request.donorName,
          amountCents: res.amount_cents,
          currency: res.currency,
          frequency: res.frequency as Donation['frequency'],
          designation: res.designation,
          status: res.status as Order['status'],
          provider: 'synthetic',
          receiptUrl: res.receipt_url,
          createdAt: new Date().toISOString(),
        };

        this.localDonations.push(donation);
        return donation;
      } catch (err) {
        console.warn('Donation RPC failed, executing local simulation:', err);
      }
    }

    // Local simulation
    const donationNumber = `DON-SYNTH-${++this.donationCounter}`;
    const donation: Donation = {
      id: `don_synth_${this.donationCounter}`,
      userId: user?.id,
      donationNumber,
      donorEmail: request.donorEmail,
      donorName: request.donorName,
      amountCents: request.amountCents,
      currency: request.currency,
      frequency: request.frequency,
      designation: request.designation,
      status: (request.simulatedOutcome || 'succeeded') as Order['status'],
      provider: 'synthetic',
      receiptUrl: `https://receipts.lifted-app.com/${donationNumber}`,
      createdAt: new Date().toISOString(),
    };

    this.localDonations.push(donation);
    return donation;
  }

  async restorePurchases(): Promise<PurchaseEntitlement[]> {
    const client = supabaseAuthService.getClient();
    const user = supabaseAuthService.getCurrentUser();

    if (client && user) {
      try {
        const { data, error } = await (client.rpc as any)('store_restore_entitlements');
        if (!error && data) {
          return (data as unknown as Array<{
            product_id: string;
            product_code: string;
            title: string;
            version: string;
            status: string;
            granted_at: string;
          }>).map((row) => ({
            id: `ent_${row.product_id}`,
            userId: user.id,
            productId: row.product_id,
            productCode: row.product_code,
            productTitle: row.title,
            status: row.status as PurchaseEntitlement['status'],
            grantedAt: row.granted_at,
          }));
        }
      } catch (err) {
        console.warn('Failed restoring remote entitlements:', err);
      }
    }

    return Array.from(this.localEntitlements.values());
  }

  async refundOrder(
    orderId: string,
    reason = 'Customer requested refund'
  ): Promise<{ refunded: boolean; orderId: string }> {
    if (APP_CONFIG.isProduction) {
      throw new Error(
        'PRODUCTION_SECURITY_VIOLATION: Synthetic refunds are strictly disabled in production builds.'
      );
    }
    const client = supabaseAuthService.getClient();
    const user = supabaseAuthService.getCurrentUser();

    if (client && user) {
      const { data, error } = await (client.rpc as any)('store_refund_order', {
        p_order_id: orderId,
        p_reason: reason,
      });

      if (error) {
        throw new Error(error.message);
      }

      const res = data as unknown as { order_id: string; status: string; entitlement_revoked: boolean };
      const order = this.localOrders.get(orderId);
      if (order) {
        order.status = 'refunded';
      }

      return { refunded: res.status === 'refunded', orderId: res.order_id };
    }

    const order = this.localOrders.get(orderId);
    if (order) {
      order.status = 'refunded';
      this.localEntitlements.delete(`${order.userId}_${order.productId}`);
    }

    return { refunded: true, orderId };
  }
}
