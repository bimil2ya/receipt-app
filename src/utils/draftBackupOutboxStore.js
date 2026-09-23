import { openReceiptDb, STORE_DRAFT_BACKUP_OUTBOX } from './receiptDb';

function asArray(value) { return Array.isArray(value) ? value : []; }
function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('DRAFT_BACKUP_IDB_REQUEST_FAILED'));
  });
}
function transactionResult(tx, result) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result());
    tx.onerror = () => reject(tx.error || new Error('DRAFT_BACKUP_IDB_TRANSACTION_FAILED'));
    tx.onabort = () => reject(tx.error || new Error('DRAFT_BACKUP_IDB_TRANSACTION_ABORTED'));
  });
}
function isDue(operation, now) {
  if (!operation?.opId) return false;
  if (Number.isFinite(operation.retryAt) && operation.retryAt > now) return false;
  return !Number.isFinite(operation.leaseExpiresAt) || operation.leaseExpiresAt <= now;
}
function leaseToken() { return crypto.randomUUID(); }

// The worker must never send an older operation after a newer state for the
// same receipt has already been recorded.  Keep exactly one candidate per
// receipt before applying the due/lease filter.  Corrupt duplicate revisions
// are resolved deterministically so two tabs cannot choose different rows.
function compareNewestForReceipt(a, b) {
  const revisionDifference = Number(b.backupRevision || 0) - Number(a.backupRevision || 0);
  if (revisionDifference) return revisionDifference;
  const createdDifference = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  if (createdDifference) return createdDifference;
  return String(b.opId || '').localeCompare(String(a.opId || ''));
}

function compareClaimOrder(a, b) {
  return String(a.createdAt || '').localeCompare(String(b.createdAt || ''))
    || String(a.receiptId || '').localeCompare(String(b.receiptId || ''))
    || String(a.opId || '').localeCompare(String(b.opId || ''));
}

function newestOperationsByReceipt(operations) {
  const newest = new Map();
  for (const operation of asArray(operations)) {
    if (!operation?.receiptId) continue;
    const current = newest.get(operation.receiptId);
    if (!current || compareNewestForReceipt(operation, current) < 0) {
      newest.set(operation.receiptId, operation);
    }
  }
  return [...newest.values()];
}

/**
 * The only IndexedDB boundary used by the silent draft worker. Each method
 * allocates a read/write transaction and validates the operation's lease in
 * that same transaction; a late tab cannot delete or release another tab's
 * reclaimed operation.
 */
export function createDraftBackupOutboxStore({ dbOpen = openReceiptDb, makeLeaseToken = leaseToken } = {}) {
  return {
    async claimDue({ now, leaseMs, limit }) {
      if (!Number.isFinite(now) || !Number.isFinite(leaseMs) || leaseMs <= 0 || !Number.isSafeInteger(limit) || limit < 1) {
        throw new Error('DRAFT_BACKUP_INVALID_CLAIM');
      }
      const db = await dbOpen();
      const tx = db.transaction(STORE_DRAFT_BACKUP_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_DRAFT_BACKUP_OUTBOX);
      const claimed = [];
      const all = await requestResult(store.getAll());
      for (const operation of newestOperationsByReceipt(all)
        .filter(operation => isDue(operation, now))
        .sort(compareClaimOrder)
        .slice(0, limit)) {
        const token = makeLeaseToken();
        const leased = { ...operation, leaseToken: token, leaseExpiresAt: now + leaseMs };
        store.put(leased);
        claimed.push(structuredClone(leased));
      }
      return transactionResult(tx, () => claimed);
    },

    async acknowledge({ opId, leaseToken: expectedToken }) {
      if (!opId || !expectedToken) throw new Error('DRAFT_BACKUP_INVALID_ACKNOWLEDGEMENT');
      const db = await dbOpen();
      const tx = db.transaction(STORE_DRAFT_BACKUP_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_DRAFT_BACKUP_OUTBOX);
      const operation = await requestResult(store.get(opId));
      const removed = Boolean(operation && operation.leaseToken === expectedToken);
      if (removed) store.delete(opId);
      return transactionResult(tx, () => removed);
    },

    async release({ opId, leaseToken: expectedToken, now, attempts, retryAt, lastError }) {
      if (!opId || !expectedToken || !Number.isFinite(now) || !Number.isSafeInteger(attempts) || attempts < 1 || !Number.isFinite(retryAt)) {
        throw new Error('DRAFT_BACKUP_INVALID_RELEASE');
      }
      const db = await dbOpen();
      const tx = db.transaction(STORE_DRAFT_BACKUP_OUTBOX, 'readwrite');
      const store = tx.objectStore(STORE_DRAFT_BACKUP_OUTBOX);
      const operation = await requestResult(store.get(opId));
      const released = Boolean(operation && operation.leaseToken === expectedToken);
      if (released) {
        store.put({ ...operation, attempts, retryAt, lastError: String(lastError || '').slice(0, 240), lastAttemptAt: now, leaseToken: null, leaseExpiresAt: null });
      }
      return transactionResult(tx, () => released);
    },
  };
}
