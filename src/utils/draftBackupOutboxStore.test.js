import { describe, expect, it } from 'vitest';
import { createDraftBackupOutboxStore } from './draftBackupOutboxStore';
import { STORE_DRAFT_BACKUP_OUTBOX } from './receiptDb';

const clone = value => value === undefined ? undefined : structuredClone(value);
function createDb(rows) {
  const state = new Map(rows.map(row => [row.opId, clone(row)]));
  let active = false; const waiting = [];
  return {
    rows: () => [...state.values()].map(clone),
    transaction(name, mode) {
      expect(name).toBe(STORE_DRAFT_BACKUP_OUTBOX); expect(mode).toBe('readwrite');
      let working; let started = false; let aborted = false; const pending = [];
      const tx = { error: null, oncomplete: null, onerror: null, onabort: null,
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore() { const request = fn => { const req = {}; const run = () => queueMicrotask(() => { try { req.result = fn(); req.onsuccess?.(); } catch (error) { req.error = error; req.onerror?.(); } }); if (started) run(); else pending.push(run); return req; };
          return { getAll: () => request(() => [...working.values()].map(clone)), get: id => request(() => clone(working.get(id))), put: row => request(() => working.set(row.opId, clone(row))), delete: id => request(() => working.delete(id)) };
        },
      };
      const start = () => { active = true; started = true; working = new Map([...state].map(([key, value]) => [key, clone(value)])); pending.splice(0).forEach(run => run()); setTimeout(() => { if (!aborted) { state.clear(); for (const [key, value] of working) state.set(key, value); tx.oncomplete?.(); } active = false; waiting.shift()?.(); }, 0); };
      if (active) waiting.push(start); else start(); return tx;
    },
  };
}
const op = (id, extra = {}) => ({ opId: id, kind: 'delete', receiptId: id, backupRevision: 1, createdAt: id, attempts: 0, ...extra });

describe('IndexedDB draft backup outbox store', () => {
  it('atomically claims only due unleased operations with unique lease tokens', async () => {
    const db = createDb([op('a'), op('b', { retryAt: 1001 }), op('c', { leaseExpiresAt: 1001 })]);
    let token = 0; const store = createDraftBackupOutboxStore({ dbOpen: async () => db, makeLeaseToken: () => `lease-${++token}` });
    const [first, second] = await Promise.all([
      store.claimDue({ now: 1000, leaseMs: 50, limit: 2 }),
      store.claimDue({ now: 1000, leaseMs: 50, limit: 2 }),
    ]);
    expect(first.map(item => item.opId)).toEqual(['a']);
    expect(second).toEqual([]);
    expect(db.rows().find(item => item.opId === 'a')).toMatchObject({ leaseToken: 'lease-1', leaseExpiresAt: 1050 });
  });

  it('allows a lease to be reclaimed only after it expires', async () => {
    const db = createDb([op('a', { leaseToken: 'old', leaseExpiresAt: 99 })]);
    const store = createDraftBackupOutboxStore({ dbOpen: async () => db, makeLeaseToken: () => 'fresh' });
    await expect(store.claimDue({ now: 100, leaseMs: 10, limit: 1 })).resolves.toMatchObject([{ opId: 'a', leaseToken: 'fresh' }]);
  });

  it('claims only the newest revision for each receipt, even when timestamps tie', async () => {
    const db = createDb([
      op('receipt-a-v1', { receiptId: 'receipt-a', backupRevision: 1, createdAt: 'same' }),
      op('receipt-a-v2', { receiptId: 'receipt-a', backupRevision: 2, createdAt: 'same' }),
      op('receipt-a-v3', { receiptId: 'receipt-a', backupRevision: 3, createdAt: 'same' }),
      op('receipt-b-v1', { receiptId: 'receipt-b', backupRevision: 1, createdAt: 'same' }),
    ]);
    let token = 0;
    const store = createDraftBackupOutboxStore({ dbOpen: async () => db, makeLeaseToken: () => `lease-${++token}` });

    const claimed = await store.claimDue({ now: 100, leaseMs: 10, limit: 3 });

    expect(claimed).toHaveLength(2);
    expect(claimed.map(item => item.opId)).toEqual(['receipt-a-v3', 'receipt-b-v1']);
    expect(db.rows().find(item => item.opId === 'receipt-a-v1')).not.toHaveProperty('leaseToken');
    expect(db.rows().find(item => item.opId === 'receipt-a-v2')).not.toHaveProperty('leaseToken');
  });

  it('does not send an older due revision while the newest revision is leased or deferred', async () => {
    const db = createDb([
      op('old', { receiptId: 'receipt-a', backupRevision: 1 }),
      op('new', { receiptId: 'receipt-a', backupRevision: 2, leaseToken: 'other-tab', leaseExpiresAt: 200 }),
    ]);
    const store = createDraftBackupOutboxStore({ dbOpen: async () => db });

    await expect(store.claimDue({ now: 100, leaseMs: 10, limit: 1 })).resolves.toEqual([]);
  });

  it('deletes only when the exact current lease acknowledges', async () => {
    const db = createDb([op('a', { leaseToken: 'live', leaseExpiresAt: 100 })]);
    const store = createDraftBackupOutboxStore({ dbOpen: async () => db });
    await expect(store.acknowledge({ opId: 'a', leaseToken: 'late' })).resolves.toBe(false);
    expect(db.rows()).toHaveLength(1);
    await expect(store.acknowledge({ opId: 'a', leaseToken: 'live' })).resolves.toBe(true);
    expect(db.rows()).toEqual([]);
  });

  it('backs off only the exact lease and preserves the operation after failure', async () => {
    const db = createDb([op('a', { leaseToken: 'live', leaseExpiresAt: 100 })]);
    const store = createDraftBackupOutboxStore({ dbOpen: async () => db });
    await expect(store.release({ opId: 'a', leaseToken: 'late', now: 10, attempts: 1, retryAt: 30, lastError: 'late' })).resolves.toBe(false);
    await expect(store.release({ opId: 'a', leaseToken: 'live', now: 10, attempts: 2, retryAt: 70, lastError: 'offline' })).resolves.toBe(true);
    expect(db.rows()).toEqual([expect.objectContaining({ opId: 'a', attempts: 2, retryAt: 70, lastError: 'offline', leaseToken: null, leaseExpiresAt: null })]);
  });
});
