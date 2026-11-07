/**
 * Custom Storage and Cryptographic Exceptions
 * Explicitly typed to allow safe, recoverable error handling without silent fallbacks.
 */

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export class KeyMissingError extends StorageError {
  constructor(
    message: string = 'An existing encrypted database was detected on this device, but the encryption key is missing from secure storage. Refusing to overwrite or generate a replacement key.'
  ) {
    super(message);
    this.name = 'KeyMissingError';
  }
}

export class KeyInvalidError extends StorageError {
  constructor(
    message: string = 'The security key failed authentication canary verification. The database cannot be safely decrypted.'
  ) {
    super(message);
    this.name = 'KeyInvalidError';
  }
}

export class TamperedCiphertextError extends StorageError {
  constructor(
    message: string = 'Cryptographic integrity check failed. The ciphertext has been modified, corrupted, or encrypted with a different key.'
  ) {
    super(message);
    this.name = 'TamperedCiphertextError';
  }
}

export class DatabaseCorruptedError extends StorageError {
  constructor(message: string = 'The database storage file could not be opened or parsed.') {
    super(message);
    this.name = 'DatabaseCorruptedError';
  }
}

export class DatabaseInitError extends StorageError {
  constructor(message: string = 'Failed to initialize the storage engine.') {
    super(message);
    this.name = 'DatabaseInitError';
  }
}

export class RecordNotFoundError extends StorageError {
  constructor(entityName: string, id: string) {
    super(`${entityName} record with id "${id}" was not found.`);
    this.name = 'RecordNotFoundError';
  }
}
