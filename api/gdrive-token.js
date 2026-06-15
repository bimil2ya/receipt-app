/**
 * GET  /api/gdrive-token
 *   → Google OAuth 동의 화면으로 리다이렉트
 *
 * GET  /api/gdrive-token?code=XXXX
 *   → 코드 교환 후 refresh_token 반환 (HTML 페이지)
 *
 * 사전 조건 (1회만):
 *   Google Cloud Console → API 및 서비스 → 사용자 인증 정보
 *   → receipt-app OAuth 클라이언트 수정
 *   → 승인된 리다이렉트 URI에 추가:
 *     https://receipt-app-rho.vercel.app/api/gdrive-token
 *
 * 발급받은 refresh_token을 Vercel 환경변수
 *   GDRIVE_REFRESH_TOKEN 에 저장하세요.
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const CLIENT_ID     = process.env.GDRIVE_CLIENT_ID;
  const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const REDIRECT_URI = host ? `${proto}://${host}/api/gdrive-token` : 'https://receipt-app-rho.vercel.app/api/gdrive-token';

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send('GDRIVE_CLIENT_ID 또는 GDRIVE_CLIENT_SECRET 환경변수가 없습니다.');
  }

  const { code } = req.query;

  // ── 인증 코드 없음 → Google OAuth 동의 화면으로 리다이렉트
  if (!code) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     CLIENT_ID,
      redirect_uri:  REDIRECT_URI,
      scope:         'https://www.googleapis.com/auth/drive',
      access_type:   'offline',
      prompt:        'consent',
    });
    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  }

  // ── 코드 있음 → refresh_token 교환
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri:  REDIRECT_URI,
        grant_type:    'authorization_code',
      }),
    });
    const data = await tokenRes.json();

    if (!data.refresh_token) {
      return res.status(400).send(`
        <h2>❌ 토큰 발급 실패</h2>
        <pre>${JSON.stringify(data, null, 2)}</pre>
        <p><a href="/api/gdrive-token" style="color:#6ee7b7">다시 시도</a></p>
      `);
    }

    // 성공 페이지
    return res.status(200).send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Google Drive 토큰 발급 완료</title>
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; background: #111; color: #eee; }
    h2 { color: #4ade80; }
    .token-box { background: #1e1e1e; border: 1px solid #444; border-radius: 8px; padding: 16px; margin: 16px 0; word-break: break-all; font-family: monospace; font-size: 13px; }
    .copy-btn { background: #059669; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
    .copy-btn:active { background: #047857; }
    .step { background: #1a1a2e; border-left: 4px solid #4ade80; padding: 12px 16px; margin: 12px 0; border-radius: 0 8px 8px 0; }
  </style>
</head>
<body>
  <h2>✅ Google Drive 토큰 발급 완료</h2>
  <p>아래 <strong>Refresh Token</strong>을 Vercel 환경변수에 저장하세요:</p>

  <div class="token-box" id="rt">${data.refresh_token}</div>
  <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('rt').textContent).then(()=>this.textContent='✅ 복사됨!')">📋 복사</button>

  <div class="step" style="margin-top:24px">
    <strong>저장 방법:</strong><br>
    1. <a href="https://vercel.com/bimil2yas-projects/receipt-app/settings/environment-variables" target="_blank" style="color:#6ee7b7">Vercel 환경변수 페이지</a> 열기<br>
    2. <code>GDRIVE_REFRESH_TOKEN</code> → Edit → 위 값 붙여넣기<br>
    3. Save 후 재배포: <code>vercel --prod</code>
  </div>

  <details style="margin-top:16px">
    <summary style="cursor:pointer;color:#9ca3af">전체 토큰 정보 보기</summary>
    <pre style="font-size:12px;color:#6b7280">${JSON.stringify({
      access_token:             (data.access_token  || '').slice(0, 20) + '...',
      refresh_token:            (data.refresh_token || '').slice(0, 20) + '...',
      expires_in:               data.expires_in,
      token_type:               data.token_type,
    }, null, 2)}</pre>
  </details>
</body>
</html>`);
  } catch (err) {
    return res.status(500).send(`<h2>오류</h2><pre>${err.message}</pre>`);
  }
}
