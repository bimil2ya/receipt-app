// 공유 Redis(KV) 기반. 대시보드 rate-limit(_dashboardRate.js)과
// Codex의 제출 잠금·작업 상태(_submissionLock.js / _submissionJob.js)가 함께 쓴다.
//
// 2026-09-11: Vercel Marketplace의 Upstash Redis가 receipt-app 프로젝트에 연결됨.
// env: KV_REST_API_URL / KV_REST_API_TOKEN (Sensitive·Production·Preview).
//
// - 배포(production·preview)에서 자격증명이 없으면 KvUnavailableError(fail-closed).
// - 로컬(배포 아님·자격증명 없음)이면 인메모리 셰임 — 테스트·UI 개발 전용, 배포엔 절대 안 쓰임.
//   (Codex의 getSubmissionRedis()는 로컬 셰임 없이 항상 엄격 — 제출은 Drive를 건드리므로.
//    이 getRedis()는 rate-limit용이라 로컬 셰임을 허용한다. 병합 시 조율.)
//
// KvUnavailableError(code 'KV_UNAVAILABLE')는 _submissionLock.js·_submissionJob.js가
// import하는 공유 계약이다 — 이름·code를 바꾸지 말 것.
//
// _ 접두사라 Vercel 파일 라우팅에서 API 엔드포인트로 노출되지 않는다.

import { Redis } from '@upstash/redis';

export class KvUnavailableError extends Error {
  constructor(message) {
    super(message || 'KV unavailable');
    this.name = 'KvUnavailableError';
    this.code = 'KV_UNAVAILABLE';
  }
}

// 로컬 전용 인메모리 Redis 셰임 — incr / expire(NX) / del / get / set(nx,ex)만.
// Lua eval은 없다(제출 잠금은 실제 Redis 필요).
export function memoryRedis() {
  const map = new Map();
  const live = (e) => e && (e.exp === 0 || e.exp > Date.now());
  return {
    async incr(key) {
      const e = map.get(key);
      const v = (live(e) ? Number(e.v) : 0) + 1;
      map.set(key, { v, exp: live(e) ? e.exp : 0 });
      return v;
    },
    async expire(key, seconds, mode) {
      const e = map.get(key);
      if (!live(e)) return 0;
      if (mode === 'NX' && e.exp !== 0) return 0; // 이미 TTL이 있으면 갱신 안 함(고정 윈도우)
      e.exp = Date.now() + seconds * 1000;
      return 1;
    },
    async del(key) {
      return map.delete(key) ? 1 : 0;
    },
    async get(key) {
      const e = map.get(key);
      return live(e) ? String(e.v) : null;
    },
    async set(key, value, opts = {}) {
      const e = map.get(key);
      if (opts.nx && live(e)) return null;
      map.set(key, { v: value, exp: opts.ex ? Date.now() + opts.ex * 1000 : 0 });
      return 'OK';
    },
  };
}

let testRedis = null;
let localShim = null;

/** 테스트에서 가짜 Redis를 주입한다. 인자 없이 호출하면 새 인메모리 셰임으로 리셋. */
export function setTestRedis(client) {
  testRedis = client === undefined ? memoryRedis() : client;
  localShim = null;
}

/**
 * 공유 Redis 클라이언트를 반환한다.
 *
 * - 배포(production·preview): 실제 Upstash. 자격증명이 없으면 KvUnavailableError(fail-closed).
 * - 로컬: **.env.local에 자격증명이 있어도** 인메모리 셰임을 쓴다. 로컬 테스트가
 *   프로덕션과 같은 Redis의 rate-limit 잠금 키를 건드리면 실제 대시보드가 잠기므로.
 *   (Codex의 getSubmissionRedis()는 로컬도 실제 Redis — 잠금 성격이 달라 허용. 병합 시 재검토.)
 *   로컬 셰임은 프로세스 수명 동안 한 인스턴스로 유지된다(요청 간 카운터 누적).
 *
 * @returns {import('@upstash/redis').Redis | ReturnType<typeof memoryRedis>}
 */
export function getRedis() {
  if (testRedis) return testRedis;
  const deployed =
    process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  if (deployed) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (url && token) return new Redis({ url, token });
    throw new KvUnavailableError('KV_REST_API_URL / KV_REST_API_TOKEN not set on this deployment');
  }
  if (!localShim) localShim = memoryRedis();
  return localShim;
}
