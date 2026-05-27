import { openDB } from 'idb';

const DB_NAME = 'PointPhotoDB';
const DB_VERSION = 1;
const STORE_NAME = 'points';

/**
 * IndexedDB 초기화 및 인스턴스 반환
 */
export async function initDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'pointId' });
      }
    },
  });
}

/**
 * 포인트 데이터 저장 (Blob 객체 직접 저장 - Base64 금지 준수)
 */
export async function savePointData(pointData) {
  const db = await initDB();
  // 트랜잭션을 짧게 유지하기 위해 데이터 가공 후 호출 (전문가 가이드 준수)
  return db.put(STORE_NAME, pointData);
}

/**
 * 모든 미전송 포인트 목록 조회
 */
export async function getAllPoints() {
  const db = await initDB();
  return db.getAll(STORE_NAME);
}

/**
 * 특정 포인트 데이터 조회
 */
export async function getPointById(pointId) {
  const db = await initDB();
  return db.get(STORE_NAME, pointId);
}

/**
 * 업로드 성공 후 포인트 삭제
 */
export async function deletePoint(pointId) {
  const db = await initDB();
  return db.delete(STORE_NAME, pointId);
}

/**
 * 시스템 초기화 (로고 5탭 비밀 버튼용)
 */
export async function factoryReset() {
  const db = await initDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.objectStore(STORE_NAME).clear();
  await tx.done;
  localStorage.clear();
  window.location.reload();
}
