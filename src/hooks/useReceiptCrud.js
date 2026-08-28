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
  const saveReceipts = useCallback(async (data) => {
    const db = await dbOpen();
    const items = Array.isArray(data) ? data : [data];
    const now = new Date().toISOString();
    const currentUserId = getOrCreateDeviceId();
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
        catch (e) { if (import.meta.env.DEV) console.warn('Blob 변환 실패:', e); }
      }

      const resolvedUserId = item.userId && item.userId !== 'system' ? item.userId : currentUserId;
      const newItem = { ...itemWithoutUrl, updatedAt: now, status: item.status || 'draft', userId: resolvedUserId };
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
        // 1단계: IndexedDB 커밋 성공, UI 업데이트
        onReceiptsLoaded(prev => {
          const next = [...prev];
          preparedItems.forEach(item => {
            const idx = next.findIndex(r => r.id === item.id);
            if (idx > -1) next[idx] = item;
            else next.unshift(item);
          });
          return next;
        });

        // 2단계: Supabase 동기화 시도 (별도 단계)
        if (!supabase) {
          onSaveStatusChange('success');
          resolve();
          return;
        }

        // Supabase 동기화를 별도로 처리
        onSyncStatusChange('syncing');
        try {
          const { error, data: upsertedData } = await supabase
            .from('receipts')
            .upsert(preparedItems)
            .select();

          if (error) throw error;

          // 부분 실패 감지: 요청한 개수와 응답 개수 비교
          if (!upsertedData || upsertedData.length !== preparedItems.length) {
            throw new Error(`부분 실패: ${upsertedData?.length || 0}/${preparedItems.length}건 동기화`);
          }

          onSaveStatusChange('success');
          onSyncStatusChange('success');
          recordSyncEvent({
            kind: 'save',
            status: 'success',
            title: '저장 동기화 완료',
            detail: `${preparedItems.length}건`,
          });
          resolve();
        } catch (err) {
          // Supabase 실패: 모든 항목을 sync queue에 추가
          if (import.meta.env.DEV) console.error('Supabase Upsert Error:', err);
          onSaveStatusChange('error');
          onSyncStatusChange('error');
          recordSyncEvent({
            kind: 'save',
            status: 'error',
            title: '저장 동기화 실패',
            detail: formatFailureDetail(err),
          });

          try {
            await appendSyncOp({ type: 'upsert', items: preparedItems });
            await retryPendingSync();
            // sync queue에 추가 성공
            recordSyncEvent({
              kind: 'save',
              status: 'info',
              title: '보류 큐에 추가됨',
              detail: `${preparedItems.length}건이 재시도 대기 중`,
            });
          } catch (queueErr) {
            if (import.meta.env.DEV) console.error('Sync queue append failed:', queueErr);
            recordSyncEvent({
              kind: 'save',
              status: 'error',
              title: '보류 큐 적재 실패',
              detail: formatFailureDetail(queueErr),
            });
          }
          resolve();
        }
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

    return new Promise((resolve, reject) => {
      // 단일 readwrite transaction으로 모든 작업 수행 (Race Condition 방지)
      const tx = db.transaction([STORE_RECEIPTS, STORE_IMAGES], 'readwrite');
      const receiptStore = tx.objectStore(STORE_RECEIPTS);
      const imageStore = tx.objectStore(STORE_IMAGES);

      // 1. 대상 receipt 읽기
      const targetReq = receiptStore.get(id);
      let target = null;
      let shouldDeleteImage = false;

      targetReq.onsuccess = () => {
        target = targetReq.result;

        if (target?.imageId) {
          // 2. 같은 imageId 참조하는 다른 receipt 확인 (index 사용)
          const indexReq = receiptStore.index('imageId');
          const range = IDBKeyRange.only(target.imageId);
          const countReq = indexReq.count(range);

          countReq.onsuccess = () => {
            // transaction 내에서 원자적으로 판단: target 자신만 참조 중이면 이미지 삭제
            shouldDeleteImage = countReq.result === 1;

            // 3. receipt 삭제
            receiptStore.delete(id);

            // 4. 이미지 삭제 (필요한 경우)
            if (shouldDeleteImage) {
              imageStore.delete(target.imageId);
            }
          };

          countReq.onerror = () => reject(new Error('이미지 참조 확인 실패'));
        } else {
          // imageId 없으면 그냥 receipt만 삭제
          receiptStore.delete(id);
        }
      };

      targetReq.onerror = () => reject(new Error('대상 receipt 조회 실패'));

      tx.oncomplete = async () => {
        onReceiptsLoaded(prev => prev.filter(r => r.id !== id));
        onSaveStatusChange('success');

        if (target?.imageId && shouldDeleteImage) {
          revokeReceiptImageUrl(target.imageId);
        }

        if (supabase) {
          const deleteUserId = getOrCreateDeviceId();
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
    });
  }, [appendSyncOp, dbOpen, onReceiptsLoaded, onSaveStatusChange, onSyncStatusChange, recordSyncEvent, retryPendingSync]);

  const resetDeviceData = useCallback(async () => {
    const db = await dbOpen();
    onSaveStatusChange('saving');

    try {
      // 1단계: Supabase 먼저 삭제 (더 중요, 원격에 남으면 문제)
      if (supabase) {
        const deviceId = getOrCreateDeviceId();
        try {
          const { error } = await supabase
            .from('receipts')
            .delete()
            .eq('userId', deviceId);

          if (error) throw error;
        } catch (err) {
          // Supabase 실패: 사용자에게 알림, 로컬 삭제는 하지 않음
          if (import.meta.env.DEV) console.error('Supabase reset delete failed:', err);
          onSaveStatusChange('error');
          throw new Error(`원격 데이터 삭제 실패: ${err.message}. 다시 시도하세요.`);
        }
      }

      // 2단계: Supabase 성공 후 로컬 IndexedDB 삭제
      return new Promise((resolve, reject) => {
        const tx = db.transaction(
          [STORE_RECEIPTS, STORE_IMAGES, STORE_HISTORY, STORE_CARDS, STORE_SYNC_QUEUE],
          'readwrite'
        );

        tx.objectStore(STORE_RECEIPTS).clear();
        tx.objectStore(STORE_IMAGES).clear();
        tx.objectStore(STORE_HISTORY).clear();
        tx.objectStore(STORE_CARDS).clear();
        tx.objectStore(STORE_SYNC_QUEUE).clear();

        tx.oncomplete = async () => {
          await resetSyncQueue().catch(() => {});
          clearReceiptImageUrlCache();
          onReceiptsLoaded([]);
          onCardsLoaded([]);
          onSaveStatusChange('success');
          resolve();
        };

        tx.onerror = () => {
          if (import.meta.env.DEV) console.error('IndexedDB reset failed:', tx.error);
          onSaveStatusChange('error');
          reject(new Error(`로컬 데이터 삭제 실패: ${tx.error?.message}`));
        };
      });
    } catch (err) {
      if (import.meta.env.DEV) console.error('Reset device data failed:', err);
      onSaveStatusChange('error');
      throw err;
    }
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
