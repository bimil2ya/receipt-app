const CHUNK_BYTES = 2 * 1024 * 1024;

export { CHUNK_BYTES };

function fail(message) { throw new Error(`DRAFT_BACKUP_${message}`); }

async function sha256(blob) {
  const bytes = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash the immutable image bytes before opening a read/write transaction.
 * IndexedDB transactions may close while an async WebCrypto digest is pending,
 * so callers must prepare this value before they allocate a receipt revision.
 */
export async function prepareDraftBackupImageSnapshot(imageBlob = null) {
  if (!imageBlob) return null;
  return {
    blob: imageBlob,
    byteLength: imageBlob.size,
    mimeType: imageBlob.type || 'application/octet-stream',
    sha256: await sha256(imageBlob),
    chunkCount: Math.ceil(imageBlob.size / CHUNK_BYTES),
  };
}

export function buildDraftBackupUpsert({ receipt, imageSnapshot = null, deviceId, teamSnapshot = null }) {
  if (!receipt?.id || !Number.isSafeInteger(receipt.backupRevision) || receipt.backupRevision < 1) fail('INVALID_RECEIPT');
  if (!deviceId) fail('INVALID_DEVICE');
  return {
    opId: crypto.randomUUID(), kind: 'upsert', receiptId: receipt.id,
    backupRevision: receipt.backupRevision, deviceId, teamSnapshot,
    receiptSnapshot: structuredClone(receipt), image: imageSnapshot ? structuredClone(imageSnapshot) : null,
    createdAt: new Date().toISOString(), attempts: 0,
  };
}

export function buildDraftBackupTombstone({ receiptId, backupRevision, deviceId, teamSnapshot = null }) {
  if (!receiptId || !Number.isSafeInteger(backupRevision) || backupRevision < 1 || !deviceId) fail('INVALID_TOMBSTONE');
  return { opId: crypto.randomUUID(), kind: 'delete', receiptId, backupRevision, deviceId, teamSnapshot, createdAt: new Date().toISOString(), attempts: 0 };
}
