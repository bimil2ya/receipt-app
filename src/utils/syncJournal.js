import { buildDailyRows, pruneByRetention, sortByNewest } from './syncStats';

export const SYNC_EVENTS_KEY = 'receipt_sync_events_v1';
export const SYNC_DAILY_KEY = 'receipt_sync_daily_v1';
export const SYNC_EVENT_RETENTION = 90;
export const SYNC_DAILY_RETENTION = 365;

export function readJsonStorage(key, fallback = []) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 기록 저장 실패는 동작을 막지 않는다.
  }
}

export function loadSyncEventsFromDb(db, storeName, limit = 30) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(sortByNewest(req.result || [], 'at').slice(0, limit));
    req.onerror = () => reject(req.error);
  });
}

export function loadAllSyncEventsFromDb(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(sortByNewest(req.result || [], 'at'));
    req.onerror = () => reject(req.error);
  });
}

export function loadSyncDailyFromDb(db, storeName, limit = 60) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(sortByNewest(req.result || [], 'updatedAt').slice(0, limit));
    req.onerror = () => reject(req.error);
  });
}

export function loadAllSyncDailyFromDb(db, storeName) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(sortByNewest(req.result || [], 'updatedAt'));
    req.onerror = () => reject(req.error);
  });
}

export function backfillSyncDailyRows(events = []) {
  return buildDailyRows(events);
}

export function rebuildRecentDailyRows(events = [], existingRows = [], windowDays = 7, limit = 60) {
  const recentCutoff = Date.now() - (windowDays * 24 * 60 * 60 * 1000);
  const recentRows = buildDailyRows((Array.isArray(events) ? events : []).filter(event => (event?.at || 0) >= recentCutoff));
  const preservedRows = (Array.isArray(existingRows) ? existingRows : []).filter(row => !recentRows.some(recent => recent.date === row.date));
  return sortByNewest([...preservedRows, ...recentRows], 'updatedAt').slice(0, limit);
}

export function trimSyncRetention(events = [], daily = []) {
  return {
    events: pruneByRetention(events, SYNC_EVENT_RETENTION, 'at'),
    daily: pruneByRetention(daily, SYNC_DAILY_RETENTION, 'updatedAt'),
  };
}

export function mergeLegacySyncEvents(existingEvents = [], legacyEvents = [], limit = 30) {
  const mergedById = new Map();
  [...existingEvents, ...legacyEvents].forEach(event => {
    if (event?.id) mergedById.set(event.id, event);
  });
  return sortByNewest([...mergedById.values()], 'at').slice(0, limit);
}

export async function persistSyncRetentionDb(db, eventStoreName, dailyStoreName) {
  const [events, daily] = await Promise.all([
    loadAllSyncEventsFromDb(db, eventStoreName),
    loadAllSyncDailyFromDb(db, dailyStoreName),
  ]);
  const trimmed = trimSyncRetention(events, daily);
  if (events.length <= SYNC_EVENT_RETENTION && daily.length <= SYNC_DAILY_RETENTION) {
    return { events, daily };
  }

  await new Promise((resolve, reject) => {
    const tx = db.transaction([eventStoreName, dailyStoreName], 'readwrite');
    const eventStore = tx.objectStore(eventStoreName);
    const dailyStore = tx.objectStore(dailyStoreName);
    eventStore.clear();
    dailyStore.clear();
    trimmed.events.forEach(item => eventStore.put(item));
    trimmed.daily.forEach(item => dailyStore.put(item));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  return trimmed;
}

export async function migrateLegacySyncEventsDb(db, storeName, legacyEvents = [], limit = 30) {
  if (!Array.isArray(legacyEvents) || legacyEvents.length === 0) {
    return loadAllSyncEventsFromDb(db, storeName);
  }

  const existingEvents = await loadAllSyncEventsFromDb(db, storeName);
  const merged = mergeLegacySyncEvents(existingEvents, legacyEvents, limit);

  await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    merged.forEach(item => store.put(item));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  return merged;
}
