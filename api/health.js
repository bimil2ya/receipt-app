export const config = { runtime: 'edge' };

import { getCorsHeaders, handleCorsPreFlight } from './_cors.js';
import { responseError, Errors } from './_errorHandler.js';

function envPresent(name) {
  return Boolean((process.env[name] || '').trim());
}

export default async function handler(req) {
  const corsPreFlight = handleCorsPreFlight(req);
  if (corsPreFlight) return corsPreFlight;

  const resHeaders = { ...getCorsHeaders(req), 'Content-Type': 'application/json' };

  if (req.method !== 'GET') return responseError(Errors.methodNotAllowed(), resHeaders);

  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    const hasApiKey = !!(apiKey && apiKey.startsWith('sk-ant-'));
    const timestamp = new Date().toISOString();

    return new Response(JSON.stringify({
      status: 'ok',
      timestamp,
      environment: process.env.VERCEL_ENV || 'unknown',
      hasApiKey,
      message: hasApiKey ? '✅ 배포 정상' : '⚠️ API 키 설정 필요',
      // 설정 > 시스템 점검 화면이 읽는 필드. 환경변수 존재 여부만 보고 외부 호출은 하지 않는다.
      success: true,
      checkedAt: timestamp,
      services: {
        drive: { ok: ['GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET', 'GDRIVE_REFRESH_TOKEN', 'GDRIVE_MAIN_FOLDER_ID'].every(envPresent) },
        ocr: { ok: hasApiKey },
        kakao: { ok: ['KAKAO_REST_API_KEY', 'KAKAO_MANAGER_REFRESH_TOKEN'].every(envPresent) },
        upload: { ok: envPresent('UPLOAD_API_TOKEN') },
      },
    }), { status: 200, headers: resHeaders });
  } catch (e) {
    return responseError(Errors.internalError(e.message), resHeaders);
  }
}
