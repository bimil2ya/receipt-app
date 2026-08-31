/**
 * 오프라인 동기화 시스템
 * Day 33-37 구현
 *
 * 기능:
 * - Idempotency 구현 (PUT /api/upload-metadata/:metadataId)
 * - 충돌 해결 정책 (서버/클라이언트/사용자 선택)
 * - 로컬 큐 동기화 (온라인 복귀 시 자동)
 * - 네트워크 상태 감지
 */

import { addToSyncQueue, updateSyncStatus, getPendingSyncItems } from './indexeddb-schema.js';

/**
 * 네트워크 상태 모니터링
 */
class NetworkMonitor {
  constructor() {
    this.isOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
    this.listeners = [];

    // 네트워크 변경 감지 (브라우저 환경에서만)
    if (typeof window !== "undefined") {
      window.addEventListener("online", () => this.setOnline(true));
      window.addEventListener("offline", () => this.setOnline(false));
    }
  }

  /**
   * 네트워크 상태 변경
   */
  setOnline(status) {
    if (this.isOnline !== status) {
      this.isOnline = status;
      console.log(`🌐 네트워크: ${status ? "온라인" : "오프라인"}`);

      // 모든 리스너에 알림
      for (const listener of this.listeners) {
        listener(status);
      }

      // 온라인 복귀 시 동기화 시작
      if (status) {
        this.syncPendingItems();
      }
    }
  }

  /**
   * 네트워크 상태 변경 리스너 등록
   */
  onStatusChange(callback) {
    this.listeners.push(callback);
  }

  /**
   * 대기 중인 항목 동기화
   */
  async syncPendingItems() {
    console.log("🔄 대기 중인 항목 동기화 시작...");
    // 구현은 아래에서
  }
}

export const networkMonitor = new NetworkMonitor();

/**
 * 충돌 해결 전략
 */
export const CONFLICT_RESOLUTION = {
  SERVER_WINS: "server_wins",           // 서버 데이터 우선
  CLIENT_WINS: "client_wins",           // 클라이언트 데이터 우선
  MERGE: "merge",                        // 병합
  USER_CHOICE: "user_choice",           // 사용자 선택
};

/**
 * 동기화 항목 상태
 */
export const SYNC_STATUS = {
  PENDING: "pending",                   // 대기
  SYNCING: "syncing",                   // 동기화 중
  SYNCED: "synced",                     // 완료
  CONFLICT: "conflict",                 // 충돌
  ERROR: "error",                       // 오류
};

/**
 * 오프라인 변경사항 저장
 * @param {string} metadataId - 메타데이터 ID
 * @param {Object} changes - 변경사항
 * @param {string} operation - 작업 (upload, update, delete)
 */
export async function saveOfflineChange(metadataId, changes, operation = "update") {
  if (networkMonitor.isOnline) {
    // 온라인이면 즉시 동기화
    return await syncToServer(metadataId, changes, operation);
  }

  // 오프라인이면 큐에 저장
  console.log(`💾 오프라인 변경사항 저장: ${metadataId}`);

  const db = await openReceiptDB(); // IndexedDB 열기
  await addToSyncQueue(db, {
    metadataId,
    operation,
    status: SYNC_STATUS.PENDING,
    data: changes,
    timestamp: new Date().toISOString(),
  });

  return {
    success: true,
    queued: true,
    message: "오프라인 상태에서 저장되었습니다. 온라인 복귀 시 자동 동기화됩니다.",
  };
}

/**
 * 서버에 변경사항 동기화
 * @param {string} metadataId - 메타데이터 ID
 * @param {Object} changes - 변경사항
 * @param {string} operation - 작업
 */
export async function syncToServer(metadataId, changes, operation) {
  try {
    console.log(`📡 서버 동기화 시작: ${metadataId}`);

    const response = await fetch(`/api/upload-metadata/${metadataId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        metadataId,
        operation,
        data: changes,
        timestamp: new Date().toISOString(),
      }),
    });

    if (response.status === 409) {
      // 충돌 발생
      const conflict = await response.json();
      console.warn(`⚠️ 충돌 감지: ${metadataId}`);

      return {
        success: false,
        conflict: true,
        serverData: conflict.serverData,
        clientData: changes,
        resolution: CONFLICT_RESOLUTION.USER_CHOICE,
      };
    }

    if (!response.ok) {
      throw new Error(`Sync failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`✅ 동기화 완료: ${metadataId}`);

    return {
      success: true,
      conflict: false,
      data: result,
    };

  } catch (error) {
    console.error(`❌ 동기화 오류: ${error.message}`);

    // 재시도 큐에 추가
    return {
      success: false,
      error: error.message,
      retry: true,
    };
  }
}

/**
 * 충돌 해결
 * @param {Object} conflict - 충돌 정보
 * @param {string} resolution - 해결 전략
 */
export async function resolveConflict(conflict, resolution) {
  console.log(`🔧 충돌 해결: ${resolution}`);

  const { metadataId, serverData, clientData } = conflict;

  let resolvedData;

  switch (resolution) {
    case CONFLICT_RESOLUTION.SERVER_WINS:
      resolvedData = serverData;
      console.log(`  ✅ 서버 데이터 우선`);
      break;

    case CONFLICT_RESOLUTION.CLIENT_WINS:
      resolvedData = clientData;
      console.log(`  ✅ 클라이언트 데이터 우선`);
      break;

    case CONFLICT_RESOLUTION.MERGE:
      // 병합 전략: 최신 데이터 선택
      resolvedData = {
        ...serverData,
        ...clientData,
        mergedAt: new Date().toISOString(),
      };
      console.log(`  ✅ 데이터 병합`);
      break;

    default:
      throw new Error(`Unknown resolution: ${resolution}`);
  }

  // 해결된 데이터 다시 동기화
  return await syncToServer(metadataId, resolvedData, "update");
}

/**
 * 모든 대기 항목 동기화
 * @param {IDBDatabase} db - IndexedDB 인스턴스
 */
export async function syncAllPendingItems(db) {
  console.log("🔄 모든 대기 항목 동기화 시작...");

  const pendingItems = await getPendingSyncItems(db);
  console.log(`📋 대기 중인 항목: ${pendingItems.length}개`);

  const results = [];

  for (const item of pendingItems) {
    try {
      await updateSyncStatus(db, item.id, SYNC_STATUS.SYNCING);

      const result = await syncToServer(
        item.metadataId,
        item.data,
        item.operation
      );

      if (result.success) {
        await updateSyncStatus(db, item.id, SYNC_STATUS.SYNCED);
        results.push({ id: item.id, status: "synced" });
      } else if (result.conflict) {
        await updateSyncStatus(db, item.id, SYNC_STATUS.CONFLICT);
        results.push({ id: item.id, status: "conflict", data: result });
      } else {
        await updateSyncStatus(
          db,
          item.id,
          SYNC_STATUS.ERROR,
          result.error || "Unknown error"
        );
        results.push({ id: item.id, status: "error" });
      }

    } catch (error) {
      console.error(`❌ 동기화 실패: ${item.metadataId} - ${error.message}`);
      await updateSyncStatus(
        db,
        item.id,
        SYNC_STATUS.ERROR,
        error.message
      );
      results.push({ id: item.id, status: "error" });
    }
  }

  const succeeded = results.filter(r => r.status === "synced").length;
  const conflicts = results.filter(r => r.status === "conflict").length;
  const failed = results.filter(r => r.status === "error").length;

  console.log(`📊 동기화 결과:`);
  console.log(`  ✅ 성공: ${succeeded}개`);
  console.log(`  ⚠️ 충돌: ${conflicts}개`);
  console.log(`  ❌ 실패: ${failed}개`);

  return results;
}

/**
 * 충돌 다이얼로그 정보 생성
 * @param {Object} conflict - 충돌 정보
 */
export function createConflictDialog(conflict) {
  const { metadataId, serverData, clientData } = conflict;

  return {
    title: "데이터 충돌 감지",
    message: `"${metadataId}"에 대한 변경사항이 충돌했습니다.`,
    serverData: {
      label: "서버 데이터",
      data: serverData,
    },
    clientData: {
      label: "내 변경사항",
      data: clientData,
    },
    options: [
      {
        value: CONFLICT_RESOLUTION.SERVER_WINS,
        label: "서버 데이터 사용",
        description: "서버의 최신 데이터를 사용합니다",
      },
      {
        value: CONFLICT_RESOLUTION.CLIENT_WINS,
        label: "내 변경사항 사용",
        description: "내가 변경한 데이터를 사용합니다",
      },
      {
        value: CONFLICT_RESOLUTION.MERGE,
        label: "병합",
        description: "두 데이터를 병합합니다",
      },
    ],
  };
}

/**
 * 동기화 상태 대시보드
 */
export async function getSyncDashboard(db) {
  const pendingItems = await getPendingSyncItems(db);

  const stats = {
    online: networkMonitor.isOnline,
    pending: pendingItems.length,
    syncing: pendingItems.filter(i => i.status === SYNC_STATUS.SYNCING).length,
    conflicts: pendingItems.filter(i => i.status === SYNC_STATUS.CONFLICT).length,
    errors: pendingItems.filter(i => i.status === SYNC_STATUS.ERROR).length,
    items: pendingItems,
  };

  console.log(`📊 동기화 대시보드:`);
  console.log(`  🌐 상태: ${stats.online ? "온라인" : "오프라인"}`);
  console.log(`  📋 대기: ${stats.pending}개`);
  console.log(`  🔄 동기화 중: ${stats.syncing}개`);
  console.log(`  ⚠️ 충돌: ${stats.conflicts}개`);
  console.log(`  ❌ 오류: ${stats.errors}개`);

  return stats;
}

/**
 * 자동 동기화 시작
 * @param {IDBDatabase} db - IndexedDB 인스턴스
 * @param {number} interval - 동기화 간격 (ms)
 */
export function startAutoSync(db, interval = 30000) {
  console.log(`⚙️ 자동 동기화 시작 (${interval / 1000}초 간격)`);

  networkMonitor.onStatusChange(async (isOnline) => {
    if (isOnline) {
      console.log("🔄 온라인 복귀 - 즉시 동기화 시작");
      await syncAllPendingItems(db);
    }
  });

  // 정기적 동기화
  setInterval(async () => {
    if (networkMonitor.isOnline) {
      await syncAllPendingItems(db);
    }
  }, interval);
}

/**
 * Idempotency 키 생성
 * @param {string} metadataId - 메타데이터 ID
 * @param {Object} data - 데이터
 */
export async function generateIdempotencyKey(metadataId, data) {
  const content = JSON.stringify({ metadataId, data });

  // 브라우저 환경 (Web Crypto API)
  if (typeof window !== "undefined" && window.crypto) {
    try {
      const buffer = new TextEncoder().encode(content);
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
      return `idempotency-${metadataId}-${hash.substring(0, 16)}`;
    } catch (error) {
      console.warn("Web Crypto API 사용 불가, fallback 사용");
    }
  }

  // Node.js 환경 또는 fallback
  try {
    const crypto = await import("crypto");
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    return `idempotency-${metadataId}-${hash.substring(0, 16)}`;
  } catch (error) {
    // 최후의 fallback: 간단한 해시 (실제 환경에서는 사용 금지)
    const simple = Math.random().toString(36).substring(7);
    return `idempotency-${metadataId}-${simple}`;
  }
}
