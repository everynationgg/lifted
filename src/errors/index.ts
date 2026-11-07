/**
 * LIFTED — Centralized Typed Error Classifications & Safe Error Presentation
 * Phase 9 Architecture & Boundary Stabilization
 *
 * Distinguishes operational and security error classes across domain boundaries:
 * - Offline network & unverified connectivity
 * - Missing authentication & expired sessions
 * - Locked Sanctuary privacy boundary
 * - Missing or invalid keys & consent required
 * - Optimistic concurrency revision conflicts & tombstone rejections
 * - Device revocation
 * - Remote provider unavailability & quota exhaustion
 * - Local storage / database failures
 *
 * Privacy & Security Invariant:
 * Safe user-facing error formatting NEVER logs or reveals recovery secrets,
 * personal narratives, access tokens, raw ciphertext keys, or emotional tags.
 */

export type AppErrorCode =
  | 'OFFLINE_NETWORK'
  | 'UNVERIFIED_CONNECTIVITY'
  | 'MISSING_AUTHENTICATION'
  | 'EXPIRED_SESSION'
  | 'LOCKED_SANCTUARY'
  | 'MISSING_OR_INVALID_KEY'
  | 'CONSENT_REQUIRED'
  | 'REVISION_CONFLICT'
  | 'TOMBSTONE_REJECTION'
  | 'DEVICE_REVOKED'
  | 'PROVIDER_UNAVAILABLE'
  | 'QUOTA_EXCEEDED'
  | 'LOCAL_DATABASE_FAILURE'
  | 'INTERNAL_UNEXPECTED';

export abstract class LiftedDomainError extends Error {
  abstract readonly code: AppErrorCode;
  readonly isSafeUserFacing: boolean;
  readonly compassionateMessage: string;

  constructor(internalMessage: string, compassionateMessage?: string, isSafeUserFacing: boolean = true) {
    super(internalMessage);
    this.name = this.constructor.name;
    this.isSafeUserFacing = isSafeUserFacing;
    this.compassionateMessage =
      compassionateMessage || 'We encountered a momentary pause. Your journal and prayers remain safely preserved on your device.';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class OfflineNetworkError extends LiftedDomainError {
  readonly code: AppErrorCode = 'OFFLINE_NETWORK';
  constructor(message = 'No active network connection available.') {
    super(message, 'You appear to be offline. All your entries are stored securely on this device.');
  }
}

export class UnverifiedConnectivityError extends LiftedDomainError {
  readonly code: AppErrorCode = 'UNVERIFIED_CONNECTIVITY';
  constructor(message = 'Network interface active but cloud service unreachable.') {
    super(message, 'Connecting to our quiet sanctuary. Your entries are safely held locally while we recheck.');
  }
}

export class MissingAuthenticationError extends LiftedDomainError {
  readonly code: AppErrorCode = 'MISSING_AUTHENTICATION';
  constructor(message = 'Authentication required for cloud operations.') {
    super(message, 'Please sign in to access your account settings and preferences.');
  }
}

export class ExpiredSessionError extends LiftedDomainError {
  readonly code: AppErrorCode = 'EXPIRED_SESSION';
  constructor(message = 'Authentication session has expired or been revoked.') {
    super(message, 'Your session has timed out for your security. Please sign in again.');
  }
}

export class LockedSanctuaryError extends LiftedDomainError {
  readonly code: AppErrorCode = 'LOCKED_SANCTUARY';
  constructor(message = 'Sanctuary Privacy Lock is currently active.') {
    super(message, 'Sanctuary is protected. Enter your 4-digit PIN to open your private reflections.');
  }
}

export class MissingOrInvalidKeyError extends LiftedDomainError {
  readonly code: AppErrorCode = 'MISSING_OR_INVALID_KEY';
  constructor(message = 'Encryption key missing, inaccessible, or invalid.') {
    super(message, 'Could not access the encryption key for this record. Your local vault remains locked.');
  }
}

export class ConsentRequiredError extends LiftedDomainError {
  readonly code: AppErrorCode = 'CONSENT_REQUIRED';
  constructor(message = 'Explicit consent required before processing cloud operations.') {
    super(message, 'Your consent is required before enabling this cloud feature. You remain in complete control.');
  }
}

export class RevisionConflictError extends LiftedDomainError {
  readonly code: AppErrorCode = 'REVISION_CONFLICT';
  readonly serverRevision?: number;
  readonly clientRevision?: number;

  constructor(message: string, serverRevision?: number, clientRevision?: number) {
    super(message, 'A newer version of this entry exists on your other device. Preserving both versions safely.');
    this.serverRevision = serverRevision;
    this.clientRevision = clientRevision;
  }
}

export class TombstoneRejectionError extends LiftedDomainError {
  readonly code: AppErrorCode = 'TOMBSTONE_REJECTION';
  constructor(message = 'Record has been deleted on another device.') {
    super(message, 'This entry was previously removed and cannot be updated.');
  }
}

export class DeviceRevokedError extends LiftedDomainError {
  readonly code: AppErrorCode = 'DEVICE_REVOKED';
  constructor(message = 'This device has been revoked from synchronization.') {
    super(message, 'This device is no longer authorized for cloud sync. Your local notes remain intact.');
  }
}

export class ProviderUnavailableError extends LiftedDomainError {
  readonly code: AppErrorCode = 'PROVIDER_UNAVAILABLE';
  constructor(message = 'Companion or cloud service provider temporarily unavailable.') {
    super(message, 'Our offline companion is ready to support you with soothing prayers and calming reflections.');
  }
}

export class QuotaExceededError extends LiftedDomainError {
  readonly code: AppErrorCode = 'QUOTA_EXCEEDED';
  constructor(message = 'Cloud inference or service quota reached.') {
    super(message, 'Daily companion reflection limit reached. Our built-in grounded reflections remain always available.');
  }
}

export class LocalDatabaseFailureError extends LiftedDomainError {
  readonly code: AppErrorCode = 'LOCAL_DATABASE_FAILURE';
  constructor(message = 'Local SQLite / IndexedDB database operation failed.') {
    super(message, 'Encountered a storage issue on your device. Please restart the app if this persists.');
  }
}

/**
 * Strips sensitive data (keys, tokens, email addresses, personal narratives)
 * and returns a compassionate, user-facing error message.
 */
export function getSafeUserFacingMessage(error: unknown): string {
  if (error instanceof LiftedDomainError) {
    return error.compassionateMessage;
  }

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('failed to fetch')) {
      return 'You appear to be offline. Your notes and prayers remain safe on this device.';
    }
    if (msg.includes('auth') || msg.includes('jwt') || msg.includes('session_revoked')) {
      return 'Your security session has ended. Please sign in again to continue.';
    }
    if (msg.includes('timeout')) {
      return 'The request took longer than expected. Please try again in a quiet moment.';
    }
    if (msg.includes('quota') || msg.includes('rate limit')) {
      return 'Companion limit reached. Grounded scriptures and offline reflections remain accessible.';
    }
    if (msg.includes('device_revoked')) {
      return 'This device is no longer enrolled for sync. Your local entries are preserved.';
    }
  }

  return 'A temporary quiet error occurred. Your personal entries remain safely preserved on this device.';
}
