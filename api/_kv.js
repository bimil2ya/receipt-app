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

// 로컬 전용 인메모리 Redis 셰임 — 대시보드 rate-limit이 쓰는 명령만 부분 구현:
// incr / expire(key, sec, 'NX') / del / get / set(key, val, {nx, ex}).
// set의 xx·keepTtl·px, expire의 XX/GT/LT, Lua eval은 **의도적으로 없다**.
// 제출 잠금/job 코드(_submissionLock.js)는 자체 fake를 주입하거나 실제 Redis를 쓸 것.
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
let upstashClient = null;
let upstashKey = '';

/** 테스트에서 가짜 Redis를 주입한다. 인자 없이 호출하면 새 인메모리 셰임으로 리셋. */
export function setTestRedis(client) {
  testRedis = client === undefined ? memoryRedis() : client;
  localShim = null;
}

/**
 * 실제 Upstash 클라이언트를 만든다(url+token 조합당 1개 메모이즈).
 * 자격증명이 없으면 KvUnavailableError. Codex의 getSubmissionRedis()도 결국 이걸
 * 호출하도록 통합하면 두 개의 손수 짠 new Redis() 블록이 드리프트하지 않는다.
 */
export function createUpstashClient() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new KvUnavailableError('KV_REST_API_URL / KV_REST_API_TOKEN not set');
  }
  const key = `${url}\n${token}`;
  if (!upstashClient || upstashKey !== key) {
    upstashClient = new Redis({ url, token });
    upstashKey = key;
  }
  return upstashClient;
}

/**
 * 대시보드 rate-limit용 Redis. 절대 통합 대상이 아니다 — 로컬 셰임을 허용하기 때문:
 *
 * - 배포(production·preview): 실제 Upstash. 자격증명 없으면 KvUnavailableError(fail-closed).
 * - 그 외(로컬 vitest·vercel dev·CI·npm run dev): **.env.local에 자격증명이 있어도**
 *   인메모리 셰임. 로컬 테스트가 프로덕션 Redis의 잠금 키를 건드리면 실제 대시보드가
 *   잠기므로. 셰임은 프로세스 수명 동안 한 인스턴스(요청 간 카운터 누적).
 *
 * 반대로 Codex의 제출 잠금(_submissionLock.js)은 로컬에서도 분산성이 필요하고 Lua eval을
 * 쓰므로 셰임을 쓸 수 없다 — getSubmissionRedis()를 이 함수로 대체하면 잠금이 깨진다.
 *
 * @returns {import('@upstash/redis').Redis | ReturnType<typeof memoryRedis>}
 */
export function getRedis() {
  if (testRedis) return testRedis;
  const deployed =
    process.env.VERCEL_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
  if (deployed) return createUpstashClient();
  if (!localShim) localShim = memoryRedis();
  return localShim;
}
