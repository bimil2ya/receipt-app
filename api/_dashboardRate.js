// 대시보드 인증 rate-limit — 공유 Redis(_kv.js) 위의 얇은 규칙 레이어.
// 착수 키트 §6. Codex 규약에 맞춰 redis를 주입 가능한 기본 파라미터로 받는다.
//
//   auth 실패:  dashboard:v1:rl:<hash(ip)>   — windowSec 안에서 max회 초과 시 잠금
//   forgot:     dashboard:v1:rl:forgot        — 전역, 1시간 perHour회
//
// IP는 원문을 저장하지 않고 sha256 앞 16자리만. TTL은 NX(고정 윈도우, 슬라이딩 아님).
// KV 접근 실패는 KvUnavailableError로 전파(fail-closed는 호출부 책임).

import { createHash } from 'crypto';
import { KvUnavailableError, getRedis } from './_kv.js';

// Preview·Production이 같은 Upstash keyspace를 공유한다(Vercel이 KV_REST_API_URL을
// 두 환경에 같은 값으로 주입). 환경을 키에 넣어 preview 인증 시도가 프로덕션 잠금
// 카운터와 섞이지 않게 한다.
const ENV = process.env.VERCEL_ENV || 'local';
const NS = `dashboard:v1:${ENV}:rl`;
const hashKey = (raw) => createHash('sha256').update(String(raw)).digest('hex').slice(0, 16);

async function guarded(op, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof KvUnavailableError) throw err;
    throw new KvUnavailableError(`${op}: ${err && err.message ? err.message : err}`);
  }
}

async function bump(redis, key, ttlSec) {
  const count = await redis.incr(key);
  await redis.expire(key, ttlSec, 'NX'); // 첫 설정만 유효 → 고정 윈도우, 고아 키 self-heal
  return count;
}

/**
 * 시도를 1회 기록하고 한도 초과 여부를 반환한다.
 * @returns {Promise<{ ok: boolean, count: number, retryAfterSec?: number }>}
 */
export async function rlHit(rawKey, { max, windowSec }, redis = getRedis()) {
  return guarded('rlHit', async () => {
    const count = await bump(redis, `${NS}:${hashKey(rawKey)}`, windowSec);
    if (count > max) return { ok: false, count, retryAfterSec: windowSec };
    return { ok: true, count };
  });
}

/** 성공 로그인 후 해당 키의 실패 카운트를 지운다. */
export async function rlReset(rawKey, redis = getRedis()) {
  return guarded('rlReset', () => redis.del(`${NS}:${hashKey(rawKey)}`));
}

/**
 * 복구 메일 전역 게이트. perHour회까지만 true(=보내도 됨).
 * @returns {Promise<boolean>}
 */
export async function forgotGate({ perHour }, redis = getRedis()) {
  return guarded('forgotGate', async () => {
    const count = await bump(redis, `${NS}:forgot`, 3600);
    return count <= perHour;
  });
}
