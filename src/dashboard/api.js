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
  let res;
  try {
    res = await fetch('/api/dashboard?action=auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
  } catch {
    return { ok: false, reason: 'network' };
  }
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

// 정산서 PDF를 blob으로 받아 objectURL을 돌려준다(토큰을 URL에 안 실음).
// 호출부는 다 쓰면 URL.revokeObjectURL 해야 한다.
export async function fetchReportObjectUrl(token, ref) {
  let res;
  try {
    res = await fetch(`/api/dashboard?action=report&ref=${encodeURIComponent(ref)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (res.status === 401) return { ok: false, reason: 'expired' };
  if (res.status === 413) return { ok: false, reason: 'toolarge' };
  if (!res.ok) return { ok: false, reason: 'error' };
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('pdf')) return { ok: false, reason: 'error' }; // 예상치 못한 응답(JSON 오류 등)
  const blob = await res.blob().catch(() => null);
  if (!blob || blob.size === 0) return { ok: false, reason: 'error' };
  return { ok: true, url: URL.createObjectURL(blob) };
}

export async function fetchDashboardData(token, month) {
  const qs = month ? `&month=${encodeURIComponent(month)}` : '';
  let res;
  try {
    res = await fetch(`/api/dashboard?action=data${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  if (res.status === 401) return { ok: false, reason: 'expired' };
  if (!res.ok) return { ok: false, reason: 'error' };
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object') return { ok: false, reason: 'error' };
  return { ok: true, data: body };
}
