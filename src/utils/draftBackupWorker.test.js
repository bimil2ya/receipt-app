import { describe, expect, it, vi } from 'vitest';
import {
  DRAFT_BACKUP_INITIAL_BACKOFF_MS,
  DRAFT_BACKUP_RETENTION,
  draftBackupBackoffMs,
  isStrictDraftBackupAck,
  runDraftBackupWorker,
} from './draftBackupWorker';

const hash = 'a'.repeat(64);
function operation(overrides = {}) {
  return {
    opId: 'operation-1', kind: 'upsert', receiptId: 'receipt-1', backupRevision: 2,
    receiptSnapshot: { id: 'receipt-1' }, image: { blob: new Blob(['photo']), byteLength: 5, chunkCount: 1, sha256: hash },
    attempts: 0, leaseToken: 'lease-1', ...overrides,
  };
}
function ackFor(op) {
  return { type: 'draft-backup', success: true, operationId: op.opId, receiptId: op.receiptId, backupRevision: op.backupRevision, imageSha256: op.image?.sha256 || null, manifestFileId: 'manifest-1' };
}

function fakeStore(operations) {
  const releases = []; const acknowledgements = [];
  return {
    claimDue: vi.fn(async () => operations),
    acknowledge: vi.fn(async input => { acknowledgements.push(input); return true; }),
    release: vi.fn(async input => { releases.push(input); }),
    releases, acknowledgements,
  };
}

describe('draft backup worker', () => {
  it('is disabled by default and makes no claim or network call', async () => {
    const store = fakeStore([operation()]); const transport = vi.fn();
    await expect(runDraftBackupWorker({ store, transport })).resolves.toEqual({ status: 'disabled', claimed: 0, acknowledged: 0, retained: 0 });
    expect(store.claimDue).not.toHaveBeenCalled(); expect(transport).not.toHaveBeenCalled();
  });

  it('only removes an operation after an exact strict commit acknowledgement', async () => {
    const op = operation(); const store = fakeStore([op]);
    await expect(runDraftBackupWorker({ enabled: true, store, transport: async item => ackFor(item), now: () => 100 })).resolves.toMatchObject({ acknowledged: 1, retained: 0 });
    expect(store.claimDue).toHaveBeenCalledWith({ now: 100, leaseMs: 60_000, limit: 3 });
    expect(store.acknowledge).toHaveBeenCalledWith({ opId: op.opId, leaseToken: op.leaseToken });
  });

  it('retains empty, mismatched, or incomplete acknowledgements with backoff', async () => {
    const op = operation(); const store = fakeStore([op]);
    await runDraftBackupWorker({ enabled: true, store, transport: async () => ({ type: 'draft-backup', success: true }), now: () => 500 });
    expect(store.acknowledge).not.toHaveBeenCalled();
    expect(store.releases).toEqual([expect.objectContaining({ opId: op.opId, leaseToken: op.leaseToken, attempts: 1, retryAt: 500 + DRAFT_BACKUP_INITIAL_BACKOFF_MS, lastError: 'DRAFT_BACKUP_INVALID_ACK' })]);
  });

  it('retains network failures and never marks them complete', async () => {
    const op = operation({ attempts: 2 }); const store = fakeStore([op]);
    await runDraftBackupWorker({ enabled: true, store, transport: async () => { throw new Error('offline'); }, now: () => 1000 });
    expect(store.acknowledge).not.toHaveBeenCalled();
    expect(store.releases[0]).toMatchObject({ attempts: 3, retryAt: 1000 + draftBackupBackoffMs(3), lastError: 'offline' });
  });

  it('retains malformed local records rather than sending them', async () => {
    const op = operation({ image: { blob: new Blob(['x']), byteLength: 1, chunkCount: 1, sha256: 'bad' } }); const store = fakeStore([op]); const transport = vi.fn();
    await runDraftBackupWorker({ enabled: true, store, transport, now: () => 0 });
    expect(transport).not.toHaveBeenCalled();
    expect(store.releases[0].lastError).toBe('INVALID_IMAGE_HASH');
  });

  it('uses an injected lock but relies on atomic claim for lease correctness', async () => {
    const op = operation(); const store = fakeStore([op]); const locks = { request: vi.fn(async (_name, _options, work) => work()) };
    await runDraftBackupWorker({ enabled: true, store, locks, transport: async item => ackFor(item) });
    expect(locks.request).toHaveBeenCalledWith('receipt-app:draft-backup-worker:v1', { mode: 'exclusive' }, expect.any(Function));
  });

  it('documents exponential backoff and retention until strict ack', () => {
    expect(draftBackupBackoffMs(1)).toBe(DRAFT_BACKUP_INITIAL_BACKOFF_MS);
    expect(draftBackupBackoffMs(2)).toBe(DRAFT_BACKUP_INITIAL_BACKOFF_MS * 2);
    expect(DRAFT_BACKUP_RETENTION).toBe('until-strict-commit-ack');
  });

  it('does not accept a hash from another image', () => {
    const op = operation();
    expect(isStrictDraftBackupAck({ ...ackFor(op), imageSha256: 'b'.repeat(64) }, op)).toBe(false);
  });
});
