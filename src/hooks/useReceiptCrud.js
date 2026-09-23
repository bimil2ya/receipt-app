import { useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { formatFailureDetail } from '../utils/errorCopy';
import { base64ToBlob, getOrCreateDeviceId } from '../utils/storage';
import {
  STORE_CARDS,
  STORE_HISTORY,
  STORE_IMAGES,
  STORE_DRAFT_BACKUP_OUTBOX,
  STORE_RECEIPTS,
  STORE_SYNC_QUEUE,
  clearReceiptImageUrlCache,
  revokeReceiptImageUrl,
} from '../utils/receiptDb';
import { buildDraftBackupTombstone, buildDraftBackupUpsert, prepareDraftBackupImageSnapshot } from '../utils/draftBackupOutbox';

const DRAFT_BACKUP_MUTATION_LOCK = 'receipt-app:draft-backup-mutation:v1';
function nextDraftBackupRevision(receiptId, currentReceipt, outboxOperations) {
  const receiptRevision = Number.isSafeInteger(currentReceipt?.backupRevision) ? currentReceipt.backupRevision : 0;
  // A deletion removes the receipt record but deliberately leaves its
  // tombstone in the outbox. Use that durable history as the high-water mark
  // so a later re-save cannot be mistaken for an older version by Drive.
  const outboxRevision = (outboxOperations || []).reduce((highest, operation) => (
    operation?.receiptId === receiptId && Number.isSafeInteger(operation.backupRevision)
      ? Math.max(highest, operation.backupRevision)
      : highest
  ), 0);
  return Math.max(receiptRevision, outboxRevision) + 1;
}

async function withDraftBackupMutationLock(work) {
  const locks = globalThis.navigator?.locks;
  // IndexedDB read/write transactions serialize their own writes. Web Locks
  // only narrows contention across tabs; it is not the correctness boundary.
  if (!locks?.request) return work(true);
  return locks.request(DRAFT_BACKUP_MUTATION_LOCK, { mode: 'exclusive' }, () => work(true));
}

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
  const saveReceipts = useCallback(async data => withDraftBackupMutationLock(async canQueueDraftBackup => {
    const db = await dbOpen();
    const items = Array.isArray(data) ? data : [data];
    if (items.some(item => !item?.id) || new Set(items.map(item => item.id)).size !== items.length) throw new Error('DRAFT_BACKUP_DUPLICATE_RECEIPT_ID');
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
    const referencedImageIds = [...new Set(inputItems.map(item => item.imageId).filter(Boolean))];
    const existingImages = await new Promise((resolve, reject) => {
      if (referencedImageIds.length === 0) { resolve(new Map()); return; }
      const tx = db.transaction(STORE_IMAGES, 'readonly'); const store = tx.objectStore(STORE_IMAGES); const found = new Map(); let pending = referencedImageIds.length;
      referencedImageIds.forEach(imageId => {
        const request = store.get(imageId);
        request.onsuccess = () => { if (request.result?.blob) found.set(imageId, request.result.blob); if (--pending === 0) resolve(found); };
        request.onerror = () => reject(request.error);
      });
    });
    // WebCrypto is async and would allow an IndexedDB transaction to become
    // inactive. Pin bytes and hashes before the single mutation transaction.
    const imageSnapshots = canQueueDraftBackup ? new Map(await Promise.all(inputItems.map(async item => {
      const imageBlob = imageMap.get(item.imageId) || existingImages.get(item.imageId) || null;
      if (item.imageId && !imageBlob) throw new Error('DRAFT_BACKUP_SOURCE_IMAGE_MISSING');
      return [item.id, await prepareDraftBackupImageSnapshot(imageBlob)];
    }))) : new Map();
    // Include images even for an edit that reuses an existing image. If a
    // concurrent delete won after the preflight read, this transaction makes
    // the saved receipt and its immutable image snapshot appear together.
    const storeNames = [STORE_RECEIPTS, STORE_HISTORY, STORE_IMAGES, ...(canQueueDraftBackup ? [STORE_DRAFT_BACKUP_OUTBOX] : [])];

    return new Promise((resolve, reject) => {
      const writeTx = db.transaction(storeNames, 'readwrite');
      const writeStore = writeTx.objectStore(STORE_RECEIPTS);
      const historyStore = writeTx.objectStore(STORE_HISTORY);
      const existingMap = new Map();
      let existingOutboxOperations = [];
      const preparedItems = [];
      let pendingReads = inputItems.length;
      let outboxRead = !canQueueDraftBackup;
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
              backupRevision: nextDraftBackupRevision(item.id, existing, existingOutboxOperations),
            };
            preparedItems.push(newItem);
            if (existing) ['totalAmount', 'date', 'storeName', 'category'].forEach(field => {
              if (existing[field] !== item[field]) historyStore.add({ receiptId: item.id, userId: currentUserId, fieldChanged: field, oldValue: existing[field], newValue: item[field], editedAt: now });
            });
            writeStore.put(newItem);
            if (canQueueDraftBackup) writeTx.objectStore(STORE_DRAFT_BACKUP_OUTBOX).put(buildDraftBackupUpsert({
              receipt: newItem, imageSnapshot: imageSnapshots.get(item.id), deviceId: currentUserId,
              teamSnapshot: { id: newItem.assignmentTeamId || null, name: newItem.assignmentTeamName || '' },
            }));
          });
          inputItems.forEach(item => {
            const snapshot = imageSnapshots.get(item.id);
            if (item.imageId && snapshot?.blob) writeTx.objectStore(STORE_IMAGES).put({ imageId: item.imageId, blob: snapshot.blob, createdAt: Date.now() });
          });
        } catch (error) { fail(error); }
      };
      if (pendingReads === 0 && outboxRead) commitWrites();
      inputItems.forEach(item => {
        const request = writeStore.get(item.id);
        request.onsuccess = () => {
          if (request.result) existingMap.set(item.id, request.result);
          if (--pendingReads === 0 && outboxRead) commitWrites();
        };
        request.onerror = () => fail(request.error);
      });
      if (canQueueDraftBackup) {
        const outboxRequest = writeTx.objectStore(STORE_DRAFT_BACKUP_OUTBOX).getAll();
        outboxRequest.onsuccess = () => {
          existingOutboxOperations = outboxRequest.result || [];
          outboxRead = true;
          if (pendingReads === 0) commitWrites();
        };
        outboxRequest.onerror = () => fail(outboxRequest.error);
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
  }), [appendSyncOp, dbOpen, onReceiptsLoaded, onSaveStatusChange, onSyncStatusChange, recordSyncEvent, retryPendingSync]);

  const deleteReceipt = useCallback(async id => withDraftBackupMutationLock(async canQueueDraftBackup => {
    const db = await dbOpen();
    onSaveStatusChange('saving');
    const deleteUserId = getOrCreateDeviceId();
    // Reads, version allocation, tombstone, and removal happen in one
    // transaction so a later save can never be overwritten by this delete.
    const storeNames = [STORE_RECEIPTS, STORE_IMAGES, ...(canQueueDraftBackup ? [STORE_DRAFT_BACKUP_OUTBOX] : [])];
    const tx = db.transaction(storeNames, 'readwrite');
    return new Promise((resolve, reject) => {
      const receiptStore = tx.objectStore(STORE_RECEIPTS);
      let target = null;
      let allRecs = null;
      let targetRead = false;
      let allRead = false;
      let outboxRead = !canQueueDraftBackup;
      let existingOutboxOperations = [];
      let deletedImageId = null;
      let writesStarted = false;
      const fail = error => { try { tx.abort(); } catch (abortError) { /* transaction already closed */ } reject(error); };
      const commitDelete = () => {
        if (writesStarted || !targetRead || !allRead || !outboxRead) return;
        writesStarted = true;
        if (!target) { fail(new Error('삭제할 영수증을 찾을 수 없습니다.')); return; }
        try {
          const shouldDeleteImage = target.imageId && allRecs.every(r => r.id === id || r.imageId !== target.imageId);
          receiptStore.delete(id);
          if (canQueueDraftBackup) tx.objectStore(STORE_DRAFT_BACKUP_OUTBOX).put(buildDraftBackupTombstone({
            receiptId: target.id,
            backupRevision: nextDraftBackupRevision(target.id, target, existingOutboxOperations),
            deviceId: deleteUserId,
            teamSnapshot: { id: target.assignmentTeamId || null, name: target.assignmentTeamName || '' },
          }));
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
      if (canQueueDraftBackup) {
        const outboxRequest = tx.objectStore(STORE_DRAFT_BACKUP_OUTBOX).getAll();
        outboxRequest.onsuccess = () => { existingOutboxOperations = outboxRequest.result || []; outboxRead = true; commitDelete(); };
        outboxRequest.onerror = () => fail(outboxRequest.error);
      }
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
  }), [appendSyncOp, dbOpen, onReceiptsLoaded, onSaveStatusChange, onSyncStatusChange, recordSyncEvent, retryPendingSync]);

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
