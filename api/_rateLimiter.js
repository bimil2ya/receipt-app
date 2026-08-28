import { kv } from '@vercel/kv';

/**
 * 분산 환경(Vercel 다중 인스턴스)에서 안전한 Rate Limiting
 * Vercel KV를 사용하여 모든 인스턴스에서 공유되는 카운터 유지
 */

const UPLOAD_RATE_WINDOW_MS = 10 * 60_000; // 10분
const UPLOAD_RATE_MAX = 200;
const ANALYZE_RATE_WINDOW_MS = 60_000; // 1분
const ANALYZE_RATE_MAX = 30;

/**
 * Upload API Rate Limit Check (10분에 200회)
 * @param {string} key - 출처/사용자 식별자 (IP 또는 deviceId)
 * @returns {Promise<{ok: boolean, retryAfterSec?: number}>}
 */
export async function uploadRateLimitCheck(key) {
  if (!key) {
    return { ok: false, retryAfterSec: 60 };
  }

  const kvKey = `upload_ratelimit:${key}`;

  try {
    const bucket = await kv.get(kvKey);
    const now = Date.now();

    if (!bucket || bucket.resetAt < now) {
      // 새로운 윈도우 시작
      await kv.setex(kvKey, Math.ceil(UPLOAD_RATE_WINDOW_MS / 1000), {
        count: 1,
        resetAt: now + UPLOAD_RATE_WINDOW_MS,
      });
      return { ok: true };
    }

    if (bucket.count >= UPLOAD_RATE_MAX) {
      // 제한 도달
      return {
        ok: false,
        retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
      };
    }

    // 카운트 증가
    bucket.count += 1;
    await kv.setex(kvKey, Math.ceil((bucket.resetAt - now) / 1000), bucket);
    return { ok: true };
  } catch (error) {
    // KV 서비스 다운 시 fallback: 요청 허용하되 로그
    console.error('[Rate Limiter] KV error, allowing request:', error.message);
    return { ok: true };
  }
}

/**
 * Analyze API Rate Limit Check (분당 30회)
 * @param {string} key - 출처/사용자 식별자
 * @returns {Promise<{ok: boolean, retryAfterSec?: number}>}
 */
export async function analyzeRateLimitCheck(key) {
  if (!key) {
    return { ok: false, retryAfterSec: 60 };
  }

  const kvKey = `analyze_ratelimit:${key}`;

  try {
    const bucket = await kv.get(kvKey);
    const now = Date.now();

    if (!bucket || bucket.resetAt < now) {
      await kv.setex(kvKey, Math.ceil(ANALYZE_RATE_WINDOW_MS / 1000), {
        count: 1,
        resetAt: now + ANALYZE_RATE_WINDOW_MS,
      });
      return { ok: true };
    }

    if (bucket.count >= ANALYZE_RATE_MAX) {
      return {
        ok: false,
        retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000),
      };
    }

    bucket.count += 1;
    await kv.setex(kvKey, Math.ceil((bucket.resetAt - now) / 1000), bucket);
    return { ok: true };
  } catch (error) {
    console.error('[Rate Limiter] KV error, allowing request:', error.message);
    return { ok: true };
  }
}

/**
 * 특정 key의 rate limit 정보 조회 (디버깅용)
 */
export async function getRateLimitStatus(key, type = 'upload') {
  const kvKey = `${type}_ratelimit:${key}`;
  try {
    return await kv.get(kvKey);
  } catch (error) {
    console.error(`[Rate Limiter] Failed to get ${type} status:`, error.message);
    return null;
  }
}

/**
 * 특정 key의 rate limit 리셋 (관리자용)
 */
export async function resetRateLimit(key, type = 'upload') {
  const kvKey = `${type}_ratelimit:${key}`;
  try {
    await kv.del(kvKey);
    return { success: true };
  } catch (error) {
    console.error(`[Rate Limiter] Failed to reset ${type}:`, error.message);
    return { success: false, error: error.message };
  }
}
