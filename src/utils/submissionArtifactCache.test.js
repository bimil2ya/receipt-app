import { describe, expect, it } from 'vitest';
import { deleteSubmissionPdfArtifact, readSubmissionPdfArtifact, saveSubmissionPdfArtifact } from './submissionArtifactCache';
import { createHash } from 'crypto';
import { DB_VERSION, ensureReceiptDbStores, STORE_DRAFT_BACKUP_OUTBOX, STORE_IMAGES, STORE_RECEIPTS, STORE_SUBMISSION_ARTIFACTS } from './receiptDb';

function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function artifact(reportId, values = [1, 2, 3]) {
  const bytes = new Uint8Array(values);
  return { reportId, bytes, byteLength: bytes.byteLength, sha256: sha(bytes), chunkCount: 1, chunkSha256: [sha(bytes)], chunkByteLength: [bytes.byteLength], createdAt: '2026-09-12T00:00:00Z' };
}

function fakeDb() {
  const records = new Map();
  return {
    records,
    transaction(storeName) {
      expect(storeName).toBe(STORE_SUBMISSION_ARTIFACTS);
      const tx = {
        objectStore: () => ({
          put(value) { records.set(value.reportId, value); queueMicrotask(() => tx.oncomplete?.()); },
          get(key) {
            const request = {};
            queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); tx.oncomplete?.(); });
            return request;
          },
          delete(key) { records.delete(key); queueMicrotask(() => tx.oncomplete?.()); },
        }),
      };
      return tx;
    },
  };
}

describe('submission PDF artifact cache', () => {
  it('uses an additive IndexedDB schema version and dedicated store', () => {
    expect(DB_VERSION).toBe(10);
    expect(STORE_SUBMISSION_ARTIFACTS).toBe('receipt_submission_artifacts');
    expect(STORE_DRAFT_BACKUP_OUTBOX).toBe('draft_backup_outbox');
  });

  it('adds only the new store when upgrading an existing v8-style database', () => {
    const existing = new Set([STORE_RECEIPTS, STORE_IMAGES, 'sync_queue']);
    const created = [];
    const db = {
      objectStoreNames: { contains: name => existing.has(name) },
      createObjectStore(name) {
        created.push(name); existing.add(name);
        return { createIndex() {} };
      },
    };
    ensureReceiptDbStores(db);
    expect(created).toContain(STORE_SUBMISSION_ARTIFACTS);
    expect(created).toContain(STORE_DRAFT_BACKUP_OUTBOX);
    expect(created).not.toContain(STORE_RECEIPTS);
    expect(created).not.toContain(STORE_IMAGES);
    expect(existing.has(STORE_RECEIPTS)).toBe(true);
    expect(existing.has(STORE_IMAGES)).toBe(true);
  });

  it('copies PDF bytes into storage and returns an independent copy', async () => {
    const db = fakeDb();
    const value = artifact('11111111-1111-4111-8111-111111111111');
    await saveSubmissionPdfArtifact(value, db);
    const bytes = value.bytes;
    bytes[0] = 9;
    const saved = await readSubmissionPdfArtifact(value.reportId, db);
    expect([...saved.bytes]).toEqual([1, 2, 3]);
    saved.bytes[1] = 8;
    expect([...(await readSubmissionPdfArtifact(value.reportId, db)).bytes]).toEqual([1, 2, 3]);
  });

  it('rejects empty/oversized artifacts and invalid stored byte lengths', async () => {
    const db = fakeDb();
    const empty = artifact('11111111-1111-4111-8111-111111111111'); empty.bytes = new Uint8Array(); empty.byteLength = 0;
    await expect(saveSubmissionPdfArtifact(empty, db)).rejects.toThrow('size');
    const brokenId = '22222222-2222-4222-8222-222222222222';
    db.records.set(brokenId, { ...artifact(brokenId), bytes: new ArrayBuffer(2), byteLength: 3 });
    await expect(readSubmissionPdfArtifact(brokenId, db)).resolves.toBeNull();
  });

  it('deletes only the requested report artifact', async () => {
    const db = fakeDb();
    const a = '11111111-1111-4111-8111-111111111111'; const b = '22222222-2222-4222-8222-222222222222';
    await saveSubmissionPdfArtifact(artifact(a, [1]), db);
    await saveSubmissionPdfArtifact(artifact(b, [2]), db);
    await deleteSubmissionPdfArtifact(a, db);
    await expect(readSubmissionPdfArtifact(a, db)).resolves.toBeNull();
    expect([...(await readSubmissionPdfArtifact(b, db)).bytes]).toEqual([2]);
  });
});
