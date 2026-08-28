// 출처 단위 인메모리 Rate Limiting (Vercel Fluid Compute 인스턴스 재사용 환경용)
// 분산 환경에서는 Vercel KV 등 외부 저장소 필요

const rateLimitBuckets = new Map();

export function createRateLimiter(windowMs, maxRequests, bucketId = 'default') {
  return function checkRateLimit(key) {
    const now = Date.now();
    const bucketKey = `${bucketId}:${key}`;
    const bucket = rateLimitBuckets.get(bucketKey);

    if (!bucket || bucket.resetAt < now) {
      rateLimitBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return { ok: true };
    }

    if (bucket.count >= maxRequests) {
      return { 
        ok: false, 
        retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) 
      };
    }

    bucket.count += 1;
    return { ok: true };
  };
}

// 사전 정의된 레이트 리미터
export const analyzeRateLimiter = createRateLimiter(
  60_000,    // 1분
  30,        // 분당 최대 30회
  'analyze'
);

export const uploadRateLimiter = createRateLimiter(
  10 * 60_000, // 10분
  200,         // 10분당 최대 200회
  'upload'
);

export const restoreRateLimiter = createRateLimiter(
  10 * 60_000, // 10분
  60,          // 10분당 최대 60회
  'restore'
);
