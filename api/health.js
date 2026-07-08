import { createDrive, MAIN_FOLDER_ID } from './driveUtils.js';
import { getKakaoAccessToken } from './notify/kakao.js';
import { safeCompare } from './_auth.js';

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
    'GDRIVE_CLIENT_ID',
    'GDRIVE_CLIENT_SECRET',
    'GDRIVE_REFRESH_TOKEN',
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
    console.error('Drive 점검 실패:', error.message, error.stack);
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

function quickSummary() {
  const ocr = envSection([], ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY']);
  ocr.ok = ocr.optional.some(item => item.present);

  return {
    drive:     { ok: ['GDRIVE_CLIENT_ID', 'GDRIVE_CLIENT_SECRET', 'GDRIVE_REFRESH_TOKEN', 'GDRIVE_MAIN_FOLDER_ID'].every(envPresent) },
    ocr:       { ok: ocr.ok },
    kakao:     { ok: ['KAKAO_REST_API_KEY', 'KAKAO_MANAGER_REFRESH_TOKEN'].every(envPresent) },
    upload:    { ok: envPresent('UPLOAD_API_TOKEN') },
    adminAuth: { ok: envPresent('ADMIN_PIN') },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  // 관리자 인증 — X-Admin-Token 헤더 우선, ?admin= 쿼리는 하위 호환용
  const adminToken = process.env.ADMIN_TOKEN;
  const provided = (req.headers['x-admin-token'] || req.query?.admin || '').toString();
  const isAdmin = Boolean(adminToken && provided && safeCompare(provided, adminToken));

  // 비관리자: 외부 API 호출 없이 env 존재 여부만 반환
  if (!isAdmin) {
    return res.status(200).json({
      success: true,
      checkedAt: new Date().toISOString(),
      services: quickSummary(),
    });
  }

  // 관리자: Drive/Kakao 실제 연결 점검 수행
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
  const upload = envSection([], ['UPLOAD_API_TOKEN']);
  const adminAuth = envSection(['ADMIN_PIN'], []);

  return res.status(200).json({
    success: true,
    checkedAt: new Date().toISOString(),
    services: { drive, ocr, kakao, upload, adminAuth },
  });
}
