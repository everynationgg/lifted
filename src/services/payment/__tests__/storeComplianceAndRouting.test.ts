import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PaymentRouter } from '../PaymentRouter';
import { Capacitor } from '@capacitor/core';
import { StoreKitAdapterStub } from '../StoreKitAdapterStub';
import { GooglePlayBillingAdapterStub } from '../GooglePlayBillingAdapterStub';

describe('PaymentRouter & Mobile Store Compliance', () => {
  let router: PaymentRouter;

  beforeEach(() => {
    router = new PaymentRouter();
    vi.restoreAllMocks();
  });

  describe('Synthetic Sandbox Simulator Mode', () => {
    it('defaults to synthetic sandbox simulator mode in test/development', () => {
      expect(router.isSimulatorMode()).toBe(true);
      const adapter = router.getAdapter();
      expect(adapter.providerId).toBe('synthetic');
      expect(adapter.isSynthetic).toBe(true);
    });

    it('provides clear sandbox compliance notice', () => {
      const notice = router.getComplianceNotice('web');
      expect(notice.isPurchaseEnabled).toBe(true);
      expect(notice.complianceRule).toBe('SANDBOX_SIMULATOR_ONLY');
      expect(notice.noticeTitle).toContain('Synthetic Development Sandbox');
    });
  });

  describe('iOS Store Compliance (Apple App Store Review Guidelines)', () => {
    it('enforces Guideline 3.1.1 (StoreKit required; external web checkout prohibited)', async () => {
      router.setSimulatorMode(false);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('ios');

      const adapter = router.getAdapter();
      expect(adapter.providerId).toBe('apple_iap');

      // Live purchases are disabled pending Apple Developer Program merchant setup
      expect(adapter.canPurchase('ios')).toBe(false);

      const notice = router.getComplianceNotice('ios');
      expect(notice.complianceRule).toBe('APPLE_APP_STORE_GUIDELINE_3_1_1');
      expect(notice.noticeDescription).toContain('Apple In-App Purchase (StoreKit)');
      expect(notice.noticeDescription).toContain('External web checkout links are strictly prohibited');

      // Attempting to initiate live order throws store policy restriction
      await expect(adapter.initiateOrder('wb-1')).rejects.toThrow('STORE_POLICY_RESTRICTION');
    });

    it('enforces Guideline 3.2.2(iv) (Charitable contributions cannot use StoreKit)', async () => {
      const storeKit = new StoreKitAdapterStub();
      await expect(
        storeKit.processDonation({
          amountCents: 2500,
          currency: 'USD',
          frequency: 'one_time',
          designation: 'crisis_ministry',
        })
      ).rejects.toThrow('APPLE_POLICY_NOTICE');
    });
  });

  describe('Android Store Compliance (Google Play Billing Policies)', () => {
    it('enforces Google Play Billing for in-app digital goods', async () => {
      router.setSimulatorMode(false);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');

      const adapter = router.getAdapter();
      expect(adapter.providerId).toBe('google_play');
      expect(adapter.canPurchase('android')).toBe(false);

      const notice = router.getComplianceNotice('android');
      expect(notice.complianceRule).toBe('GOOGLE_PLAY_BILLING_POLICY');
      expect(notice.noticeDescription).toContain('Google Play Billing');

      await expect(adapter.initiateOrder('wb-1')).rejects.toThrow('STORE_POLICY_RESTRICTION');
    });

    it('enforces Play policy exception for charitable donations via web', async () => {
      const googlePlay = new GooglePlayBillingAdapterStub();
      await expect(
        googlePlay.processDonation({
          amountCents: 2500,
          currency: 'USD',
          frequency: 'one_time',
          designation: 'general_healing_ministry',
        })
      ).rejects.toThrow('GOOGLE_PLAY_POLICY');
    });
  });

  describe('Web Checkout Compliance & Merchant Eligibility', () => {
    it('enforces merchant eligibility notice for Philippine corporate entity', async () => {
      router.setSimulatorMode(false);
      vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('web');

      const adapter = router.getAdapter();
      expect(adapter.providerId).toBe('stripe_web');
      expect(adapter.canPurchase('web')).toBe(false);

      const notice = router.getComplianceNotice('web');
      expect(notice.complianceRule).toBe('MERCHANT_ELIGIBILITY_REQUIREMENT');
      expect(notice.noticeDescription).toContain('Philippines');

      await expect(adapter.initiateOrder('wb-1')).rejects.toThrow('MERCHANT_ELIGIBILITY_ERROR');
    });
  });
});
