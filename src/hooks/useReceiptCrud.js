import { useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { formatFailureDetail } from '../utils/errorCopy';
import { base64ToBlob, getOrCreateDeviceId } from '../utils/storage';
import {
  STORE_CARDS,
  STORE_HISTORY,
  STORE_IMAGES,
  STORE_RECEIPTS,
  STORE_SYNC_QUEUE,
  clearReceiptImageUrlCache,
  revokeReceiptImageUrl,
} from '../utils/receiptDb';

export default function useReceiptCrud({
  dbOpen,
  onReceiptsLoaded,
  onCardsLoaded,
  onSaveStatusChange,
  onSyncStatusChange,
  appendSyncOp,
  retryPendingSync,
  recordSyncEvent,
  resetSyncQueue,
}) {
  const saveReceipts = useCallback(async data => {
    const db = await dbOpen();
    const items = Array.isArray(data) ? data : [data];
    if (items.some(item => !item?.id) || new Set(items.map(item => item.id)).size !== items.length) throw new Error('RECEIPT_ID_MISSING_OR_DUPLICATE');
    const now = new Date().toISOString();
    const currentUserId = getOrCreateDeviceId();
    onSaveStatusChange('saving');
    const imageMap = new Map();
    const inputItems = [];
    for (const item of items) {
      const { imageUrl, ...itemWithoutUrl } = item;
      if (imageUrl && item.imageId && !imageMap.has(item.imageId)) {
        try { imageMap.set(item.imageId, base64ToBlob(imageUrl)); }
        catch (e) { if (import.meta.env.DEV) console.warn('Blob 변환 실패:', e); }
      }
      inputItems.push(itemWithoutUrl);
    }
    // Existing records are read inside the write transaction so edit history is
    // computed against the exact version being replaced.
    const storeNames = imageMap.size > 0 ? [STORE_RECEIPTS, STORE_HISTORY, STORE_IMAGES] : [STORE_RECEIPTS, STORE_HISTORY];

    return new Promise((resolve, reject) => {
      const writeTx = db.transaction(storeNames, 'readwrite');
      const writeStore = writeTx.objectStore(STORE_RECEIPTS);
      const historyStore = writeTx.objectStore(STORE_HISTORY);
      const existingMap = new Map();
      const preparedItems = [];
      let pendingReads = inputItems.length;
      let writesStarted = false;
      const fail = error => { try { writeTx.abort(); } catch (abortError) { /* transaction already closed */ } reject(error); };
      const commitWrites = () => {
        if (writesStarted) return;
        writesStarted = true;
        try {
          inputItems.forEach(item => {
            const existing = existingMap.get(item.id);
            const newItem = {
              ...item, updatedAt: now, status: item.status || 'draft',
              userId: item.userId && item.userId !== 'system' ? item.userId : currentUserId,
            };
            preparedItems.push(newItem);
            if (existing) ['totalAmount', 'date', 'storeName', 'category'].forEach(field => {
              if (existing[field] !== item[field]) historyStore.add({ receiptId: item.id, userId: currentUserId, fieldChanged: field, oldValue: existing[field], newValue: item[field], editedAt: now });
            });
            writeStore.put(newItem);
          });
          imageMap.forEach((blob, imageId) => {
            writeTx.objectStore(STORE_IMAGES).put({ imageId, blob, createdAt: Date.now() });
          });
        } catch (error) { fail(error); }
      };
      if (pendingReads === 0) commitWrites();
      inputItems.forEach(item => {
        const request = writeStore.get(item.id);
        request.onsuccess = () => {
          if (request.result) existingMap.set(item.id, request.result);
          if (--pendingReads === 0) commitWrites();
        };
        request.onerror = () => fail(request.error);
      });

      writeTx.oncomplete = async () => {
        onReceiptsLoaded(prev => {
          const next = [...prev];
          preparedItems.forEach(item => {
            const idx = next.findIndex(r => r.id === item.id);
            if (idx > -1) next[idx] = item;
            else next.unshift(item);
          });
          return next;
        });
        onSaveStatusChange('success');

        if (supabase) {
          onSyncStatusChange('syncing');
          try {
            const { error } = await supabase.from('receipts').upsert(preparedItems);
            if (error) throw error;
            onSyncStatusChange('success');
            recordSyncEvent({
              kind: 'save',
              status: 'success',
              title: '저장 동기화 완료',
              detail: `${preparedItems.length}건`,
            });
          } catch (err) {
            if (import.meta.env.DEV) console.error('Supabase Upsert Error:', err);
            onSyncStatusChange('error');
            recordSyncEvent({
              kind: 'save',
              status: 'error',
              title: '저장 동기화 실패',
              detail: formatFailureDetail(err),
            });
            try {
              await appendSyncOp({ type: 'upsert', items: preparedItems });
              retryPendingSync();
            } catch (queueErr) {
              if (import.meta.env.DEV) console.error('Sync queue append failed:', queueErr);
              recordSyncEvent({
                kind: 'save',
                status: 'error',
                title: '보류 큐 적재 실패',
                detail: formatFailureDetail(queueErr),
              });
            }
          }
        }

        resolve();
      };
      writeTx.onerror = () => {
        onSaveStatusChange('error');
        reject(writeTx.error);
      };
      writeTx.onabort = () => {
        onSaveStatusChange('error');
        reject(writeTx.error || new Error('save receipt transaction aborted'));
      };
    });
  }, [appendSyncOp, dbOpen, onReceiptsLoaded, onSaveStatusChange, onSyncStatusChange, recordSyncEvent, retryPendingSync]);

  const deleteReceipt = useCallback(async id => {
    const db = await dbOpen();
    onSaveStatusChange('saving');
    const deleteUserId = getOrCreateDeviceId();
    // Reads and removal share one transaction so the shared-image check sees
    // the same receipts that are being deleted from.
    const tx = db.transaction([STORE_RECEIPTS, STORE_IMAGES], 'readwrite');
    return new Promise((resolve, reject) => {
      const receiptStore = tx.objectStore(STORE_RECEIPTS);
      let target = null;
      let allRecs = null;
      let targetRead = false;
      let allRead = false;
      let deletedImageId = null;
      let writesStarted = false;
      const fail = error => { try { tx.abort(); } catch (abortError) { /* transaction already closed */ } reject(error); };
      const commitDelete = () => {
        if (writesStarted || !targetRead || !allRead) return;
        writesStarted = true;
        if (!target) { fail(new Error('삭제할 영수증을 찾을 수 없습니다.')); return; }
        try {
          const shouldDeleteImage = target.imageId && allRecs.every(r => r.id === id || r.imageId !== target.imageId);
          receiptStore.delete(id);
          if (shouldDeleteImage) {
            tx.objectStore(STORE_IMAGES).delete(target.imageId);
            deletedImageId = target.imageId;
          }
        } catch (error) { fail(error); }
      };
      const targetRequest = receiptStore.get(id);
      targetRequest.onsuccess = () => { target = targetRequest.result || null; targetRead = true; commitDelete(); };
      targetRequest.onerror = () => fail(targetRequest.error);
      const allRequest = receiptStore.getAll();
      allRequest.onsuccess = () => { allRecs = allRequest.result || []; allRead = true; commitDelete(); };
      allRequest.onerror = () => fail(allRequest.error);
      tx.oncomplete = async () => {
        if (deletedImageId) revokeReceiptImageUrl(deletedImageId);
        onReceiptsLoaded(prev => prev.filter(r => r.id !== id));
        onSaveStatusChange('success');

        if (supabase) {
          onSyncStatusChange('syncing');
          try {
            const { error } = await supabase.from('receipts').delete().eq('id', id).eq('userId', deleteUserId);
            if (error) throw error;
            onSyncStatusChange('success');
            recordSyncEvent({
              kind: 'delete',
              status: 'success',
              title: '삭제 동기화 완료',
              detail: id,
            });
          } catch (err) {
            if (import.meta.env.DEV) console.error('Supabase Delete Error:', err);
            onSyncStatusChange('error');
            recordSyncEvent({
              kind: 'delete',
              status: 'error',
              title: '삭제 동기화 실패',
              detail: formatFailureDetail(err),
            });
            try {
              await appendSyncOp({ type: 'delete', id, userId: deleteUserId });
              retryPendingSync();
            } catch (queueErr) {
              if (import.meta.env.DEV) console.error('Sync queue append failed:', queueErr);
              recordSyncEvent({
                kind: 'delete',
                status: 'error',
                title: '보류 큐 적재 실패',
                detail: formatFailureDetail(queueErr),
              });
            }
          }
        }
        resolve();
      };
      tx.onerror = () => {
        onSaveStatusChange('error');
        reject(tx.error);
      };
      tx.onabort = () => {
        onSaveStatusChange('error');
        reject(tx.error || new Error('delete receipt transaction aborted'));
      };
    });
  }, [appendSyncOp, dbOpen, onReceiptsLoaded, onSaveStatusChange, onSyncStatusChange, recordSyncEvent, retryPendingSync]);

  const resetDeviceData = useCallback(async () => {
    const db = await dbOpen();
    onSaveStatusChange('saving');
    const tx = db.transaction([STORE_RECEIPTS, STORE_IMAGES, STORE_HISTORY, STORE_CARDS, STORE_SYNC_QUEUE], 'readwrite');
    tx.objectStore(STORE_RECEIPTS).clear();
    tx.objectStore(STORE_IMAGES).clear();
    tx.objectStore(STORE_HISTORY).clear();
    tx.objectStore(STORE_CARDS).clear();
    tx.objectStore(STORE_SYNC_QUEUE).clear();
    return new Promise((resolve, reject) => {
      tx.oncomplete = async () => {
        await resetSyncQueue().catch(() => {});
        clearReceiptImageUrlCache();
        onReceiptsLoaded([]);
        onCardsLoaded([]);

        // 원격(Supabase) 데이터도 삭제 — 그러지 않으면 다음 부트스트랩에서 다시 내려와
        // '새 출장 시작'의 멘탈 모델(완전 초기화)과 어긋남
        if (supabase) {
          const deviceId = getOrCreateDeviceId();
          try {
            const { error } = await supabase.from('receipts').delete().eq('userId', deviceId);
            if (error) throw error;
          } catch (err) {
            if (import.meta.env.DEV) console.error('Supabase reset delete failed:', err);
            onSaveStatusChange('error');
            reject(err);
            return;
          }
        }

        onSaveStatusChange('success');
        resolve();
      };
      tx.onerror = () => { onSaveStatusChange('error'); reject(tx.error); };
    });
  }, [dbOpen, onCardsLoaded, onReceiptsLoaded, onSaveStatusChange, resetSyncQueue]);

  const saveCard = useCallback(async (card) => {
    const db = await dbOpen();
    const tx = db.transaction(STORE_CARDS, 'readwrite');
    tx.objectStore(STORE_CARDS).put(card);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        onCardsLoaded(prev => {
          const idx = prev.findIndex(c => c.cardNumber === card.cardNumber);
          if (idx > -1) { const next = [...prev]; next[idx] = card; return next; }
          return [...prev, card];
        });
        resolve();
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('saveCard transaction aborted'));
    });
  }, [dbOpen, onCardsLoaded]);

  const getHistory = useCallback(async (receiptId) => {
    const db = await dbOpen();
    const tx = db.transaction(STORE_HISTORY, 'readonly');
    const index = tx.objectStore(STORE_HISTORY).index('receiptId');
    const request = index.getAll(receiptId);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        const sorted = (request.result || []).sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt));
        resolve(sorted);
      };
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error || new Error('getHistory transaction aborted'));
    });
  }, [dbOpen]);

  return { saveReceipts, deleteReceipt, resetDeviceData, saveCard, getHistory };
}
