import {
  ARCHIVE_FOLDER_NAME,
  createDrive,
  getOrCreateFolder,
  getOrCreateFolderByNormalizedName,
  MAIN_FOLDER_ID,
} from './driveUtils.js';
import { ALLOWED_ORIGINS } from './_cors.js';
import { safeCompare } from './_auth.js';

// 출처 단위 호출 제한 — 10분에 60회 (list 1회 + download N회 감안)
const RESTORE_RATE_WINDOW_MS = 10 * 60_000;
const RESTORE_RATE_MAX = 60;
const restoreRateBuckets = new Map();

function restoreRateLimitCheck(key) {
  const now = Date.now();
  const bucket = restoreRateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    restoreRateBuckets.set(key, { count: 1, resetAt: now + RESTORE_RATE_WINDOW_MS });
    return { ok: true };
  }
  if (bucket.count >= RESTORE_RATE_MAX) {
    return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count += 1;
  return { ok: true };
}

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

async function listChildEntries(drive, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,size,createdTime)',
    pageSize: 200,
  });
  return res.data.files || [];
}

async function collectImageFilesRecursive(drive, folderId, seenFileIds = new Set()) {
  const entries = await listChildEntries(drive, folderId);
  const files = [];
  for (const entry of entries) {
    if (entry.mimeType === 'application/vnd.google-apps.folder') {
      if (String(entry.name || '').trim() === ARCHIVE_FOLDER_NAME) continue;
      const nested = await collectImageFilesRecursive(drive, entry.id, seenFileIds);
      files.push(...nested);
      continue;
    }
    if (!IMAGE_MIME_PATTERN.test(entry.mimeType || '')) continue;
    if (seenFileIds.has(entry.id)) continue;
    seenFileIds.add(entry.id);
    files.push(entry);
  }
  return files;
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
 * 인증: 브라우저 호출은 출처 검증, 서버 간 호출은 선택적 UPLOAD_API_TOKEN
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

  // ── 호출 빈도 제한
  const rateKey = origin || 'unknown';
  const rate = restoreRateLimitCheck(rateKey);
  if (!rate.ok) {
    return res.status(429).json({
      success: false,
      error: '호출 빈도 제한',
      detail: `10분에 ${RESTORE_RATE_MAX}회 초과. ${rate.retryAfterSec}초 후 재시도.`,
    });
  }

  const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN;
  const authHeader = req.headers['authorization'] || '';
  if (authHeader) {
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!UPLOAD_TOKEN || !safeCompare(provided, UPLOAD_TOKEN)) {
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
      const personId = await getOrCreateFolderByNormalizedName(drive, surveyorName, monthId);
      const files = (await collectImageFilesRecursive(drive, personId))
        .sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));
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
    if (/invalid_grant|token.*expired|revoked|unauthorized/i.test(error.message || '')) {
      return res.status(401).json({ success: false, error: 'Google Drive 인증이 만료되었습니다. 관리자에게 Drive 재연결을 요청하세요.' });
    }
    return res.status(500).json({ success: false, error: error.message || '복원 실패' });
  }
}
