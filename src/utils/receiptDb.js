import idbReady from 'safari-14-idb-fix';

export const DB_NAME = '미래생태공간_정산앱';
export const STORE_RECEIPTS = 'receipts';
export const STORE_HISTORY = 'edit_history';
export const STORE_TEAMS = 'teams';
export const STORE_CARDS = 'card_mapping';
export const STORE_IMAGES = 'receipt_images';
export const STORE_SYNC_QUEUE = 'sync_queue';
export const STORE_SYNC_EVENTS = 'sync_events';
export const STORE_SYNC_DAILY = 'sync_daily';
export const STORE_SUBMISSION_ARTIFACTS = 'receipt_submission_artifacts';
export const STORE_DRAFT_BACKUP_OUTBOX = 'draft_backup_outbox';
export const DB_VERSION = 10;

let dbCache = null;
const imageUrlCache = new Map();

export function ensureReceiptDbStores(db) {
  if (!db.objectStoreNames.contains(STORE_RECEIPTS)) db.createObjectStore(STORE_RECEIPTS, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(STORE_HISTORY)) {
    const hs = db.createObjectStore(STORE_HISTORY, { keyPath: 'historyId', autoIncrement: true });
    hs.createIndex('receiptId', 'receiptId', { unique: false });
  }
  if (!db.objectStoreNames.contains(STORE_TEAMS)) db.createObjectStore(STORE_TEAMS, { keyPath: 'teamId' });
  if (!db.objectStoreNames.contains(STORE_CARDS)) db.createObjectStore(STORE_CARDS, { keyPath: 'cardNumber' });
  if (!db.objectStoreNames.contains(STORE_IMAGES)) db.createObjectStore(STORE_IMAGES, { keyPath: 'imageId' });
  if (!db.objectStoreNames.contains(STORE_SYNC_QUEUE)) db.createObjectStore(STORE_SYNC_QUEUE, { keyPath: 'queueId' });
  if (!db.objectStoreNames.contains(STORE_SYNC_EVENTS)) db.createObjectStore(STORE_SYNC_EVENTS, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(STORE_SYNC_DAILY)) db.createObjectStore(STORE_SYNC_DAILY, { keyPath: 'date' });
  if (!db.objectStoreNames.contains(STORE_SUBMISSION_ARTIFACTS)) db.createObjectStore(STORE_SUBMISSION_ARTIFACTS, { keyPath: 'reportId' });
  // Additive only: pending silent Drive backups must survive receipt/image
  // edits and device resets until a future worker receives a strict ACK.
  if (!db.objectStoreNames.contains(STORE_DRAFT_BACKUP_OUTBOX)) db.createObjectStore(STORE_DRAFT_BACKUP_OUTBOX, { keyPath: 'opId' });
}

export function revokeReceiptImageUrl(imageId) {
  if (!imageId || !imageUrlCache.has(imageId)) return;
  URL.revokeObjectURL(imageUrlCache.get(imageId));
  imageUrlCache.delete(imageId);
}

export function clearReceiptImageUrlCache() {
  for (const url of imageUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  imageUrlCache.clear();
}

export async function openReceiptDb() {
  if (dbCache) return dbCache;
  await idbReady();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = e => {
      ensureReceiptDbStores(e.target.result);
    };
    request.onsuccess = e => {
      dbCache = e.target.result;
      dbCache.onversionchange = () => {
        try { dbCache.close(); } catch (error) {
          if (import.meta.env.DEV) console.error('IndexedDB versionchange close failed:', error);
        }
        dbCache = null;
      };
      resolve(dbCache);
    };
    request.onerror = e => reject(e.target.error);
  });
}

export async function getReceiptImageUrl(imageId) {
  if (!imageId) return null;
  if (imageUrlCache.has(imageId)) return imageUrlCache.get(imageId);
  const db = await openReceiptDb();
  const record = await new Promise(res => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const req = tx.objectStore(STORE_IMAGES).get(imageId);
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });
  if (!record?.blob) return null;
  const url = URL.createObjectURL(record.blob);
  imageUrlCache.set(imageId, url);
  return url;
}
