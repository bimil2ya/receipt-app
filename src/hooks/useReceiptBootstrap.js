import { useEffect } from 'react';
import { getOrCreateDeviceId } from '../utils/storage';
import { STORE_DRAFT_BACKUP_OUTBOX, STORE_RECEIPTS } from '../utils/receiptDb';

// The retired draft-backup outbox held only duplicate image blobs that no
// server ever received. The store itself stays because removing it would need
// a DB version bump; emptying it frees the space on devices that filled it.
function clearRetiredDraftBackupOutbox(db) {
  return new Promise(resolve => {
    if (!db.objectStoreNames.contains(STORE_DRAFT_BACKUP_OUTBOX)) { resolve(); return; }
    try {
      const tx = db.transaction(STORE_DRAFT_BACKUP_OUTBOX, 'readwrite');
      tx.objectStore(STORE_DRAFT_BACKUP_OUTBOX).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export default function useReceiptBootstrap({
  dbOpen,
  onReceiptsLoaded,
  onCardsLoaded,
  onLoadingChange,
}) {
  useEffect(() => {
    (async () => {
      try {
        const db = await dbOpen();
        await clearRetiredDraftBackupOutbox(db);

        const allReceipts = await new Promise(res => {
          const tx = db.transaction(STORE_RECEIPTS, 'readonly');
          const req = tx.objectStore(STORE_RECEIPTS).getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror = () => res([]);
        });

        // 기존에 userId='system'으로 저장된 데이터를 현재 UUID로 일괄 갱신한다.
        const deviceId = getOrCreateDeviceId();

        const systemReceipts = allReceipts.filter(r => !r.userId || r.userId === 'system');
        if (systemReceipts.length > 0) {
          await new Promise((resolve, reject) => {
            const migrateTx = db.transaction(STORE_RECEIPTS, 'readwrite');
            const store = migrateTx.objectStore(STORE_RECEIPTS);
            systemReceipts.forEach(r => store.put({ ...r, userId: deviceId }));
            migrateTx.oncomplete = resolve;
            migrateTx.onerror = () => reject(migrateTx.error);
          });
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
  }, [dbOpen, onCardsLoaded, onLoadingChange, onReceiptsLoaded]);
}
