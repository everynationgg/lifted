/**
 * LIFTED — Tombstone & Deletion Semantics Test Suite
 * Phase 8 Stage 1: Deletion Invariants & Anti-Resurrection Protection
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBDriver } from '../../storage/databaseDriver';
import { TombstoneManager } from '../tombstoneManager';

describe('Tombstone & Deletion Semantics', () => {
  let driver: IndexedDBDriver;
  let tombstones: TombstoneManager;

  beforeEach(async () => {
    driver = new IndexedDBDriver('lifted_test_tombstones_db');
    await driver.initialize();
    tombstones = new TombstoneManager(driver);
    await tombstones.clear();
  });

  afterEach(async () => {
    await driver.close();
  });

  it('1. Records a tombstone durably upon record deletion', async () => {
    const deleted = await tombstones.recordTombstone(
      'journal-del-1',
      'journal',
      3,
      'cloud-user-123',
      1000
    );

    expect(deleted.recordId).toBe('journal-del-1');
    expect(deleted.revision).toBe(3);
    expect(deleted.cloudUserId).toBe('cloud-user-123');

    const isMarked = await tombstones.isTombstoned('journal-del-1');
    expect(isMarked).toBe(true);

    const fetched = await tombstones.getTombstone('journal-del-1');
    expect(fetched?.recordType).toBe('journal');
    expect(fetched?.deletedAt).toBe(1000);
  });

  it('2. Anti-Resurrection Invariant: Stale incoming update with revision <= tombstone revision is strictly rejected', async () => {
    await tombstones.recordTombstone(
      'prayer-del-1',
      'prayer',
      5,
      'cloud-user-123',
      1000
    );

    // Stale update from offline device with revision 4 (older) -> REJECT
    const rejectStale = await tombstones.shouldRejectIncomingUpdate('prayer-del-1', 4);
    expect(rejectStale).toBe(true);

    // Stale update from concurrent device with revision 5 (same) -> REJECT
    const rejectSame = await tombstones.shouldRejectIncomingUpdate('prayer-del-1', 5);
    expect(rejectSame).toBe(true);
  });

  it('3. Re-creation Invariant: Stale update with higher revision is rejected; ONLY explicit user-authorized restore allows re-creation', async () => {
    await tombstones.recordTombstone(
      'prayer-del-2',
      'prayer',
      5,
      'cloud-user-123',
      1000
    );

    // Stale update with revision 6 from a device offline for 90 days is STILL REJECTED (anti-resurrection)
    const rejectHigherRevision = await tombstones.shouldRejectIncomingUpdate('prayer-del-2', 6, false);
    expect(rejectHigherRevision).toBe(true);

    // Explicit user-authorized restore allows intentional re-creation
    const allowExplicitRestore = await tombstones.shouldRejectIncomingUpdate('prayer-del-2', 6, true);
    expect(allowExplicitRestore).toBe(false);

    // Tombstone is cleared once restored
    expect(await tombstones.isTombstoned('prayer-del-2')).toBe(false);
  });

  it('4. Safe Deletion Pruning: Tombstones are NOT pruned by elapsed wall-clock time, but only when all active devices acknowledge', async () => {
    const activeEnrolledDevices = ['device-phone-1', 'device-tablet-2'];

    await tombstones.recordTombstone('safe-del-1', 'journal', 2, 'user-1', 1000);

    // Device 1 acknowledges deletion
    await tombstones.acknowledgeDevice('safe-del-1', 'device-phone-1');

    // Only 1 of 2 devices acknowledged: MUST NOT prune yet (protects tablet offline for 365 days!)
    let pruned = await tombstones.pruneAcknowledgedTombstones(activeEnrolledDevices);
    expect(pruned).toBe(0);
    expect(await tombstones.isTombstoned('safe-del-1')).toBe(true);

    // Device 2 acknowledges deletion
    await tombstones.acknowledgeDevice('safe-del-1', 'device-tablet-2');

    // All active devices acknowledged: safely prune!
    pruned = await tombstones.pruneAcknowledgedTombstones(activeEnrolledDevices);
    expect(pruned).toBe(1);
    expect(await tombstones.isTombstoned('safe-del-1')).toBe(false);
  });

  it('5. Survives driver restart and re-loads persisted ledger', async () => {
    await tombstones.recordTombstone('persist-test-1', 'mood', 4, 'user-1', 5000);

    // Create a new TombstoneManager instance referencing the same driver
    const newManager = new TombstoneManager(driver);
    expect(await newManager.isTombstoned('persist-test-1')).toBe(true);
    const item = await newManager.getTombstone('persist-test-1');
    expect(item?.revision).toBe(4);
  });
});
