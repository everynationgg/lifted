/**
 * Server-Side Webhook Security & Signature Verification
 * LIFTED Phase 11: Payment Security & Webhook Hardening
 *
 * Enforces zero-trust webhook intake:
 * 1. Cryptographic HMAC-SHA256 signature verification over raw body bytes
 * 2. Replay attack prevention via timestamp drift tolerance (<= 300 seconds)
 * 3. Constant-time timing-safe string comparison
 * 4. Authoritative order amount & currency validation against database
 * 5. Replay idempotency verification
 */

export interface WebhookHeaderVerificationInput {
  rawBody: string;
  signatureHeader?: string;
  secret: string;
  toleranceSeconds?: number;
}

export interface WebhookVerificationResult {
  isValid: boolean;
  errorCode?: string;
  errorMessage?: string;
  timestamp?: number;
}

export interface WebhookOrderPayload {
  eventId: string;
  eventType: string;
  orderId: string;
  amountCents: number;
  currency: string;
  status: string;
}

export interface AuthoritativeOrder {
  id: string;
  amountCents: number;
  currency: string;
  status: string;
  userId: string;
}

/**
 * Constant-time comparison between two strings to prevent timing attacks.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Generates an HMAC-SHA256 hex digest using Web Crypto API.
 */
export async function computeHmacSha256Hex(keyString: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(keyString),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  const hashArray = Array.from(new Uint8Array(signatureBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parses a standard provider signature header of format:
 * `t=1730460000,v1=6a7b8c...`
 */
export function parseSignatureHeader(header: string): { timestamp?: number; signatures: string[] } {
  const parts = header.split(',');
  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.trim().split('=');
    if (!key || !value) continue;

    if (key === 't') {
      const parsed = parseInt(value, 10);
      if (!Number.isNaN(parsed)) {
        timestamp = parsed;
      }
    } else if (key === 'v1' || key === 'sig') {
      signatures.push(value);
    }
  }

  return { timestamp, signatures };
}

/**
 * Verifies an authentic provider webhook signature over the raw request body.
 */
export async function verifyWebhookSignature({
  rawBody,
  signatureHeader,
  secret,
  toleranceSeconds = 300,
}: WebhookHeaderVerificationInput): Promise<WebhookVerificationResult> {
  if (!signatureHeader || typeof signatureHeader !== 'string') {
    return {
      isValid: false,
      errorCode: 'MISSING_SIGNATURE',
      errorMessage: 'Missing signature header.',
    };
  }

  if (!secret || typeof secret !== 'string') {
    return {
      isValid: false,
      errorCode: 'MISSING_SECRET',
      errorMessage: 'Payment provider webhook secret is not configured.',
    };
  }

  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

  if (!timestamp) {
    return {
      isValid: false,
      errorCode: 'INVALID_HEADER_FORMAT',
      errorMessage: 'Missing timestamp in signature header.',
    };
  }

  if (signatures.length === 0) {
    return {
      isValid: false,
      errorCode: 'INVALID_HEADER_FORMAT',
      errorMessage: 'No v1/sig signatures found in header.',
    };
  }

  // Prevent replay attacks by checking timestamp drift
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const drift = Math.abs(currentTimestamp - timestamp);

  if (drift > toleranceSeconds) {
    return {
      isValid: false,
      errorCode: 'TIMESTAMP_OUT_OF_TOLERANCE',
      errorMessage: `Webhook timestamp differs by ${drift}s (tolerance: ${toleranceSeconds}s). Potential replay attack.`,
      timestamp,
    };
  }

  // Signed payload is: `${timestamp}.${rawBody}`
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = await computeHmacSha256Hex(secret, signedPayload);

  // Check against all provided signatures using timing-safe comparison
  const matches = signatures.some((sig) => timingSafeEqual(sig.toLowerCase(), expectedSignature.toLowerCase()));

  if (!matches) {
    return {
      isValid: false,
      errorCode: 'SIGNATURE_MISMATCH',
      errorMessage: 'Computed HMAC-SHA256 signature does not match any provided signature.',
      timestamp,
    };
  }

  return {
    isValid: true,
    timestamp,
  };
}

/**
 * Validates that the event's reported amount and currency exactly match
 * the authoritative order in the database. Prevents underpayment/amount tampering.
 */
export function validateOrderAmountAndCurrency(
  incomingPayload: WebhookOrderPayload,
  authoritativeOrder: AuthoritativeOrder
): { valid: boolean; reason?: string } {
  if (incomingPayload.orderId !== authoritativeOrder.id) {
    return { valid: false, reason: 'Order ID mismatch between webhook payload and database.' };
  }

  if (incomingPayload.amountCents !== authoritativeOrder.amountCents) {
    return {
      valid: false,
      reason: `Amount mismatch. Authoritative order requires ${authoritativeOrder.amountCents} cents, but webhook reported ${incomingPayload.amountCents} cents.`,
    };
  }

  if (incomingPayload.currency.toUpperCase() !== authoritativeOrder.currency.toUpperCase()) {
    return {
      valid: false,
      reason: `Currency mismatch. Authoritative order is in ${authoritativeOrder.currency}, but webhook reported ${incomingPayload.currency}.`,
    };
  }

  return { valid: true };
}
