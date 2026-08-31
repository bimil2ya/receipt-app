/**
 * 세션 메모리 캐싱 시스템: API 호출 50% 감소
 * Day 18-19 구현
 */

/**
 * 폴더 캐시 클래스 (TTL: 1시간)
 */
export class FolderCache {
  constructor(ttl = 3600000) {
    // ttl: 밀리초 (기본값: 1시간)
    this.cache = new Map();
    this.ttl = ttl;
    this.stats = { hits: 0, misses: 0, size: 0 };
  }

  /**
   * 캐시에서 조회
   * @param {string} key - 캐시 키
   * @returns {any|null} 캐시된 값 또는 null
   */
  get(key) {
    if (!this.cache.has(key)) {
      this.stats.misses++;
      return null;
    }

    const entry = this.cache.get(key);

    // TTL 만료 확인
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.value;
  }

  /**
   * 캐시에 저장
   * @param {string} key - 캐시 키
   * @param {any} value - 저장할 값
   */
  set(key, value) {
    this.cache.set(key, {
      value: value,
      timestamp: Date.now()
    });

    this.stats.size = this.cache.size;
  }

  /**
   * 캐시 통계 조회
   * @returns {Object} 통계 객체
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? ((this.stats.hits / total) * 100).toFixed(2) : 0;

    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: `${hitRate}%`,
      size: this.stats.size,
      total: total
    };
  }

  /**
   * 캐시 초기화
   */
  clear() {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0, size: 0 };
  }

  /**
   * 만료된 항목 정리
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key);
        cleaned++;
      }
    }

    this.stats.size = this.cache.size;
    console.log(`🧹 캐시 정리: ${cleaned}개 항목 제거, 현재 크기: ${this.stats.size}`);
    return cleaned;
  }
}

/**
 * 글로벌 폴더 캐시 인스턴스
 */
export const folderCache = new FolderCache(3600000); // 1시간

/**
 * 캐시를 포함한 폴더 조회/생성
 * @param {object} drive - googleapis drive 인스턴스
 * @param {string} folderName - 폴더명
 * @param {string} parentId - 부모 폴더 ID
 * @param {Function} getOrCreateFolderFn - 실제 조회/생성 함수
 * @returns {Promise<string>} 폴더 ID
 */
export async function getOrCreateFolderWithCache(
  drive,
  folderName,
  parentId,
  getOrCreateFolderFn
) {
  // 캐시 키: parentId + folderName
  const cacheKey = `${parentId}:${folderName}`;

  // 1. 캐시 확인
  const cached = folderCache.get(cacheKey);
  if (cached) {
    console.log(`✅ 캐시 히트: ${folderName}`);
    return cached;
  }

  // 2. 캐시 미스 → Google Drive에서 조회/생성
  console.log(`📡 Google Drive 호출: ${folderName}`);
  const folderId = await getOrCreateFolderFn(drive, folderName, parentId);

  // 3. 캐시에 저장
  folderCache.set(cacheKey, folderId);

  return folderId;
}

/**
 * 캐시 효율성 분석
 * @returns {Object} 분석 결과
 */
export function analyzeCacheEfficiency() {
  const stats = folderCache.getStats();
  const hitRate = parseFloat(stats.hitRate);

  return {
    ...stats,
    efficiency: {
      apiCallsSaved: stats.hits,
      estimatedApiCallReduction: hitRate > 0 ? `${((hitRate / 100) * 100).toFixed(1)}%` : '0%',
      recommendation: hitRate > 60 ? '✅ 좋은 캐시 성능' : '⚠️ 캐시 성능 개선 필요'
    }
  };
}
