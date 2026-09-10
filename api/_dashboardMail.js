// 대시보드 비밀번호 복구 메일.
// 착수 키트 §9. 앱에는 이메일 sender가 없다(Kakao 알림만) → 실제 전송 수단은 미구현.
//
// TODO(P2 이후 또는 병행): RESEND_API_KEY로 Resend, 또는 Nodemailer(Gmail 앱 비밀번호) 연결.
// 지금은 전송 시도를 로그로만 남긴다. 수신 주소는 항상 RECOVERY_EMAIL 고정(요청 본문 무시).

/**
 * @param {{ to: string, role: 'owner'|'staff', password: string, ip: string, at: string }} args
 */
export async function sendRecoveryEmail({ to, role, password, ip, at }) {
  const sender = process.env.RESEND_API_KEY ? 'resend' : null;

  const subject = `[출장비 대시보드] ${role} 비밀번호`;
  const text = [
    `요청 역할: ${role}`,
    `비밀번호: ${password}`,
    `요청 IP: ${ip}`,
    `요청 시각: ${at}`,
  ].join('\n');

  if (!sender) {
    // 아직 sender가 없다 — 개발 중엔 로그로 확인.
    console.warn('[dashboard/forgot] 이메일 sender 미설정 — 전송 생략', { to, subject });
    return { sent: false, reason: 'no_sender' };
  }

  // TODO: 실제 전송 구현
  //   const res = await fetch('https://api.resend.com/emails', {
  //     method: 'POST',
  //     headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ from: '...', to, subject, text }),
  //   });
  console.info('[dashboard/forgot] 전송(TODO)', { to, subject, textLength: text.length });
  return { sent: true };
}
