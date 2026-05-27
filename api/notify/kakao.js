/**
 * 카카오톡 "나에게 보내기" 유틸리티
 *
 * 필수 환경변수:
 *   KAKAO_REST_API_KEY          — 카카오 앱 REST API 키
 *   KAKAO_MANAGER_REFRESH_TOKEN — 관리자 계정 refresh_token
 *
 * 선택 환경변수:
 *   KAKAO_CLIENT_SECRET         — 보안 설정 활성화 시 필요
 */
export async function sendKakaoNotification(text) {
  if (!process.env.KAKAO_REST_API_KEY || !process.env.KAKAO_MANAGER_REFRESH_TOKEN) {
    console.warn('[Kakao] 환경변수 미설정: KAKAO_REST_API_KEY 또는 KAKAO_MANAGER_REFRESH_TOKEN');
    return false;
  }

  const tokenParams = {
    grant_type:    'refresh_token',
    client_id:     process.env.KAKAO_REST_API_KEY,
    refresh_token: process.env.KAKAO_MANAGER_REFRESH_TOKEN,
  };
  if (process.env.KAKAO_CLIENT_SECRET) tokenParams.client_secret = process.env.KAKAO_CLIENT_SECRET;

  const tokenRes  = await fetch('https://kauth.kakao.com/oauth/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams(tokenParams),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`카카오 토큰 갱신 실패: ${JSON.stringify(tokenData)}`);
  }

  const template = JSON.stringify({
    object_type: 'text',
    text,
    link: {
      web_url:        'https://receipt-app-rho.vercel.app',
      mobile_web_url: 'https://receipt-app-rho.vercel.app',
    },
  });

  const msgRes  = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${tokenData.access_token}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ template_object: template }),
  });
  const msgData = await msgRes.json();
  if (msgData.result_code !== 0) {
    throw new Error(`카카오 메시지 발송 실패: ${JSON.stringify(msgData)}`);
  }
  return true;
}
