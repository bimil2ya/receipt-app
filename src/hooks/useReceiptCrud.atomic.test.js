import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', () => ({ useCallback: fn => fn }));

import useReceiptCrud from './useReceiptCrud';
import { _resetDeviceIdCacheForTest } from '../utils/storage';
import { STORE_HISTORY, STORE_IMAGES, STORE_RECEIPTS } from '../utils/receiptDb';

const clone = value => value === undefined ? undefined : structuredClone(value);

/** A deliberately small IndexedDB-shaped database. A readwrite transaction
 * works against private copies and publishes only on complete; abort therefore
 * verifies the same all-or-nothing property that the browser transaction gives
 * useReceiptCrud. */
function createDb({ receipts = [], images = [], failImagePut = false } = {}) {
  const state = new Map([
    [STORE_RECEIPTS, new Map(receipts.map(row => [row.id, clone(row)]) )],
    [STORE_IMAGES, new Map(images.map(row => [row.imageId, clone(row)]) )],
    [STORE_HISTORY, new Map()],
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
          const keyFor = row => name === STORE_IMAGES ? row.imageId : name === STORE_HISTORY ? (row.historyId ?? nextHistoryId) : row.id;
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
              if (name === STORE_IMAGES && failImagePut) {
                const error = new Error('image put failed');
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
    onCardsLoaded: () => {}, onSaveStatusChange: () => {},
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

describe('useReceiptCrud atomic mutation', () => {
  it('preserves an existing image and records history when an edit omits imageUrl', async () => {
    const blob = new Blob(['original'], { type: 'image/jpeg' });
    const db = createDb({ receipts: [receipt('r1', 'img1')], images: [{ imageId: 'img1', blob }] });
    await useCrudHarness(db).saveReceipts(receipt('r1', 'img1', { totalAmount: 2000 }));
    expect(read(db, STORE_RECEIPTS)[0]).toMatchObject({ id: 'r1', imageId: 'img1', totalAmount: 2000 });
    expect(await read(db, STORE_IMAGES)[0].blob.text()).toBe('original');
    expect(read(db, STORE_HISTORY)).toMatchObject([{ receiptId: 'r1', fieldChanged: 'totalAmount', oldValue: 1000, newValue: 2000 }]);
  });

  it('stores a newly captured image from imageUrl without keeping the data URL on the receipt', async () => {
    const db = createDb();
    await useCrudHarness(db).saveReceipts(receipt('r1', 'img1', { imageUrl: 'data:image/jpeg;base64,bmV3' }));
    expect(await read(db, STORE_IMAGES)[0].blob.text()).toBe('new');
    expect(read(db, STORE_RECEIPTS)[0].imageUrl).toBeUndefined();
  });

  it('still saves an edit when the receipt image is missing on this device', async () => {
    const db = createDb({ receipts: [receipt('r1', 'gone')] });
    await useCrudHarness(db).saveReceipts(receipt('r1', 'gone', { totalAmount: 5000 }));
    expect(read(db, STORE_RECEIPTS)[0]).toMatchObject({ id: 'r1', totalAmount: 5000 });
  });

  it('rejects missing or duplicate receipt ids before writing', async () => {
    const db = createDb();
    await expect(useCrudHarness(db).saveReceipts([receipt('r1', null), receipt('r1', null)])).rejects.toThrow('RECEIPT_ID_MISSING_OR_DUPLICATE');
    expect(read(db, STORE_RECEIPTS)).toEqual([]);
  });

  it('applies overlapping save and delete in call order without Web Locks', async () => {
    const db = createDb({ receipts: [receipt('r1', null)] });
    const crud = useCrudHarness(db);
    const saving = crud.saveReceipts(receipt('r1', null, { totalAmount: 2000 }));
    const deleting = crud.deleteReceipt('r1');
    await Promise.all([saving, deleting]);
    expect(read(db, STORE_RECEIPTS)).toEqual([]);
  });

  it('saves a receipt again after it was deleted', async () => {
    const db = createDb({ receipts: [receipt('r1', null)] });
    const crud = useCrudHarness(db);
    await crud.deleteReceipt('r1');
    await crud.saveReceipts(receipt('r1', null, { totalAmount: 3000 }));
    expect(read(db, STORE_RECEIPTS)).toMatchObject([{ id: 'r1', totalAmount: 3000 }]);
  });

  it('keeps a shared image when only one receipt is deleted', async () => {
    const blob = new Blob(['shared'], { type: 'image/png' });
    const db = createDb({ receipts: [receipt('r1', 'shared'), receipt('r2', 'shared')], images: [{ imageId: 'shared', blob }] });
    await useCrudHarness(db).deleteReceipt('r1');
    expect(read(db, STORE_RECEIPTS).map(row => row.id)).toEqual(['r2']);
    expect(await read(db, STORE_IMAGES)[0].blob.text()).toBe('shared');
  });

  it('deletes the image with the last receipt that uses it', async () => {
    const blob = new Blob(['only'], { type: 'image/png' });
    const db = createDb({ receipts: [receipt('r1', 'img1')], images: [{ imageId: 'img1', blob }] });
    await useCrudHarness(db).deleteReceipt('r1');
    expect(read(db, STORE_RECEIPTS)).toEqual([]);
    expect(read(db, STORE_IMAGES)).toEqual([]);
  });

  it('rolls back receipt, image, and history when the image write fails', async () => {
    const oldBlob = new Blob(['old'], { type: 'image/jpeg' });
    const db = createDb({ receipts: [receipt('r1', 'img1', { totalAmount: 1000 })], images: [{ imageId: 'img1', blob: oldBlob }], failImagePut: true });
    await expect(useCrudHarness(db).saveReceipts(receipt('r1', 'img1', { totalAmount: 9000, imageUrl: 'data:image/jpeg;base64,bmV3' }))).rejects.toBeTruthy();
    expect(read(db, STORE_RECEIPTS)[0]).toMatchObject({ totalAmount: 1000 });
    expect(await read(db, STORE_IMAGES)[0].blob.text()).toBe('old');
    expect(read(db, STORE_HISTORY)).toEqual([]);
  });
});
