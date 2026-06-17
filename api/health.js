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

const CHECK_TIMEOUT_MS = 5000;

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} 응답 지연 (${ms}ms 초과)`)), ms)),
  ]);
}

async function checkDrive() {
  const required = envSection([
    'GDRIVE_SERVICE_ACCOUNT_JSON',
    'GDRIVE_MAIN_FOLDER_ID',
  ]);
  if (!required.ok) return required;

  try {
    const drive = createDrive();
    const res = await withTimeout(
      drive.files.get({ fileId: MAIN_FOLDER_ID, fields: 'id,name,mimeType' }),
      CHECK_TIMEOUT_MS,
      'Drive'
    );
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
    const accessToken = await withTimeout(getKakaoAccessToken(), CHECK_TIMEOUT_MS, 'Kakao');
    return { ...required, ok: Boolean(accessToken), connected: Boolean(accessToken) };
  } catch (error) {
    return { ...required, ok: false, connected: false, error: error.message };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // 외부 호출 두 건을 병렬로, 한쪽 hang이 다른 쪽을 막지 않도록
  const [driveSettled, kakaoSettled] = await Promise.allSettled([
    checkDrive(),
    checkKakao(),
  ]);
  const drive = driveSettled.status === 'fulfilled'
    ? driveSettled.value
    : { ok: false, connected: false, error: driveSettled.reason?.message || 'Drive 점검 실패' };
  const kakao = kakaoSettled.status === 'fulfilled'
    ? kakaoSettled.value
    : { ok: false, connected: false, error: kakaoSettled.reason?.message || 'Kakao 점검 실패' };
  const ocr = envSection([], ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
  ocr.ok = ocr.optional.some(item => item.present);
  ocr.note = '환경 변수 확인만 수행';
  const upload = envSection(['UPLOAD_API_TOKEN'], ['VITE_UPLOAD_TOKEN']);

  // 관리자 모드 (?admin=TOKEN)에서만 상세 정보 노출 — 일반 응답은 ok만
  const adminQuery = (req.query && req.query.admin) || '';
  const adminToken = process.env.ADMIN_TOKEN;
  const isAdmin = adminToken && adminQuery === adminToken;

  const summarize = (svc) => isAdmin ? svc : { ok: Boolean(svc?.ok) };

  return res.status(200).json({
    success: true,
    checkedAt: new Date().toISOString(),
    services: {
      drive: summarize(drive),
      ocr: summarize(ocr),
      kakao: summarize(kakao),
      upload: summarize(upload),
    },
  });
}
