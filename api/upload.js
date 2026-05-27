import { Readable } from 'stream';
import crypto from 'crypto';
import { createDrive, getOrCreateFolder, getYearMonth, MAIN_FOLDER_ID } from './driveUtils.js';
import { sendKakaoNotification } from './notify/kakao.js';
import { runMonthAggregate } from './aggregate.js';

/**
 * Drive에 파일 업로드 (이름+크기+MD5 중복 체크 포함)
 * @returns {'uploaded'|'skipped'} 업로드 여부
 */
async function uploadFile(drive, buffer, fileName, folderId, mimeType = 'application/octet-stream') {
  // ── 중복 체크: 동일 이름 파일 조회
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and name = '${fileName}' and trashed = false`,
    fields: 'files(id, size, md5Checksum)',
  });

  if (data.files.length > 0) {
    const existing = data.files[0];
    const localMd5 = crypto.createHash('md5').update(buffer).digest('hex');

    // 이름 + 크기 + MD5 모두 일치 → 동일 파일, 건너뜀
    if (Number(existing.size) === buffer.length && existing.md5Checksum === localMd5) {
      return 'skipped';
    }

    // 내용이 달라진 경우 → 기존 파일 삭제 후 재업로드
    await drive.files.delete({ fileId: existing.id }).catch(() => {});
  }

  await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  });
  return 'uploaded';
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

  // ── 인증 토큰 검증
  const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN;
  if (UPLOAD_TOKEN) {
    const authHeader = req.headers['authorization'] || '';
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (provided !== UPLOAD_TOKEN) {
      return res.status(401).json({ success: false, error: '인증 실패', detail: '유효하지 않은 토큰입니다.' });
    }
  }

  try {
    const { surveyorName, reportDate, xlsxBase64, images, isImageOnly, receiptSummary } = req.body;

    if (!surveyorName) return res.status(400).json({ success: false, error: '담당자 이름(surveyorName)이 없습니다.' });

    const drive = createDrive();

    // ── 폴더 경로: MAIN / YYYY년 MM월 / 담당자이름
    const yearMonth = getYearMonth(reportDate);
    const monthId   = await getOrCreateFolder(drive, yearMonth,    MAIN_FOLDER_ID);
    const personId  = await getOrCreateFolder(drive, surveyorName, monthId);

    // ── 오늘 날짜 (서울 기준)
    const today = new Date().toLocaleDateString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).replace(/\. /g, '').replace('.', '').replace(/\s/g, '');

    if (!isImageOnly) {
      // ── XLSX 업로드
      if (!xlsxBase64) return res.status(400).json({ success: false, error: 'xlsxBase64 데이터가 없습니다.' });
      const xlsxBuffer = Buffer.from(xlsxBase64, 'base64');
      const xlsxName   = `출장비_${today}.xlsx`;

      // ── 기존 출장비_*.xlsx 삭제 (날짜가 달라 쌓이는 것 방지, 최신 1개만 유지)
      const oldFiles = await drive.files.list({
        q: `'${personId}' in parents and name contains '출장비' and name contains '.xlsx' and trashed = false`,
        fields: 'files(id)',
      });
      for (const f of oldFiles.data.files || []) {
        await drive.files.delete({ fileId: f.id }).catch(() => {});
      }

      const xlsxResult = await uploadFile(drive, xlsxBuffer, xlsxName, personId,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');

      // ── 월별 전체집계 자동 업데이트
      try {
        await runMonthAggregate(drive, monthId, yearMonth);
      } catch (aggErr) {
        console.warn('월집계 실패 (업로드는 성공):', aggErr.message);
      }

      // ── 카카오톡 알림
      let kakaoSent = false;
      try {
        const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
        const mmdd   = `${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(kstNow.getUTCDate()).padStart(2, '0')}`;
        const hhmm   = `${String(kstNow.getUTCHours()).padStart(2, '0')}:${String(kstNow.getUTCMinutes()).padStart(2, '0')}`;

        if (xlsxResult === 'uploaded') {
          let text = `📤 전송 완료\n작업자: ${surveyorName}\n${mmdd} ${hhmm} KST\n`;
          if (receiptSummary) {
            const { totalCount, totalAmount, categories, imageCount } = receiptSummary;
            const fmt = (n) => n.toLocaleString('ko-KR') + '원';
            text += `\n영수증 ${totalCount}건, 합계 ${fmt(totalAmount)}\n`;
            for (const [cat, amt] of Object.entries(categories)) {
              if (amt > 0) text += `  • ${cat}: ${fmt(amt)}\n`;
            }
            if (imageCount > 0) text += `이미지 ${imageCount}장`;
          }
          kakaoSent = (await sendKakaoNotification(text.trim())) !== false;
        } else {
          // 이미 동일한 파일이 드라이브에 존재 → 새 업로드 없음을 통보
          kakaoSent = (await sendKakaoNotification(
            `⚠️ 중복 전송 시도\n작업자: ${surveyorName}\n${mmdd} ${hhmm} KST\n이미 전송된 동일 파일 — 새 업로드 없음`
          )) !== false;
        }
      } catch (kakaoErr) {
        console.warn('카카오 알림 실패 (업로드는 성공):', kakaoErr.message);
      }

      return res.status(200).json({ success: true, type: 'xlsx', file: xlsxName, skipped: xlsxResult === 'skipped', kakaoSent });
    }

    // ── 이미지 업로드
    if (!images || images.length === 0) return res.status(400).json({ success: false, error: '이미지 데이터가 없습니다.' });
    const uploaded = [];
    const skipped  = [];
    for (const img of images) {
      const base64Data = img.dataUrl.includes(',') ? img.dataUrl.split(',')[1] : img.dataUrl;
      const imgBuffer  = Buffer.from(base64Data, 'base64');
      const result     = await uploadFile(drive, imgBuffer, img.filename, personId, 'image/jpeg');
      if (result === 'skipped') skipped.push(img.filename);
      else uploaded.push(img.filename);
    }
    return res.status(200).json({ success: true, type: 'images', files: uploaded, skipped });

  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
