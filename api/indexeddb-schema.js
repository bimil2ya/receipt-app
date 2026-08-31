/**
 * IndexedDB 스키마 정의 및 관리
 * Day 24-25 구현
 *
 * 로컬 저장소 구조:
 * - Database: "receipt-app"
 * - Stores:
 *   ├── receipts (영수증 데이터)
 *   ├── metadata (메타데이터)
 *   └── sync-queue (동기화 대기 큐)
 */

/**
 * IndexedDB 스키마 정의
 */
export const DB_SCHEMA = {
  name: "receipt-app",
  version: 1,
  stores: {
    receipts: {
      keyPath: "id",
      indexes: [
        { name: "date", keyPath: "date" },
        { name: "store", keyPath: "store" },
        { name: "amount", keyPath: "amount" },
        { name: "metadataId", keyPath: "metadataId", unique: true },
      ]
    },
    metadata: {
      keyPath: "metadataId",
      indexes: [
        { name: "contentHash", keyPath: "contentHash" },
        { name: "dataDate", keyPath: "dataDate" },
        { name: "createdAt", keyPath: "createdAt" },
      ]
    },
    syncQueue: {
      keyPath: "id",
      indexes: [
        { name: "status", keyPath: "status" },
        { name: "timestamp", keyPath: "timestamp" },
        { name: "metadataId", keyPath: "metadataId" },
      ]
    }
  }
};

/**
 * 영수증 데이터 구조
 */
export const RECEIPT_SCHEMA = {
  id: "receipt-20260831-001",
  metadataId: "meta-20260831-001",     // 메타데이터와 연결
  date: "2026-08-31",                  // ISO 8601
  store: "카페서울",                     // 상호명
  amount: 12345,                       // 금액 (원)
  category: "cafe",                    // 카테고리
  items: ["아메리카노", "크로아상"],    // 구매 항목
  imageUrl: "blob:...",                // 이미지 URL
  ocrConfidence: 0.92,                 // OCR 신뢰도
  verified: false,                     // 사용자 검증 여부
  syncStatus: "pending",               // 동기화 상태: pending, synced, error
  syncRetries: 0,                      // 동기화 시도 횟수
  createdAt: "2026-08-31T14:30:00Z",   // 생성 시각
  updatedAt: "2026-08-31T14:30:00Z",   // 수정 시각
};

/**
 * 메타데이터 구조
 */
export const METADATA_SCHEMA = {
  metadataId: "meta-20260831-001",
  contentHash: "abc123def456...",      // SHA256 앞 32자
  dataDate: "2026-08-31",
  createdBy: "receipt-app-v2",
  receiptId: "receipt-20260831-001",
  fileName: "receipt-001.json",
  app_type: "receipt-app",
  app_version: "2.0.0",
  createdAt: "2026-08-31T14:30:00Z",
};

/**
 * 동기화 큐 구조
 */
export const SYNC_QUEUE_SCHEMA = {
  id: "sync-20260831-001",
  metadataId: "meta-20260831-001",
  operation: "upload",                 // upload, delete, update
  status: "pending",                   // pending, syncing, synced, error
  retries: 0,
  maxRetries: 3,
  lastError: null,
  timestamp: "2026-08-31T14:30:00Z",
  scheduledAt: "2026-08-31T14:35:00Z", // 동기화 예정 시간
};

/**
 * IndexedDB 데이터베이스 초기화
 * @returns {Promise<IDBDatabase>}
 */
export async function initializeDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_SCHEMA.name, DB_SCHEMA.version);

    request.onerror = () => {
      console.error("❌ IndexedDB 열기 실패");
      reject(request.error);
    };

    request.onsuccess = () => {
      console.log("✅ IndexedDB 열기 성공");
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      console.log("📋 IndexedDB 스키마 업그레이드 시작");

      // Receipts Store
      if (!db.objectStoreNames.contains("receipts")) {
        const receiptsStore = db.createObjectStore(
          "receipts",
          { keyPath: DB_SCHEMA.stores.receipts.keyPath }
        );

        for (const index of DB_SCHEMA.stores.receipts.indexes) {
          receiptsStore.createIndex(index.name, index.keyPath, {
            unique: index.unique || false
          });
        }
        console.log("  ✅ receipts store 생성");
      }

      // Metadata Store
      if (!db.objectStoreNames.contains("metadata")) {
        const metadataStore = db.createObjectStore(
          "metadata",
          { keyPath: DB_SCHEMA.stores.metadata.keyPath }
        );

        for (const index of DB_SCHEMA.stores.metadata.indexes) {
          metadataStore.createIndex(index.name, index.keyPath, {
            unique: index.unique || false
          });
        }
        console.log("  ✅ metadata store 생성");
      }

      // Sync Queue Store
      if (!db.objectStoreNames.contains("syncQueue")) {
        const syncQueueStore = db.createObjectStore(
          "syncQueue",
          { keyPath: DB_SCHEMA.stores.syncQueue.keyPath }
        );

        for (const index of DB_SCHEMA.stores.syncQueue.indexes) {
          syncQueueStore.createIndex(index.name, index.keyPath, {
            unique: index.unique || false
          });
        }
        console.log("  ✅ syncQueue store 생성");
      }

      console.log("📋 IndexedDB 스키마 업그레이드 완료");
    };
  });
}

/**
 * 영수증 저장
 * @param {IDBDatabase} db
 * @param {Object} receipt
 * @returns {Promise<string>} 저장된 ID
 */
export async function saveReceipt(db, receipt) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["receipts"], "readwrite");
    const store = transaction.objectStore("receipts");

    // ID 자동 생성
    receipt.id = receipt.id || `receipt-${Date.now()}`;
    receipt.createdAt = receipt.createdAt || new Date().toISOString();
    receipt.updatedAt = new Date().toISOString();

    const request = store.add(receipt);

    request.onsuccess = () => {
      console.log(`✅ 영수증 저장: ${receipt.id}`);
      resolve(receipt.id);
    };

    request.onerror = () => {
      console.error(`❌ 영수증 저장 실패: ${request.error}`);
      reject(request.error);
    };
  });
}

/**
 * 메타데이터 저장
 * @param {IDBDatabase} db
 * @param {Object} metadata
 * @returns {Promise<string>} 저장된 metadataId
 */
export async function saveMetadata(db, metadata) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["metadata"], "readwrite");
    const store = transaction.objectStore("metadata");

    metadata.createdAt = metadata.createdAt || new Date().toISOString();

    const request = store.add(metadata);

    request.onsuccess = () => {
      console.log(`✅ 메타데이터 저장: ${metadata.metadataId}`);
      resolve(metadata.metadataId);
    };

    request.onerror = () => {
      console.error(`❌ 메타데이터 저장 실패: ${request.error}`);
      reject(request.error);
    };
  });
}

/**
 * 동기화 큐에 추가
 * @param {IDBDatabase} db
 * @param {Object} syncItem
 * @returns {Promise<string>} 큐 ID
 */
export async function addToSyncQueue(db, syncItem) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["syncQueue"], "readwrite");
    const store = transaction.objectStore("syncQueue");

    syncItem.id = syncItem.id || `sync-${Date.now()}`;
    syncItem.timestamp = syncItem.timestamp || new Date().toISOString();
    syncItem.status = syncItem.status || "pending";
    syncItem.retries = syncItem.retries || 0;

    const request = store.add(syncItem);

    request.onsuccess = () => {
      console.log(`✅ 동기화 큐 추가: ${syncItem.id}`);
      resolve(syncItem.id);
    };

    request.onerror = () => {
      console.error(`❌ 동기화 큐 추가 실패: ${request.error}`);
      reject(request.error);
    };
  });
}

/**
 * 대기 중인 동기화 항목 조회
 * @param {IDBDatabase} db
 * @returns {Promise<Array>} 대기 중인 항목
 */
export async function getPendingSyncItems(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["syncQueue"], "readonly");
    const store = transaction.objectStore("syncQueue");
    const index = store.index("status");

    const request = index.getAll("pending");

    request.onsuccess = () => {
      const items = request.result;
      console.log(`📋 대기 중인 동기화: ${items.length}개`);
      resolve(items);
    };

    request.onerror = () => {
      console.error(`❌ 동기화 항목 조회 실패: ${request.error}`);
      reject(request.error);
    };
  });
}

/**
 * 영수증 조회
 * @param {IDBDatabase} db
 * @param {string} id
 * @returns {Promise<Object>} 영수증 데이터
 */
export async function getReceipt(db, id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["receipts"], "readonly");
    const store = transaction.objectStore("receipts");
    const request = store.get(id);

    request.onsuccess = () => {
      console.log(`📖 영수증 조회: ${id}`);
      resolve(request.result);
    };

    request.onerror = () => {
      console.error(`❌ 영수증 조회 실패: ${request.error}`);
      reject(request.error);
    };
  });
}

/**
 * 모든 영수증 조회
 * @param {IDBDatabase} db
 * @returns {Promise<Array>} 모든 영수증
 */
export async function getAllReceipts(db) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["receipts"], "readonly");
    const store = transaction.objectStore("receipts");
    const request = store.getAll();

    request.onsuccess = () => {
      const receipts = request.result;
      console.log(`📖 총 영수증: ${receipts.length}개`);
      resolve(receipts);
    };

    request.onerror = () => {
      console.error(`❌ 모든 영수증 조회 실패: ${request.error}`);
      reject(request.error);
    };
  });
}

/**
 * 동기화 상태 업데이트
 * @param {IDBDatabase} db
 * @param {string} syncId
 * @param {string} status - pending, syncing, synced, error
 * @param {string} error - 에러 메시지 (선택사항)
 * @returns {Promise<void>}
 */
export async function updateSyncStatus(db, syncId, status, error = null) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(["syncQueue"], "readwrite");
    const store = transaction.objectStore("syncQueue");
    const getRequest = store.get(syncId);

    getRequest.onsuccess = () => {
      const item = getRequest.result;
      if (!item) {
        reject(new Error(`Sync item not found: ${syncId}`));
        return;
      }

      item.status = status;
      if (error) item.lastError = error;
      if (status === "syncing") item.retries = (item.retries || 0) + 1;

      const updateRequest = store.put(item);
      updateRequest.onsuccess = () => {
        console.log(`✅ 동기화 상태 업데이트: ${syncId} → ${status}`);
        resolve();
      };

      updateRequest.onerror = () => {
        reject(updateRequest.error);
      };
    };

    getRequest.onerror = () => {
      reject(getRequest.error);
    };
  });
}
