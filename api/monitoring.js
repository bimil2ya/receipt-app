/**
 * Google Drive API 헬스 체크 및 알림
 * 성능 저하, Rate Limit, 권한 문제 감지
 */

import { driveMetrics } from './_metrics.js';

/**
 * Google Drive 헬스 체크
 * @param {object} drive - googleapis drive 인스턴스 (선택사항)
 * @returns {Object} { status, alerts, stats }
 */
export async function checkDriveHealth(drive = null) {
  const alerts = [];
  const stats = driveMetrics.getStats();

  // 임계값 기반 알림 확인
  
  // 1. 캐시 히트율 저조
  const cacheHitRate = parseFloat(stats.cacheHitRate);
  if (cacheHitRate < 30 && stats.latencySamples > 0) {
    alerts.push('⚠️ 캐시 히트율 저조 (<30%) - 캐시 전략 검토 필요');
  }

  // 2. 평균 응답시간 높음
  const avgLatency = parseInt(stats.avgLatencyMs);
  if (avgLatency > 1000) {
    alerts.push(`⚠️ 평균 응답시간 높음 (${avgLatency}ms) - 네트워크 지연 가능`);
  }

  // 3. Rate Limit 초과
  if ((stats.errors['429'] || 0) > 5) {
    alerts.push(`⚠️ Rate Limit 초과 (429 에러 ${stats.errors['429']}회) - 요청 속도 조절 필요`);
  }

  // 4. 권한 오류
  if ((stats.errors['403'] || 0) > 0) {
    alerts.push(`🚨 권한 오류 (403) 발생 - OAuth 토큰 재인증 필요`);
  }

  // 5. 서버 오류
  if ((stats.errors['500'] || 0) > 0 || (stats.errors['503'] || 0) > 0) {
    alerts.push(`⚠️ Google Drive 서버 오류 감지`);
  }

  // Drive 직접 접근 테스트 (선택사항)
  let driveAccessible = null;
  if (drive) {
    try {
      await drive.files.list({
        q: "'root' in trashed",
        pageSize: 1,
        fields: 'files(id)'
      });
      driveAccessible = true;
    } catch (error) {
      driveAccessible = false;
      alerts.push(`❌ Google Drive 접근 불가 - ${error.message}`);
    }
  }

  return {
    status: alerts.length === 0 ? 'healthy' : 'warning',
    timestamp: new Date().toISOString(),
    alerts,
    stats: {
      ...stats,
      driveAccessible
    }
  };
}

/**
 * 정기적 헬스 체크 스케줄링 (매시간)
 * @param {object} drive - googleapis drive 인스턴스
 */
export function scheduleHealthCheck(drive) {
  const intervalId = setInterval(async () => {
    const health = await checkDriveHealth(drive);
    if (health.alerts.length > 0) {
      console.warn('🏥 Drive Health Report:', JSON.stringify(health, null, 2));
      // TODO: Slack 알림, Sentry 로깅 등 추가 가능
    }
  }, 3600000); // 1시간

  return intervalId;
}
