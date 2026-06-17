/**
 * Google Drive 공유 유틸리티
 * upload.js / aggregate.js 양쪽에서 사용
 */
import { google } from 'googleapis';

export const MAIN_FOLDER_ID =
  process.env.GDRIVE_MAIN_FOLDER_ID || '14zsrX1vuLuO74Lfa6yr9s0nBTzrDBG8X';

export function driveQueryString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
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
