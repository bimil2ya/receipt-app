/**
 * Google Drive 공유 유틸리티
 * upload.js / aggregate.js 양쪽에서 사용
 *
 * 인증: 서비스 계정 (Vercel 환경변수 GDRIVE_SERVICE_ACCOUNT_JSON 에
 *       Google Cloud Console에서 받은 JSON 키 파일 내용을 통째로 저장)
 *
 * 저장소: 공유 드라이브("공유 문서함") 안의 폴더
 *       → 모든 files API 호출에 supportsAllDrives: true 가 자동으로 추가됨
 */
import { google } from 'googleapis';

export const MAIN_FOLDER_ID =
  process.env.GDRIVE_MAIN_FOLDER_ID || '14zsrX1vuLuO74Lfa6yr9s0nBTzrDBG8X';

export function driveQueryString(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// 공유 드라이브(Shared Drive)에서 동작하려면 모든 files.* 호출에
// supportsAllDrives 가 필요. 호출 사이트마다 추가하지 않고 한곳에서 처리.
function wrapDriveForSharedDrives(drive) {
  const originalFiles = drive.files;
  const wrappedFiles = {};
  for (const key of Object.keys(originalFiles)) {
    const original = originalFiles[key];
    if (typeof original === 'function') {
      wrappedFiles[key] = function (params, ...rest) {
        const merged = {
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
          ...(params || {}),
        };
        return original.call(originalFiles, merged, ...rest);
      };
    } else {
      wrappedFiles[key] = original;
    }
  }
  // drive 의 다른 리소스(about, drives, ...)는 그대로 forward,
  // files 만 wrap된 객체로 교체. plain object를 Proxy 대상으로 쓰면
  // non-configurable invariant 위반이 발생하지 않음.
  return new Proxy({}, {
    get(_target, prop) {
      if (prop === 'files') return wrappedFiles;
      return drive[prop];
    },
  });
}

export function createDrive() {
  const json =
    process.env.GDRIVE_SERVICE_ACCOUNT_JSON ||
    process.env.GDRIVE_SERVICE_ACCOUNT;
  if (!json) {
    throw new Error(
      'GDRIVE_SERVICE_ACCOUNT_JSON 환경변수가 없습니다. Vercel에 서비스 계정 JSON 키 전체를 저장하세요.'
    );
  }
  let credentials;
  try {
    credentials = JSON.parse(json);
  } catch {
    throw new Error(
      'GDRIVE_SERVICE_ACCOUNT_JSON 파싱 실패 — Vercel 환경변수에 JSON 전체가 올바르게 저장됐는지 확인하세요.'
    );
  }
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  const drive = google.drive({ version: 'v3', auth });
  return wrapDriveForSharedDrives(drive);
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
