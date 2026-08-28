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
export const DB_VERSION = 8;

let dbCache = null;
const MAX_CACHE_SIZE = 50; // 최대 50개 이미지만 메모리에 유지
const imageUrlCache = new Map();
const imageCacheOrder = []; // LRU 추적용

function evictOldestFromCache() {
  if (imageCacheOrder.length === 0) return;
  const oldestId = imageCacheOrder.shift();
  if (imageUrlCache.has(oldestId)) {
    const url = imageUrlCache.get(oldestId);
    URL.revokeObjectURL(url);
    imageUrlCache.delete(oldestId);
  }
}

export function revokeReceiptImageUrl(imageId) {
  if (!imageId || !imageUrlCache.has(imageId)) return;
  const url = imageUrlCache.get(imageId);
  URL.revokeObjectURL(url);
  imageUrlCache.delete(imageId);
  const idx = imageCacheOrder.indexOf(imageId);
  if (idx > -1) imageCacheOrder.splice(idx, 1);
}

export function clearReceiptImageUrlCache() {
  for (const url of imageUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  imageUrlCache.clear();
  imageCacheOrder.length = 0;
}

export async function openReceiptDb() {
  if (dbCache) return dbCache;
  await idbReady();
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = e => {
      const db = e.target.result;
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

  // 캐시 히트: LRU 순서 업데이트
  if (imageUrlCache.has(imageId)) {
    const idx = imageCacheOrder.indexOf(imageId);
    if (idx > -1) imageCacheOrder.splice(idx, 1);
    imageCacheOrder.push(imageId);
    return imageUrlCache.get(imageId);
  }

  // 캐시 미스: IndexedDB에서 로드
  const db = await openReceiptDb();
  const record = await new Promise(res => {
    const tx = db.transaction(STORE_IMAGES, 'readonly');
    const req = tx.objectStore(STORE_IMAGES).get(imageId);
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  });

  if (!record?.blob) return null;

  // 캐시 크기 제한: LRU 방식으로 가장 오래된 항목 제거
  if (imageUrlCache.size >= MAX_CACHE_SIZE) {
    evictOldestFromCache();
  }

  const url = URL.createObjectURL(record.blob);
  imageUrlCache.set(imageId, url);
  imageCacheOrder.push(imageId);
  return url;
}
