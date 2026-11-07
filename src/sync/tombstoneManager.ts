/**
 * LIFTED — Tombstone Manager
 * Phase 8 Stage 1/2: Deletion Semantics & Authoritative Anti-Resurrection Invariants
 *
 * Persists record deletions as tombstones to guarantee that stale remote or local
 * operations never resurrect records intentionally deleted by the user.
 *
 * Anti-Resurrection Rules:
 * 1. NO automatic pruning purely because a wall-clock duration elapsed (e.g. 30 days).
 * 2. Stale updates (even with higher revisions from long-offline devices) are REJECTED.
 * 3. Legitimate re-creation requires an explicit, authenticated user restoration action.
 * 4. Safe pruning occurs ONLY when all active enrolled devices have acknowledged the deletion,
 *    or when an inactive device is explicitly retired.
 */

import type { IDatabaseDriver } from '../storage/databaseDriver';
import type { OutboxRecordType, TombstoneRecord } from './types';

const TOMBSTONE_METADATA_KEY = 'lifted_sync_tombstones';

export class TombstoneManager {
  private driver: IDatabaseDriver;
  private cache: Map<string, TombstoneRecord> = new Map();
  private isLoaded = false;

  constructor(driver: IDatabaseDriver) {
    this.driver = driver;
  }

  /**
   * Loads tombstone ledger from persistent driver metadata
   */
  async loadLedger(): Promise<void> {
    if (this.isLoaded) return;
    try {
      const raw = await this.driver.getMetadata(TOMBSTONE_METADATA_KEY);
      if (raw) {
        const records = JSON.parse(raw) as TombstoneRecord[];
        this.cache.clear();
        for (const r of records) {
          this.cache.set(r.recordId, r);
        }
      }
    } catch {
      this.cache.clear();
    } finally {
      this.isLoaded = true;
    }
  }

  private async persistLedger(): Promise<void> {
    const list = Array.from(this.cache.values());
    await this.driver.setMetadata(TOMBSTONE_METADATA_KEY, JSON.stringify(list));
  }

  /**
   * Records a deletion tombstone for a domain record
   */
  async recordTombstone(
    recordId: string,
    recordType: OutboxRecordType,
    revision: number,
    cloudUserId: string | null = null,
    deletedAt: number = Date.now()
  ): Promise<TombstoneRecord> {
    await this.loadLedger();

    const existing = this.cache.get(recordId);
    const newRevision = existing ? Math.max(existing.revision + 1, revision) : revision;

    const tombstone: TombstoneRecord = {
      recordId,
      recordType,
      deletedAt,
      revision: newRevision,
      cloudUserId,
      acknowledgedDeviceIds: [],
    };

    this.cache.set(recordId, tombstone);
    await this.persistLedger();
    return tombstone;
  }

  /**
   * Checks whether a record has an active tombstone
   */
  async isTombstoned(recordId: string): Promise<boolean> {
    await this.loadLedger();
    return this.cache.has(recordId);
  }

  /**
   * Retrieves an active tombstone
   */
  async getTombstone(recordId: string): Promise<TombstoneRecord | null> {
    await this.loadLedger();
    return this.cache.get(recordId) || null;
  }

  /**
   * Evaluates Anti-Resurrection Invariant:
   * Any incoming update to a tombstoned record is REJECTED, regardless of its revision,
   * protecting devices offline for 31, 90, or 365 days from resurrecting deleted records.
   * Only an explicit, authorized user restoration action (isExplicitRecreate = true) allows recreation.
   */
  async shouldRejectIncomingUpdate(
    recordId: string,
    _incomingRevision: number,
    isExplicitRecreate: boolean = false
  ): Promise<boolean> {
    await this.loadLedger();
    const tombstone = this.cache.get(recordId);
    if (!tombstone) return false;

    // Explicit user-authorized restore allows recreation and clears the tombstone
    if (isExplicitRecreate) {
      this.cache.delete(recordId);
      await this.persistLedger();
      return false;
    }

    // Default: REJECT all updates attempting to resurrect a deleted record
    return true;
  }

  /**
   * Explicitly authorizes record recreation / restoration by the user
   */
  async authorizeRecordRecreation(recordId: string): Promise<boolean> {
    await this.loadLedger();
    if (this.cache.has(recordId)) {
      this.cache.delete(recordId);
      await this.persistLedger();
      return true;
    }
    return false;
  }

  /**
   * Records device acknowledgment of a deletion tombstone
   */
  async acknowledgeDevice(recordId: string, deviceId: string): Promise<boolean> {
    await this.loadLedger();
    const tombstone = this.cache.get(recordId);
    if (!tombstone) return false;

    const acks = new Set(tombstone.acknowledgedDeviceIds || []);
    acks.add(deviceId);
    tombstone.acknowledgedDeviceIds = Array.from(acks);
    await this.persistLedger();
    return true;
  }

  /**
   * Prunes tombstones ONLY when all active enrolled devices have acknowledged the deletion.
   * NEVER prunes purely based on wall-clock elapsed time.
   */
  async pruneAcknowledgedTombstones(activeDeviceIds: string[]): Promise<number> {
    await this.loadLedger();
    if (activeDeviceIds.length === 0) return 0;

    let prunedCount = 0;
    for (const [id, record] of this.cache.entries()) {
      const acks = new Set(record.acknowledgedDeviceIds || []);
      const allAcknowledged = activeDeviceIds.every((devId) => acks.has(devId));
      if (allAcknowledged) {
        this.cache.delete(id);
        prunedCount++;
      }
    }

    if (prunedCount > 0) {
      await this.persistLedger();
    }

    return prunedCount;
  }

  /**
   * Retires an inactive device so tombstones need not wait indefinitely for a lost/destroyed device.
   */
  async retireDevice(retiredDeviceId: string, remainingActiveDeviceIds: string[]): Promise<number> {
    await this.loadLedger();
    // After removing the retired device from active consideration, check if pending tombstones can now be pruned
    return this.pruneAcknowledgedTombstones(remainingActiveDeviceIds.filter((id) => id !== retiredDeviceId));
  }

  /**
   * Total active tombstones count
   */
  async count(): Promise<number> {
    await this.loadLedger();
    return this.cache.size;
  }

  /**
   * Clear all tombstones (for isolated unit tests only)
   */
  async clear(): Promise<void> {
    this.cache.clear();
    await this.driver.setMetadata(TOMBSTONE_METADATA_KEY, JSON.stringify([]));
  }
}
