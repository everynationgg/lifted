/**
 * LIFTED — Durable Local Outbox Manager
 * Phase 8 Stage 1: Transactional Outbox, Bounded Retries & Lifecycle Safety
 *
 * Persists pending synchronization operations in SQLite / IndexedDB.
 * Enforces strict safety invariants:
 * 1. Zero upload without explicit cloud sync consent.
 * 2. Zero upload when network is offline or unverified.
 * 3. Zero polling / execution while suspended in background.
 * 4. Zero upload while Sanctuary Privacy Lock is engaged.
 * 5. Bounded retries with exponential backoff and full jitter.
 * 6. Idempotent queue insertion and deterministic operation ordering.
 * 7. Crash recovery for in-flight records.
 */

import type { IDatabaseDriver } from '../storage/databaseDriver';
import type { INetworkTelemetryService } from '../services/networkService';
import type {
  OutboxStorageRecord,
  OutboxProcessSummary,
  ISyncTransport,
} from './types';

export interface OutboxManagerConfig {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  isSanctuaryLocked?: () => boolean;
  hasSyncConsent?: () => boolean;
  isKeyReady?: () => boolean;
  getAppLifecycleState?: () => 'active' | 'background' | 'inactive';
}

export class OutboxManager {
  private driver: IDatabaseDriver;
  private network: INetworkTelemetryService;
  private config: Required<OutboxManagerConfig>;

  constructor(
    driver: IDatabaseDriver,
    network: INetworkTelemetryService,
    config: OutboxManagerConfig = {}
  ) {
    this.driver = driver;
    this.network = network;
    this.config = {
      maxRetries: config.maxRetries ?? 5,
      baseDelayMs: config.baseDelayMs ?? 1000,
      maxDelayMs: config.maxDelayMs ?? 60000,
      isSanctuaryLocked: config.isSanctuaryLocked ?? (() => false),
      hasSyncConsent: config.hasSyncConsent ?? (() => false),
      isKeyReady: config.isKeyReady ?? (() => true),
      getAppLifecycleState: config.getAppLifecycleState ?? (() => 'active'),
    };
  }

  /**
   * Enqueues an operation idempotently into the durable local outbox.
   * If operationId or (recordId + newLocalRevision) already exists, returns existing record.
   */
  async enqueue(
    item: Omit<
      OutboxStorageRecord,
      'status' | 'retryCount' | 'lastAttemptAt' | 'nextAttemptAt' | 'lastErrorCategory'
    >
  ): Promise<OutboxStorageRecord> {
    // 1. Check if operationId already exists (Exact replay protection)
    const existing = await this.driver.outbox.get(item.operationId);
    if (existing) {
      return existing;
    }

    // 2. Check if this recordId + newLocalRevision is already queued
    const all = await this.driver.outbox.getAll();
    const duplicate = all.find(
      (o) => o.recordId === item.recordId && o.newLocalRevision === item.newLocalRevision
    );
    if (duplicate) {
      return duplicate;
    }

    const record: OutboxStorageRecord = {
      ...item,
      status: 'pending',
      retryCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: null,
      lastErrorCategory: null,
    };

    await this.driver.outbox.put(record);
    return record;
  }

  /**
   * Alias for enqueue to support standard naming conventions
   */
  async enqueueOperation(
    item: Omit<
      OutboxStorageRecord,
      'status' | 'retryCount' | 'lastAttemptAt' | 'nextAttemptAt' | 'lastErrorCategory'
    >
  ): Promise<OutboxStorageRecord> {
    return this.enqueue(item);
  }

  /**
   * Calculates exponential backoff with full jitter to avoid thundering herd.
   */
  calculateNextBackoff(retryCount: number): number {
    const exponential = Math.min(
      this.config.maxDelayMs,
      this.config.baseDelayMs * Math.pow(2, retryCount)
    );
    // Full jitter: random between 0 and exponential delay
    return Math.floor(Math.random() * exponential);
  }

  /**
   * Recovers operations stranded in 'in_flight' due to an app crash or process kill.
   */
  async recoverInFlightOperations(): Promise<number> {
    const all = await this.driver.outbox.getAll();
    let recoveredCount = 0;

    for (const item of all) {
      if (item.status === 'in_flight') {
        item.status = 'pending';
        await this.driver.outbox.put(item);
        recoveredCount++;
      }
    }

    return recoveredCount;
  }

  /**
   * Retrieves pending operations ready for processing in deterministic order:
   * Sorted by createdAt ASC, then newLocalRevision ASC.
   * Can be filtered by active account to prevent cross-account processing.
   */
  async getPendingOperations(
    now: number = Date.now(),
    accountFilter?: { localUserId?: string; cloudUserId?: string | null }
  ): Promise<OutboxStorageRecord[]> {
    const all = await this.driver.outbox.getAll();

    return all
      .filter((item) => {
        if (item.status !== 'pending') return false;
        if (item.nextAttemptAt && item.nextAttemptAt > now) return false;
        if (accountFilter) {
          if (accountFilter.cloudUserId !== undefined && item.cloudUserId !== accountFilter.cloudUserId) {
            return false;
          }
          if (accountFilter.localUserId !== undefined && item.localUserId !== accountFilter.localUserId) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return a.createdAt - b.createdAt;
        }
        return a.newLocalRevision - b.newLocalRevision;
      });
  }

  /**
   * Evaluates all synchronization preconditions and safety gates.
   */
  checkPreconditions(): OutboxProcessSummary['skippedReason'] | null {
    // 1. Consent Gate: Never upload without explicit user opt-in
    if (!this.config.hasSyncConsent()) {
      return 'NO_CONSENT';
    }

    // 2. Sanctuary Privacy Lock Gate: Never transmit while locked
    if (this.config.isSanctuaryLocked()) {
      return 'SANCTUARY_LOCKED';
    }

    // 3. Lifecycle Gate: Never sync while backgrounded/suspended
    const lifecycle = this.config.getAppLifecycleState();
    if (lifecycle === 'background' || lifecycle === 'inactive') {
      return 'LIFECYCLE_SUSPENDED';
    }

    // 4. Encryption Prerequisite Gate: Key must be ready and verified
    if (!this.config.isKeyReady()) {
      return 'KEY_MISSING';
    }

    // 5. Network Gates: Use INetworkTelemetryService
    const netState = this.network.getState();
    if (netState === 'OFFLINE') {
      return 'OFFLINE';
    }
    // CONNECTED_UNVERIFIED must NOT be treated as guaranteed reachability!
    if (netState === 'CONNECTED_UNVERIFIED') {
      return 'UNVERIFIED_NETWORK';
    }

    return null;
  }

  /**
   * Processes pending outbox items against the provided transport.
   * NOTE: In Stage 1, this is strictly driven by an injected SyntheticTransport.
   * No live background worker or cloud service is active.
   */
  async processPending(
    transport: ISyncTransport,
    now: number = Date.now(),
    activeAccount?: { localUserId?: string; cloudUserId?: string | null }
  ): Promise<OutboxProcessSummary> {
    const skippedReason = this.checkPreconditions();
    if (skippedReason) {
      return {
        attempted: 0,
        acknowledged: 0,
        failed: 0,
        skippedReason,
      };
    }

    const pending = await this.getPendingOperations(now, activeAccount);
    let acknowledged = 0;
    let failed = 0;

    for (const item of pending) {
      item.status = 'in_flight';
      item.lastAttemptAt = now;
      await this.driver.outbox.put(item);

      try {
        const response = await transport.pushOperation(item);

        if (response.success) {
          item.status = 'acknowledged';
          item.retryCount = 0;
          item.nextAttemptAt = null;
          item.lastErrorCategory = null;
          await this.driver.outbox.put(item);
          acknowledged++;
        } else {
          item.retryCount++;
          item.lastErrorCategory = response.errorCategory || 'SERVER_ERROR';

          if (item.retryCount >= this.config.maxRetries) {
            item.status = 'failed';
            item.nextAttemptAt = null;
          } else {
            item.status = 'pending';
            item.nextAttemptAt = now + this.calculateNextBackoff(item.retryCount);
          }

          await this.driver.outbox.put(item);
          failed++;
        }
      } catch {
        item.retryCount++;
        item.lastErrorCategory = 'UNKNOWN';

        if (item.retryCount >= this.config.maxRetries) {
          item.status = 'failed';
          item.nextAttemptAt = null;
        } else {
          item.status = 'pending';
          item.nextAttemptAt = now + this.calculateNextBackoff(item.retryCount);
        }

        await this.driver.outbox.put(item);
        failed++;
      }
    }

    return {
      attempted: pending.length,
      acknowledged,
      failed,
    };
  }

  /**
   * Strict Account Isolation:
   * Retrieves pending outbox items strictly belonging to a specific cloud account ID.
   */
  async getOperationsForAccount(cloudUserId: string): Promise<OutboxStorageRecord[]> {
    const all = await this.driver.outbox.getAll();
    return all.filter((op) => op.cloudUserId === cloudUserId);
  }

  /**
   * Safe Account Logout / Disconnect:
   * Quarantines pending operations for a specific cloud account to prevent transmission
   * while logged out, WITHOUT deleting user data. Unsent personal changes remain durably preserved.
   */
  async pauseOperationsForAccount(cloudUserId: string): Promise<number> {
    const all = await this.driver.outbox.getAll();
    let paused = 0;

    for (const op of all) {
      if (op.cloudUserId === cloudUserId && (op.status === 'pending' || op.status === 'in_flight')) {
        op.status = 'quarantined';
        await this.driver.outbox.put(op);
        paused++;
      }
    }

    return paused;
  }

  /**
   * Safe Account Reconnect / Login:
   * Restores quarantined operations back to 'pending' when the user logs back in.
   */
  async resumeOperationsForAccount(cloudUserId: string): Promise<number> {
    const all = await this.driver.outbox.getAll();
    let resumed = 0;

    for (const op of all) {
      if (op.cloudUserId === cloudUserId && op.status === 'quarantined') {
        op.status = 'pending';
        op.nextAttemptAt = null;
        await this.driver.outbox.put(op);
        resumed++;
      }
    }

    return resumed;
  }

  /**
   * Explicit Authorized Account Data Purge:
   * ONLY deletes outbox operations when the user has provided explicit, confirmed authorization
   * (e.g. permanent account deletion).
   */
  async explicitPurgeAuthorizedAccountOperations(
    cloudUserId: string,
    confirmationToken: string
  ): Promise<number> {
    if (confirmationToken !== 'CONFIRM_PURGE_DATA') {
      throw new Error('Unauthorized purge: confirmation token invalid.');
    }

    const all = await this.driver.outbox.getAll();
    let removed = 0;

    for (const op of all) {
      if (op.cloudUserId === cloudUserId) {
        await this.driver.outbox.delete(op.operationId);
        removed++;
      }
    }

    return removed;
  }

  /**
   * Account-specific purge for testing and explicit data wipe
   */
  async clearOperationsForAccount(cloudUserId: string): Promise<number> {
    return this.explicitPurgeAuthorizedAccountOperations(cloudUserId, 'CONFIRM_PURGE_DATA');
  }

  /**
   * Outbox queue size metrics
   */
  async getQueueStatus(): Promise<{ pending: number; inFlight: number; failed: number; acknowledged: number }> {
    const all = await this.driver.outbox.getAll();
    return {
      pending: all.filter((o) => o.status === 'pending').length,
      inFlight: all.filter((o) => o.status === 'in_flight').length,
      failed: all.filter((o) => o.status === 'failed').length,
      acknowledged: all.filter((o) => o.status === 'acknowledged').length,
    };
  }

  /**
   * Clear entire outbox (for test isolation)
   */
  async clear(): Promise<void> {
    await this.driver.outbox.clear();
  }
}
