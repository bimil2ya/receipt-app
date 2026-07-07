import { timingSafeEqual, createHash } from 'crypto'

// Vercel 파일 기반 라우팅에서 _ 접두사 파일은 API 라우트에서 제외됩니다.
// analyze.js / upload.js / aggregate.js / lookup-biz.js / teams.js / restore.js
// 6개 파일이 공통으로 사용하는 허용 출처 목록입니다.
export const ALLOWED_ORIGINS = [
  'https://receipt-app-rho.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

// 토큰/PIN 비교 — timing-safe (길이가 다를 경우 해시 후 비교로 시간 균일화)
export function safeCompare(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}
