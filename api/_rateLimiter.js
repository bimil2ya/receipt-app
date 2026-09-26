// 기기(IP) 단위 인메모리 Rate Limiting (Vercel Fluid Compute 인스턴스 재사용 환경용)
// 분산 환경에서는 Vercel KV 등 외부 저장소 필요

const rateLimitBuckets = new Map();

// 출처(Origin)로 묶으면 모든 현장 기기가 한 버킷을 나눠 써서, 여러 조가 동시에 올릴 때
// 정상 요청이 429로 막힌다. Vercel은 x-real-ip / x-forwarded-for를 직접 덮어쓰므로
// 클라이언트가 위조할 수 없다. 헤더가 없을 때(로컬 개발)만 출처로 대신한다.
export function clientRateKey(headers) {
  const get = name => (typeof headers?.get === 'function' ? headers.get(name) : headers?.[name]) || '';
  const realIp = String(get('x-real-ip')).trim();
  const forwarded = String(get('x-forwarded-for')).split(',')[0].trim();
  return realIp || forwarded || String(get('origin')).trim() || 'unknown';
}

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
  400,         // 10분당 최대 400회 (정산서 PDF 청크는 upload.js에서 카운트 제외)
  'upload'
);

// 진행 공유: 폰이 목록이 바뀔 때만 최소 5분 간격으로 보내므로 넉넉한 상한이다.
export const progressRateLimiter = createRateLimiter(
  10 * 60_000, // 10분
  30,          // 10분당 최대 30회
  'progress'
);

export const restoreRateLimiter = createRateLimiter(
  10 * 60_000, // 10분
  60,          // 10분당 최대 60회
  'restore'
);
