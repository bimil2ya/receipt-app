import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { getOrCreateDeviceId } from '../utils/storage';
import { formatFailureDetail } from '../utils/errorCopy';
import { buildDailyRows, sortByNewest, toDayKey } from '../utils/syncStats';
import {
  backfillSyncDailyRows,
  loadAllSyncDailyFromDb as loadAllSyncDaily,
  loadAllSyncEventsFromDb as loadAllSyncEvents,
  loadSyncDailyFromDb as loadSyncDaily,
  loadSyncEventsFromDb as loadSyncEvents,
  migrateLegacySyncEventsDb,
  persistSyncRetentionDb,
  rebuildRecentDailyRows,
  readJsonStorage,
  writeJsonStorage,
  SYNC_DAILY_KEY,
  SYNC_EVENTS_KEY,
} from '../utils/syncJournal';
import {
  STORE_SYNC_DAILY,
  STORE_SYNC_EVENTS,
  STORE_SYNC_QUEUE,
} from '../utils/receiptDb';

export const SYNC_MAX_ATTEMPTS = 5;
export const SYNC_BASE_DELAY_MS = 5_000;
export const SYNC_MAX_DELAY_MS = 5 * 60 * 1000;

export function computeBackoff(attempts, baseDelay = SYNC_BASE_DELAY_MS, maxDelay = SYNC_MAX_DELAY_MS) {
  return Math.min(maxDelay, baseDelay * 2 ** attempts);
}

export function shouldDropOp(op, maxAttempts = SYNC_MAX_ATTEMPTS) {
  return (op.attempts || 0) >= maxAttempts;
}

export function shouldDeferOp(op, now = Date.now()) {
  return !!(op.nextAttemptAt && op.nextAttemptAt > now);
}

// 큐 처리 순수 함수 — Supabase/IndexedDB 콜백을 주입받아 독립적으로 테스트 가능
export async function processQueue(queue, { supabase, deleteQueueItem, updateQueueItem, recordSyncEvent, now = Date.now(), deviceUserId }) {
  let processed = 0, failed = 0, deferred = 0, dropped = 0, lastError = null;

  for (const op of queue) {
    if (!op) continue;
    const attempts = op.attempts || 0;

    if (shouldDropOp(op)) {
      await deleteQueueItem(op.queueId).catch(() => {});
      dropped += 1;
      recordSyncEvent({ kind: 'sync', status: 'error', title: '보류 작업 포기', detail: `재시도 ${attempts}회 초과 (${op.type})` });
      continue;
    }

    if (shouldDeferOp(op, now)) { deferred += 1; continue; }

    try {
      if (op.type === 'upsert') {
        const { error } = await supabase.from('receipts').upsert(op.items || []);
        if (error) throw error;
      } else if (op.type === 'delete') {
        const uid = op.userId || deviceUserId;
        if (!uid) throw new Error('delete op: userId missing');
        const { error } = await supabase.from('receipts').delete().eq('id', op.id).eq('userId', uid);
        if (error) throw error;
      }
      await deleteQueueItem(op.queueId);
      processed += 1;
    } catch (err) {
      lastError = err;
      failed += 1;
      await updateQueueItem({
        ...op,
        attempts: attempts + 1,
        lastAttemptAt: now,
        nextAttemptAt: now + computeBackoff(attempts),
        lastError: formatFailureDetail(err),
      }).catch(() => {});
    }
  }

  return { processed, failed, deferred, dropped, lastError };
}

export default function useReceiptSync({ dbOpen, loading, onSyncStatusChange }) {
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [syncEvents, setSyncEvents] = useState(() => readJsonStorage(SYNC_EVENTS_KEY, []));
  const [syncDaily, setSyncDaily] = useState([]);
  const syncingRef = useRef(false);
  const syncEventWriteRef = useRef(Promise.resolve());

  const loadSyncQueue = useCallback(async (dbArg) => {
    const db = dbArg || await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readonly');
      const req = tx.objectStore(STORE_SYNC_QUEUE).getAll();
      req.onsuccess = () => resolve((req.result || []).sort((a, b) => (a.queuedAt || 0) - (b.queuedAt || 0)));
      req.onerror = () => reject(req.error);
    });
  }, [dbOpen]);

  const appendSyncOp = useCallback(async (op) => {
    const db = await dbOpen();
    const item = { ...op, queuedAt: Date.now(), queueId: crypto.randomUUID() };
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      tx.objectStore(STORE_SYNC_QUEUE).put(item);
      tx.oncomplete = () => {
        setPendingSyncCount(prev => prev + 1);
        resolve(item);
      };
      tx.onerror = () => reject(tx.error);
    });
  }, [dbOpen]);

  const deleteQueueItem = useCallback(async (queueId) => {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      tx.objectStore(STORE_SYNC_QUEUE).delete(queueId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, [dbOpen]);

  const updateQueueItem = useCallback(async (item) => {
    const db = await dbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
      tx.objectStore(STORE_SYNC_QUEUE).put(item);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }, [dbOpen]);

  const recordSyncEvent = useCallback((event) => {
    const item = { id: crypto.randomUUID(), at: Date.now(), ...event };
    syncEventWriteRef.current = syncEventWriteRef.current.then(async () => {
      try {
        const db = await dbOpen();

        // Promise로 transaction을 래핑: onsuccess/onerror 콜백이 완료될 때까지 대기
        return new Promise((resolve, reject) => {
          const tx = db.transaction([STORE_SYNC_EVENTS, STORE_SYNC_DAILY], 'readwrite');
          const eventStore = tx.objectStore(STORE_SYNC_EVENTS);
          const dailyStore = tx.objectStore(STORE_SYNC_DAILY);

          // 1. event를 먼저 저장
          eventStore.put(item);

          // 2. daily 통계를 읽고 업데이트 (같은 transaction 내에서)
          const dailyKey = toDayKey(item.at);
          const dailyReq = dailyStore.get(dailyKey);

          dailyReq.onsuccess = () => {
            const current = dailyReq.result || {
              date: dailyKey,
              total: 0,
              success: 0,
              error: 0,
              save: 0,
              sync: 0,
              deleteCount: 0,
              updatedAt: 0,
            };

            // 같은 transaction 내에서 put 호출
            dailyStore.put({
              ...current,
              date: dailyKey,
              total: (current.total || 0) + 1,
              success: (current.success || 0) + (item.status === 'success' ? 1 : 0),
              error: (current.error || 0) + (item.status === 'error' ? 1 : 0),
              save: (current.save || 0) + (item.kind === 'save' ? 1 : 0),
              sync: (current.sync || 0) + (item.kind === 'sync' ? 1 : 0),
              deleteCount: (current.deleteCount || 0) + (item.kind === 'delete' ? 1 : 0),
              updatedAt: item.at,
            });
          };

          dailyReq.onerror = () => reject(dailyReq.error);

          // Transaction 완료: 새로운 DB 핸들에서 조회
          tx.oncomplete = async () => {
            try {
              const db2 = await dbOpen();
              await persistSyncRetentionDb(db2, STORE_SYNC_EVENTS, STORE_SYNC_DAILY);
              const [events, daily] = await Promise.all([
                loadSyncEvents(db2),
                loadSyncDaily(db2)
              ]);
              setSyncEvents(events);
              setSyncDaily(daily);
              resolve();
            } catch (err) {
              reject(err);
            }
          };

          tx.onerror = () => reject(tx.error);
        });
      } catch (error) {
        // Fallback: IndexedDB 실패 시 localStorage 사용
        const fallback = sortByNewest([item, ...readJsonStorage(SYNC_EVENTS_KEY, [])], 'at').slice(0, 30);
        writeJsonStorage(SYNC_EVENTS_KEY, fallback);
        setSyncEvents(fallback);
        const fallbackDaily = buildDailyRows(fallback);
        writeJsonStorage(SYNC_DAILY_KEY, fallbackDaily);
        setSyncDaily(fallbackDaily.slice(0, 60));
      }
    }).catch(() => {});
    return syncEventWriteRef.current;
  }, [dbOpen]);

  const flushSyncQueue = useCallback(async () => {
    if (!supabase || syncingRef.current) return;
    const queue = await loadSyncQueue();
    if (queue.length === 0) {
      setPendingSyncCount(0);
      return;
    }

    syncingRef.current = true;
    onSyncStatusChange?.('syncing');

    try {
      const { processed, failed, deferred, dropped, lastError } = await processQueue(queue, {
        supabase,
        deleteQueueItem,
        updateQueueItem,
        recordSyncEvent,
        deviceUserId: getOrCreateDeviceId(),
      });

      const remaining = failed + deferred + (queue.length - processed - failed - deferred - dropped);
      setPendingSyncCount(Math.max(0, remaining));

      if (failed === 0 && processed > 0) {
        onSyncStatusChange?.('success');
        recordSyncEvent({
          kind: 'sync',
          status: 'success',
          title: '보류 작업 전송 완료',
          detail: `${processed}건 처리${dropped > 0 ? ` (${dropped}건 포기)` : ''}`,
        });
      } else if (failed > 0) {
        onSyncStatusChange?.('error');
        recordSyncEvent({
          kind: 'sync',
          status: 'error',
          title: '보류 작업 일부 실패',
          detail: `${processed}건 처리 / ${failed}건 재시도 예약${dropped > 0 ? ` / ${dropped}건 포기` : ''} · ${formatFailureDetail(lastError)}`,
        });
      }
    } finally {
      syncingRef.current = false;
    }
  }, [deleteQueueItem, loadSyncQueue, onSyncStatusChange, recordSyncEvent, updateQueueItem]);

  useEffect(() => {
    (async () => {
      try {
        const db = await dbOpen();
        await migrateLegacySyncEventsDb(db, STORE_SYNC_EVENTS, readJsonStorage(SYNC_EVENTS_KEY, []));
        const events = await loadAllSyncEvents(db);
        let daily = await loadAllSyncDaily(db);
        if (events.length > 0) {
          daily = rebuildRecentDailyRows(events, daily);
        } else if (daily.length === 0) {
          daily = backfillSyncDailyRows(events);
        }
        setSyncEvents(events);
        setSyncDaily(daily);
        const queue = await loadSyncQueue(db);
        setPendingSyncCount(queue.length);
      } catch {
        const fallbackEvents = sortByNewest(readJsonStorage(SYNC_EVENTS_KEY, []), 'at').slice(0, 30);
        const fallbackDaily = sortByNewest(readJsonStorage(SYNC_DAILY_KEY, []), 'updatedAt').slice(0, 60);
        setSyncEvents(fallbackEvents);
        setSyncDaily(fallbackDaily.length > 0 ? fallbackDaily : buildDailyRows(fallbackEvents));
        setPendingSyncCount(0);
      }
    })();
  }, [dbOpen, loadSyncQueue]);

  useEffect(() => {
    if (!loading && supabase) {
      flushSyncQueue();
    }
  }, [flushSyncQueue, loading]);

  useEffect(() => {
    if (!supabase || typeof window === 'undefined') return;
    const onRetry = () => flushSyncQueue();
    window.addEventListener('online', onRetry);
    window.addEventListener('focus', onRetry);
    return () => {
      window.removeEventListener('online', onRetry);
      window.removeEventListener('focus', onRetry);
    };
  }, [flushSyncQueue]);

  const resetActivityLogs = useCallback(async () => {
    const db = await dbOpen();
    const tx = db.transaction([STORE_SYNC_EVENTS, STORE_SYNC_DAILY], 'readwrite');
    tx.objectStore(STORE_SYNC_EVENTS).clear();
    tx.objectStore(STORE_SYNC_DAILY).clear();
    writeJsonStorage(SYNC_EVENTS_KEY, []);
    writeJsonStorage(SYNC_DAILY_KEY, []);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { setSyncEvents([]); setSyncDaily([]); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }, [dbOpen]);

  const resetSyncQueue = useCallback(async () => {
    const db = await dbOpen();
    const tx = db.transaction(STORE_SYNC_QUEUE, 'readwrite');
    tx.objectStore(STORE_SYNC_QUEUE).clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { setPendingSyncCount(0); resolve(); };
      tx.onerror = () => reject(tx.error);
    });
  }, [dbOpen]);

  return {
    pendingSyncCount,
    syncEvents,
    syncDaily,
    appendSyncOp,
    deleteQueueItem,
    recordSyncEvent,
    retryPendingSync: flushSyncQueue,
    resetActivityLogs,
    resetSyncQueue,
  };
}
