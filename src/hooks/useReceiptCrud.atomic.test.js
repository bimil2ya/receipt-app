import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({ useCallback: fn => fn }));
vi.mock('../utils/supabase', () => ({ supabase: null }));

import useReceiptCrud from './useReceiptCrud';
import { _resetDeviceIdCacheForTest } from '../utils/storage';
import { STORE_DRAFT_BACKUP_OUTBOX, STORE_HISTORY, STORE_IMAGES, STORE_RECEIPTS } from '../utils/receiptDb';

const clone = value => value === undefined ? undefined : structuredClone(value);

/** A deliberately small IndexedDB-shaped database. A readwrite transaction
 * works against private copies and publishes only on complete; abort therefore
 * verifies the same all-or-nothing property that the browser transaction gives
 * useReceiptCrud. */
function createDb({ receipts = [], images = [], failOutboxPut = false } = {}) {
  const state = new Map([
    [STORE_RECEIPTS, new Map(receipts.map(row => [row.id, clone(row)]) )],
    [STORE_IMAGES, new Map(images.map(row => [row.imageId, clone(row)]) )],
    [STORE_HISTORY, new Map()],
    [STORE_DRAFT_BACKUP_OUTBOX, new Map()],
  ]);
  let nextHistoryId = 1;
  let activeReadwrite = false;
  const pendingReadwrite = [];
  const snapshot = name => new Map([...state.get(name)].map(([key, value]) => [key, clone(value)]));

  return {
    state,
    transaction(names, mode) {
      names = Array.isArray(names) ? names : [names];
      const readwrite = mode === 'readwrite';
      let working = null;
      let started = false;
      let aborted = false;
      const pendingRequests = [];
      const tx = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        abort() {
          if (aborted) return;
          aborted = true;
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore(name) {
          const keyFor = row => name === STORE_IMAGES ? row.imageId : name === STORE_HISTORY ? (row.historyId ?? nextHistoryId) : name === STORE_DRAFT_BACKUP_OUTBOX ? row.opId : row.id;
          const request = action => {
            const result = {};
            const run = () => queueMicrotask(() => {
              try { result.result = action(); result.onsuccess?.(); }
              catch (error) { result.error = error; result.onerror?.(); }
            });
            if (started) run(); else pendingRequests.push(run);
            return result;
          };
          return {
            get: key => request(() => clone(working.get(name).get(key))),
            getAll: () => request(() => [...working.get(name).values()].map(clone)),
            put: row => request(() => {
              if (name === STORE_DRAFT_BACKUP_OUTBOX && failOutboxPut) {
                const error = new Error('outbox put failed');
                tx.error = error; tx.abort(); throw error;
              }
              const record = clone(row); const key = keyFor(record); working.get(name).set(key, record); return key;
            }),
            add: row => request(() => {
              const record = clone(row); const key = keyFor(record);
              if (name === STORE_HISTORY && record.historyId == null) {
                record.historyId = nextHistoryId++; working.get(name).set(record.historyId, record); return record.historyId;
              }
              working.get(name).set(key, record); return key;
            }),
            delete: key => request(() => working.get(name).delete(key)),
          };
        },
      };
      const finish = () => {
        if (readwrite) {
          activeReadwrite = false;
          const next = pendingReadwrite.shift();
          next?.();
        }
      };
      const activate = () => {
        started = true;
        working = new Map(names.map(name => [name, readwrite ? snapshot(name) : state.get(name)]));
        pendingRequests.splice(0).forEach(run => run());
        // Requests registered by the caller run as microtasks before this timer.
        setTimeout(() => {
          if (!aborted && readwrite) names.forEach(name => { state.set(name, working.get(name)); });
          if (!aborted) tx.oncomplete?.();
          finish();
        }, 0);
      };
      if (readwrite) {
        const startWhenAvailable = () => { activeReadwrite = true; activate(); };
        if (activeReadwrite) pendingReadwrite.push(startWhenAvailable);
        else startWhenAvailable();
      } else {
        activate();
      }
      return tx;
    },
  };
}
function useCrudHarness(db) {
  const receipts = [];
  return useReceiptCrud({
    dbOpen: async () => db,
    onReceiptsLoaded: update => { const next = update(receipts); receipts.splice(0, receipts.length, ...next); },
    onCardsLoaded: () => {}, onSaveStatusChange: () => {}, onSyncStatusChange: () => {},
    appendSyncOp: async () => {}, retryPendingSync: () => {}, recordSyncEvent: () => {}, resetSyncQueue: async () => {},
  });
}
const receipt = (id, imageId, extra = {}) => ({ id, imageId, totalAmount: 1000, date: '2026-09-23', storeName: '상점', category: '식비', ...extra });
const read = (db, name) => [...db.state.get(name).values()];

beforeEach(() => {
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), clear: () => values.clear() });
  localStorage.clear();
  _resetDeviceIdCacheForTest();
  vi.stubGlobal('navigator', {}); // prove IndexedDB transaction, not Web Locks, is the boundary
});

describe('useReceiptCrud draft backup atomic mutation', () => {
  it('preserves an existing image when an edit omits imageUrl and records the same snapshot in the outbox', async () => {
    const blob = new Blob(['original'], { type: 'image/jpeg' });
    const db = createDb({ receipts: [receipt('r1', 'img1', { backupRevision: 3 })], images: [{ imageId: 'img1', blob }] });
    await useCrudHarness(db).saveReceipts(receipt('r1', 'img1', { totalAmount: 2000 }));
    const saved = read(db, STORE_RECEIPTS)[0];
    const outbox = read(db, STORE_DRAFT_BACKUP_OUTBOX)[0];
    expect(saved.backupRevision).toBe(4);
    expect(read(db, STORE_IMAGES)[0].blob.size).toBe(blob.size);
    expect(outbox).toMatchObject({ kind: 'upsert', receiptId: 'r1', backupRevision: 4, image: { byteLength: blob.size } });
    expect(await outbox.image.blob.text()).toBe('original');
  });

  it('serializes overlapping save and delete calls into distinct revisions without Web Locks', async () => {
    const db = createDb({ receipts: [receipt('r1', null, { backupRevision: 1 })] });
    const crud = useCrudHarness(db);

    // Do not await between calls: the delete opens a write transaction while
    // save is still preparing its snapshot. The test database queues
    // read/write transactions like IndexedDB for overlapping object stores.
    const saving = crud.saveReceipts(receipt('r1', null, { totalAmount: 2000 }));
    const deleting = crud.deleteReceipt('r1');
    await Promise.all([saving, deleting]);

    expect(read(db, STORE_DRAFT_BACKUP_OUTBOX).map(op => [op.kind, op.backupRevision])).toEqual([
      ['delete', 2], ['upsert', 3],
    ]);
    expect(read(db, STORE_RECEIPTS)).toMatchObject([{ id: 'r1', totalAmount: 2000, backupRevision: 3 }]);
  });

  it('orders a save followed by delete as consecutive outbox revisions without Web Locks', async () => {
    const db = createDb({ receipts: [receipt('r1', null, { backupRevision: 1 })] });
    const crud = useCrudHarness(db);
    await crud.saveReceipts(receipt('r1', null, { totalAmount: 2000 }));
    await crud.deleteReceipt('r1');
    expect(read(db, STORE_RECEIPTS)).toEqual([]);
    expect(read(db, STORE_DRAFT_BACKUP_OUTBOX).map(op => [op.kind, op.backupRevision])).toEqual([['upsert', 2], ['delete', 3]]);
  });

  it('uses the tombstone high-water mark when a deleted receipt is saved again', async () => {
    const db = createDb({ receipts: [receipt('r1', null, { backupRevision: 1 })] });
    const crud = useCrudHarness(db);
    await crud.saveReceipts(receipt('r1', null, { totalAmount: 2000 }));
    await crud.deleteReceipt('r1');
    await crud.saveReceipts(receipt('r1', null, { totalAmount: 3000 }));

    expect(read(db, STORE_RECEIPTS)[0]).toMatchObject({ id: 'r1', backupRevision: 4, totalAmount: 3000 });
    expect(read(db, STORE_DRAFT_BACKUP_OUTBOX).map(op => [op.kind, op.backupRevision])).toEqual([
      ['upsert', 2], ['delete', 3], ['upsert', 4],
    ]);
  });

  it('keeps a shared image when only one receipt is deleted', async () => {
    const blob = new Blob(['shared'], { type: 'image/png' });
    const db = createDb({ receipts: [receipt('r1', 'shared', { backupRevision: 1 }), receipt('r2', 'shared', { backupRevision: 7 })], images: [{ imageId: 'shared', blob }] });
    await useCrudHarness(db).deleteReceipt('r1');
    expect(read(db, STORE_RECEIPTS).map(row => row.id)).toEqual(['r2']);
    expect(await read(db, STORE_IMAGES)[0].blob.text()).toBe('shared');
    expect(read(db, STORE_DRAFT_BACKUP_OUTBOX)[0]).toMatchObject({ kind: 'delete', receiptId: 'r1', backupRevision: 2 });
  });

  it('rolls back receipt, image, history, and outbox when outbox recording fails', async () => {
    const oldBlob = new Blob(['old'], { type: 'image/jpeg' });
    const db = createDb({ receipts: [receipt('r1', 'img1', { backupRevision: 2, totalAmount: 1000 })], images: [{ imageId: 'img1', blob: oldBlob }], failOutboxPut: true });
    await expect(useCrudHarness(db).saveReceipts(receipt('r1', 'img1', { totalAmount: 9000, imageUrl: 'data:image/jpeg;base64,bmV3' }))).rejects.toThrow('outbox put failed');
    expect(read(db, STORE_RECEIPTS)[0]).toMatchObject({ backupRevision: 2, totalAmount: 1000 });
    expect(await read(db, STORE_IMAGES)[0].blob.text()).toBe('old');
    expect(read(db, STORE_HISTORY)).toEqual([]);
    expect(read(db, STORE_DRAFT_BACKUP_OUTBOX)).toEqual([]);
  });
});
