// 대시보드 인증 rate-limit·잠금·복구 메일 제한을 담는 지속 저장소 어댑터.
//
// 계획서 v0.9 선결조건 4 / 착수 키트 §6.
//   - 프로덕션: Vercel 마켓플레이스의 Upstash Redis(권장). 아래 configureKv()로 주입.
//   - 개발/테스트: 인메모리 fallback(프로세스 수명 동안만 유지 — 서버리스에선 무의미하므로
//     프로덕션에서는 반드시 configureKv()로 실제 클라이언트를 붙여야 한다).
//
// 핵심 계약: 저장소 접근이 실패하면 KvUnavailableError(code: 'KV_UNAVAILABLE')를 던진다.
// 절대 삼키지 않는다 → 호출부가 fail-closed(로그인 거부)할 수 있어야 한다.
//
// _ 접두사라 Vercel 파일 라우팅에서 API 엔드포인트로 노출되지 않는다.

export class KvUnavailableError extends Error {
  constructor(message) {
    super(message || 'KV unavailable');
    this.name = 'KvUnavailableError';
    this.code = 'KV_UNAVAILABLE';
  }
}

// ── 인메모리 fallback ──────────────────────────────────────────────
// { value, expireAt } 형태. expire()는 TTL(초)만 기록, 조회 시 만료 처리.
function createMemoryStore() {
  const map = new Map();

  const isLive = (entry) => entry && (entry.expireAt === 0 || entry.expireAt > Date.now());

  return {
    async incr(key) {
      const entry = map.get(key);
      const next = isLive(entry) ? Number(entry.value) + 1 : 1;
      map.set(key, { value: next, expireAt: isLive(entry) ? entry.expireAt : 0 });
      return next;
    },
    async expire(key, ttlSec) {
      const entry = map.get(key);
      if (!isLive(entry)) return false;
      entry.expireAt = Date.now() + ttlSec * 1000;
      return true;
    },
    async get(key) {
      const entry = map.get(key);
      return isLive(entry) ? entry.value : null;
    },
    async del(key) {
      return map.delete(key) ? 1 : 0;
    },
  };
}

let store = createMemoryStore();

/**
 * 프로덕션에서 실제 KV 클라이언트를 주입한다.
 * client는 { incr, expire, get, del } 4개 메서드(전부 async)를 구현해야 한다.
 *
 * Upstash 예시(패키지 설치 후):
 *   import { Redis } from '@upstash/redis';
 *   const redis = Redis.fromEnv();
 *   configureKv({
 *     incr:   (k)      => redis.incr(k),
 *     expire: (k, sec) => redis.expire(k, sec),
 *     get:    (k)      => redis.get(k),
 *     del:    (k)      => redis.del(k),
 *   });
 */
export function configureKv(client) {
  store = client;
}

/** 테스트 훅: 인메모리 store로 되돌린다. */
export function resetKvToMemory() {
  store = createMemoryStore();
}

async function guard(op, fn) {
  try {
    return await fn();
  } catch (err) {
    throw new KvUnavailableError(`${op}: ${err && err.message ? err.message : err}`);
  }
}

export const kv = {
  /** 키를 1 증가시키고 증가 후 값을 반환한다. 키가 없으면 1. */
  incr: (key) => guard('incr', () => store.incr(key)),
  /** 키에 TTL(초)을 건다. 키가 살아있으면 true. */
  expire: (key, ttlSec) => guard('expire', () => store.expire(key, ttlSec)),
  get: (key) => guard('get', () => store.get(key)),
  del: (key) => guard('del', () => store.del(key)),
};

/** incr + (첫 증가일 때만) expire를 한 번에. 반환값 = 증가 후 카운트. */
export async function kvIncrWithTtl(key, ttlSec) {
  const n = await kv.incr(key);
  if (n === 1) await kv.expire(key, ttlSec);
  return n;
}
