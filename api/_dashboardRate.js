// 대시보드 인증 rate-limit — KV 백엔드(api/_kv.js) 위의 얇은 규칙 레이어.
// 착수 키트 §6.
//
//   auth 실패:  rl:auth:<hash(ip)>   — windowSec 안에서 max회 초과 시 잠금
//   forgot:     rl:forgot:global     — 전역, 1시간 perHour회
//
// IP는 원문을 저장하지 않고 sha256 앞 16자리만 저장한다.
// KV 접근 실패는 KvUnavailableError로 전파된다(fail-closed는 호출부 책임).

import { createHash } from 'crypto';
import { kvIncrWithTtl, kv } from './_kv.js';

const hashKey = (raw) => createHash('sha256').update(String(raw)).digest('hex').slice(0, 16);

/**
 * 시도를 1회 기록하고 한도 초과 여부를 반환한다.
 * @param {string} rawKey  예: `auth:1.2.3.4`
 * @param {{ max: number, windowSec: number }} opts
 * @returns {Promise<{ ok: boolean, count: number, retryAfterSec?: number }>}
 */
export async function rlHit(rawKey, { max, windowSec }) {
  const count = await kvIncrWithTtl(`rl:${hashKey(rawKey)}`, windowSec);
  if (count > max) return { ok: false, count, retryAfterSec: windowSec };
  return { ok: true, count };
}

/** 성공 로그인 후 해당 키의 실패 카운트를 지운다. */
export async function rlReset(rawKey) {
  await kv.del(`rl:${hashKey(rawKey)}`);
}

/**
 * 복구 메일 전역 게이트. perHour회까지만 true(=보내도 됨).
 * @param {{ perHour: number }} opts
 * @returns {Promise<boolean>}
 */
export async function forgotGate({ perHour }) {
  const count = await kvIncrWithTtl('rl:forgot:global', 3600);
  return count <= perHour;
}
