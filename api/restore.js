import { createDrive, driveQueryString, getOrCreateFolder, MAIN_FOLDER_ID } from './driveUtils.js';

const ALLOWED_ORIGINS = [
  'https://receipt-app-rho.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

const IMAGE_MIME_PATTERN = /^image\/(jpeg|png|webp)$/i;

function setCors(res, origin) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function bufferFromStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/**
 * POST /api/restore
 *
 * body (action: list) — 폴더 안 영수증 이미지 메타데이터 목록 반환
 *   { action: 'list', surveyorName, yearMonth }
 *   → { success, files: [{ id, name, size, createdTime, mimeType }] }
 *
 * body (action: download) — 단일 이미지 base64 다운로드
 *   { action: 'download', fileId }
 *   → { success, base64, mediaType, fileName }
 *
 * 인증: upload.js와 동일한 UPLOAD_API_TOKEN
 */
export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

  if (process.env.VERCEL_ENV === 'production' && !ALLOWED_ORIGINS.includes(origin)) {
    const referer = req.headers.referer || '';
    const refererOk = ALLOWED_ORIGINS.some(o => referer.startsWith(o + '/') || referer === o);
    if (!refererOk) {
      return res.status(403).json({ success: false, error: '허용되지 않은 출처' });
    }
  }

  const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN;
  const isVercelHosted = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  if (!UPLOAD_TOKEN && isVercelHosted) {
    return res.status(503).json({ success: false, error: '복원 인증이 설정되지 않았습니다.' });
  }
  if (UPLOAD_TOKEN) {
    const authHeader = req.headers['authorization'] || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (provided !== UPLOAD_TOKEN) {
      return res.status(401).json({ success: false, error: '인증 실패' });
    }
  }

  try {
    const { action, surveyorName, yearMonth, fileId } = req.body || {};

    if (action !== 'list' && action !== 'download') {
      return res.status(400).json({ success: false, error: 'action은 list 또는 download여야 합니다.' });
    }

    const drive = createDrive();

    if (action === 'list') {
      if (!surveyorName || typeof surveyorName !== 'string') {
        return res.status(400).json({ success: false, error: 'surveyorName이 없습니다.' });
      }
      if (surveyorName.length > 80) {
        return res.status(400).json({ success: false, error: 'surveyorName이 너무 깁니다.' });
      }
      // Drive 폴더명에서 실제로 금지된 문자만 차단 (공백·쉼표는 한국 이름에 허용)
      if (/[\\/:*?"<>|]/.test(surveyorName)) {
        return res.status(400).json({ success: false, error: 'surveyorName에 사용할 수 없는 문자가 포함됨.' });
      }
      if (!yearMonth || typeof yearMonth !== 'string' || !/^\d{4}년 \d{2}월$/.test(yearMonth)) {
        return res.status(400).json({ success: false, error: 'yearMonth 형식 오류 (예: "2026년 06월").' });
      }

      // 폴더 경로: MAIN / yearMonth / surveyorName
      // getOrCreateFolder는 없으면 만들지만, 복원 케이스에선 빈 폴더가 만들어져도 무해 (이미지 0개 반환)
      const monthId  = await getOrCreateFolder(drive, yearMonth,    MAIN_FOLDER_ID);
      const personId = await getOrCreateFolder(drive, surveyorName, monthId);

      // 이미지 파일만 조회 (xlsx는 제외)
      const safeFolder = driveQueryString(personId);
      const { data } = await drive.files.list({
        q: `'${safeFolder}' in parents and (mimeType contains 'image/') and trashed = false`,
        fields: 'files(id, name, size, createdTime, mimeType)',
        pageSize: 200,
        orderBy: 'createdTime',
      });

      const files = (data.files || []).filter(f => IMAGE_MIME_PATTERN.test(f.mimeType || ''));
      return res.status(200).json({
        success: true,
        files,
        targetPath: `영수증정산관리/${yearMonth}/${surveyorName}`,
      });
    }

    // action === 'download'
    if (!fileId || typeof fileId !== 'string' || fileId.length > 200) {
      return res.status(400).json({ success: false, error: 'fileId가 없거나 형식 오류.' });
    }
    // fileId는 Drive의 알파벳·숫자·하이픈·언더스코어 조합
    if (!/^[A-Za-z0-9_-]+$/.test(fileId)) {
      return res.status(400).json({ success: false, error: 'fileId 형식 오류.' });
    }

    // 메타데이터 조회 — mimeType과 name 확보
    const metaRes = await drive.files.get({ fileId, fields: 'id,name,mimeType,size' });
    const meta = metaRes.data;
    if (!IMAGE_MIME_PATTERN.test(meta.mimeType || '')) {
      return res.status(400).json({ success: false, error: '이미지 파일만 다운로드할 수 있습니다.' });
    }
    if (Number(meta.size || 0) > 10 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: '파일이 너무 큽니다 (최대 10MB).' });
    }

    const stream = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    );
    const buffer = await bufferFromStream(stream.data);

    return res.status(200).json({
      success: true,
      base64: buffer.toString('base64'),
      mediaType: meta.mimeType,
      fileName: meta.name,
      size: buffer.length,
    });
  } catch (error) {
    console.error('Restore error:', error);
    return res.status(500).json({ success: false, error: error.message || '복원 실패' });
  }
}
