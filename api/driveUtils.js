/**
 * Google Drive 공유 유틸리티
 * upload.js / aggregate.js 양쪽에서 사용
 */
import { google } from 'googleapis';

export const MAIN_FOLDER_ID =
  process.env.GDRIVE_MAIN_FOLDER_ID || '14zsrX1vuLuO74Lfa6yr9s0nBTzrDBG8X';
export const ARCHIVE_FOLDER_NAME = '보관함';

export function driveQueryString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
 * 폴더가 없으면 생성하고 ID 반환
 * @param {object} drive    - googleapis drive 인스턴스
 * @param {string} name     - 폴더 이름
 * @param {string} parentId - 부모 폴더 ID
 */
export async function getOrCreateFolder(drive, name, parentId) {
  const safeName = driveQueryString(name);
  const q = `'${parentId}' in parents and name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const res = await drive.files.list({ q, fields: 'files(id,name)' });
  if (res.data.files.length > 0) return res.data.files[0].id;

  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return created.data.id;
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
