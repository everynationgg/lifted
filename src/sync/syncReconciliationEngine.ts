/**
 * LIFTED — Repository Outbox Integration & Durable Reconciliation Engine
 * Phase 8 Stage 2: Atomicity, Non-Sacrifice Guarantees & Durable Revision Checkpoints
 *
 * Invariant: NEVER sacrifice a user's local journal, prayer, or mood entry merely
 * because synchronization or outbox queuing encountered an error.
 *
 * Key Capabilities:
 * 1. Best-effort outbox enqueue during local writes without risking local record loss.
 * 2. Durable per-record, per-account checkpoints (RecordSyncCheckpoint) to prevent
 *    endlessly re-queueing already acknowledged operations.
 * 3. Reconciliation scanner audits domain stores against checkpoints on startup,
 *    idempotently healing only un-queued or modified records.
 * 4. Explicit first-time linking of existing guest records requiring user consent.
 */

import type { IDatabaseDriver } from '../storage/databaseDriver';
import type { OutboxManager } from './outboxManager';
import type {
  OutboxRecordType,
  OutboxOperationType,
  OutboxStorageRecord,
  RecordSyncCheckpoint,
} from './types';
import type { EncryptedPayload } from '../storage/types';

export const CHECKPOINTS_METADATA_KEY = 'lifted_sync_checkpoints';

export interface RepositoryOutboxIntegrationConfig {
  hasSyncConsent: () => boolean;
  getActiveAccount: () => { localUserId: string; cloudUserId: string | null };
}

export class SyncReconciliationEngine {
  private driver: IDatabaseDriver;
  private outbox: OutboxManager;
  private config: RepositoryOutboxIntegrationConfig;
  private checkpoints: Map<string, RecordSyncCheckpoint> = new Map();
  private checkpointsLoaded = false;

  constructor(
    driver: IDatabaseDriver,
    outbox: OutboxManager,
    config: RepositoryOutboxIntegrationConfig
  ) {
    this.driver = driver;
    this.outbox = outbox;
    this.config = config;
  }

  /**
   * Loads durable checkpoints from driver metadata
   */
  async loadCheckpoints(): Promise<void> {
    if (this.checkpointsLoaded) return;
    try {
      const raw = await this.driver.getMetadata(CHECKPOINTS_METADATA_KEY);
      if (raw) {
        const list = JSON.parse(raw) as RecordSyncCheckpoint[];
        this.checkpoints.clear();
        for (const cp of list) {
          this.checkpoints.set(`${cp.recordType}:${cp.recordId}`, cp);
        }
      }
    } catch {
      this.checkpoints.clear();
    } finally {
      this.checkpointsLoaded = true;
    }
  }

  private async persistCheckpoints(): Promise<void> {
    const list = Array.from(this.checkpoints.values());
    await this.driver.setMetadata(CHECKPOINTS_METADATA_KEY, JSON.stringify(list));
  }

  /**
   * Retrieves an existing checkpoint for a domain record
   */
  async getCheckpoint(recordType: OutboxRecordType, recordId: string): Promise<RecordSyncCheckpoint | null> {
    await this.loadCheckpoints();
    return this.checkpoints.get(`${recordType}:${recordId}`) || null;
  }

  /**
   * Records a confirmed sync acknowledgment checkpoint
   */
  async recordAcknowledgment(
    recordType: OutboxRecordType,
    recordId: string,
    operationId: string,
    confirmedServerRevision: number,
    cloudUserId: string,
    contentHash?: string | null,
    syncedAt: number = Date.now()
  ): Promise<void> {
    await this.loadCheckpoints();
    const key = `${recordType}:${recordId}`;
    const existing = this.checkpoints.get(key);

    const checkpoint: RecordSyncCheckpoint = {
      recordId,
      recordType,
      localRevision: existing ? Math.max(existing.localRevision, confirmedServerRevision) : confirmedServerRevision,
      lastConfirmedServerRevision: confirmedServerRevision,
      lastAcknowledgedOperationId: operationId,
      lastSyncedAt: syncedAt,
      cloudUserId,
      lastContentHash: contentHash ?? existing?.lastContentHash ?? null,
    };

    this.checkpoints.set(key, checkpoint);
    await this.persistCheckpoints();
  }

  /**
   * Enqueues an operation safely alongside a local record write.
   * If outbox fails, the error is captured and the record is left in local storage
   * to be healed by the reconciliation scanner, guaranteeing zero data loss of user entries.
   */
  async recordDomainChange(
    recordId: string,
    recordType: OutboxRecordType,
    opType: OutboxOperationType,
    encryptedEnvelope: EncryptedPayload,
    baseRevision: number,
    newRevision: number,
    simulateOutboxFailure: boolean = false
  ): Promise<{ enqueued: boolean; error?: string }> {
    const consent = this.config.hasSyncConsent();
    const account = this.config.getActiveAccount();

    if (!consent || !account.cloudUserId) {
      return { enqueued: false };
    }

    if (simulateOutboxFailure) {
      return { enqueued: false, error: 'SIMULATED_OUTBOX_STORAGE_ERROR' };
    }

    try {
      const opId = `op-${recordType}-${recordId}-${newRevision}-${Date.now()}`;
      const op: OutboxStorageRecord = {
        operationId: opId,
        recordId,
        localUserId: account.localUserId,
        cloudUserId: account.cloudUserId,
        recordType,
        operationType: opType,
        baseRevision,
        newLocalRevision: newRevision,
        encryptedEnvelope,
        status: 'pending',
        retryCount: 0,
        createdAt: Date.now(),
        lastAttemptAt: null,
        nextAttemptAt: null,
        lastErrorCategory: null,
        idempotencyKey: `idem-${opId}`,
      };

      await this.outbox.enqueueOperation(op);
      return { enqueued: true };
    } catch (err: unknown) {
      return {
        enqueued: false,
        error: err instanceof Error ? err.message : 'Unknown outbox queuing failure',
      };
    }
  }

  /**
   * Audits local domain tables against checkpoints and the outbox ledger.
   * Only heals un-queued or modified records; skips already confirmed revisions.
   */
  async reconcileMissingOutboxEntries(): Promise<{ healedCount: number }> {
    const consent = this.config.hasSyncConsent();
    const account = this.config.getActiveAccount();

    if (!consent || !account.cloudUserId) {
      return { healedCount: 0 };
    }

    await this.loadCheckpoints();
    const allOutbox = await this.driver.outbox.getAll();
    const existingRecordOps = new Set(
      allOutbox
        .filter((op) => op.status === 'pending' || op.status === 'in_flight')
        .map((op) => `${op.recordType}:${op.recordId}`)
    );

    let healedCount = 0;

    // 1. Audit Journals
    const journals = await this.driver.journals.getAll();
    for (const j of journals) {
      const key = `journal:${j.id}`;
      if (existingRecordOps.has(key)) continue;

      const checkpoint = this.checkpoints.get(key);
      const contentHash = j.contentEncrypted ? `${j.contentEncrypted.iv}:${j.contentEncrypted.ct}` : null;
      const isAlreadySynced =
        checkpoint != null &&
        checkpoint.cloudUserId === account.cloudUserId &&
        checkpoint.lastConfirmedServerRevision >= checkpoint.localRevision &&
        checkpoint.lastContentHash != null &&
        checkpoint.lastContentHash === contentHash;

      if (!isAlreadySynced) {
        const nextRev = checkpoint ? checkpoint.localRevision + 1 : 1;
        const opId = `recon-journal-${j.id}-${nextRev}-${Date.now()}`;

        await this.outbox.enqueueOperation({
          operationId: opId,
          recordId: j.id,
          localUserId: account.localUserId,
          cloudUserId: account.cloudUserId,
          recordType: 'journal',
          operationType: checkpoint ? 'update' : 'insert',
          baseRevision: checkpoint ? checkpoint.lastConfirmedServerRevision : 0,
          newLocalRevision: nextRev,
          encryptedEnvelope: j.contentEncrypted,
          createdAt: Date.now(),
          idempotencyKey: `idem-${opId}`,
        });
        healedCount++;
      }
    }

    // 2. Audit Prayers
    const prayers = await this.driver.prayers.getAll();
    for (const p of prayers) {
      const key = `prayer:${p.id}`;
      if (existingRecordOps.has(key)) continue;

      const checkpoint = this.checkpoints.get(key);
      const contentHash = p.requestEncrypted ? `${p.requestEncrypted.iv}:${p.requestEncrypted.ct}` : null;
      const isAlreadySynced =
        checkpoint != null &&
        checkpoint.cloudUserId === account.cloudUserId &&
        checkpoint.lastConfirmedServerRevision >= checkpoint.localRevision &&
        checkpoint.lastContentHash != null &&
        checkpoint.lastContentHash === contentHash;

      if (!isAlreadySynced) {
        const nextRev = checkpoint ? checkpoint.localRevision + 1 : 1;
        const opId = `recon-prayer-${p.id}-${nextRev}-${Date.now()}`;

        await this.outbox.enqueueOperation({
          operationId: opId,
          recordId: p.id,
          localUserId: account.localUserId,
          cloudUserId: account.cloudUserId,
          recordType: 'prayer',
          operationType: checkpoint ? 'update' : 'insert',
          baseRevision: checkpoint ? checkpoint.lastConfirmedServerRevision : 0,
          newLocalRevision: nextRev,
          encryptedEnvelope: p.requestEncrypted,
          createdAt: Date.now(),
          idempotencyKey: `idem-${opId}`,
        });
        healedCount++;
      }
    }

    return { healedCount };
  }

  /**
   * Explicit User-Initiated Linking of Historical Guest Records
   * Requires explicit confirmation token so historical local records are not
   * automatically uploaded without separate user authorization.
   */
  async linkHistoricalGuestRecords(confirmationToken: string): Promise<number> {
    if (confirmationToken !== 'CONFIRM_LINK_GUEST_RECORDS') {
      throw new Error('Unauthorized guest linking: confirmation token invalid.');
    }

    const consent = this.config.hasSyncConsent();
    const account = this.config.getActiveAccount();
    if (!consent || !account.cloudUserId) {
      throw new Error('Cannot link guest records without active sync consent and an authenticated cloud account.');
    }

    let queuedCount = 0;
    const journals = await this.driver.journals.getAll();
    for (const j of journals) {
      if (!j.cloudUserId) {
        j.cloudUserId = account.cloudUserId;
        await this.driver.journals.put(j);

        const opId = `link-journal-${j.id}-${Date.now()}`;
        await this.outbox.enqueueOperation({
          operationId: opId,
          recordId: j.id,
          localUserId: account.localUserId,
          cloudUserId: account.cloudUserId,
          recordType: 'journal',
          operationType: 'insert',
          baseRevision: 0,
          newLocalRevision: 1,
          encryptedEnvelope: j.contentEncrypted,
          createdAt: Date.now(),
          idempotencyKey: `idem-${opId}`,
        });
        queuedCount++;
      }
    }

    return queuedCount;
  }
}
