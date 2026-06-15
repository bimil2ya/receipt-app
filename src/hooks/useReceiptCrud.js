import { useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { formatFailureDetail } from '../utils/errorCopy';
import { base64ToBlob, readStorageItem } from '../utils/storage';
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
  const saveReceipts = useCallback(async (data) => {
    const db = await dbOpen();
    const items = Array.isArray(data) ? data : [data];
    const now = new Date().toISOString();
    const currentUserId = readStorageItem('device_num', 'system');
    onSaveStatusChange('saving');

    const existingMap = await new Promise((resolve, reject) => {
      const readTx = db.transaction(STORE_RECEIPTS, 'readonly');
      const readStore = readTx.objectStore(STORE_RECEIPTS);
      const map = new Map();
      let pending = items.length;
      if (pending === 0) { resolve(map); return; }
      readTx.onerror = () => reject(readTx.error);
      readTx.onabort = () => reject(new Error('Transaction aborted'));
      items.forEach(item => {
        const req = readStore.get(item.id);
        req.onsuccess = () => {
          if (req.result) map.set(item.id, req.result);
          if (--pending === 0) resolve(map);
        };
        req.onerror = () => reject(req.error);
      });
    });

    const preparedItems = [];
    const historyRecords = [];
    const imageMap = new Map();

    for (const item of items) {
      const { imageUrl, ...itemWithoutUrl } = item;
      if (imageUrl && item.imageId && !imageMap.has(item.imageId)) {
        try { imageMap.set(item.imageId, base64ToBlob(imageUrl)); }
        catch (e) { console.warn('Blob 변환 실패:', e); }
      }

      const newItem = { ...itemWithoutUrl, updatedAt: now, status: item.status || 'draft', userId: item.userId || currentUserId };
      preparedItems.push(newItem);

      const existing = existingMap.get(item.id);
      if (existing) {
        ['totalAmount', 'date', 'storeName', 'category'].forEach(field => {
          if (existing[field] !== item[field]) {
            historyRecords.push({
              receiptId: item.id, userId: currentUserId,
              fieldChanged: field, oldValue: existing[field], newValue: item[field], editedAt: now,
            });
          }
        });
      }
    }

    const storeNames = imageMap.size > 0 ? [STORE_RECEIPTS, STORE_HISTORY, STORE_IMAGES] : [STORE_RECEIPTS, STORE_HISTORY];

    return new Promise((resolve, reject) => {
      const writeTx = db.transaction(storeNames, 'readwrite');
      const writeStore = writeTx.objectStore(STORE_RECEIPTS);
      const historyStore = writeTx.objectStore(STORE_HISTORY);

      preparedItems.forEach(item => writeStore.put(item));
      historyRecords.forEach(record => historyStore.add(record));

      if (imageMap.size > 0) {
        const imageStore = writeTx.objectStore(STORE_IMAGES);
        imageMap.forEach((blob, imageId) => {
          imageStore.put({ imageId, blob, createdAt: Date.now() });
        });
      }

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
            console.error('Supabase Upsert Error:', err);
            onSyncStatusChange('error');
            recordSyncEvent({
              kind: 'save',
              status: 'error',
              title: '저장 동기화 실패',
              detail: formatFailureDetail(err),
            });
            await appendSyncOp({ type: 'upsert', items: preparedItems });
            retryPendingSync();
          }
        }

        resolve();
      };
      writeTx.onerror = () => {
        onSaveStatusChange('error');
        reject(writeTx.error);
      };
    });
  }, [appendSyncOp, dbOpen, onReceiptsLoaded, onSaveStatusChange, onSyncStatusChange, recordSyncEvent, retryPendingSync]);

  const deleteReceipt = useCallback(async (id) => {
    const db = await dbOpen();
    onSaveStatusChange('saving');

    const [target, allRecs] = await Promise.all([
      new Promise(res => {
        const tx = db.transaction(STORE_RECEIPTS, 'readonly');
        const req = tx.objectStore(STORE_RECEIPTS).get(id);
        req.onsuccess = () => res(req.result);
        req.onerror = () => res(null);
      }),
      new Promise(res => {
        const tx = db.transaction(STORE_RECEIPTS, 'readonly');
        const req = tx.objectStore(STORE_RECEIPTS).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => res([]);
      }),
    ]);

    const shouldDeleteImage =
      target?.imageId &&
      allRecs.filter(r => r.id !== id && r.imageId === target.imageId).length === 0;

    const storeNames = shouldDeleteImage ? [STORE_RECEIPTS, STORE_IMAGES] : [STORE_RECEIPTS];
    const tx = db.transaction(storeNames, 'readwrite');
    tx.objectStore(STORE_RECEIPTS).delete(id);
    if (shouldDeleteImage) {
      tx.objectStore(STORE_IMAGES).delete(target.imageId);
      revokeReceiptImageUrl(target.imageId);
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = async () => {
        onReceiptsLoaded(prev => prev.filter(r => r.id !== id));
        onSaveStatusChange('success');

        if (supabase) {
          onSyncStatusChange('syncing');
          try {
            const { error } = await supabase.from('receipts').delete().eq('id', id);
            if (error) throw error;
            onSyncStatusChange('success');
            recordSyncEvent({
              kind: 'delete',
              status: 'success',
              title: '삭제 동기화 완료',
              detail: id,
            });
          } catch (err) {
            console.error('Supabase Delete Error:', err);
            onSyncStatusChange('error');
            recordSyncEvent({
              kind: 'delete',
              status: 'error',
              title: '삭제 동기화 실패',
              detail: formatFailureDetail(err),
            });
            await appendSyncOp({ type: 'delete', id });
            retryPendingSync();
          }
        }
        resolve();
      };
      tx.onerror = () => {
        onSaveStatusChange('error');
        reject(tx.error);
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
    return new Promise(resolve => {
      tx.oncomplete = () => {
        onCardsLoaded(prev => {
          const idx = prev.findIndex(c => c.cardNumber === card.cardNumber);
          if (idx > -1) { const next = [...prev]; next[idx] = card; return next; }
          return [...prev, card];
        });
        resolve();
      };
    });
  }, [dbOpen, onCardsLoaded]);

  const getHistory = useCallback(async (receiptId) => {
    const db = await dbOpen();
    const tx = db.transaction(STORE_HISTORY, 'readonly');
    const index = tx.objectStore(STORE_HISTORY).index('receiptId');
    const request = index.getAll(receiptId);
    return new Promise(resolve => {
      request.onsuccess = () => {
        const sorted = (request.result || []).sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt));
        resolve(sorted);
      };
    });
  }, [dbOpen]);

  return { saveReceipts, deleteReceipt, resetDeviceData, saveCard, getHistory };
}
