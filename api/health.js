import { createDrive, MAIN_FOLDER_ID } from './driveUtils.js';
import { getKakaoAccessToken } from './notify/kakao.js';

function envPresent(name) {
  return Boolean((process.env[name] || '').trim());
}

function envSection(requiredKeys, optionalKeys = []) {
  const required = requiredKeys.map(key => ({ key, present: envPresent(key) }));
  const optional = optionalKeys.map(key => ({ key, present: envPresent(key) }));
  return { ok: required.every(item => item.present), required, optional };
}

async function checkDrive() {
  const required = envSection([
    'GDRIVE_CLIENT_ID',
    'GDRIVE_CLIENT_SECRET',
    'GDRIVE_REFRESH_TOKEN',
    'GDRIVE_MAIN_FOLDER_ID',
  ]);
  if (!required.ok) return required;

  try {
    const drive = createDrive();
    const res = await drive.files.get({
      fileId: MAIN_FOLDER_ID,
      fields: 'id,name,mimeType',
    });
    return { ...required, ok: true, connected: true, file: res.data };
  } catch (error) {
    return { ...required, ok: false, connected: false, error: error.message };
  }
}

async function checkKakao() {
  const required = envSection([
    'KAKAO_REST_API_KEY',
    'KAKAO_MANAGER_REFRESH_TOKEN',
  ], ['KAKAO_CLIENT_SECRET']);
  if (!required.ok) return required;

  try {
    const accessToken = await getKakaoAccessToken();
    return { ...required, ok: Boolean(accessToken), connected: Boolean(accessToken) };
  } catch (error) {
    return { ...required, ok: false, connected: false, error: error.message };
  }
}

export default async function handler(req) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers });
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ success: false, error: 'Method not allowed' }), {
      status: 405,
      headers,
    });
  }

  const drive = await checkDrive();
  const ocr = envSection([], ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
  ocr.ok = ocr.optional.some(item => item.present);
  ocr.note = '환경 변수 확인만 수행';
  const kakao = await checkKakao();
  const upload = envSection(['UPLOAD_API_TOKEN'], ['VITE_UPLOAD_TOKEN']);

  return new Response(JSON.stringify({
    success: true,
    checkedAt: new Date().toISOString(),
    services: { drive, ocr, kakao, upload },
  }), { status: 200, headers });
}
