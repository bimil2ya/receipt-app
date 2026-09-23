import { describe, expect, it, vi } from 'vitest';
import { buildDraftBackupTombstone, buildDraftBackupUpsert, CHUNK_BYTES, prepareDraftBackupImageSnapshot } from './draftBackupOutbox';

describe('draft backup outbox snapshots', () => {
  it('pins receipt and original image bytes into one immutable operation', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'op-1', subtle: globalThis.crypto.subtle });
    const receipt = { id: 'r1', backupRevision: 2, totalAmount: 1000 };
    const imageSnapshot = await prepareDraftBackupImageSnapshot(new Blob([new Uint8Array(CHUNK_BYTES + 1)], { type: 'image/png' }));
    const operation = buildDraftBackupUpsert({ receipt, imageSnapshot, deviceId: 'device-1' });
    receipt.totalAmount = 9;
    expect(operation).toMatchObject({ opId: 'op-1', kind: 'upsert', receiptId: 'r1', backupRevision: 2, image: { byteLength: CHUNK_BYTES + 1, chunkCount: 2, mimeType: 'image/png' } });
    expect(operation.receiptSnapshot.totalAmount).toBe(1000);
    vi.unstubAllGlobals();
  });

  it('requires a positive versioned tombstone', () => {
    expect(() => buildDraftBackupTombstone({ receiptId: 'r1', backupRevision: 0, deviceId: 'd1' })).toThrow('DRAFT_BACKUP');
  });
});
