/**
 * LIFTED — Sync Safety Gates, Consent & Account Isolation Test Suite
 * Phase 8 Stage 1: Zero Unauthorized Upload & Multi-Account Partitioning
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

describe('Sync Safety Gates, Consent & Account Isolation', () => {
  let driver: IndexedDBDriver;
  let network: MockNetworkTelemetry;

  const sampleEnvelope: EncryptedPayload = {
    v: 1,
    iv: 'dGVzdElWMTIzNDU2',
    ct: 'ZW5jcnlwdGVkX2pvdXJuYWxfY29udGVudF8xMjM0NTY3ODk=',
  };

  beforeEach(async () => {
    driver = new IndexedDBDriver('lifted_test_gates_db');
    await driver.initialize();
    await driver.outbox.clear();
    network = new MockNetworkTelemetry();
  });

  afterEach(async () => {
    await driver.close();
  });

  it('1. Consent Gate: Strictly blocks processing if user has not opted into cloud sync', async () => {
    let consentGranted = false;
    const outbox = new OutboxManager(driver, network, {
      hasSyncConsent: () => consentGranted,
      isSanctuaryLocked: () => false,
      isKeyReady: () => true,
      getAppLifecycleState: () => 'active',
    });

    await outbox.enqueue({
      operationId: 'op-unauthorized-1',
      recordId: 'j-unauth-1',
      localUserId: 'guest-1',
      cloudUserId: null,
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'unauth-k1',
    });

    const transport = new SyntheticSyncTransport();
    const summary = await outbox.processPending(transport);

    expect(summary.skippedReason).toBe('NO_CONSENT');
    expect(summary.attempted).toBe(0);
    expect(transport.receivedOperations.length).toBe(0); // ZERO unauthorized uploads!

    // Grant consent and verify it now proceeds
    consentGranted = true;
    const summaryAfter = await outbox.processPending(transport);
    expect(summaryAfter.attempted).toBe(1);
    expect(summaryAfter.acknowledged).toBe(1);
    expect(transport.receivedOperations.length).toBe(1);
  });

  it('2. Sanctuary Privacy Lock Gate: Aborts sync immediately when Sanctuary Lock is engaged', async () => {
    let sanctuaryLocked = true;
    const outbox = new OutboxManager(driver, network, {
      hasSyncConsent: () => true,
      isSanctuaryLocked: () => sanctuaryLocked,
      isKeyReady: () => true,
      getAppLifecycleState: () => 'active',
    });

    await outbox.enqueue({
      operationId: 'op-locked-1',
      recordId: 'j-locked-1',
      localUserId: 'guest-1',
      cloudUserId: 'cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'lock-k1',
    });

    const transport = new SyntheticSyncTransport();
    const summary = await outbox.processPending(transport);

    expect(summary.skippedReason).toBe('SANCTUARY_LOCKED');
    expect(summary.attempted).toBe(0);
    expect(transport.receivedOperations.length).toBe(0);

    // Unlock sanctuary and verify it proceeds safely
    sanctuaryLocked = false;
    const summaryUnlocked = await outbox.processPending(transport);
    expect(summaryUnlocked.attempted).toBe(1);
    expect(summaryUnlocked.acknowledged).toBe(1);
  });

  it('3. Network Offline & Unverified Gate: Blocks sync when network is offline or unverified', async () => {
    const outbox = new OutboxManager(driver, network, {
      hasSyncConsent: () => true,
      isSanctuaryLocked: () => false,
      isKeyReady: () => true,
      getAppLifecycleState: () => 'active',
    });

    await outbox.enqueue({
      operationId: 'op-net-1',
      recordId: 'j-net-1',
      localUserId: 'guest-1',
      cloudUserId: 'cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'net-k1',
    });

    const transport = new SyntheticSyncTransport();

    // 1. OFFLINE
    network.state = 'OFFLINE';
    network.connected = false;
    const summaryOffline = await outbox.processPending(transport);
    expect(summaryOffline.skippedReason).toBe('OFFLINE');
    expect(transport.receivedOperations.length).toBe(0);

    // 2. CONNECTED_UNVERIFIED (e.g. captive portal / hotel Wi-Fi)
    // Invariant: CONNECTED_UNVERIFIED must NOT be treated as guaranteed remote reachability!
    network.state = 'CONNECTED_UNVERIFIED';
    network.connected = true;
    const summaryUnverified = await outbox.processPending(transport);
    expect(summaryUnverified.skippedReason).toBe('UNVERIFIED_NETWORK');
    expect(transport.receivedOperations.length).toBe(0);

    // 3. ONLINE_REACHABLE
    network.state = 'ONLINE_REACHABLE';
    const summaryOnline = await outbox.processPending(transport);
    expect(summaryOnline.attempted).toBe(1);
    expect(summaryOnline.acknowledged).toBe(1);
    expect(transport.receivedOperations.length).toBe(1);
  });

  it('4. Lifecycle Gate: Suspends processing when app is backgrounded or inactive', async () => {
    let lifecycleState: 'active' | 'background' | 'inactive' = 'background';
    const outbox = new OutboxManager(driver, network, {
      hasSyncConsent: () => true,
      isSanctuaryLocked: () => false,
      isKeyReady: () => true,
      getAppLifecycleState: () => lifecycleState,
    });

    await outbox.enqueue({
      operationId: 'op-bg-1',
      recordId: 'j-bg-1',
      localUserId: 'guest-1',
      cloudUserId: 'cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'bg-k1',
    });

    const transport = new SyntheticSyncTransport();

    // Backgrounded state
    const summaryBg = await outbox.processPending(transport);
    expect(summaryBg.skippedReason).toBe('LIFECYCLE_SUSPENDED');
    expect(transport.receivedOperations.length).toBe(0);

    // Inactive state (e.g. app switcher / phone call)
    lifecycleState = 'inactive';
    const summaryInactive = await outbox.processPending(transport);
    expect(summaryInactive.skippedReason).toBe('LIFECYCLE_SUSPENDED');

    // Foreground active
    lifecycleState = 'active';
    const summaryActive = await outbox.processPending(transport);
    expect(summaryActive.attempted).toBe(1);
    expect(summaryActive.acknowledged).toBe(1);
  });

  it('5. Encryption Prerequisite Gate: Aborts if DEK or encryption key is missing', async () => {
    let keyReady = false;
    const outbox = new OutboxManager(driver, network, {
      hasSyncConsent: () => true,
      isSanctuaryLocked: () => false,
      isKeyReady: () => keyReady,
      getAppLifecycleState: () => 'active',
    });

    await outbox.enqueue({
      operationId: 'op-key-1',
      recordId: 'j-key-1',
      localUserId: 'guest-1',
      cloudUserId: 'cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'key-k1',
    });

    const transport = new SyntheticSyncTransport();
    const summary = await outbox.processPending(transport);
    expect(summary.skippedReason).toBe('KEY_MISSING');
    expect(transport.receivedOperations.length).toBe(0);
  });

  it('6. Cross-Account Isolation: Partitions outbox items by cloud account ID', async () => {
    const outbox = new OutboxManager(driver, network, {
      hasSyncConsent: () => true,
      isSanctuaryLocked: () => false,
      isKeyReady: () => true,
      getAppLifecycleState: () => 'active',
    });

    // Enqueue operation for Account Alice
    await outbox.enqueue({
      operationId: 'op-alice-1',
      recordId: 'j-alice-1',
      localUserId: 'guest-1',
      cloudUserId: 'user-alice-uuid',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'alice-k1',
    });

    // Enqueue operation for Account Bob on same device
    await outbox.enqueue({
      operationId: 'op-bob-1',
      recordId: 'j-bob-1',
      localUserId: 'guest-1',
      cloudUserId: 'user-bob-uuid',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 2000,
      idempotencyKey: 'bob-k1',
    });

    const aliceOps = await outbox.getOperationsForAccount('user-alice-uuid');
    expect(aliceOps.length).toBe(1);
    expect(aliceOps[0].operationId).toBe('op-alice-1');

    const bobOps = await outbox.getOperationsForAccount('user-bob-uuid');
    expect(bobOps.length).toBe(1);
    expect(bobOps[0].operationId).toBe('op-bob-1');

    // When Alice signs out and requests cloud cleanup, Bob's operations are preserved
    const removedAlice = await outbox.clearOperationsForAccount('user-alice-uuid');
    expect(removedAlice).toBe(1);

    expect(await outbox.getOperationsForAccount('user-alice-uuid')).toHaveLength(0);
    expect(await outbox.getOperationsForAccount('user-bob-uuid')).toHaveLength(1);
  });
});
