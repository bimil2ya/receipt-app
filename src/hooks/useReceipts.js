import { useState, useEffect, useCallback } from 'react';
import idbReady from 'safari-14-idb-fix';
import { supabase } from '../utils/supabase';

const DB_NAME = '미래생태공간_정산앱';
const STORE_RECEIPTS = 'receipts';
const STORE_HISTORY  = 'edit_history';
const STORE_TEAMS    = 'teams';
const STORE_CARDS    = 'card_mapping';
const STORE_IMAGES   = 'receipt_images';  // 신규 — Blob 분리 저장
const DB_VERSION     = 5;                 // 4 → 5

let dbCache = null;
const imageUrlCache = new Map(); // imageId → Object URL (모듈 레벨 캐시)

/** base64 dataURL → Blob */
function base64ToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)[1];
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export default function useReceipts() {
  const [receipts,   setReceipts]   = useState([]);
  const [cards,      setCards]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [syncStatus, setSyncStatus] = useState(supabase ? 'idle' : 'offline');

  // ──────────────────────────────────────────────
  // DB 열기
  // ──────────────────────────────────────────────
  const dbOpen = useCallback(async () => {
    if (dbCache) return dbCache;
    await idbReady();
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_RECEIPTS)) db.createObjectStore(STORE_RECEIPTS, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const hs = db.createObjectStore(STORE_HISTORY, { keyPath: 'historyId', autoIncrement: true });
          hs.createIndex('receiptId', 'receiptId', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_TEAMS)) db.createObjectStore(STORE_TEAMS, { keyPath: 'teamId' });
        if (!db.objectStoreNames.contains(STORE_CARDS)) db.createObjectStore(STORE_CARDS, { keyPath: 'cardNumber' });
        if (!db.objectStoreNames.contains(STORE_IMAGES)) db.createObjectStore(STORE_IMAGES, { keyPath: 'imageId' });
      };
      request.onsuccess = e => { dbCache = e.target.result; resolve(dbCache); };
      request.onerror   = e => reject(e.target.error);
    });
  }, []);

  // ──────────────────────────────────────────────
  // getImageUrl: imageId → Object URL (캐싱)
  // ──────────────────────────────────────────────
  const getImageUrl = useCallback(async (imageId) => {
    if (!imageId) return null;
    if (imageUrlCache.has(imageId)) return imageUrlCache.get(imageId);
    const db = await dbOpen();
    const record = await new Promise(res => {
      const tx  = db.transaction(STORE_IMAGES, 'readonly');
      const req = tx.objectStore(STORE_IMAGES).get(imageId);
      req.onsuccess = () => res(req.result);
      req.onerror   = () => res(null);
    });
    if (!record?.blob) return null;
    const url = URL.createObjectURL(record.blob);
    imageUrlCache.set(imageId, url);
    return url;
  }, [dbOpen]);

  // ──────────────────────────────────────────────
  // 초기 로드 + 마이그레이션
  // ──────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const db = await dbOpen();

        // ── v4→v5 마이그레이션: imageUrl이 있는 receipt를 STORE_IMAGES로 분리
        const allReceipts = await new Promise(res => {
          const tx  = db.transaction(STORE_RECEIPTS, 'readonly');
          const req = tx.objectStore(STORE_RECEIPTS).getAll();
          req.onsuccess = () => res(req.result || []);
          req.onerror   = () => res([]);
        });

        const toMigrate = allReceipts.filter(r => r.imageUrl);
        if (toMigrate.length > 0) {
          // Phase B: base64 → Blob 변환 (순수 JS, imageId별 중복 제거)
          const imageMap = new Map();
          for (const r of toMigrate) {
            if (r.imageId && !imageMap.has(r.imageId) && r.imageUrl) {
              try { imageMap.set(r.imageId, base64ToBlob(r.imageUrl)); }
              catch (e) { console.warn('마이그레이션 blob 변환 실패:', r.imageId, e); }
            }
          }

          // Phase C: 단일 readwrite tx — 이미지 저장 + receipt imageUrl 제거
          await new Promise((resolve, reject) => {
            const migTx        = db.transaction([STORE_RECEIPTS, STORE_IMAGES], 'readwrite');
            const receiptStore = migTx.objectStore(STORE_RECEIPTS);
            const imageStore   = migTx.objectStore(STORE_IMAGES);

            imageMap.forEach((blob, imageId) => {
              imageStore.put({ imageId, blob, createdAt: Date.now() });
            });
            toMigrate.forEach(r => {
              // eslint-disable-next-line no-unused-vars
              const { imageUrl, ...clean } = r;
              receiptStore.put(clean);
            });

            migTx.oncomplete = resolve;
            migTx.onerror    = () => reject(migTx.error);
          });
          console.log(`✅ 이미지 마이그레이션 완료: 영수증 ${toMigrate.length}건, 이미지 ${imageMap.size}개`);
        }

        // ── Supabase 동기화 (클라우드 데이터 가져오기)
        if (supabase) {
          setSyncStatus('syncing');
          try {
            const deviceId = localStorage.getItem('device_num') || 'system';
            const { data, error } = await supabase.from('receipts').select('*').eq('userId', deviceId);
            if (!error && data && data.length > 0) {
              // 구버전 Supabase 데이터에 imageUrl이 포함된 경우 분리 저장
              const supaToMigrate = data.filter(r => r.imageUrl);
              if (supaToMigrate.length > 0) {
                const supaImageMap = new Map();
                for (const r of supaToMigrate) {
                  if (r.imageId && !supaImageMap.has(r.imageId) && r.imageUrl) {
                    try { supaImageMap.set(r.imageId, base64ToBlob(r.imageUrl)); }
                    catch (e) { console.warn('Supabase blob 변환 실패:', e); }
                  }
                }
                await new Promise((resolve, reject) => {
                  const supaTx       = db.transaction([STORE_RECEIPTS, STORE_IMAGES], 'readwrite');
                  const rStore       = supaTx.objectStore(STORE_RECEIPTS);
                  const iStore       = supaTx.objectStore(STORE_IMAGES);
                  supaImageMap.forEach((blob, imageId) => iStore.put({ imageId, blob, createdAt: Date.now() }));
                  // eslint-disable-next-line no-unused-vars
                  data.forEach(item => { const { imageUrl, ...clean } = item; rStore.put(clean); });
                  supaTx.oncomplete = resolve;
                  supaTx.onerror    = () => reject(supaTx.error);
                });
              } else {
                await new Promise((resolve, reject) => {
                  const tx    = db.transaction(STORE_RECEIPTS, 'readwrite');
                  const store = tx.objectStore(STORE_RECEIPTS);
                  // eslint-disable-next-line no-unused-vars
                  data.forEach(item => { const { imageUrl, ...clean } = item; store.put(clean); });
                  tx.oncomplete = resolve;
                  tx.onerror    = () => reject(tx.error);
                });
              }
            }
            setSyncStatus('success');
          } catch (err) {
            console.error('Supabase Sync Error:', err);
            setSyncStatus('error');
          }
        }

        // ── 최종 데이터 로드
        const cardTx  = db.transaction(STORE_CARDS, 'readonly');
        const cardReq = cardTx.objectStore(STORE_CARDS).getAll();
        cardReq.onsuccess = () => {
          setCards(cardReq.result || []);
          const tx      = db.transaction(STORE_RECEIPTS, 'readonly');
          const request = tx.objectStore(STORE_RECEIPTS).getAll();
          request.onsuccess = () => {
            setReceipts(request.result || []);
            setLoading(false);
          };
        };
      } catch (e) {
        console.error('DB 로드 실패:', e);
        setLoading(false);
      }
    })();
  }, [dbOpen]);

  // ──────────────────────────────────────────────
  // saveReceipts
  // ──────────────────────────────────────────────
  const saveReceipts = useCallback(async (data) => {
    const db    = await dbOpen();
    const items = Array.isArray(data) ? data : [data];
    const now   = new Date().toISOString();
    const currentUserId = localStorage.getItem('device_num') || 'system';

    // ── Phase A: readonly 트랜잭션으로 기존 항목 일괄 조회
    const existingMap = await new Promise((resolve, reject) => {
      const readTx    = db.transaction(STORE_RECEIPTS, 'readonly');
      const readStore = readTx.objectStore(STORE_RECEIPTS);
      const map       = new Map();
      let pending     = items.length;
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

    // ── Phase B: 저장 데이터 & 이력 계산 + imageUrl → Blob 분리
    const preparedItems  = [];
    const historyRecords = [];
    const imageMap       = new Map(); // imageId → Blob

    for (const item of items) {
      const { imageUrl, ...itemWithoutUrl } = item;

      // imageUrl이 있으면 Blob으로 변환 (imageId별 중복 제거)
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

    // ── Phase C: readwrite 트랜잭션에서 await 없이 동기 일괄 저장
    const storeNames = imageMap.size > 0
      ? [STORE_RECEIPTS, STORE_HISTORY, STORE_IMAGES]
      : [STORE_RECEIPTS, STORE_HISTORY];

    return new Promise((resolve, reject) => {
      const writeTx      = db.transaction(storeNames, 'readwrite');
      const writeStore   = writeTx.objectStore(STORE_RECEIPTS);
      const historyStore = writeTx.objectStore(STORE_HISTORY);

      preparedItems.forEach(item   => writeStore.put(item));
      historyRecords.forEach(record => historyStore.add(record));

      if (imageMap.size > 0) {
        const imageStore = writeTx.objectStore(STORE_IMAGES);
        imageMap.forEach((blob, imageId) => {
          imageStore.put({ imageId, blob, createdAt: Date.now() });
          // 기존 Object URL 캐시 무효화
          if (imageUrlCache.has(imageId)) {
            URL.revokeObjectURL(imageUrlCache.get(imageId));
            imageUrlCache.delete(imageId);
          }
        });
      }

      writeTx.oncomplete = async () => {
        setReceipts(prev => {
          const next = [...prev];
          preparedItems.forEach(item => {
            const idx = next.findIndex(r => r.id === item.id);
            if (idx > -1) next[idx] = item;
            else next.unshift(item);
          });
          return next;
        });

        // Supabase로 데이터 푸시 (imageUrl 제외됨 — preparedItems에 없음)
        if (supabase) {
          setSyncStatus('syncing');
          try {
            const { error } = await supabase.from('receipts').upsert(preparedItems);
            if (error) throw error;
            setSyncStatus('success');
          } catch (err) {
            console.error('Supabase Upsert Error:', err);
            setSyncStatus('error');
          }
        }

        resolve();
      };
      writeTx.onerror = () => reject(writeTx.error);
    });
  }, [dbOpen]);

  // ──────────────────────────────────────────────
  // deleteReceipt — 고아 이미지 정리 포함
  // ──────────────────────────────────────────────
  const deleteReceipt = useCallback(async (id) => {
    const db = await dbOpen();

    // Phase A: 삭제 대상 조회 + 같은 imageId를 공유하는 다른 영수증 수 파악
    const [target, allRecs] = await Promise.all([
      new Promise(res => {
        const tx  = db.transaction(STORE_RECEIPTS, 'readonly');
        const req = tx.objectStore(STORE_RECEIPTS).get(id);
        req.onsuccess = () => res(req.result);
        req.onerror   = () => res(null);
      }),
      new Promise(res => {
        const tx  = db.transaction(STORE_RECEIPTS, 'readonly');
        const req = tx.objectStore(STORE_RECEIPTS).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror   = () => res([]);
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
      if (imageUrlCache.has(target.imageId)) {
        URL.revokeObjectURL(imageUrlCache.get(target.imageId));
        imageUrlCache.delete(target.imageId);
      }
    }

    return new Promise((resolve, reject) => {
      tx.oncomplete = async () => {
        setReceipts(prev => prev.filter(r => r.id !== id));

        if (supabase) {
          setSyncStatus('syncing');
          try {
            const { error } = await supabase.from('receipts').delete().eq('id', id);
            if (error) throw error;
            setSyncStatus('success');
          } catch (err) {
            console.error('Supabase Delete Error:', err);
            setSyncStatus('error');
          }
        }
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }, [dbOpen]);

  // ──────────────────────────────────────────────
  // resetAll — 두 store 모두 초기화
  // ──────────────────────────────────────────────
  const resetAll = useCallback(async () => {
    const db = await dbOpen();
    const tx = db.transaction([STORE_RECEIPTS, STORE_IMAGES], 'readwrite');
    tx.objectStore(STORE_RECEIPTS).clear();
    tx.objectStore(STORE_IMAGES).clear();
    // Object URL 캐시 전체 정리
    imageUrlCache.forEach(url => URL.revokeObjectURL(url));
    imageUrlCache.clear();
    return new Promise(resolve => {
      tx.oncomplete = () => { setReceipts([]); resolve(); };
    });
  }, [dbOpen]);

  // ──────────────────────────────────────────────
  // saveCard
  // ──────────────────────────────────────────────
  const saveCard = useCallback(async (card) => {
    const db = await dbOpen();
    const tx = db.transaction(STORE_CARDS, 'readwrite');
    tx.objectStore(STORE_CARDS).put(card);
    return new Promise(resolve => {
      tx.oncomplete = () => {
        setCards(prev => {
          const idx = prev.findIndex(c => c.cardNumber === card.cardNumber);
          if (idx > -1) { const next = [...prev]; next[idx] = card; return next; }
          return [...prev, card];
        });
        resolve();
      };
    });
  }, [dbOpen]);

  // ──────────────────────────────────────────────
  // getHistory
  // ──────────────────────────────────────────────
  const getHistory = useCallback(async (receiptId) => {
    const db      = await dbOpen();
    const tx      = db.transaction(STORE_HISTORY, 'readonly');
    const index   = tx.objectStore(STORE_HISTORY).index('receiptId');
    const request = index.getAll(receiptId);
    return new Promise(resolve => {
      request.onsuccess = () => {
        const sorted = (request.result || []).sort((a, b) => new Date(b.editedAt) - new Date(a.editedAt));
        resolve(sorted);
      };
    });
  }, [dbOpen]);

  // ──────────────────────────────────────────────
  // fetchAllReceipts (Supabase 전체 조회)
  // ──────────────────────────────────────────────
  const fetchAllReceipts = useCallback(async () => {
    if (!supabase) return [];
    setSyncStatus('syncing');
    const { data, error } = await supabase.from('receipts').select('*').order('date', { ascending: false });
    if (error) { setSyncStatus('error'); return []; }
    setSyncStatus('success');
    // imageUrl 제거 (있더라도 클라이언트에서는 Blob 기반 사용)
    return (data || []).map(({ imageUrl, ...rest }) => rest);
  }, []);

  return {
    receipts, cards, loading, syncStatus,
    saveReceipts, deleteReceipt, resetAll, saveCard, getHistory, fetchAllReceipts,
    getImageUrl,
  };
}
