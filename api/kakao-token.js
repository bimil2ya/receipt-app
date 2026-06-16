/**
 * GET  /api/kakao-token
 *   → 카카오 로그인 인증 URL 리다이렉트
 *
 * GET  /api/kakao-token?code=XXXX
 *   → 코드 교환 후 refresh_token 반환 (HTML 페이지)
 *
 * 발급받은 refresh_token을 Vercel 환경변수
 * KAKAO_MANAGER_REFRESH_TOKEN 에 저장하세요.
 */
export default async function handler(req, res) {
  // 셋업 전용 라우트 보호 — ADMIN_TOKEN env 필요. OAuth state로 round-trip
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
  const providedToken = (req.query.admin || req.query.state || '').toString();
  if (!ADMIN_TOKEN || providedToken !== ADMIN_TOKEN) {
    return res.status(404).send('Not Found');
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  const REST_API_KEY  = process.env.KAKAO_REST_API_KEY;
  const CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET || '';
  const REQUIRED_SCOPE = 'talk_message';
  const proto = (req.headers['x-forwarded-proto'] || 'https').toString();
  const host = (req.headers['x-forwarded-host'] || req.headers.host || '').toString();
  const REDIRECT_URI = host ? `${proto}://${host}/api/kakao-token` : 'https://receipt-app-rho.vercel.app/api/kakao-token';

  if (!REST_API_KEY) {
    return res.status(500).send('KAKAO_REST_API_KEY 환경변수가 없습니다.');
  }

  const { code } = req.query;

  // ── 코드 없음 → 카카오 로그인 페이지로 리다이렉트
  if (!code) {
    const authUrl =
      `https://kauth.kakao.com/oauth/authorize` +
      `?response_type=code` +
      `&client_id=${REST_API_KEY}` +
      `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&scope=${encodeURIComponent(REQUIRED_SCOPE)}` +
      `&state=${encodeURIComponent(ADMIN_TOKEN)}`;
    return res.redirect(authUrl);
  }

  // ── 코드 있음 → 토큰 교환
  try {
    const params = new URLSearchParams({
      grant_type:   'authorization_code',
      client_id:    REST_API_KEY,
      redirect_uri: REDIRECT_URI,
      code,
    });
    if (CLIENT_SECRET) params.append('client_secret', CLIENT_SECRET);

    const tokenRes  = await fetch('https://kauth.kakao.com/oauth/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    params,
    });
    const data = await tokenRes.json();

    if (!data.refresh_token) {
      return res.status(400).send(`
        <h2>❌ 토큰 발급 실패</h2>
        <pre>${JSON.stringify(data, null, 2)}</pre>
      `);
    }

    // 성공 페이지
    return res.status(200).send(`<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>카카오 토큰 발급 완료</title>
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
  <h2>✅ 카카오 토큰 발급 완료</h2>

  <p>아래 <strong>Refresh Token</strong>을 Vercel 환경변수에 저장하세요:</p>

  <div class="token-box" id="rt">${data.refresh_token}</div>
  <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('rt').textContent).then(()=>this.textContent='✅ 복사됨!')">📋 복사</button>

  <div class="step" style="margin-top:16px">
    <strong>요청한 권한:</strong> <code>${REQUIRED_SCOPE}</code><br>
    <strong>발급된 권한:</strong> <code>${data.scope || '카카오 응답에 scope 정보 없음'}</code>
  </div>

  <div class="step" style="margin-top:24px">
    <strong>저장 방법:</strong><br>
    1. <a href="https://vercel.com/bimil2yas-projects/receipt-app/settings/environment-variables" target="_blank" style="color:#6ee7b7">Vercel 환경변수 페이지</a> 열기<br>
    2. <code>KAKAO_MANAGER_REFRESH_TOKEN</code> → Edit → 위 값 붙여넣기<br>
    3. Save 후 Vercel에서 <strong>Redeploy</strong>
  </div>

  <details style="margin-top:16px">
    <summary style="cursor:pointer;color:#9ca3af">전체 토큰 정보 보기</summary>
    <pre style="font-size:12px;color:#6b7280">${JSON.stringify({ access_token: data.access_token?.slice(0,20)+'...', refresh_token: data.refresh_token?.slice(0,20)+'...', expires_in: data.expires_in, refresh_token_expires_in: data.refresh_token_expires_in, scope: data.scope }, null, 2)}</pre>
  </details>
</body>
</html>`);
  } catch (err) {
    return res.status(500).send(`<h2>오류</h2><pre>${err.message}</pre>`);
  }
}
