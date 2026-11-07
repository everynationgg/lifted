import { describe, it, expect, beforeEach } from 'vitest';
import { SyntheticPaymentAdapter } from '../SyntheticPaymentAdapter';

describe('SyntheticPaymentAdapter (Sandbox Payment Simulator)', () => {
  let adapter: SyntheticPaymentAdapter;

  beforeEach(() => {
    adapter = new SyntheticPaymentAdapter();
  });

  describe('Order Initiation', () => {
    it('creates a pending order with authoritative pricing in USD', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      expect(order.id).toBeDefined();
      expect(order.orderNumber).toContain('ORD-SYNTH-');
      expect(order.currency).toBe('USD');
      expect(order.amountCents).toBe(1499);
      expect(order.status).toBe('pending');
      expect(order.provider).toBe('synthetic');
    });

    it('creates a pending order with authoritative pricing in PHP', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'PHP');
      expect(order.currency).toBe('PHP');
      expect(order.amountCents).toBe(79900); // ₱799.00
      expect(order.status).toBe('pending');
    });

    it('simulates network disconnection during order initiation', async () => {
      await expect(
        adapter.initiateOrder('wb-trauma-healing-v1', 'USD', { simulatedOutcome: 'network_error' })
      ).rejects.toThrow('NETWORK_ERROR');
    });
  });

  describe('Checkout State Machine Simulation', () => {
    it('simulates successful checkout and grants purchase entitlement', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      const result = await adapter.processCheckout(order.id, { simulatedOutcome: 'succeeded' });

      expect(result.orderId).toBe(order.id);
      expect(result.status).toBe('succeeded');
      expect(result.entitlementGranted).toBe(true);
      expect(result.isIdempotent).toBe(false);

      // Verify entitlement was granted
      const entitlements = await adapter.restorePurchases();
      const activeEnt = entitlements.find((e) => e.productId === order.productId);
      expect(activeEnt).toBeDefined();
      expect(activeEnt?.status).toBe('active');
    });

    it('simulates failed checkout and does NOT grant entitlement', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      const result = await adapter.processCheckout(order.id, { simulatedOutcome: 'failed' });

      expect(result.status).toBe('failed');
      expect(result.entitlementGranted).toBe(false);

      const entitlements = await adapter.restorePurchases();
      const ent = entitlements.find((e) => e.productId === order.productId);
      expect(ent).toBeUndefined();
    });

    it('simulates user cancellation and does NOT grant entitlement', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      const result = await adapter.processCheckout(order.id, { simulatedOutcome: 'cancelled' });

      expect(result.status).toBe('cancelled');
      expect(result.entitlementGranted).toBe(false);
    });

    it('simulates session expiry and does NOT grant entitlement', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      const result = await adapter.processCheckout(order.id, { simulatedOutcome: 'expired' });

      expect(result.status).toBe('expired');
      expect(result.entitlementGranted).toBe(false);
    });

    it('simulates delayed payment confirmation (transitioning to processing)', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      const result = await adapter.processCheckout(order.id, { simulatedOutcome: 'delayed' });

      expect(result.status).toBe('processing');
      expect(result.entitlementGranted).toBe(false);
    });

    it('simulates network drop during settlement', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      await expect(
        adapter.processCheckout(order.id, { simulatedOutcome: 'network_error' })
      ).rejects.toThrow('NETWORK_ERROR');
    });

    it('handles duplicate completion events idempotently without double-granting', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      const firstResult = await adapter.processCheckout(order.id, { simulatedOutcome: 'succeeded' });
      expect(firstResult.status).toBe('succeeded');
      expect(firstResult.isIdempotent).toBe(false);

      // Replay identical completion event
      const secondResult = await adapter.processCheckout(order.id, { simulatedOutcome: 'succeeded' });
      expect(secondResult.status).toBe('succeeded');
      expect(secondResult.isIdempotent).toBe(true);

      // Verify single entitlement exists
      const entitlements = await adapter.restorePurchases();
      const count = entitlements.filter((e) => e.productId === order.productId).length;
      expect(count).toBe(1);
    });
  });

  describe('Refund and License Revocation', () => {
    it('refunds succeeded order and revokes purchase entitlement', async () => {
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      await adapter.processCheckout(order.id, { simulatedOutcome: 'succeeded' });

      // Verify entitlement exists before refund
      let entitlements = await adapter.restorePurchases();
      expect(entitlements.length).toBe(1);

      // Process refund
      const refundResult = await adapter.refundOrder(order.id, 'User sandbox refund request');
      expect(refundResult.refunded).toBe(true);

      // Verify entitlement is revoked
      entitlements = await adapter.restorePurchases();
      const ent = entitlements.find((e) => e.productId === order.productId);
      expect(ent).toBeUndefined();
    });
  });

  describe('Voluntary Giving (Donations)', () => {
    it('processes a valid one-time voluntary donation', async () => {
      const donation = await adapter.processDonation({
        amountCents: 2500, // $25.00
        currency: 'USD',
        frequency: 'one_time',
        designation: 'trauma_workbook_scholarships',
        donorEmail: 'partner@example.com',
        donorName: 'Generous Partner',
        simulatedOutcome: 'succeeded',
      });

      expect(donation.id).toBeDefined();
      expect(donation.donationNumber).toMatch(/^DON-(SYNTH|\d{8})-/);
      expect(donation.amountCents).toBe(2500);
      expect(donation.status).toBe('succeeded');
      expect(donation.frequency).toBe('one_time');
      expect(donation.receiptUrl).toBeDefined();
    });

    it('rejects donation amounts under 100 cents ($1.00 / ₱50)', async () => {
      await expect(
        adapter.processDonation({
          amountCents: 50, // 50 cents
          currency: 'USD',
          frequency: 'one_time',
          designation: 'general_healing_ministry',
        })
      ).rejects.toThrow('INVALID_AMOUNT');
    });

    it('handles simulated donation failure', async () => {
      await expect(
        adapter.processDonation({
          amountCents: 5000,
          currency: 'USD',
          frequency: 'one_time',
          designation: 'crisis_ministry',
          simulatedOutcome: 'failed',
        })
      ).rejects.toThrow('PAYMENT_FAILED');
    });

    it('STRICT ISOLATION: Voluntary donation NEVER grants commercial digital workbook access', async () => {
      // User makes a large voluntary donation ($100.00)
      await adapter.processDonation({
        amountCents: 10000,
        currency: 'USD',
        frequency: 'one_time',
        designation: 'trauma_workbook_scholarships',
        simulatedOutcome: 'succeeded',
      });

      // Assert that entitlements remain empty
      const entitlements = await adapter.restorePurchases();
      expect(entitlements.length).toBe(0);
    });
  });
});
