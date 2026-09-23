import { openReceiptDb, STORE_SUBMISSION_ARTIFACTS } from './receiptDb';

const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_CHUNKS = 20;
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_RE = /^[0-9a-f]{64}$/i;

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function normalizeArtifact(artifact, bytes) {
  if (!artifact || !UUID_RE.test(artifact.reportId || '') || !(bytes instanceof Uint8Array)) throw new TypeError('invalid submission PDF artifact');
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PDF_BYTES || artifact.byteLength !== bytes.byteLength) throw new TypeError('invalid submission PDF artifact size');
  if (!SHA_RE.test(artifact.sha256 || '') || await sha256Hex(bytes) !== artifact.sha256.toLowerCase()) throw new TypeError('invalid submission PDF artifact sha256');
  if (!Number.isSafeInteger(artifact.chunkCount) || artifact.chunkCount < 1 || artifact.chunkCount > MAX_CHUNKS
    || !Array.isArray(artifact.chunkSha256) || !Array.isArray(artifact.chunkByteLength)
    || artifact.chunkSha256.length !== artifact.chunkCount || artifact.chunkByteLength.length !== artifact.chunkCount) {
    throw new TypeError('invalid submission PDF artifact chunks');
  }
  if (artifact.chunkSha256.some(value => !SHA_RE.test(value))
    || artifact.chunkByteLength.some(value => !Number.isSafeInteger(value) || value < 1 || value > MAX_CHUNK_BYTES)
    || artifact.chunkByteLength.reduce((sum, value) => sum + value, 0) !== bytes.byteLength) {
    throw new TypeError('invalid submission PDF artifact chunks');
  }
  let offset = 0;
  for (let index = 0; index < artifact.chunkCount; index += 1) {
    const end = offset + artifact.chunkByteLength[index];
    if (await sha256Hex(bytes.subarray(offset, end)) !== artifact.chunkSha256[index].toLowerCase()) {
      throw new TypeError('invalid submission PDF artifact chunk sha256');
    }
    offset = end;
  }
  if (typeof artifact.createdAt !== 'string' || !Number.isFinite(Date.parse(artifact.createdAt))) throw new TypeError('invalid submission PDF artifact createdAt');
  return {
    ...artifact,
    sha256: artifact.sha256.toLowerCase(),
    chunkSha256: artifact.chunkSha256.map(value => value.toLowerCase()),
    bytes,
  };
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('submission artifact transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('submission artifact transaction aborted'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('submission artifact request failed'));
  });
}

export async function saveSubmissionPdfArtifact(artifact, db = null) {
  const normalized = await normalizeArtifact(artifact, artifact?.bytes);
  const targetDb = db || await openReceiptDb();
  const tx = targetDb.transaction(STORE_SUBMISSION_ARTIFACTS, 'readwrite');
  tx.objectStore(STORE_SUBMISSION_ARTIFACTS).put({
    ...normalized,
    bytes: normalized.bytes.slice().buffer,
  });
  await transactionDone(tx);
}

export async function readSubmissionPdfArtifact(reportId, db = null) {
  if (typeof reportId !== 'string' || reportId.length === 0) return null;
  const targetDb = db || await openReceiptDb();
  const tx = targetDb.transaction(STORE_SUBMISSION_ARTIFACTS, 'readonly');
  const done = transactionDone(tx);
  const [record] = await Promise.all([
    requestResult(tx.objectStore(STORE_SUBMISSION_ARTIFACTS).get(reportId)),
    done,
  ]);
  if (!record || !(record.bytes instanceof ArrayBuffer) || record.byteLength !== record.bytes.byteLength) return null;
  try {
    return await normalizeArtifact(record, new Uint8Array(record.bytes.slice(0)));
  } catch {
    return null;
  }
}

export async function deleteSubmissionPdfArtifact(reportId, db = null) {
  if (typeof reportId !== 'string' || reportId.length === 0) return;
  const targetDb = db || await openReceiptDb();
  const tx = targetDb.transaction(STORE_SUBMISSION_ARTIFACTS, 'readwrite');
  tx.objectStore(STORE_SUBMISSION_ARTIFACTS).delete(reportId);
  await transactionDone(tx);
}
