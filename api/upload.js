import { Readable } from 'stream';
import crypto from 'crypto';
import * as XLSX from 'xlsx';
import { createDrive, driveQueryString, getOrCreateFolder, getYearMonth, MAIN_FOLDER_ID } from './driveUtils.js';
import { sendKakaoNotification, sendKakaoNotifications } from './notify/kakao.js';
import { runMonthAggregate } from './aggregate.js';

const KAKAO_TEXT_LIMIT = 180;

function formatWon(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function shorten(value, max) {
  const text = safeText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function readReceiptRowsFromXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows.map((row) => ({
    date: safeText(row['날짜']),
    storeName: safeText(row['사용처']),
    amount: Number(row['금액']) || 0,
    category: safeText(row['용도']),
    note: safeText(row['비고']),
  })).filter(row => row.date || row.storeName || row.amount);
}

function buildKakaoChunks(headerLines, detailLines, maxLength = KAKAO_TEXT_LIMIT) {
  const chunks = [];
  let current = headerLines.join('\n');

  for (const line of detailLines) {
    const next = `${current}\n${line}`;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    chunks.push(current);
    current = line.length > maxLength ? shorten(line, maxLength) : line;
  }

  if (current) chunks.push(current);
  return chunks;
}

function buildReceiptKakaoMessages({ fileName, surveyorName, mmdd, hhmm, rows, imageCount }) {
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const categoryTotals = rows.reduce((acc, row) => {
    const category = row.category || '기타';
    acc[category] = (acc[category] || 0) + row.amount;
    return acc;
  }, {});

  const summaryLines = [
    '📤 Drive 업로드',
    `파일: ${fileName}`,
    `작업자: ${surveyorName}`,
    `${mmdd} ${hhmm} KST`,
    `합계: ${rows.length}건 / ${formatWon(totalAmount)}`,
  ];

  const categoryLine = Object.entries(categoryTotals)
    .filter(([, amount]) => amount > 0)
    .map(([category, amount]) => `${category} ${formatWon(amount)}`)
    .join(', ');
  if (categoryLine) summaryLines.push(shorten(categoryLine, 80));
  if (imageCount > 0) summaryLines.push(`이미지 ${imageCount}장`);

  const detailLines = rows.map((row, index) => {
    const mmddDate = row.date?.includes('-') ? row.date.slice(5) : row.date;
    const main = `${index + 1}. ${mmddDate} ${shorten(row.storeName || '사용처 없음', 12)}`;
    return shorten(`${main} ${formatWon(row.amount)} ${row.category || '기타'}`, 90);
  });

  return buildKakaoChunks(summaryLines, detailLines);
}

/**
 * Drive에 파일 업로드 (이름+크기+MD5 중복 체크 포함)
 * @returns {{status:'uploaded'|'updated'|'skipped', id:string|null}} 업로드 결과
 */
async function uploadFile(drive, buffer, fileName, folderId, mimeType = 'application/octet-stream') {
  // ── 중복 체크: 동일 이름 파일 조회
  const safeFileName = driveQueryString(fileName);
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and name = '${safeFileName}' and trashed = false`,
    fields: 'files(id, name, size, md5Checksum)',
  });

  if (data.files.length > 0) {
    const existing = data.files[0];
    const localMd5 = crypto.createHash('md5').update(buffer).digest('hex');

    // 이름 + 크기 + MD5 모두 일치 → 동일 파일, 건너뜀
    if (Number(existing.size) === buffer.length && existing.md5Checksum === localMd5) {
      return {
        status: 'skipped',
        id: existing.id,
        duplicateReason: 'same_name_size_md5',
        existing: {
          id: existing.id,
          name: existing.name,
          size: Number(existing.size) || 0,
        },
      };
    }

    // 내용이 달라진 경우 → 기존 파일을 삭제하지 않고 안전하게 덮어쓰기
    const updated = await drive.files.update({
      fileId: existing.id,
      requestBody: { name: fileName },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,name,size',
    });
    return {
      status: 'updated',
      id: updated.data.id,
      replacedExistingId: existing.id,
      duplicateReason: 'same_name_different_content',
    };
  }

  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,name,size',
  });
  return { status: 'uploaded', id: created.data.id };
}

/**
 * POST /api/upload
 *
 * 요청 body (XLSX 업로드):
 *   { surveyorName, reportDate, xlsxBase64, receiptSummary, isImageOnly: false }
 *
 * 요청 body (이미지 업로드):
 *   { surveyorName, reportDate, images: [{ filename, dataUrl }], isImageOnly: true }
 *
 * 인증: GDRIVE_CLIENT_ID + GDRIVE_CLIENT_SECRET + GDRIVE_REFRESH_TOKEN (OAuth2)
 *
 * 폴더 구조:
 *   영수증정산관리(미래생태공간) / YYYY년 MM월 / surveyorName /
 */
export default async function handler(req, res) {
  // 출처 화이트리스트 — 클라 번들 토큰만으로는 부족하니, 출처와 토큰 둘 다 검증
  const ALLOWED_ORIGINS = [
    'https://receipt-app-rho.vercel.app',
    'http://localhost:5173',
    'http://localhost:3000',
  ];
  const origin = req.headers.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

  // ── 출처 검증 (프로덕션 환경에서만 강제, dev/preview는 통과)
  if (process.env.VERCEL_ENV === 'production' && !ALLOWED_ORIGINS.includes(origin)) {
    const referer = req.headers.referer || '';
    const refererOk = ALLOWED_ORIGINS.some(o => referer.startsWith(o + '/') || referer === o);
    if (!refererOk) {
      return res.status(403).json({ success: false, error: '허용되지 않은 출처', detail: `origin: ${origin || '(없음)'}` });
    }
  }

  // ── 인증 토큰 검증 (defense in depth)
  const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN;
  const isVercelHosted = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);
  if (!UPLOAD_TOKEN && isVercelHosted) {
    return res.status(503).json({
      success: false,
      error: '전송 인증이 설정되지 않았습니다.',
      detail: 'UPLOAD_API_TOKEN 환경변수가 필요합니다.',
    });
  }
  if (UPLOAD_TOKEN) {
    const authHeader = req.headers['authorization'] || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (provided !== UPLOAD_TOKEN) {
      return res.status(401).json({ success: false, error: '인증 실패', detail: '유효하지 않은 토큰입니다.' });
    }
  }

  try {
    const { surveyorName, reportDate, xlsxBase64, images, isImageOnly, receiptSummary } = req.body;
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > 25 * 1024 * 1024) {
      return res.status(413).json({ success: false, error: '요청이 너무 큽니다.' });
    }

    // ── 입력 검증 (서버측) — 클라이언트만 믿지 않고 한 번 더 검사
    if (!surveyorName || typeof surveyorName !== 'string') {
      return res.status(400).json({ success: false, error: '담당자 이름(surveyorName)이 없습니다.' });
    }
    if (surveyorName.length > 80) {
      return res.status(400).json({ success: false, error: '담당자 이름이 너무 깁니다 (최대 80자).' });
    }
    // 경로 분리자/제어문자 차단 — Drive 폴더 경로 조작 방지
    if (/[\\/:*?"<>| -]/.test(surveyorName)) {
      return res.status(400).json({ success: false, error: '담당자 이름에 사용할 수 없는 문자가 포함됨.' });
    }
    if (reportDate && (typeof reportDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate))) {
      return res.status(400).json({ success: false, error: 'reportDate 형식 오류 (YYYY-MM-DD 필요).' });
    }
    if (receiptSummary && typeof receiptSummary !== 'object') {
      return res.status(400).json({ success: false, error: 'receiptSummary 형식 오류.' });
    }

    const drive = createDrive();

    // ── 폴더 경로: MAIN / YYYY년 MM월 / 담당자이름
    const yearMonth = getYearMonth(reportDate);
    const monthId   = await getOrCreateFolder(drive, yearMonth,    MAIN_FOLDER_ID);
    const personId  = await getOrCreateFolder(drive, surveyorName, monthId);
    const targetPath = `영수증정산관리/${yearMonth}/${surveyorName}`;

    // ── 오늘 날짜 (서울 기준)
    const today = new Date().toLocaleDateString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).replace(/\. /g, '').replace('.', '').replace(/\s/g, '');

    if (!isImageOnly) {
      // ── XLSX 업로드
      if (!xlsxBase64 || typeof xlsxBase64 !== 'string') {
        return res.status(400).json({ success: false, error: 'xlsxBase64 데이터가 없습니다.' });
      }
      if (xlsxBase64.length > 20 * 1024 * 1024) {
        return res.status(413).json({ success: false, error: 'xlsxBase64 데이터가 너무 큽니다.' });
      }
      const xlsxBuffer = Buffer.from(xlsxBase64, 'base64');
      const xlsxName   = `출장비_${today}.xlsx`;

      const xlsxResult = await uploadFile(drive, xlsxBuffer, xlsxName, personId,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      // ── 새 출장비 파일이 안전하게 존재한 뒤, 예전 출장비 파일 정리
      const oldFiles = await drive.files.list({
        q: `'${personId}' in parents and name contains '출장비' and name contains '.xlsx' and trashed = false`,
        fields: 'files(id,name)',
      });
      for (const f of oldFiles.data.files || []) {
        if (f.id !== xlsxResult.id) await drive.files.delete({ fileId: f.id }).catch(() => {});
      }

      // ── 월별 전체집계 자동 업데이트
      let aggregateResult = null;
      try {
        aggregateResult = await runMonthAggregate(drive, monthId, yearMonth);
      } catch (aggErr) {
        console.warn('월집계 실패 (업로드는 성공):', aggErr.message);
        aggregateResult = { success: false, error: aggErr.message };
      }

      // ── 카카오톡 알림
      let kakaoSent = false;
      let kakaoError = null;
      try {
        const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
        const mmdd   = `${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(kstNow.getUTCDate()).padStart(2, '0')}`;
        const hhmm   = `${String(kstNow.getUTCHours()).padStart(2, '0')}:${String(kstNow.getUTCMinutes()).padStart(2, '0')}`;

        if (xlsxResult.status !== 'skipped') {
          const receiptRows = readReceiptRowsFromXlsx(xlsxBuffer);
          const kakaoMessages = buildReceiptKakaoMessages({
            fileName: xlsxName,
            surveyorName,
            mmdd,
            hhmm,
            rows: receiptRows,
            imageCount: receiptSummary?.imageCount || 0,
          });
          kakaoSent = (await sendKakaoNotifications(kakaoMessages)) !== false;
        } else {
          // 이미 동일한 파일이 드라이브에 존재 → 새 업로드 없음을 통보
          kakaoSent = (await sendKakaoNotification(
            `⚠️ 중복 전송 시도\n작업자: ${surveyorName}\n${mmdd} ${hhmm} KST\n이미 전송된 동일 파일 — 새 업로드 없음`
          )) !== false;
        }
      } catch (kakaoErr) {
        kakaoError = kakaoErr.message;
        console.warn('카카오 알림 실패 (업로드는 성공):', kakaoErr.message);
      }

      return res.status(200).json({
        success: true,
        type: 'xlsx',
        file: xlsxName,
        skipped: xlsxResult.status === 'skipped',
        uploadStatus: xlsxResult.status,
        duplicateReason: xlsxResult.duplicateReason || null,
        fileId: xlsxResult.id,
        targetPath,
        folders: {
          mainId: MAIN_FOLDER_ID,
          monthId,
          personId,
        },
        aggregate: aggregateResult,
        kakaoSent,
        kakaoError,
      });
    }

    // ── 이미지 업로드
    if (!images || images.length === 0) return res.status(400).json({ success: false, error: '이미지 데이터가 없습니다.' });
    if (images.length > 30) {
      return res.status(413).json({ success: false, error: '이미지 개수가 너무 많습니다.' });
    }
    // 이미지별 입력 검증
    const ALLOWED_IMG_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX_DECODED_SIZE = 8 * 1024 * 1024; // 8MB per image
    for (const img of images) {
      if (!img || typeof img !== 'object') {
        return res.status(400).json({ success: false, error: '이미지 항목 형식 오류.' });
      }
      if (!img.dataUrl || typeof img.dataUrl !== 'string') {
        return res.status(400).json({ success: false, error: '이미지 dataUrl이 없습니다.' });
      }
      if (!img.filename || typeof img.filename !== 'string' || img.filename.length > 160) {
        return res.status(400).json({ success: false, error: '이미지 파일명 누락 또는 너무 김.' });
      }
      if (/[\\/:*?"<>|]/.test(img.filename) || /[\x00-\x1F]/.test(img.filename)) {
        return res.status(400).json({ success: false, error: '이미지 파일명에 사용할 수 없는 문자.' });
      }
      // MIME 화이트리스트 (data:image/jpeg;base64,... 패턴)
      const mimeMatch = img.dataUrl.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      if (!ALLOWED_IMG_MIMES.includes(mime)) {
        return res.status(415).json({ success: false, error: `지원하지 않는 이미지 형식: ${mime}` });
      }
      // base64 디코딩 후 실제 크기 검증 (length * 0.75 근사)
      const base64Part = img.dataUrl.includes(',') ? img.dataUrl.split(',')[1] : img.dataUrl;
      const approxDecodedSize = Math.floor(base64Part.length * 0.75);
      if (approxDecodedSize > MAX_DECODED_SIZE) {
        return res.status(413).json({ success: false, error: `이미지가 너무 큽니다 (최대 ${MAX_DECODED_SIZE / 1024 / 1024}MB).` });
      }
    }
    const uploaded = [];
    const skipped  = [];
    const details = [];
    for (const img of images) {
      const base64Data = img.dataUrl.includes(',') ? img.dataUrl.split(',')[1] : img.dataUrl;
      const imgBuffer  = Buffer.from(base64Data, 'base64');
      // 실제 MIME을 dataUrl 헤더에서 추출해 그대로 Drive에 전달 (이전엔 항상 image/jpeg로 잘못 저장)
      const mimeMatch = img.dataUrl.match(/^data:([^;]+);base64,/);
      const imgMime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const result     = await uploadFile(drive, imgBuffer, img.filename, personId, imgMime);
      const detail = {
        filename: img.filename,
        status: result.status,
        fileId: result.id,
        duplicateReason: result.duplicateReason || null,
      };
      details.push(detail);
      if (result.status === 'skipped') skipped.push(img.filename);
      else uploaded.push(img.filename);
    }
    return res.status(200).json({
      success: true,
      type: 'images',
      files: uploaded,
      skipped,
      details,
      targetPath,
      folders: {
        mainId: MAIN_FOLDER_ID,
        monthId,
        personId,
      },
    });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
