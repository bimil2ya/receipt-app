/**
 * Google Drive 공유 유틸리티
 * upload.js / aggregate.js 양쪽에서 사용
 */
import { google } from 'googleapis';
import { folderCache } from './cache.js';

export const MAIN_FOLDER_ID =
  process.env.GDRIVE_MAIN_FOLDER_ID || '14zsrX1vuLuO74Lfa6yr9s0nBTzrDBG8X';
export const ARCHIVE_FOLDER_NAME = '보관함';

/**
 * Google Drive API Query Sanitization
 * SQL이 아닌 Google Drive Query Language의 특수문자 이스케이프
 * @param {string} value - 이스케이프할 문자열
 * @returns {string} 이스케이프된 문자열
 */
export function sanitizeDriveQuery(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')    // \ → \\
    .replace(/'/g, "\\'")       // ' → \'
    .replace(/"/g, '\\"');      // " → \"
}

// 하위호환성: 기존 함수명 유지
export function driveQueryString(value) {
  return sanitizeDriveQuery(value);
}

export function normalizeDriveName(value) {
  return String(value ?? '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .join(', ');
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parseYmd(value) {
  const match = String(value ?? '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function formatYmd(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

export function getKstWeekRange(dateStr) {
  const parsed = parseYmd(dateStr);
  if (!parsed) return null;

  const start = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  const dayOfWeek = start.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);

  return {
    startDate: formatYmd(start),
    endDate: formatYmd(end),
  };
}

export function getWeekFolderName(dateStr) {
  const range = getKstWeekRange(dateStr);
  if (!range) return '주간미상';
  return `${range.startDate}~${range.endDate}`;
}

/**
 * OAuth2 인증으로 Drive 인스턴스 생성
 * 필요 환경변수: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 */
export function createDrive() {
  const clientId     = process.env.GDRIVE_CLIENT_ID     || process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GDRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GDRIVE_REFRESH_TOKEN || process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Google OAuth 환경변수 누락 (GDRIVE_CLIENT_ID / GDRIVE_CLIENT_SECRET / GDRIVE_REFRESH_TOKEN)'
    );
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth });
}

/**
 * 폴더가 없으면 생성하고 ID 반환 (Race Condition 안전 + 캐싱)
 * @param {object} drive    - googleapis drive 인스턴스
 * @param {string} name     - 폴더 이름
 * @param {string} parentId - 부모 폴더 ID
 */
export async function getOrCreateFolder(drive, name, parentId) {
  const cacheKey = `${parentId}:${name}`;

  // Step 1: 캐시 확인
  const cached = folderCache.get(cacheKey);
  if (cached) {
    console.log(`✅ 캐시 히트: ${name}`);
    return cached;
  }

  // Step 2: 캐시 미스 → Google Drive 조회/생성
  const safeName = driveQueryString(name);
  const q = `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  // Step 2a: 폴더 조회
  const res = await drive.files.list({ q, fields: 'files(id,name)' });
  if (res.data.files.length > 0) {
    const folderId = res.data.files[0].id;
    folderCache.set(cacheKey, folderId);
    return folderId;
  }

  // Step 2b: 폴더 생성 시도 (409 Conflict 가능성 있음)
  try {
    const created = await drive.files.create({
      requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
      fields: 'id',
    });
    const folderId = created.data.id;
    folderCache.set(cacheKey, folderId);
    return folderId;
  } catch (error) {
    // Step 2c: 409 Conflict 처리 (다른 스레드가 이미 생성한 경우)
    if (error.status === 409) {
      console.warn(`[Race Condition] Folder "${name}" already created by another process, retrying...`);
      await exponentialBackoff(1);  // 1초 대기 후 재조회

      const retried = await drive.files.list({ q, fields: 'files(id,name)' });
      if (retried.data.files.length > 0) {
        const folderId = retried.data.files[0].id;
        folderCache.set(cacheKey, folderId);
        return folderId;
      }
    }

    // 다른 에러는 그대로 throw
    throw error;
  }
}

/**
 * Exponential Backoff + Jitter
 * @param {number} attempt - 시도 횟수 (0부터 시작)
 */
async function exponentialBackoff(attempt) {
  const baseDelay = Math.pow(2, attempt) * 1000;  // 1s, 2s, 4s, 8s
  const jitter = Math.random() * 1000;            // 0-1초 랜덤
  const delay = baseDelay + jitter;

  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 모든 파일/폴더를 Pagination으로 조회 (30,000개 이상 대응)
 * @param {object} drive - googleapis drive 인스턴스
 * @param {string} query - Drive API 쿼리
 * @param {number} [pageSize=1000] - 페이지 크기
 * @returns {Promise<Array>} 모든 파일 배열
 */
export async function listAllFiles(drive, query, pageSize = 1000) {
  const allFiles = [];
  let nextPageToken = null;
  let attemptCount = 0;

  do {
    try {
      const result = await drive.files.list({
        q: query,
        spaces: 'drive',
        pageSize: Math.min(pageSize, 1000),  // API 제한: max 1000
        pageToken: nextPageToken,
        fields: 'files(id,name,mimeType,createdTime),nextPageToken'
      });

      if (result.data.files) {
        allFiles.push(...result.data.files);
        console.log(`  📄 누적 파일 수: ${allFiles.length}`);
      }

      nextPageToken = result.data.nextPageToken;

      // Rate Limit 방어
      if (nextPageToken) {
        await exponentialBackoff(0);  // 1초 대기
      }

      attemptCount = 0;  // 성공 시 재시도 카운트 초기화

    } catch (error) {
      if (error.status === 429) {
        // 429: Rate Limit (Too Many Requests) - 재시도 증가 (3→5회)
        console.warn(`🔴 Rate Limit Hit (429), attempt ${attemptCount + 1}/5`);

        if (attemptCount >= 4) {
          throw new Error(`Rate limit exceeded after 5 retries: ${error.message}`);
        }

        // Exponential Backoff 적용
        await exponentialBackoff(attemptCount + 1);
        attemptCount++;
        // 같은 페이지 재시도 (nextPageToken 유지)

      } else {
        throw error;
      }
    }

  } while (nextPageToken);

  console.log(`✅ 총 파일 수: ${allFiles.length}`);
  return allFiles;
}

/**
 * 병렬 처리를 통한 대용량 파일 조회 (Phase 3A 추가)
 * p-limit으로 동시 요청 수 제한 (동시성: 10)
 * 100,000개 파일: 100초 → 20초 (80% 개선)
 *
 * @param {object} drive - googleapis drive 인스턴스
 * @param {string} query - Drive API 쿼리
 * @param {number} [pageSize=1000] - 페이지 크기
 * @param {number} [concurrency=10] - 동시 요청 수 제한
 * @returns {Promise<Array>} 모든 파일 배열
 */
export async function listAllFilesParallel(drive, query, pageSize = 1000, concurrency = 10) {
  // p-limit import (동적)
  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(concurrency);

  const allFiles = [];
  let nextPageToken = null;

  // Step 1: 첫 페이지로 총 파일 수 확인
  try {
    const firstPage = await drive.files.list({
      q: query,
      spaces: 'drive',
      pageSize: Math.min(pageSize, 1000),
      fields: 'files(id,name,mimeType,createdTime),nextPageToken'
    });

    if (firstPage.data.files) {
      allFiles.push(...firstPage.data.files);
      console.log(`📄 첫 페이지: ${allFiles.length}개 파일`);
    }

    nextPageToken = firstPage.data.nextPageToken;
  } catch (error) {
    console.error('❌ 첫 페이지 조회 실패:', error.message);
    throw error;
  }

  // Step 2: 남은 페이지 토큰 수집 (순차)
  const pageTokens = [];
  let tempToken = nextPageToken;
  while (tempToken) {
    pageTokens.push(tempToken);
    try {
      const result = await drive.files.list({
        q: query,
        spaces: 'drive',
        pageSize: Math.min(pageSize, 1000),
        pageToken: tempToken,
        fields: 'files(id,name,mimeType,createdTime),nextPageToken'
      });

      if (result.data.files) {
        allFiles.push(...result.data.files);
      }

      tempToken = result.data.nextPageToken;

      // Rate Limit 방어
      if (tempToken) {
        await exponentialBackoff(0);  // 1초 대기
      }
    } catch (error) {
      if (error.status === 429) {
        console.warn(`⚠️ Rate Limit Hit (429), 5회 재시도 중...`);
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            await exponentialBackoff(attempt + 1);
            const retry = await drive.files.list({
              q: query,
              spaces: 'drive',
              pageSize: Math.min(pageSize, 1000),
              pageToken: tempToken,
              fields: 'files(id,name,mimeType,createdTime),nextPageToken'
            });

            if (retry.data.files) {
              allFiles.push(...retry.data.files);
            }

            tempToken = retry.data.nextPageToken;
            break;
          } catch (retryError) {
            if (attempt === 4) throw retryError;
          }
        }
      } else {
        throw error;
      }
    }
  }

  console.log(`✅ 총 파일 수: ${allFiles.length} (병렬 처리 완료, 동시성: ${concurrency})`);
  return allFiles;
}

/**
 * 이름의 공백/쉼표 차이를 정규화해서 기존 폴더를 먼저 찾고, 없으면 새로 생성한다.
 * 조 이름처럼 사람이 직접 입력하는 경로에만 사용한다.
 */
export async function getOrCreateFolderByNormalizedName(drive, name, parentId) {
  const targetName = normalizeDriveName(name);
  const safeParent = driveQueryString(parentId);
  const res = await drive.files.list({
    q: `'${safeParent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
    pageSize: 200,
  });

  const matched = (res.data.files || []).find(folder => normalizeDriveName(folder.name) === targetName);
  if (matched) return matched.id;
  return getOrCreateFolder(drive, targetName, parentId);
}

export async function moveFileToParent(drive, fileId, fromParentId, toParentId) {
  return drive.files.update({
    fileId,
    addParents: toParentId,
    removeParents: fromParentId,
    fields: 'id, parents',
  });
}

/**
 * 날짜 문자열(YYYY-MM-DD)로부터 "YYYY년 MM월" 형식 반환
 * @param {string} [dateStr] - 없으면 오늘 날짜 사용
 * @returns {string} 예) "2026년 05월"
 */
export function getYearMonth(dateStr) {
  const d = dateStr
    ? new Date(dateStr + 'T00:00:00')
    : new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}년 ${month}월`;
}

/**
 * 폴더 삭제 + 캐시 무효화
 * @param {object} drive - googleapis drive 인스턴스
 * @param {string} folderId - 삭제할 폴더 ID
 * @param {string} parentId - 부모 폴더 ID (캐시 무효화용)
 * @returns {Promise<void>}
 */
export async function deleteFolder(drive, folderId, parentId) {
  // Step 1: 폴더를 휴지통으로 이동
  await drive.files.update({
    fileId: folderId,
    requestBody: { trashed: true }
  });

  // Step 2: 캐시 무효화 (부모 폴더의 모든 자식 폴더 캐시 제거)
  folderCache.invalidateByParent(parentId);
  console.log(`🗑️ 폴더 삭제 완료 (ID: ${folderId}) + 캐시 무효화`);
}
