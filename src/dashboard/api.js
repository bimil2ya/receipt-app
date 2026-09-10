// 대시보드 클라이언트 ↔ api/dashboard.js
// 착수 키트 §8. 토큰은 sessionStorage에만, 디코드하지 않는다(서명 검증 키 없음).

const TOKEN_KEY = 'dash_token';

export function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function writeToken(token) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode 등 — 세션만 유지되지 않을 뿐 동작엔 지장 없음 */
  }
}

export async function authenticate(password) {
  const res = await fetch('/api/dashboard?action=auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok && body.token) return { ok: true, token: body.token };
  if (res.status === 429) return { ok: false, reason: 'locked', retryAfter: body.retryAfter };
  if (res.status === 503) return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'invalid' };
}

export async function requestForgot(role) {
  await fetch('/api/dashboard?action=forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  }).catch(() => {});
  // 응답은 항상 동일하므로 성공/실패를 노출하지 않는다.
}

export async function fetchDashboardData(token, month) {
  const qs = month ? `&month=${encodeURIComponent(month)}` : '';
  const res = await fetch(`/api/dashboard?action=data${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (res.status === 401) return { ok: false, reason: 'expired' };
  if (!res.ok) return { ok: false, reason: 'error' };
  const body = await res.json();
  return { ok: true, data: body };
}
