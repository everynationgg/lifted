import { describe, it, expect } from 'vitest';
import {
  verifyWebhookSignature,
  computeHmacSha256Hex,
  timingSafeEqual,
  parseSignatureHeader,
  validateOrderAmountAndCurrency,
  type AuthoritativeOrder,
  type WebhookOrderPayload,
} from '../webhookSecurity';

describe('Server-Side Webhook Security & Signature Verification', () => {
  const TEST_SECRET = 'whsec_test_secret_key_super_secure_987654321';

  describe('timingSafeEqual', () => {
    it('returns true for identical strings', () => {
      expect(timingSafeEqual('abcdef123456', 'abcdef123456')).toBe(true);
      expect(timingSafeEqual('', '')).toBe(true);
    });

    it('returns false for different strings of same length', () => {
      expect(timingSafeEqual('abcdef123456', 'abcdef123457')).toBe(false);
    });

    it('returns false for strings of different length', () => {
      expect(timingSafeEqual('abcdef', 'abcdef123456')).toBe(false);
    });
  });

  describe('parseSignatureHeader', () => {
    it('correctly parses timestamp and v1 signatures', () => {
      const header = 't=1730460000,v1=abc123def456,v1=789xyz';
      const parsed = parseSignatureHeader(header);
      expect(parsed.timestamp).toBe(1730460000);
      expect(parsed.signatures).toEqual(['abc123def456', '789xyz']);
    });

    it('handles alternative sig= key', () => {
      const header = 't=1730460000,sig=my_hmac_hex_hash';
      const parsed = parseSignatureHeader(header);
      expect(parsed.timestamp).toBe(1730460000);
      expect(parsed.signatures).toEqual(['my_hmac_hex_hash']);
    });

    it('handles empty or malformed headers gracefully', () => {
      expect(parseSignatureHeader('')).toEqual({ timestamp: undefined, signatures: [] });
      expect(parseSignatureHeader('malformed_without_equals')).toEqual({ timestamp: undefined, signatures: [] });
    });
  });

  describe('verifyWebhookSignature', () => {
    it('successfully verifies authentic HMAC-SHA256 signature with matching raw body', async () => {
      const rawBody = JSON.stringify({
        id: 'evt_123',
        type: 'payment_intent.succeeded',
        amount: 1499,
        currency: 'usd',
      });
      const now = Math.floor(Date.now() / 1000);
      const signedPayload = `${now}.${rawBody}`;
      const validSignature = await computeHmacSha256Hex(TEST_SECRET, signedPayload);
      const signatureHeader = `t=${now},v1=${validSignature}`;

      const result = await verifyWebhookSignature({
        rawBody,
        signatureHeader,
        secret: TEST_SECRET,
        toleranceSeconds: 300,
      });

      expect(result.isValid).toBe(true);
      expect(result.timestamp).toBe(now);
      expect(result.errorCode).toBeUndefined();
    });

    it('rejects forged webhook signatures', async () => {
      const rawBody = '{"id":"evt_forged"}';
      const now = Math.floor(Date.now() / 1000);
      const signatureHeader = `t=${now},v1=deadbeef00112233445566778899aabbccddeeff`;

      const result = await verifyWebhookSignature({
        rawBody,
        signatureHeader,
        secret: TEST_SECRET,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('SIGNATURE_MISMATCH');
    });

    it('rejects tampered raw body bytes even when signature is otherwise well-formed', async () => {
      const originalBody = '{"amount": 1499}';
      const now = Math.floor(Date.now() / 1000);
      const validSignature = await computeHmacSha256Hex(TEST_SECRET, `${now}.${originalBody}`);
      const signatureHeader = `t=${now},v1=${validSignature}`;

      // Attacker tampers body to reduce payment amount to 100 cents
      const tamperedBody = '{"amount": 100}';

      const result = await verifyWebhookSignature({
        rawBody: tamperedBody,
        signatureHeader,
        secret: TEST_SECRET,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('SIGNATURE_MISMATCH');
    });

    it('rejects replayed webhook events with timestamps outside tolerance window', async () => {
      const rawBody = '{"event":"replayed"}';
      // 10 minutes ago (600 seconds)
      const staleTimestamp = Math.floor(Date.now() / 1000) - 600;
      const signature = await computeHmacSha256Hex(TEST_SECRET, `${staleTimestamp}.${rawBody}`);
      const signatureHeader = `t=${staleTimestamp},v1=${signature}`;

      const result = await verifyWebhookSignature({
        rawBody,
        signatureHeader,
        secret: TEST_SECRET,
        toleranceSeconds: 300, // 5 min tolerance
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('TIMESTAMP_OUT_OF_TOLERANCE');
    });

    it('rejects missing or empty signature header', async () => {
      const result = await verifyWebhookSignature({
        rawBody: '{}',
        signatureHeader: '',
        secret: TEST_SECRET,
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('MISSING_SIGNATURE');
    });

    it('rejects missing secret', async () => {
      const result = await verifyWebhookSignature({
        rawBody: '{}',
        signatureHeader: 't=123,v1=abc',
        secret: '',
      });

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('MISSING_SECRET');
    });
  });

  describe('validateOrderAmountAndCurrency', () => {
    const authoritativeOrder: AuthoritativeOrder = {
      id: 'ord_authoritative_uuid_01',
      amountCents: 1499,
      currency: 'USD',
      status: 'pending',
      userId: 'usr_buyer_1',
    };

    it('approves exact amount and currency match', () => {
      const payload: WebhookOrderPayload = {
        eventId: 'evt_valid_1',
        eventType: 'payment.succeeded',
        orderId: 'ord_authoritative_uuid_01',
        amountCents: 1499,
        currency: 'USD',
        status: 'succeeded',
      };

      const result = validateOrderAmountAndCurrency(payload, authoritativeOrder);
      expect(result.valid).toBe(true);
    });

    it('rejects underpayment or amount mismatch', () => {
      const payload: WebhookOrderPayload = {
        eventId: 'evt_underpaid',
        eventType: 'payment.succeeded',
        orderId: 'ord_authoritative_uuid_01',
        amountCents: 500, // Underpaid ($5.00 instead of $14.99)
        currency: 'USD',
        status: 'succeeded',
      };

      const result = validateOrderAmountAndCurrency(payload, authoritativeOrder);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Amount mismatch');
    });

    it('rejects currency mismatch', () => {
      const payload: WebhookOrderPayload = {
        eventId: 'evt_wrong_curr',
        eventType: 'payment.succeeded',
        orderId: 'ord_authoritative_uuid_01',
        amountCents: 1499,
        currency: 'EUR', // Wrong currency
        status: 'succeeded',
      };

      const result = validateOrderAmountAndCurrency(payload, authoritativeOrder);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Currency mismatch');
    });

    it('rejects order ID mismatch', () => {
      const payload: WebhookOrderPayload = {
        eventId: 'evt_wrong_id',
        eventType: 'payment.succeeded',
        orderId: 'ord_different_uuid_99',
        amountCents: 1499,
        currency: 'USD',
        status: 'succeeded',
      };

      const result = validateOrderAmountAndCurrency(payload, authoritativeOrder);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Order ID mismatch');
    });
  });
});
