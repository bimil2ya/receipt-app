import { useCallback } from 'react';
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

      writeTx.oncomplete = () => {
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
  }, [dbOpen, onReceiptsLoaded, onSaveStatusChange]);

  const deleteReceipt = useCallback(async id => {
    const db = await dbOpen();
    onSaveStatusChange('saving');
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
      tx.oncomplete = () => {
        if (deletedImageId) revokeReceiptImageUrl(deletedImageId);
        onReceiptsLoaded(prev => prev.filter(r => r.id !== id));
        onSaveStatusChange('success');
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
  }, [dbOpen, onReceiptsLoaded, onSaveStatusChange]);

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
      tx.oncomplete = () => {
        clearReceiptImageUrlCache();
        onReceiptsLoaded([]);
        onCardsLoaded([]);
        onSaveStatusChange('success');
        resolve();
      };
      tx.onerror = () => { onSaveStatusChange('error'); reject(tx.error); };
    });
  }, [dbOpen, onCardsLoaded, onReceiptsLoaded, onSaveStatusChange]);

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
