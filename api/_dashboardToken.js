// 대시보드 세션 토큰 — HMAC-SHA256 서명 스테이트리스 토큰.
// 착수 키트 §5. api/_auth.js에는 safeCompare만 있으므로 이건 신규.
//
// 형식:  base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, SECRET))
// payload: { role: 'owner' | 'staff', exp: <unix seconds> }
//
// 폐기 수단은 없다(스테이트리스). 유출 대응 = DASHBOARD_TOKEN_SECRET 로테이션(전원 재로그인).
// Node.js 런타임 전용 — Edge에서 import 금지.

import { createHmac, timingSafeEqual } from 'crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');

function hmac(body, secret) {
  return b64url(createHmac('sha256', secret).update(body).digest());
}

/**
 * @param {{ role: 'owner' | 'staff' }} claims
 * @param {{ ttlSec: number }} options
 * @returns {string} token
 */
export function signToken(claims, { ttlSec }) {
  const secret = process.env.DASHBOARD_TOKEN_SECRET;
  if (!secret) throw new Error('DASHBOARD_TOKEN_SECRET is not set');
  const payload = {
    role: claims.role === 'owner' ? 'owner' : 'staff',
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${hmac(body, secret)}`;
}

/**
 * 토큰을 검증한다. 유효하면 payload({ role, exp })를, 아니면 null을 반환한다.
 * 시크릿 미설정·서명 불일치·만료·형식 오류는 모두 null.
 * @param {string} token
 * @returns {{ role: 'owner' | 'staff', exp: number } | null}
 */
export function verifyToken(token) {
  const secret = process.env.DASHBOARD_TOKEN_SECRET;
  if (!secret || typeof token !== 'string' || !token.includes('.')) return null;

  const [body, sig] = token.split('.');
  if (!body || !sig) return null;

  const expected = hmac(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== 'number') return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  // owner가 아닌 모든 값은 staff로 강등(least privilege).
  return { role: payload.role === 'owner' ? 'owner' : 'staff', exp: payload.exp };
}
