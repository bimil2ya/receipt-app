// The worker deliberately knows nothing about IndexedDB or fetch.  The caller
// supplies an atomically-claiming outbox store and a transport when the draft
// backup endpoint exists.  Keeping those boundaries explicit prevents this
// pre-endpoint worker from accidentally calling the final-submission API.

export const DRAFT_BACKUP_LEASE_MS = 60_000;
export const DRAFT_BACKUP_MAX_BATCH = 3;
export const DRAFT_BACKUP_INITIAL_BACKOFF_MS = 30_000;
export const DRAFT_BACKUP_MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;
export const DRAFT_BACKUP_RETENTION = 'until-strict-commit-ack';

function isPositiveRevision(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validHash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function draftBackupBackoffMs(attempts) {
  const retry = Math.max(1, Number.isSafeInteger(attempts) ? attempts : 1);
  return Math.min(DRAFT_BACKUP_MAX_BACKOFF_MS, DRAFT_BACKUP_INITIAL_BACKOFF_MS * (2 ** (retry - 1)));
}

/**
 * A malformed local record is never sent and is retained for diagnosis and a
 * later migration.  A valid operation is still retained until the server has
 * acknowledged the exact operation/revision/hash below.
 */
export function validateDraftBackupOperation(operation) {
  if (!operation || typeof operation !== 'object') return 'INVALID_OPERATION';
  if (typeof operation.opId !== 'string' || !operation.opId) return 'INVALID_OPERATION_ID';
  if (operation.kind !== 'upsert' && operation.kind !== 'delete') return 'INVALID_KIND';
  if (typeof operation.receiptId !== 'string' || !operation.receiptId) return 'INVALID_RECEIPT_ID';
  if (!isPositiveRevision(operation.backupRevision)) return 'INVALID_REVISION';
  if (operation.kind === 'delete') return null;
  if (!operation.receiptSnapshot || typeof operation.receiptSnapshot !== 'object') return 'MISSING_RECEIPT_SNAPSHOT';
  if (!operation.image) return null;
  if (!(operation.image.blob instanceof Blob)) return 'INVALID_IMAGE_BLOB';
  if (!Number.isSafeInteger(operation.image.byteLength) || operation.image.byteLength < 0) return 'INVALID_IMAGE_LENGTH';
  if (!Number.isSafeInteger(operation.image.chunkCount) || operation.image.chunkCount < 1) return 'INVALID_IMAGE_CHUNKS';
  if (!validHash(operation.image.sha256)) return 'INVALID_IMAGE_HASH';
  return null;
}

export function isStrictDraftBackupAck(ack, operation) {
  if (!ack || ack.type !== 'draft-backup' || ack.success !== true) return false;
  if (ack.operationId !== operation.opId || ack.receiptId !== operation.receiptId) return false;
  if (ack.backupRevision !== operation.backupRevision || typeof ack.manifestFileId !== 'string' || !ack.manifestFileId) return false;
  const expectedHash = operation.image?.sha256 || null;
  return ack.imageSha256 === expectedHash;
}

async function withWorkerLock(locks, work) {
  if (!locks?.request) return work();
  return locks.request('receipt-app:draft-backup-worker:v1', { mode: 'exclusive' }, work);
}

function errorDetail(error) {
  if (!error) return 'UNKNOWN_ERROR';
  return String(error.message || error).slice(0, 240);
}

/**
 * @param {{
 *   enabled: boolean,
 *   store: { claimDue: Function, acknowledge: Function, release: Function },
 *   transport?: (operation: object) => Promise<object>,
 *   now?: () => number, locks?: LockManager, maxBatch?: number, leaseMs?: number,
 * }} options
 */
export async function runDraftBackupWorker(options = {}) {
  const {
    enabled = false,
    store,
    transport,
    now = () => Date.now(),
    locks = globalThis.navigator?.locks,
    maxBatch = DRAFT_BACKUP_MAX_BATCH,
    leaseMs = DRAFT_BACKUP_LEASE_MS,
  } = options;

  // An endpoint must opt in explicitly.  Do not turn a missing endpoint into
  // an accidental request to /api/upload or any other final-submission route.
  if (!enabled) return { status: 'disabled', claimed: 0, acknowledged: 0, retained: 0 };
  if (!store?.claimDue || !store?.acknowledge || !store?.release || typeof transport !== 'function') {
    throw new Error('DRAFT_BACKUP_WORKER_DEPENDENCIES_REQUIRED');
  }
  if (!Number.isSafeInteger(maxBatch) || maxBatch < 1) throw new Error('DRAFT_BACKUP_INVALID_BATCH');

  return withWorkerLock(locks, async () => {
    const startedAt = now();
    // claimDue is the correctness boundary: it must atomically attach a fresh
    // lease token and exclude unexpired leases/backoff windows across tabs.
    const claimed = await store.claimDue({ now: startedAt, leaseMs, limit: maxBatch });
    const result = { status: 'ran', claimed: claimed.length, acknowledged: 0, retained: 0 };
    for (const operation of claimed) {
      const invalid = validateDraftBackupOperation(operation);
      if (invalid) {
        await store.release({
          opId: operation.opId, leaseToken: operation.leaseToken,
          now: now(), attempts: (operation.attempts || 0) + 1,
          retryAt: now() + draftBackupBackoffMs((operation.attempts || 0) + 1),
          lastError: invalid,
        });
        result.retained += 1;
        continue;
      }
      try {
        const ack = await transport(operation);
        if (!isStrictDraftBackupAck(ack, operation)) throw new Error('DRAFT_BACKUP_INVALID_ACK');
        // The store must make this delete conditional on the lease token so a
        // late worker cannot acknowledge an operation re-claimed by another tab.
        const removed = await store.acknowledge({ opId: operation.opId, leaseToken: operation.leaseToken });
        if (removed !== true) throw new Error('DRAFT_BACKUP_ACKNOWLEDGE_CONFLICT');
        result.acknowledged += 1;
      } catch (error) {
        const attempts = (operation.attempts || 0) + 1;
        await store.release({
          opId: operation.opId, leaseToken: operation.leaseToken,
          now: now(), attempts,
          retryAt: now() + draftBackupBackoffMs(attempts),
          lastError: errorDetail(error),
        });
        result.retained += 1;
      }
    }
    return result;
  });
}
