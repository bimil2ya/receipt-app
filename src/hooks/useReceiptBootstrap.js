import { useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { formatFailureDetail } from '../utils/errorCopy';
import { base64ToBlob, readStorageItem } from '../utils/storage';
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

        const toMigrate = allReceipts.filter(r => r.imageUrl);
        if (toMigrate.length > 0) {
          const imageMap = new Map();
          for (const r of toMigrate) {
            if (r.imageId && !imageMap.has(r.imageId) && r.imageUrl) {
              try { imageMap.set(r.imageId, base64ToBlob(r.imageUrl)); }
              catch (e) { if (import.meta.env.DEV) console.warn('마이그레이션 blob 변환 실패:', r.imageId, e); }
            }
          }

          await new Promise((resolve, reject) => {
            const migTx = db.transaction([STORE_RECEIPTS, STORE_IMAGES], 'readwrite');
            const receiptStore = migTx.objectStore(STORE_RECEIPTS);
            const imageStore = migTx.objectStore(STORE_IMAGES);

            imageMap.forEach((blob, imageId) => {
              imageStore.put({ imageId, blob, createdAt: Date.now() });
            });
            toMigrate.forEach(r => {
              const clean = { ...r };
              delete clean.imageUrl;
              receiptStore.put(clean);
            });

            migTx.oncomplete = resolve;
            migTx.onerror = () => reject(migTx.error);
          });
          if (import.meta.env.DEV) console.log(`✅ 이미지 마이그레이션 완료: 영수증 ${toMigrate.length}건, 이미지 ${imageMap.size}개`);
        }

        if (supabase) {
          onSyncStatusChange?.('syncing');
          try {
            const deviceId = readStorageItem('device_num', 'system');
            const { data, error } = await supabase.from('receipts').select('*').eq('userId', deviceId);
            if (!error && data && data.length > 0) {
              const supaToMigrate = data.filter(r => r.imageUrl);
              if (supaToMigrate.length > 0) {
                const supaImageMap = new Map();
                for (const r of supaToMigrate) {
                  if (r.imageId && !supaImageMap.has(r.imageId) && r.imageUrl) {
                    try { supaImageMap.set(r.imageId, base64ToBlob(r.imageUrl)); }
                    catch (e) { if (import.meta.env.DEV) console.warn('Supabase blob 변환 실패:', e); }
                  }
                }
                await new Promise((resolve, reject) => {
                  const supaTx = db.transaction([STORE_RECEIPTS, STORE_IMAGES], 'readwrite');
                  const rStore = supaTx.objectStore(STORE_RECEIPTS);
                  const iStore = supaTx.objectStore(STORE_IMAGES);
                  supaImageMap.forEach((blob, imageId) => iStore.put({ imageId, blob, createdAt: Date.now() }));
                  data.forEach(item => {
                    const clean = { ...item };
                    delete clean.imageUrl;
                    rStore.put(clean);
                  });
                  supaTx.oncomplete = resolve;
                  supaTx.onerror = () => reject(supaTx.error);
                });
              } else {
                await new Promise((resolve, reject) => {
                  const tx = db.transaction(STORE_RECEIPTS, 'readwrite');
                  const store = tx.objectStore(STORE_RECEIPTS);
                  data.forEach(item => {
                    const clean = { ...item };
                    delete clean.imageUrl;
                    store.put(clean);
                  });
                  tx.oncomplete = resolve;
                  tx.onerror = () => reject(tx.error);
                });
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
