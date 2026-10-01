// Dashboard-only reader for the field app's silent progress snapshots.
// These records are deliberately outside the official monthly aggregate tree.
import { createDrive, driveQueryString, MAIN_FOLDER_ID } from './driveUtils.js';
import { latestRecords, progressFileName, validateProgressPayload } from './_progress.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const JSON_MIME = 'application/json';
const MAX_PROGRESS_BYTES = 2 * 1024 * 1024;
const FILE_FIELDS = 'id,name,mimeType,parents,trashed,size,modifiedTime,version';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function checkDeadline(deadline) {
  if (Date.now() >= deadline) fail('DASHBOARD_DRIVE_TIMEOUT', 'Drive 조회 시간이 초과되었습니다.');
}

async function requestDrive(operation, deadline) {
  checkDeadline(deadline);
  const remaining = deadline - Date.now();
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      operation({ timeout: Math.min(15000, remaining), signal: controller.signal }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          const error = new Error('Drive 조회 시간이 초과되었습니다.');
          error.code = 'DASHBOARD_DRIVE_TIMEOUT';
          reject(error);
        }, Math.min(15000, remaining));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function listAll(drive, q, deadline) {
  const files = [];
  const ids = new Set();
  const tokens = new Set();
  let pageToken;
  do {
    const response = await requestDrive(options => drive.files.list({
      q, pageSize: 1000, pageToken,
      fields: `files(${FILE_FIELDS}),nextPageToken,incompleteSearch`,
    }, options), deadline);
    const data = response?.data;
    if (!data || !Array.isArray(data.files) || data.incompleteSearch) fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 목록을 모두 확인하지 못했습니다.');
    for (const file of data.files) {
      if (!file?.id || ids.has(file.id)) fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 파일 목록이 올바르지 않습니다.');
      ids.add(file.id);
      files.push(file);
    }
    pageToken = data.nextPageToken;
    if (pageToken && (tokens.has(pageToken) || tokens.size >= 100)) fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 목록 페이지를 모두 확인하지 못했습니다.');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  return files;
}

function isExactChild(file, parentId, mimeType, name) {
  return file && file.name === name && file.mimeType === mimeType && file.trashed !== true
    && Array.isArray(file.parents) && file.parents.length === 1 && file.parents[0] === parentId;
}

function hasVersion(file) {
  return typeof file?.modifiedTime === 'string' && file.modifiedTime
    && typeof file?.version === 'string' && file.version;
}

function stableIdentity(file, parentId, mimeType, name) {
  return isExactChild(file, parentId, mimeType, name) && hasVersion(file);
}

function stableJsonIdentity(file, parentId) {
  return stableIdentity(file, parentId, JSON_MIME, file.name)
    && /^\d+$/.test(String(file.size))
    && Number.isSafeInteger(Number(file.size))
    && Number(file.size) >= 1
    && Number(file.size) <= MAX_PROGRESS_BYTES;
}

function assertUnchanged(before, after, parentId, mimeType, name, size = false) {
  if (!after || after.id !== before.id || !stableIdentity(after, parentId, mimeType, name)
    || after.modifiedTime !== before.modifiedTime || after.version !== before.version
    || (size && String(after.size) !== String(before.size))) {
    fail('DASHBOARD_PROGRESS_CHANGED', '조회 중 임시 집계 자료가 변경되었습니다. 다시 조회해 주세요.');
  }
}

async function getMetadata(drive, fileId, deadline) {
  const response = await requestDrive(options => drive.files.get({ fileId, fields: FILE_FIELDS }, options), deadline);
  if (response?.data?.id !== fileId) fail('DASHBOARD_PROGRESS_CHANGED', '조회 중 임시 집계 자료가 변경되었습니다. 다시 조회해 주세요.');
  return response.data;
}

function validSharedAt(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseRecord(bytes, fileName, monthName) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_PROGRESS_BYTES) {
    fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 파일의 크기 또는 내용을 확인할 수 없습니다.');
  }
  let raw;
  try { raw = JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch { fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 파일을 읽을 수 없습니다.'); }
  if (!raw || raw.schema !== 1 || !validSharedAt(raw.sharedAt)) fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 파일 형식이 올바르지 않습니다.');
  let payload;
  try { payload = validateProgressPayload(raw); }
  catch { fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 파일의 항목 형식이 올바르지 않습니다.'); }
  if (`${payload.tripStartDate.slice(0, 4)}년 ${payload.tripStartDate.slice(5, 7)}월` !== monthName
    || progressFileName(payload) !== fileName) {
    fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 파일의 경로와 내용이 일치하지 않습니다.');
  }
  return { schema: 1, ...payload, sharedAt: raw.sharedAt };
}

/**
 * Reads only _진행현황/YYYY년 MM월 direct-child JSON files. It does not write,
 * move, or treat a progress snapshot as an official submission.
 */
export async function loadDashboardProgress(month, {
  drive = createDrive(), mainFolderId = MAIN_FOLDER_ID, deadline = Date.now() + 45000,
} = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('DASHBOARD_INVALID_MONTH', '조회 월은 YYYY-MM 형식이어야 합니다.');
  const rootName = '_진행현황';
  const monthName = `${month.slice(0, 4)}년 ${month.slice(5)}월`;
  const roots = await listAll(drive, `'${driveQueryString(mainFolderId)}' in parents and name = '${rootName}' and mimeType = '${FOLDER_MIME}' and trashed = false`, deadline);
  if (roots.length === 0) return [];
  if (roots.length !== 1 || !stableIdentity(roots[0], mainFolderId, FOLDER_MIME, rootName)) fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 보관함을 하나로 확인할 수 없습니다.');
  const months = await listAll(drive, `'${driveQueryString(roots[0].id)}' in parents and name = '${monthName}' and mimeType = '${FOLDER_MIME}' and trashed = false`, deadline);
  if (months.length === 0) return [];
  if (months.length !== 1 || !stableIdentity(months[0], roots[0].id, FOLDER_MIME, monthName)) fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 월 폴더를 하나로 확인할 수 없습니다.');
  const files = await listAll(drive, `'${driveQueryString(months[0].id)}' in parents and mimeType = '${JSON_MIME}' and trashed = false`, deadline);
  const records = [];
  for (const file of files) {
    if (!file?.name || !stableJsonIdentity(file, months[0].id)) {
      fail('DASHBOARD_PROGRESS_INVALID', '임시 집계 파일 정보를 확인할 수 없습니다.');
    }
    const response = await requestDrive(options => drive.files.get({ fileId: file.id, alt: 'media' }, { ...options, responseType: 'arraybuffer' }), deadline);
    const bytes = response?.data instanceof ArrayBuffer ? Buffer.from(response.data)
      : response?.data instanceof Uint8Array ? Buffer.from(response.data) : null;
    if (!bytes) fail('DASHBOARD_PROGRESS_INVALID', 'Drive가 임시 집계 파일을 반환하지 않았습니다.');
    const after = await getMetadata(drive, file.id, deadline);
    assertUnchanged(file, after, months[0].id, JSON_MIME, file.name, true);
    records.push(parseRecord(bytes, file.name, monthName));
  }
  assertUnchanged(months[0], await getMetadata(drive, months[0].id, deadline), roots[0].id, FOLDER_MIME, monthName);
  assertUnchanged(roots[0], await getMetadata(drive, roots[0].id, deadline), mainFolderId, FOLDER_MIME, rootName);
  return latestRecords(records);
}
