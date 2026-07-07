import { useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { formatFailureDetail } from '../utils/errorCopy';
import { base64ToBlob, getOrCreateDeviceId } from '../utils/storage';
import { STORE_IMAGES, STORE_RECEIPTS } from '../utils/receiptDb';

export default function useReceiptBootstrap({
  dbOpen,
  onReceiptsLoaded,
  onCardsLoaded,
  onLoadingChange,
  onSyncStatusChange,
  recordSyncEvent,
}) {
  useEffect(() => {
    (async () => {
      try {
        const db = await dbOpen();

        const allReceipts = await new Promise(res => {
          const tx = db.transaction(STORE_RECEIPTS, 'readonly');
          const req = tx.objectStore(STORE_RECEIPTS).getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        });

        if (supabase) {
          onSyncStatusChange?.('syncing');
          try {
            const deviceId = getOrCreateDeviceId();
            const { data, error } = await supabase.from('receipts').select('*').eq('userId', deviceId);
            if (!error && data && data.length > 0) {
              const localById = new Map(allReceipts.map(r => [r.id, r]));
              const mergeable = data.filter(remote => {
                const local = localById.get(remote.id);
                if (!local) return true;
                const localTs = Date.parse(local.updatedAt || '') || 0;
                const remoteTs = Date.parse(remote.updatedAt || '') || 0;
                return remoteTs > localTs;
              });

              if (mergeable.length > 0) {
                const supaToMigrate = mergeable.filter(r => r.imageUrl);
                const supaImageMap = new Map();
                for (const r of supaToMigrate) {
                  if (r.imageId && !supaImageMap.has(r.imageId) && r.imageUrl) {
                    try { supaImageMap.set(r.imageId, base64ToBlob(r.imageUrl)); }
                    catch (e) { if (import.meta.env.DEV) console.warn('Supabase blob 변환 실패:', e); }
                  }
                }

                const storeNames = supaImageMap.size > 0 ? [STORE_RECEIPTS, STORE_IMAGES] : [STORE_RECEIPTS];
                await new Promise((resolve, reject) => {
                  const supaTx = db.transaction(storeNames, 'readwrite');
                  const rStore = supaTx.objectStore(STORE_RECEIPTS);
                  if (supaImageMap.size > 0) {
                    const iStore = supaTx.objectStore(STORE_IMAGES);
                    supaImageMap.forEach((blob, imageId) => iStore.put({ imageId, blob, createdAt: Date.now() }));
                  }
                  mergeable.forEach(item => {
                    const clean = { ...item };
                    delete clean.imageUrl;
                    rStore.put(clean);
                  });
                  supaTx.oncomplete = resolve;
                  supaTx.onerror = () => reject(supaTx.error);
                  supaTx.onabort = () => reject(supaTx.error || new Error('Supabase merge transaction aborted'));
                });
              }

              if (import.meta.env.DEV) {
                const skipped = data.length - mergeable.length;
                if (skipped > 0) console.log(`🔄 Supabase 동기화: ${mergeable.length}건 반영, ${skipped}건은 로컬이 더 최신이라 건너뜀`);
              }
            }
            onSyncStatusChange?.('success');
          } catch (err) {
            if (import.meta.env.DEV) console.error('Supabase Sync Error:', err);
            onSyncStatusChange?.('error');
            recordSyncEvent({
              kind: 'sync',
              status: 'error',
              title: '초기 동기화 실패',
              detail: formatFailureDetail(err),
            });
          }
        }

        const cardTx = db.transaction('card_mapping', 'readonly');
        const cardReq = cardTx.objectStore('card_mapping').getAll();
        cardReq.onsuccess = () => {
          onCardsLoaded(cardReq.result || []);
          const tx = db.transaction(STORE_RECEIPTS, 'readonly');
          const request = tx.objectStore(STORE_RECEIPTS).getAll();
          request.onsuccess = () => {
            onReceiptsLoaded(request.result || []);
            onLoadingChange(false);
          };
          request.onerror = () => {
            if (import.meta.env.DEV) console.error('DB receipt load failed:', request.error);
            onLoadingChange(false);
          };
        };
        cardReq.onerror = () => {
          if (import.meta.env.DEV) console.error('DB card load failed:', cardReq.error);
          onLoadingChange(false);
        };
      } catch (e) {
        if (import.meta.env.DEV) console.error('DB 로드 실패:', e);
        onLoadingChange(false);
      }
    })();
  }, [dbOpen, onCardsLoaded, onLoadingChange, onReceiptsLoaded, onSyncStatusChange, recordSyncEvent]);
}
