// 대시보드 비밀번호 복구 메일.
// 착수 키트 §9. 앱에는 이메일 sender가 없다(Kakao 알림만) → 실제 전송 수단은 미구현.
//
// TODO(P2 이후 또는 병행): RESEND_API_KEY로 Resend, 또는 Nodemailer(Gmail 앱 비밀번호) 연결.
// 지금은 전송 시도를 로그로만 남긴다. 수신 주소는 항상 RECOVERY_EMAIL 고정(요청 본문 무시).

/**
 * ⚠️ 실제 전송은 아직 미구현이다. 항상 { sent: false }를 반환한다 —
 * RESEND_API_KEY를 넣어도 아래 fetch를 채우기 전까지는 메일이 나가지 않는다.
 * handleForgot는 반환값을 신뢰하지 않으므로(응답은 항상 동일) 지금은 무해하다.
 *
 * TODO(P2 이후 또는 병행): Resend 또는 Nodemailer 연결. 그때 아래 text(평문 비밀번호)를
 * 로그에 남기지 않도록 주의.
 *
 * @param {{ to: string, role: 'owner'|'staff', password: string, ip: string, at: string }} args
 */
export async function sendRecoveryEmail({ to, role, password, ip, at }) {
  const subject = `[출장비 대시보드] ${role} 비밀번호`;
  const text = [
    `요청 역할: ${role}`,
    `비밀번호: ${password}`,
    `요청 IP: ${ip}`,
    `요청 시각: ${at}`,
  ].join('\n');

  if (!process.env.RESEND_API_KEY) {
    console.warn('[dashboard/forgot] 이메일 sender 미설정 — 전송 생략', { to, subject });
    return { sent: false, reason: 'no_sender' };
  }

  // TODO: 실제 전송 구현
  //   await fetch('https://api.resend.com/emails', {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ from: '...', to, subject, text }),
  //   });
  console.warn('[dashboard/forgot] RESEND_API_KEY는 있으나 전송 로직 미구현 — 메일 안 나감', {
    to,
    subject,
    textLength: text.length,
  });
  return { sent: false, reason: 'not_implemented' };
}
