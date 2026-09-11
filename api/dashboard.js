// 출장비 집행 현황 대시보드 — 단일 엔드포인트.
// 계획서 v0.9 §11 / 착수 키트 §4.
//
//   POST /api/dashboard?action=auth     { password }            → { token }
//   POST /api/dashboard?action=forgot   { role }                → { ok, message }
//   GET  /api/dashboard?action=data&month=YYYY-MM  (Bearer)     → payload (역할별)
//
// 세 action이 한 함수다 → 메서드 고정(405), 잘못된 action(400), 공유 장애점 격리.
// maxDuration은 함수 전체 공통(auth/forgot에도 붙지만 무해).
// Node.js 런타임 전용.

import { applyCorsHeaders, checkOriginAllowed } from './_corsNode.js';
import { safeCompare } from './_auth.js';
import { signToken, verifyToken } from './_dashboardToken.js';
import { rlHit, rlReset, forgotGate, throttle } from './_dashboardRate.js';
import { buildDashboardPayload } from './_dashboardData.js';
import { sendRecoveryEmail } from './_dashboardMail.js';
import { verifyReportRef, fetchReportPdf } from './_dashboardReports.js';

export const config = { maxDuration: 60 };

const METHOD = { auth: 'POST', forgot: 'POST', data: 'GET', report: 'GET' };
const AUTH_MAX_FAILS = 5;
const AUTH_WINDOW_SEC = 600; // 10분
// PII를 노출하는 화면이라 짧게. 스테이트리스 HMAC이라 개별 폐기 불가 —
// 유출 시 DASHBOARD_TOKEN_SECRET 로테이션(전원 재로그인)이 유일한 무효화 수단.
const TOKEN_TTL_SEC = 4 * 3600;
// Vercel 서버리스 응답 본문 상한(~4.5MB). 정산서 PDF는 영수증 이미지가 많으면 이걸 넘는다.
const REPORT_MAX_BYTES = 4 * 1024 * 1024;
// 이 대시보드는 영수증의 카드번호·사업자번호·조원 실명·금액을 노출한다.
// 6자리 숫자 PIN(100만 조합)으로는 부족 — 최소 12자 패스프레이즈를 권장한다.
// (부팅 시 진단만 — env 값을 강제로 막으면 의도적으로 정한 값도 잠기므로.)
const MIN_PW_LEN = 12;
for (const key of ['DASHBOARD_PW_OWNER', 'DASHBOARD_PW_STAFF']) {
  const v = process.env[key];
  if (v && (v.length < MIN_PW_LEN || /^\d+$/.test(v))) {
    console.error(
      `[dashboard] ${key}: ${MIN_PW_LEN}자 미만이거나 숫자만 — 무차별 대입에 취약. ` +
        '영수증 PII를 노출하는 화면이므로 패스프레이즈 권장.',
    );
  }
}

// Vercel은 x-real-ip에 실제 클라이언트 IP를 넣는다. x-forwarded-for는 프록시 체인이라
// 최좌측 값이 클라이언트 제어 가능한 경우가 있다. socket.remoteAddress는 Vercel 내부
// 프록시라 모든 요청이 한 버킷으로 뭉치므로 폴백에서 제외한다.
function clientIp(req) {
  const h = req.headers || {};
  const real = h['x-real-ip'];
  if (real) return String(real).trim();
  const fwd = String(h['x-forwarded-for'] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fwd[0] || 'unknown';
}

export default async function handler(req, res) {
  if (applyCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS' }) === true) return; // OPTIONS
  if (!checkOriginAllowed(req, res)) return; // prod 오리진/referer 검사 (실패 시 403 전송됨)

  const action = String((req.query && req.query.action) || '');
  if (!METHOD[action]) {
    return res.status(400).json({ success: false, error: 'unknown action' });
  }
  if (req.method !== METHOD[action]) {
    return res.status(405).json({ success: false, error: 'method not allowed' });
  }

  try {
    if (action === 'auth') return await handleAuth(req, res);
    if (action === 'forgot') return await handleForgot(req, res);
    if (action === 'report') return await handleReport(req, res);
    return await handleData(req, res);
  } catch (err) {
    if (err && err.code === 'KV_UNAVAILABLE') {
      // fail-closed — rate-limit 저장소가 없으면 로그인을 거부한다(fail-open 금지).
      console.error('[dashboard] KV unavailable', action, err.message);
      return res.status(503).json({ success: false, error: '일시적으로 로그인할 수 없습니다' });
    }
    console.error('[dashboard]', action, err);
    return res.status(500).json({ success: false, error: 'internal error' });
  }
}

async function handleAuth(req, res) {
  const ip = clientIp(req);
  const gate = await rlHit(`auth:${ip}`, { max: AUTH_MAX_FAILS, windowSec: AUTH_WINDOW_SEC });
  if (!gate.ok) {
    return res
      .status(429)
      .json({ success: false, error: 'too many attempts', retryAfter: gate.retryAfterSec });
  }

  const password = String((req.body && req.body.password) || '');
  let role = null;
  if (process.env.DASHBOARD_PW_OWNER && safeCompare(password, process.env.DASHBOARD_PW_OWNER)) {
    role = 'owner';
  } else if (
    process.env.DASHBOARD_PW_STAFF &&
    safeCompare(password, process.env.DASHBOARD_PW_STAFF)
  ) {
    role = 'staff';
  }
  if (!role) {
    return res.status(401).json({ success: false, error: 'invalid password' });
  }

  // 잠금 해제 실패는 치명적이지 않다(다음 윈도우 만료로 자연 복구) → 삼킨다.
  try {
    await rlReset(`auth:${ip}`);
  } catch {
    /* KV 일시 오류 — 로그인은 성공 처리 */
  }
  const token = signToken({ role }, { ttlSec: TOKEN_TTL_SEC });
  return res.status(200).json({ success: true, token });
}

async function handleForgot(req, res) {
  const role = req.body && req.body.role === 'owner' ? 'owner' : 'staff';

  // KV·메일 오류를 응답으로 노출하지 않는다 — 항상 같은 200을 돌려준다.
  // (KV 실패 = fail-closed로 메일을 안 보냄. 스팸도, 정보 유출도 없음.)
  try {
    if (await forgotGate({ perHour: 1 })) {
      const password =
        role === 'owner' ? process.env.DASHBOARD_PW_OWNER : process.env.DASHBOARD_PW_STAFF;
      await sendRecoveryEmail({
        to: process.env.RECOVERY_EMAIL,
        role,
        password: password || '(env 미설정)',
        ip: clientIp(req),
        at: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('[dashboard] forgot 처리 실패(무시하고 동일 응답)', err && err.message);
  }
  return res.status(200).json({ success: true, message: '메일을 보냈습니다' });
}

async function handleData(req, res) {
  const bearer = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  const claim = verifyToken(bearer);
  if (!claim) {
    return res.status(401).json({ success: false, error: 'invalid token' });
  }
  // best-effort 스로틀(fail-open) — 유출 토큰이 공유 Google API 쿼터를 갉아먹는 것 완화.
  if (!(await throttle(`data:${bearer}`, { max: 40, windowSec: 60 }))) {
    return res.status(429).json({ success: false, error: 'too many requests' });
  }
  const role = claim.role === 'owner' ? 'owner' : 'staff';
  const month = /^\d{4}-\d{2}$/.test(String((req.query && req.query.month) || ''))
    ? req.query.month
    : undefined;

  const payload = await buildDashboardPayload({ month, role });

  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json(payload);
}

// 조별 정산서 PDF(표지 = 용도별 집계장, 이후 = 영수증 이미지). 담당자·노경호 공통.
async function handleReport(req, res) {
  const bearer = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  if (!verifyToken(bearer)) {
    return res.status(401).json({ success: false, error: 'invalid token' });
  }
  if (!(await throttle(`report:${bearer}`, { max: 30, windowSec: 60 }))) {
    return res.status(429).json({ success: false, error: 'too many requests' });
  }
  // ref는 dashboard-data가 서명해 내려준 값만 유효 — 임의 Drive fileId 접근 차단.
  const id = verifyReportRef(String((req.query && req.query.ref) || ''));
  if (!id) {
    return res.status(400).json({ success: false, error: 'invalid report ref' });
  }

  const pdf = await fetchReportPdf(id); // 스텁: 최소 PDF / P2: Drive 다운로드
  // TODO(P2): 정산서 PDF가 4.5MB를 넘으면 res.end(buffer)로는 못 보낸다.
  //   → 짧은 수명 Drive 서명 URL로 리다이렉트하거나, 청크 스트리밍/외부 스토리지 검토.
  if (pdf.length > REPORT_MAX_BYTES) {
    return res.status(413).json({
      success: false,
      error: 'report too large to stream',
      detail: `${pdf.length} bytes (limit ${REPORT_MAX_BYTES})`,
    });
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="report.pdf"');
  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).end(pdf);
}
