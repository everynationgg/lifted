/**
 * LIFTED — Synthetic Sync Transport
 * Phase 8 Stage 1: Isolated In-Memory Transport for Non-Production Testing
 *
 * Simulates remote cloud synchronization responses, HTTP error codes,
 * network delays, and conflict conditions without any real network traffic
 * or live Supabase calls.
 */

import type { OutboxStorageRecord, ISyncTransport, SyncTransportResponse } from './types';

export interface SyntheticTransportConfig {
  simulateOffline?: boolean;
  simulateUnauthorized?: boolean;
  simulateRateLimit?: boolean;
  simulateServerError?: boolean;
  simulateRevisionConflict?: boolean;
  latencyMs?: number;
  maxServerRevision?: number;
}

export class SyntheticSyncTransport implements ISyncTransport {
  config: SyntheticTransportConfig;
  readonly receivedOperations: OutboxStorageRecord[] = [];
  private serverRevision = 1;

  constructor(config: SyntheticTransportConfig = {}) {
    this.config = config;
    this.serverRevision = config.maxServerRevision ?? 1;
  }

  async pushOperation(op: OutboxStorageRecord): Promise<SyncTransportResponse> {
    if (this.config.latencyMs && this.config.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.config.latencyMs));
    }

    // STRICT SECURITY AUDIT: Verify that payload is an encrypted envelope and NEVER plaintext!
    if (!op.encryptedEnvelope || !op.encryptedEnvelope.iv || !op.encryptedEnvelope.ct) {
      throw new Error('SECURITY_VIOLATION: Outbox operation does not contain a valid encrypted envelope!');
    }

    // 1. Simulate Offline
    if (this.config.simulateOffline) {
      return {
        success: false,
        operationId: op.operationId,
        errorCategory: 'NETWORK_OFFLINE',
        errorMessage: 'Simulated network offline condition.',
      };
    }

    // 2. Simulate 401 Unauthorized
    if (this.config.simulateUnauthorized) {
      return {
        success: false,
        operationId: op.operationId,
        errorCategory: 'AUTH_UNAUTHORIZED',
        errorMessage: 'Simulated expired or invalid session token (401).',
      };
    }

    // 3. Simulate 429 Rate Limit
    if (this.config.simulateRateLimit) {
      return {
        success: false,
        operationId: op.operationId,
        errorCategory: 'RATE_LIMITED',
        errorMessage: 'Simulated 429 Too Many Requests.',
      };
    }

    // 4. Simulate 500 Server Error
    if (this.config.simulateServerError) {
      return {
        success: false,
        operationId: op.operationId,
        errorCategory: 'SERVER_ERROR',
        errorMessage: 'Simulated 500 Internal Server Error.',
      };
    }

    // 5. Simulate 409 Conflict
    if (this.config.simulateRevisionConflict) {
      return {
        success: false,
        operationId: op.operationId,
        errorCategory: 'CONFLICT',
        isConflict: true,
        errorMessage: 'Simulated remote revision conflict: base revision is outdated.',
      };
    }

    // 6. Success: record operation and increment synthetic server revision
    this.receivedOperations.push({ ...op });
    this.serverRevision++;

    return {
      success: true,
      operationId: op.operationId,
      acknowledgedRevision: this.serverRevision,
    };
  }

  clear(): void {
    this.receivedOperations.length = 0;
  }
}
