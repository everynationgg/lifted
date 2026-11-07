/**
 * LIFTED — Outbox Retry, Exponential Backoff & Jitter Test Suite
 * Phase 8 Stage 1: Error Handling, Bounded Retries & Thundering Herd Defense
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBDriver } from '../../storage/databaseDriver';
import { OutboxManager } from '../outboxManager';
import { SyntheticSyncTransport } from '../syntheticTransport';
import type { INetworkTelemetryService, NetworkTelemetrySnapshot, NetworkState } from '../../services/networkService';
import type { EncryptedPayload } from '../../storage/types';

class MockNetworkTelemetry implements INetworkTelemetryService {
  state: NetworkState = 'ONLINE_REACHABLE';
  connected = true;

  isConnected(): boolean { return this.connected; }
  getState(): NetworkState { return this.state; }
  getSnapshot(): NetworkTelemetrySnapshot {
    return {
      state: this.state,
      connected: this.connected,
      connectionType: 'wifi',
      isReachable: this.connected,
      lastCheckedTimestamp: Date.now(),
    };
  }
  subscribe(): () => void { return () => {}; }
}

describe('Outbox Retry, Exponential Backoff & Jitter', () => {
  let driver: IndexedDBDriver;
  let network: MockNetworkTelemetry;
  let outbox: OutboxManager;

  const sampleEnvelope: EncryptedPayload = {
    v: 1,
    iv: 'dGVzdElWMTIzNDU2',
    ct: 'ZW5jcnlwdGVkX2pvdXJuYWxfY29udGVudF8xMjM0NTY3ODk=',
  };

  beforeEach(async () => {
    driver = new IndexedDBDriver('lifted_test_retry_db');
    await driver.initialize();
    await driver.outbox.clear();

    network = new MockNetworkTelemetry();
    outbox = new OutboxManager(driver, network, {
      maxRetries: 5,
      baseDelayMs: 1000,
      maxDelayMs: 60000,
      hasSyncConsent: () => true,
      isSanctuaryLocked: () => false,
      isKeyReady: () => true,
      getAppLifecycleState: () => 'active',
    });
  });

  afterEach(async () => {
    await driver.close();
  });

  it('1. Calculates exponential backoff bounded by maxDelayMs with non-negative jitter', () => {
    // Attempt 1: 1000ms * 2^1 = 2000ms max
    for (let i = 0; i < 50; i++) {
      const backoff1 = outbox.calculateNextBackoff(1);
      expect(backoff1).toBeGreaterThanOrEqual(0);
      expect(backoff1).toBeLessThanOrEqual(2000);
    }

    // Attempt 2: 1000ms * 2^2 = 4000ms max
    for (let i = 0; i < 50; i++) {
      const backoff2 = outbox.calculateNextBackoff(2);
      expect(backoff2).toBeGreaterThanOrEqual(0);
      expect(backoff2).toBeLessThanOrEqual(4000);
    }

    // Attempt 10: clamped to maxDelayMs (60000ms)
    for (let i = 0; i < 50; i++) {
      const backoff10 = outbox.calculateNextBackoff(10);
      expect(backoff10).toBeGreaterThanOrEqual(0);
      expect(backoff10).toBeLessThanOrEqual(60000);
    }
  });

  it('2. Retries on simulated 500 Server Error and computes nextAttemptAt timestamp', async () => {
    await outbox.enqueue({
      operationId: 'op-retry-1',
      recordId: 'journal-retry-1',
      localUserId: 'guest-1',
      cloudUserId: 'cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'retry-k1',
    });

    const failingTransport = new SyntheticSyncTransport({ simulateServerError: true });
    const now = 5000;
    const summary = await outbox.processPending(failingTransport, now);

    expect(summary.attempted).toBe(1);
    expect(summary.acknowledged).toBe(0);
    expect(summary.failed).toBe(1);

    const updated = await driver.outbox.get('op-retry-1');
    expect(updated?.status).toBe('pending');
    expect(updated?.retryCount).toBe(1);
    expect(updated?.lastErrorCategory).toBe('SERVER_ERROR');
    expect(updated?.lastAttemptAt).toBe(now);
    expect(updated?.nextAttemptAt).toBeGreaterThanOrEqual(now);
  });

  it('3. Bounded Retries: Transitions to status "failed" after exceeding maxRetries (5)', async () => {
    await outbox.enqueue({
      operationId: 'op-max-retry',
      recordId: 'journal-max-retry',
      localUserId: 'guest-1',
      cloudUserId: 'cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'max-k1',
    });

    const failingTransport = new SyntheticSyncTransport({ simulateServerError: true });

    // Execute 5 sequential failed attempts
    let currentTime = 10000;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const summary = await outbox.processPending(failingTransport, currentTime);
      expect(summary.failed).toBe(1);

      const op = await driver.outbox.get('op-max-retry');
      expect(op?.retryCount).toBe(attempt);

      if (attempt < 5) {
        expect(op?.status).toBe('pending');
        // Advance clock past the backoff window
        currentTime = (op?.nextAttemptAt || currentTime) + 10;
      } else {
        // 5th failure trips terminal 'failed' status
        expect(op?.status).toBe('failed');
        expect(op?.nextAttemptAt).toBeNull();
      }
    }

    // A 6th attempt should NOT process the terminal failed item
    const summary6 = await outbox.processPending(failingTransport, currentTime + 1000);
    expect(summary6.attempted).toBe(0);
  });

  it('4. Handles simulated 429 Rate Limit error by recording category and scheduling backoff', async () => {
    await outbox.enqueue({
      operationId: 'op-rate-limited',
      recordId: 'journal-rl',
      localUserId: 'guest-1',
      cloudUserId: 'cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'rl-k1',
    });

    const rateLimitTransport = new SyntheticSyncTransport({ simulateRateLimit: true });
    const now = 2000;
    const summary = await outbox.processPending(rateLimitTransport, now);

    expect(summary.failed).toBe(1);
    const item = await driver.outbox.get('op-rate-limited');
    expect(item?.lastErrorCategory).toBe('RATE_LIMITED');
    expect(item?.retryCount).toBe(1);
  });

  it('5. Successfully transitions to acknowledged on successful synthetic transport response', async () => {
    await outbox.enqueue({
      operationId: 'op-success-1',
      recordId: 'journal-success',
      localUserId: 'guest-1',
      cloudUserId: 'cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'succ-k1',
    });

    const healthyTransport = new SyntheticSyncTransport();
    const summary = await outbox.processPending(healthyTransport, 3000);

    expect(summary.attempted).toBe(1);
    expect(summary.acknowledged).toBe(1);
    expect(summary.failed).toBe(0);

    const item = await driver.outbox.get('op-success-1');
    expect(item?.status).toBe('acknowledged');
    expect(item?.retryCount).toBe(0);
    expect(item?.nextAttemptAt).toBeNull();
    expect(healthyTransport.receivedOperations.length).toBe(1);
  });
});
