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
import { rlHit, rlReset, forgotGate } from './_dashboardRate.js';
import { buildDashboardPayload } from './_dashboardData.js';
import { sendRecoveryEmail } from './_dashboardMail.js';

export const config = { maxDuration: 60 };

const METHOD = { auth: 'POST', forgot: 'POST', data: 'GET' };
const AUTH_MAX_FAILS = 5;
const AUTH_WINDOW_SEC = 600; // 10분
const TOKEN_TTL_SEC = 8 * 3600;

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

function clientIp(req) {
  const fwd = String((req.headers && req.headers['x-forwarded-for']) || '');
  return fwd.split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
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

  await rlReset(`auth:${ip}`);
  const token = signToken({ role }, { ttlSec: TOKEN_TTL_SEC });
  return res.status(200).json({ success: true, token });
}

async function handleForgot(req, res) {
  const role = req.body && req.body.role === 'owner' ? 'owner' : 'staff';
  const allowed = await forgotGate({ perHour: 1 });
  if (allowed) {
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
  // 성공/실패(레이트리밋 포함)를 응답으로 구분하지 않는다.
  return res.status(200).json({ success: true, message: '메일을 보냈습니다' });
}

async function handleData(req, res) {
  const bearer = String((req.headers && req.headers.authorization) || '').replace(/^Bearer\s+/i, '');
  const claim = verifyToken(bearer);
  if (!claim) {
    return res.status(401).json({ success: false, error: 'invalid token' });
  }
  const role = claim.role === 'owner' ? 'owner' : 'staff';
  const month = /^\d{4}-\d{2}$/.test(String((req.query && req.query.month) || ''))
    ? req.query.month
    : undefined;

  const payload = await buildDashboardPayload({ month, role });

  res.setHeader('Cache-Control', 'private, no-store');
  return res.status(200).json(payload);
}
