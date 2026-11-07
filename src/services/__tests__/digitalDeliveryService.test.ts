import { describe, it, expect, beforeEach } from 'vitest';
import { DigitalDeliveryService } from '../digitalDeliveryService';
import { paymentRouter } from '../payment/PaymentRouter';

describe('DigitalDeliveryService (Secure Digital Workbook Fulfillment)', () => {
  let deliveryService: DigitalDeliveryService;

  beforeEach(() => {
    localStorage.clear();
    deliveryService = new DigitalDeliveryService();
    paymentRouter.setSimulatorMode(true);
  });

  describe('Download Token Generation', () => {
    it('blocks download token generation if user does not own product entitlement', async () => {
      // User has not purchased wb-grounding-anxiety-v1
      await expect(
        deliveryService.generateDownloadToken('11111111-2222-3333-4444-555555555552')
      ).rejects.toThrow('PERMISSION_DENIED');
    });

    it('generates short-lived download token with checksum for entitled product', async () => {
      // First purchase product in synthetic adapter
      const adapter = paymentRouter.getAdapter();
      const order = await adapter.initiateOrder('wb-trauma-healing-v1', 'USD');
      await adapter.processCheckout(order.id, { simulatedOutcome: 'succeeded' });

      // Generate download token
      const tokenResult = await deliveryService.generateDownloadToken(
        '11111111-2222-3333-4444-555555555551'
      );

      expect(tokenResult.downloadToken).toBeDefined();
      expect(tokenResult.fileName).toContain('.pdf');
      expect(tokenResult.checksumSha256).toBeDefined();
      expect(new Date(tokenResult.expiresAt).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('Token Verification & Fulfillment', () => {
    it('verifies valid download token and returns secure storage path', async () => {
      const verified = await deliveryService.verifyDownloadToken('synth_tok_valid_123');
      expect(verified.valid).toBe(true);
      expect(verified.filePath).toContain('secure/workbooks/');
      expect(verified.checksumSha256).toBeDefined();
    });

    it('rejects expired or malformed download token', async () => {
      await expect(deliveryService.verifyDownloadToken('expired_token_abc')).rejects.toThrow(
        'EXPIRED_TOKEN'
      );
      await expect(deliveryService.verifyDownloadToken('')).rejects.toThrow('EXPIRED_TOKEN');
    });
  });

  describe('Offline Caching & Chapter Content', () => {
    it('downloads and stores workbook in isolated offline cache', async () => {
      const productId = '11111111-2222-3333-4444-555555555551';
      const cached = await deliveryService.fulfillAndCacheWorkbook(
        productId,
        'wb-trauma-healing-v1',
        'Restoring the Broken',
        'synth_tok_valid_456'
      );

      expect(cached.productId).toBe(productId);
      expect(cached.sampleContent.chapters.length).toBeGreaterThanOrEqual(2);
      expect(cached.sampleContent.chapters[0].title).toContain('Trauma');
      expect(cached.sampleContent.chapters[0].groundingExercise).toBeDefined();

      // Retrieve from offline storage
      const stored = deliveryService.getDownloadedWorkbook(productId);
      expect(stored).not.toBeNull();
      expect(stored?.productTitle).toBe('Restoring the Broken');
    });

    it('revokes local offline copy upon refund', async () => {
      const productId = '11111111-2222-3333-4444-555555555551';
      await deliveryService.fulfillAndCacheWorkbook(
        productId,
        'wb-trauma-healing-v1',
        'Restoring the Broken',
        'synth_tok_valid_789'
      );

      expect(deliveryService.getDownloadedWorkbook(productId)).not.toBeNull();

      // Revoke
      deliveryService.revokeDownloadedWorkbook(productId);
      expect(deliveryService.getDownloadedWorkbook(productId)).toBeNull();
    });

    it('PURE ISOLATION: Digital delivery never writes to private emotional wellness vault', async () => {
      const productId = '11111111-2222-3333-4444-555555555551';
      await deliveryService.fulfillAndCacheWorkbook(
        productId,
        'wb-trauma-healing-v1',
        'Restoring the Broken',
        'synth_tok_valid_999'
      );

      // Verify that no keys related to private journals or encrypted vault are modified
      const vaultKey = localStorage.getItem('lifted_vault_secure_store_v1');
      const journalsKey = localStorage.getItem('private_journals');
      const prayersKey = localStorage.getItem('prayer_requests');

      expect(vaultKey).toBeNull();
      expect(journalsKey).toBeNull();
      expect(prayersKey).toBeNull();
    });
  });
});
