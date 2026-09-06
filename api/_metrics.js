/**
 * Google Drive API 메트릭 수집
 * 캐시 히트율, 응답시간, 에러율 추적
 * 슬라이딩 윈도우로 메모리 누수 방지
 */

export class DriveMetrics {
  constructor(windowMs = 3600000) {  // 1시간 (기본값)
    this.metrics = {
      apiCalls: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: {},
      latencies: []
    };
    this.windowMs = windowMs;
    this.lastCleanup = Date.now();
  }

  /**
   * API 호출 기록
   * @param {string} endpoint - 엔드포인트명
   * @param {number} latencyMs - 응답 시간 (밀리초)
   */
  recordApiCall(endpoint, latencyMs) {
    this.metrics.apiCalls++;
    this.metrics.latencies.push(latencyMs);

    // 슬라이딩 윈도우: 최근 1000개만 유지 (메모리 누수 방지)
    if (this.metrics.latencies.length > 1000) {
      this.metrics.latencies.shift();
    }

    // 정기적 정리 (1시간마다)
    if (Date.now() - this.lastCleanup > this.windowMs) {
      this.cleanup();
    }
  }

  /**
   * 캐시 히트 기록
   */
  recordCacheHit() {
    this.metrics.cacheHits++;
  }

  /**
   * 캐시 미스 기록
   */
  recordCacheMiss() {
    this.metrics.cacheMisses++;
  }

  /**
   * 에러 기록
   * @param {number} errorStatus - HTTP 상태 코드
   */
  recordError(errorStatus) {
    this.metrics.errors[errorStatus] = (this.metrics.errors[errorStatus] || 0) + 1;
  }

  /**
   * 메모리 누수 방지: 1시간 이상 된 데이터 정리
   */
  cleanup() {
    // 에러 카운트 0인 항목 제거
    for (const key of Object.keys(this.metrics.errors)) {
      if (this.metrics.errors[key] === 0) {
        delete this.metrics.errors[key];
      }
    }
    this.lastCleanup = Date.now();
    console.log(`🧹 메트릭 정리 완료 (${new Date().toISOString()})`);
  }

  /**
   * 통계 조회
   * @returns {Object} 통계 객체
   */
  getStats() {
    const total = this.metrics.cacheHits + this.metrics.cacheMisses;
    const cacheHitRate = total > 0 
      ? (this.metrics.cacheHits / total * 100).toFixed(2) 
      : 0;

    const avgLatencyMs = this.metrics.latencies.length > 0
      ? (this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length).toFixed(0)
      : 0;

    return {
      totalApiCalls: this.metrics.apiCalls,
      cacheHitRate: `${cacheHitRate}%`,
      avgLatencyMs: `${avgLatencyMs}ms`,
      errors: this.metrics.errors,
      latencySamples: this.metrics.latencies.length
    };
  }
}

/**
 * 글로벌 메트릭 인스턴스
 */
export const driveMetrics = new DriveMetrics(3600000); // 1시간 윈도우
