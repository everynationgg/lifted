import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { paymentRouter } from '../PaymentRouter';
import { SyntheticPaymentAdapter } from '../SyntheticPaymentAdapter';
import { StoreKitAdapterStub } from '../StoreKitAdapterStub';
import { GooglePlayBillingAdapterStub } from '../GooglePlayBillingAdapterStub';
import { StripeWebAdapterStub } from '../StripeWebAdapterStub';
import { digitalDeliveryService } from '../../digitalDeliveryService';
import { supabaseAuthService } from '../../auth/supabaseAuthService';
import { APP_CONFIG } from '../../../config';
import { crisisDirectoryService } from '../../crisisDirectoryService';

describe('Phase 12 Final Release Readiness & Feature-Gate Verification', () => {
  beforeEach(() => {
    localStorage.clear();
    paymentRouter.setSimulatorMode(true);
  });

  afterEach(() => {
    paymentRouter.setSimulatorMode(true);
    vi.restoreAllMocks();
  });

  describe('1. Production Feature-Gate & Checkout Provider Isolation', () => {
    it('strictly forbids activating synthetic simulator in production builds', () => {
      // Temporarily mock isProduction as true
      const originalProd = APP_CONFIG.isProduction;
      (APP_CONFIG as any).isProduction = true;

      try {
        expect(() => {
          paymentRouter.setSimulatorMode(true);
        }).toThrow(/SECURITY_VIOLATION/);
      } finally {
        (APP_CONFIG as any).isProduction = originalProd;
      }
    });

    it('rejects all synthetic checkout operations in production builds', async () => {
      const adapter = new SyntheticPaymentAdapter();
      const originalProd = APP_CONFIG.isProduction;
      (APP_CONFIG as any).isProduction = true;

      try {
        expect(adapter.canPurchase('web')).toBe(false);

        await expect(adapter.initiateOrder('wb-trauma-healing-v1')).rejects.toThrow(
          /PRODUCTION_SECURITY_VIOLATION/
        );

        await expect(adapter.processCheckout('order_123')).rejects.toThrow(
          /PRODUCTION_SECURITY_VIOLATION/
        );

        await expect(
          adapter.processDonation({
            amountCents: 5000,
            currency: 'USD',
            frequency: 'one_time',
            designation: 'test',
          })
        ).rejects.toThrow(/PRODUCTION_SECURITY_VIOLATION/);

        await expect(adapter.refundOrder('order_123')).rejects.toThrow(
          /PRODUCTION_SECURITY_VIOLATION/
        );
      } finally {
        (APP_CONFIG as any).isProduction = originalProd;
      }
    });

    it('confirms every disabled platform payment provider fails-closed upon unauthorized activation', async () => {
      const storeKit = new StoreKitAdapterStub();
      const googlePlay = new GooglePlayBillingAdapterStub();
      const stripeWeb = new StripeWebAdapterStub();

      // Apple StoreKit
      expect(storeKit.canPurchase('ios')).toBe(false);
      await expect(storeKit.initiateOrder('wb-1')).rejects.toThrow(/STORE_POLICY_RESTRICTION/);
      await expect(storeKit.processCheckout('order-1')).rejects.toThrow(/STORE_POLICY_RESTRICTION/);
      await expect(
        storeKit.processDonation({
          amountCents: 1000,
          currency: 'USD',
          frequency: 'one_time',
          designation: 'giving',
        })
      ).rejects.toThrow(/APPLE_POLICY_NOTICE/);

      // Google Play Billing
      expect(googlePlay.canPurchase('android')).toBe(false);
      await expect(googlePlay.initiateOrder('wb-1')).rejects.toThrow(/STORE_POLICY_RESTRICTION/);
      await expect(googlePlay.processCheckout('order-1')).rejects.toThrow(/STORE_POLICY_RESTRICTION/);
      await expect(
        googlePlay.processDonation({
          amountCents: 1000,
          currency: 'USD',
          frequency: 'one_time',
          designation: 'giving',
        })
      ).rejects.toThrow(/GOOGLE_PLAY_POLICY/);

      // Stripe Web
      expect(stripeWeb.canPurchase('web')).toBe(false);
      await expect(stripeWeb.initiateOrder('wb-1')).rejects.toThrow(/MERCHANT_ELIGIBILITY_ERROR/);
      await expect(stripeWeb.processCheckout('order-1')).rejects.toThrow(/MERCHANT_ELIGIBILITY_ERROR/);
      await expect(
        stripeWeb.processDonation({
          amountCents: 1000,
          currency: 'USD',
          frequency: 'one_time',
          designation: 'giving',
        })
      ).rejects.toThrow(/MERCHANT_ELIGIBILITY_ERROR/);
    });
  });

  describe('2. Account Isolation & Cross-Account Cache Segregation', () => {
    it('strictly isolates downloaded workbooks across different signed-in accounts and guest mode', async () => {
      const productId = '11111111-2222-3333-4444-555555555551';
      const userAId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const userBId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

      // 1. User A is signed in
      vi.spyOn(supabaseAuthService, 'getCurrentUser').mockReturnValue({
        id: userAId,
        email: 'userA@lifted.app',
      } as any);

      // User A fulfills and caches workbook
      await digitalDeliveryService.fulfillAndCacheWorkbook(
        productId,
        'wb-trauma-healing-v1',
        'Restoring the Broken',
        'synth_tok_user_a'
      );

      // User A can read their workbook
      expect(digitalDeliveryService.getDownloadedWorkbook(productId)).not.toBeNull();
      expect(digitalDeliveryService.getDownloadedWorkbook(productId)?.productTitle).toBe(
        'Restoring the Broken'
      );

      // 2. User A signs out -> active user reverts to null (Guest)
      vi.spyOn(supabaseAuthService, 'getCurrentUser').mockReturnValue(null);

      // Guest CANNOT see User A's workbook
      expect(digitalDeliveryService.getDownloadedWorkbook(productId)).toBeNull();

      // 3. User B signs in
      vi.spyOn(supabaseAuthService, 'getCurrentUser').mockReturnValue({
        id: userBId,
        email: 'userB@lifted.app',
      } as any);

      // User B CANNOT see User A's workbook
      expect(digitalDeliveryService.getDownloadedWorkbook(productId)).toBeNull();

      // 4. User A logs back in
      vi.spyOn(supabaseAuthService, 'getCurrentUser').mockReturnValue({
        id: userAId,
        email: 'userA@lifted.app',
      } as any);

      // User A's workbook is securely available again
      expect(digitalDeliveryService.getDownloadedWorkbook(productId)).not.toBeNull();
    });

    it('prohibits unentitled users from generating download tokens', async () => {
      vi.spyOn(supabaseAuthService, 'getCurrentUser').mockReturnValue({
        id: 'unentitled-user-uuid',
        email: 'guest@lifted.app',
      } as any);

      await expect(
        digitalDeliveryService.generateDownloadToken('11111111-2222-3333-4444-555555555553')
      ).rejects.toThrow(/PERMISSION_DENIED|permission denied/i);
    });
  });

  describe('3. Offline Revocation Safeguard', () => {
    it('prevents offline devices from falsely representing remote server revocation', () => {
      const productId = '11111111-2222-3333-4444-555555555551';

      // Mock offline network state
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);

      // Remote revocation attempt while offline must fail safely
      expect(() => {
        digitalDeliveryService.revokeDownloadedWorkbook(productId, true); // isRemoteRevocation = true
      }).toThrow(/OFFLINE_REVOCATION_ERROR/);
    });
  });

  describe('4. Crisis Safety & Platform Grounding', () => {
    it('provides verified Philippine emergency numbers and does not default to US 988 in the Philippines', () => {
      const phProfile = crisisDirectoryService.getProfileByCode('PH')!;
      expect(phProfile.emergencyNumber).toBe('911');

      const ncmhHotline = phProfile.resources.find((r) => r.id === 'ph-ncmh-landline');
      expect(ncmhHotline).toBeDefined();
      expect(ncmhHotline?.phoneNumber).toBe('1553');
      expect(ncmhHotline?.isTollFree).toBe(true);

      const hopeline = phProfile.resources.find((r) => r.id === 'ph-hopeline');
      expect(hopeline).toBeDefined();

      // US profile is separate and verified
      const usProfile = crisisDirectoryService.getProfileByCode('US')!;
      expect(usProfile.emergencyNumber).toBe('911');
      const us988 = usProfile.resources.find((r) => r.id === 'us-988-lifeline');
      expect(us988?.phoneNumber).toBe('988');
    });
  });

  describe('5. Invariants & Master Feature Matrix Verification', () => {
    it('enforces release invariant: Cloud Sync is OFF by default', () => {
      expect(APP_CONFIG.flags.enableCloudSync).toBe(false);
    });

    it('enforces release invariant: Gemini Cloud AI is OFF by default', () => {
      expect(APP_CONFIG.flags.enableCloudAi).toBe(false);
    });

    it('enforces release invariant: Strict OCC concurrency validation is enabled', () => {
      expect(APP_CONFIG.flags.enableStrictOcc).toBe(true);
    });
  });
});
