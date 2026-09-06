/**
 * Google Drive 폴더 사전 생성 배치
 * 매달 1일 00:00 UTC에 자동 실행
 * Cron 설정: /api/folders-batch, schedule: "0 0 1 * *"
 */

import { getOrCreateFolder, MAIN_FOLDER_ID } from './driveUtils.js';
import { createDrive } from './driveUtils.js';
import { applyCorsHeaders, checkOriginAllowed } from './_cors.js';
import { Errors, jsonError } from './_errorHandler.js';
import { safeCompare } from './auth.js';

/**
 * 향후 3개월 폴더 사전 생성
 * 현재 + 향후 3개월 = 총 4개월의 연/월 폴더를 미리 생성
 *
 * @param {object} drive - googleapis drive 인스턴스
 * @returns {Promise<Object>} { status, preCreatedFolders, timestamp }
 */
export async function preFoldersForUpcomingMonths(drive) {
  const folders = [];
  const today = new Date();

  // 현재 + 향후 3개월 (총 4개월)
  for (let i = 0; i < 4; i++) {
    const date = new Date(today);
    date.setMonth(date.getMonth() + i);

    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');

    try {
      // Step 1: 연도 폴더 생성/조회
      const yearFolderId = await getOrCreateFolder(
        drive,
        String(year),
        MAIN_FOLDER_ID
      );

      // Step 2: 월 폴더 생성/조회
      const monthFolderName = `${year}-${month}`;
      const monthFolderId = await getOrCreateFolder(
        drive,
        monthFolderName,
        yearFolderId
      );

      folders.push({
        year,
        month,
        monthFolderName,
        yearFolderId,
        monthFolderId,
        created: true
      });

      console.log(`✅ 폴더 생성: ${monthFolderName}`);
    } catch (error) {
      console.error(`❌ 폴더 생성 실패: ${year}-${month} - ${error.message}`);
      folders.push({
        year,
        month,
        monthFolderName: `${year}-${month}`,
        error: error.message,
        created: false
      });
    }
  }

  return {
    status: 'success',
    timestamp: new Date().toISOString(),
    preCreatedFolders: folders,
    summary: `${folders.filter(f => f.created).length}/${folders.length} 폴더 생성 완료`
  };
}

/**
 * HTTP 핸들러
 * GET /api/folders-batch - Cron 자동 실행 + 수동 테스트 가능
 */
export default async function handler(req, res) {
  // CORS 헤더 설정
  const corsResult = applyCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS' });
  if (corsResult === true) return; // OPTIONS 처리됨

  // 출처 검증
  if (!checkOriginAllowed(req, res)) return;

  try {
    // Cron 요청은 인증이 필요 없음 (Vercel이 자동으로 실행)
    // 수동 테스트 시 토큰 필요
    if (req.method === 'POST') {
      const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN;
      if (!UPLOAD_TOKEN) {
        return jsonError(res, Errors.internalError('UPLOAD_API_TOKEN이 설정되지 않았습니다.'));
      }

      const authHeader = req.headers['authorization'] || '';
      const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!safeCompare(provided, UPLOAD_TOKEN)) {
        return jsonError(res, Errors.unauthorized('유효하지 않은 토큰입니다.'));
      }
    }

    // Google Drive 인스턴스 생성
    const drive = createDrive();

    // 폴더 사전 생성 실행
    const result = await preFoldersForUpcomingMonths(drive);

    return res.status(200).json(result);
  } catch (error) {
    console.error('🚨 폴더 사전 생성 배치 오류:', error);
    return jsonError(
      res,
      Errors.internalError(`폴더 사전 생성 실패: ${error.message}`)
    );
  }
}
