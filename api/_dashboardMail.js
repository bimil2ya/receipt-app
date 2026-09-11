// 대시보드 비밀번호 복구 메일.
// 착수 키트 §9. 기존에 쓰던 메일 계정의 SMTP로 Nodemailer를 통해 보낸다.
// 수신 주소는 항상 RECOVERY_EMAIL 고정(요청 본문 무시) — 열거 공격 방지.
//
// 필요 env (전부 없으면 발송을 생략하고 로그만 남긴다 — fail-safe):
//   DASHBOARD_SMTP_HOST, DASHBOARD_SMTP_USER, DASHBOARD_SMTP_PASS
// 선택:
//   DASHBOARD_SMTP_PORT (기본 587), DASHBOARD_SMTP_FROM (기본 DASHBOARD_SMTP_USER)

import nodemailer from 'nodemailer';

let cachedTransporter = null;
let cachedKey = '';

function getTransporter() {
  const host = process.env.DASHBOARD_SMTP_HOST;
  const user = process.env.DASHBOARD_SMTP_USER;
  const pass = process.env.DASHBOARD_SMTP_PASS;
  if (!host || !user || !pass) return null;

  const port = Number(process.env.DASHBOARD_SMTP_PORT) || 587;
  // env가 바뀌면(로컬에서 .env.local 수정 후 재시작 없이 재사용하는 경우는 없지만
  // 방어적으로) 재사용 캐시를 무효화한다.
  const key = `${host}:${port}:${user}`;
  if (cachedTransporter && cachedKey === key) return cachedTransporter;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465는 SMTPS, 587/25는 STARTTLS
    auth: { user, pass },
  });
  cachedKey = key;
  return cachedTransporter;
}

/**
 * @param {{ to: string, role: 'owner'|'staff', password: string, ip: string, at: string }} args
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function sendRecoveryEmail({ to, role, password, ip, at }) {
  const subject = `[출장비 대시보드] ${role} 비밀번호`;
  const text = [
    `요청 역할: ${role}`,
    `비밀번호: ${password}`,
    `요청 IP: ${ip}`,
    `요청 시각: ${at}`,
  ].join('\n');

  const transporter = getTransporter();
  if (!transporter || !to) {
    // 평문 비밀번호(text)는 절대 로그에 남기지 않는다.
    console.warn('[dashboard/forgot] SMTP 미설정 또는 수신 주소 없음 — 전송 생략', { to: !!to, subject });
    return { sent: false, reason: 'no_sender' };
  }

  try {
    await transporter.sendMail({
      from: process.env.DASHBOARD_SMTP_FROM || process.env.DASHBOARD_SMTP_USER,
      to,
      subject,
      text,
    });
    return { sent: true };
  } catch (err) {
    // 호출부(handleForgot)가 이 함수를 try/catch로 감싸고 응답은 항상 동일하게
    // 돌려주므로, 여기서 던져도 사용자에게는 노출되지 않는다 — 그래도 이중 방어로 삼킨다.
    console.error('[dashboard/forgot] 메일 전송 실패', err && err.message);
    return { sent: false, reason: 'send_failed' };
  }
}
