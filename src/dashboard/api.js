// 대시보드 클라이언트 ↔ api/dashboard.js
// 착수 키트 §8. 토큰은 sessionStorage에만, 디코드하지 않는다(서명 검증 키 없음).

const TOKEN_KEY = 'dash_token';

// 서버 오류·프록시 캐시·향후 계약 변경으로 일부 JSON만 도착해도 0원 화면으로
// 렌더링하지 않는다. 세부 행 검증은 서버가 담당하고, 여기서는 화면 핵심 계약만 막는다.
export function isDashboardPayload(value, requestedMonth) {
  if (!value || typeof value !== 'object' || value.month !== requestedMonth || !value.totals) return false;
  if (!Array.isArray(value.teams) || !Array.isArray(value.ledger) || !value.byCategory || typeof value.byCategory !== 'object') return false;
  const { spent, core, fuelMed, receiptCount } = value.totals;
  if (![spent, core, fuelMed, receiptCount].every(Number.isSafeInteger)) return false;
  if (spent !== core + fuelMed || receiptCount !== value.ledger.length) return false;
  const categories = Object.values(value.byCategory);
  if (!categories.every(Number.isSafeInteger) || categories.reduce((sum, amount) => sum + amount, 0) !== spent) return false;
  return value.ledger.every(row => row && Number.isSafeInteger(row.amount));
}

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

export async function fetchDashboardData(token, month, { includeProgress = false } = {}) {
  const qs = `${month ? `&month=${encodeURIComponent(month)}` : ''}${includeProgress ? '&includeProgress=1' : ''}`;
  let res;
  try {
    res = await fetch(`/api/dashboard?action=data${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, reason: 'error' };
  }
  const body = await res.json().catch(() => null);
  if (res.status === 401) return { ok: false, reason: 'expired' };
  if (!res.ok) {
    if (body?.code === 'DASHBOARD_SOURCE_MISSING') return { ok: false, reason: 'source_missing' };
    return { ok: false, reason: 'error' };
  }
  if (!isDashboardPayload(body, month)) return { ok: false, reason: 'error' };
  return { ok: true, data: body };
}
