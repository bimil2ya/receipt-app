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
// 카운터와 섞이지 않게 한다. VERCEL_ENV를 호출 시점에 읽는다(모듈 로드 시점이 아니라).
const ns = () => `dashboard:v1:${process.env.VERCEL_ENV || 'local'}:rl`;
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
    const count = await bump(redis, `${ns()}:${hashKey(rawKey)}`, windowSec);
    if (count > max) return { ok: false, count, retryAfterSec: windowSec };
    return { ok: true, count };
  });
}

/** 성공 로그인 후 해당 키의 실패 카운트를 지운다. */
export async function rlReset(rawKey, redis = getRedis()) {
  return guarded('rlReset', () => redis.del(`${ns()}:${hashKey(rawKey)}`));
}

/**
 * 복구 메일 전역 게이트. perHour회까지만 true(=보내도 됨).
 * @returns {Promise<boolean>}
 */
export async function forgotGate({ perHour }, redis = getRedis()) {
  return guarded('forgotGate', async () => {
    const count = await bump(redis, `${ns()}:forgot`, 3600);
    return count <= perHour;
  });
}

/**
 * 인증된 요청의 best-effort 스로틀(data·report). 한도 초과면 false.
 * auth와 달리 **fail-open** — 이미 인증된 요청이고, KV 하나가 흔들려도 대시보드가
 * 통째로 죽으면 안 되므로. (무차별 대입 방어는 auth의 fail-closed가 담당.)
 * 목적: 유출된 세션 토큰이 공유 Google API 쿼터·Vercel 함수시간을 갉아먹는 것 완화.
 * @returns {Promise<boolean>} 허용 여부
 */
export async function throttle(rawKey, { max, windowSec }, redis = getRedis()) {
  try {
    const count = await bump(redis, `${ns()}:t:${hashKey(rawKey)}`, windowSec);
    return count <= max;
  } catch {
    return true; // fail-open
  }
}
