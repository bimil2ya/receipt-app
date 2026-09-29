// 조별 정산서 PDF(표지 = 용도별 집계장, 이후 = 영수증 이미지) 제공.
// 착수 키트 §7 확장. 담당자·노경호 모두 볼 수 있다(역할 제한 없음).
//
// 보안: 클라이언트가 임의의 Drive fileId를 넘겨 아무 파일이나 받아가지 못하도록,
// dashboard-data가 내려준 report만 볼 수 있게 ref에 HMAC 서명을 건다.

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { createDrive, driveQueryString, isTripWeekFolderName, MAIN_FOLDER_ID, normalizeDriveName } from './driveUtils.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PDF_MIME = 'application/pdf';
export const REPORT_MAX_BYTES = 4 * 1024 * 1024;
const FILE_FIELDS = 'id,name,mimeType,parents,trashed,modifiedTime,version,size,md5Checksum';

function fail(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  throw error;
}

function monthFolderName(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000-')) {
    fail('DASHBOARD_INVALID_MONTH', '조회 월은 YYYY-MM 형식이어야 합니다.');
  }
  return `${month.slice(0, 4)}년 ${month.slice(5)}월`;
}

async function request(operation, deadline) {
  const remaining = Math.min(15000, deadline - Date.now());
  if (remaining <= 0) fail('DASHBOARD_REPORT_TIMEOUT', '정산서 조회 시간이 초과되었습니다.');
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      operation({ timeout: remaining, signal: controller.signal }),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort();
        const error = new Error('정산서 조회 시간이 초과되었습니다.');
        error.code = 'DASHBOARD_REPORT_TIMEOUT';
        reject(error);
      }, remaining); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function listAll(drive, query, deadline) {
  const result = [];
  const ids = new Set();
  const tokens = new Set();
  let pageToken;
  do {
    const response = await request(options => drive.files.list({ q: query, pageSize: 1000, pageToken,
      fields: `files(${FILE_FIELDS}),nextPageToken,incompleteSearch` }, options), deadline);
    const data = response?.data;
    if (!data || !Array.isArray(data.files) || data.incompleteSearch) fail('DASHBOARD_REPORT_LIST_INCOMPLETE', '정산서 목록을 모두 확인하지 못했습니다.');
    for (const file of data.files) {
      if (typeof file?.id !== 'string' || !file.id || ids.has(file.id)) fail('DASHBOARD_REPORT_LIST_INCOMPLETE', '정산서 목록의 식별값이 없거나 중복되었습니다.');
      ids.add(file.id);
      result.push(file);
    }
    pageToken = data.nextPageToken;
    if (pageToken && (typeof pageToken !== 'string' || tokens.has(pageToken) || tokens.size >= 100)) {
      fail('DASHBOARD_REPORT_LIST_INCOMPLETE', '정산서 목록 페이지를 모두 확인하지 못했습니다.');
    }
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  return result;
}

function identity(file, parent, mime, name) {
  if (!file?.id || file.mimeType !== mime || file.trashed !== false || file.parents?.length !== 1 || file.parents[0] !== parent
    || typeof file.name !== 'string' || (name !== undefined && file.name !== name)) {
    fail('DASHBOARD_REPORT_PATH_INVALID', '정산서의 경로와 형식을 확인할 수 없습니다.', 404);
  }
}

function reportIdentity(file, parent) {
  identity(file, parent, PDF_MIME);
  if (!/^정산서_.+\.pdf$/.test(file.name)) fail('DASHBOARD_REPORT_PATH_INVALID', '정산서 PDF가 아닙니다.', 404);
  if (!file.modifiedTime || !file.version || !/^\d+$/.test(String(file.size)) || Number(file.size) < 1
    || !Number.isSafeInteger(Number(file.size)) || !/^[a-f0-9]{32}$/i.test(file.md5Checksum || '')) {
    fail('DASHBOARD_REPORT_UNVERIFIABLE', '정산서 PDF의 버전과 바이트 정보를 확인할 수 없습니다.');
  }
}

async function getFile(drive, fileId, deadline) {
  const response = await request(options => drive.files.get({ fileId, fields: FILE_FIELDS }, options), deadline);
  if (response?.data?.id !== fileId) fail('DASHBOARD_REPORT_PATH_INVALID', '정산서 파일을 확인할 수 없습니다.', 404);
  return response.data;
}

function refSig(id) {
  const secret = process.env.DASHBOARD_TOKEN_SECRET;
  if (!secret) throw new Error('DASHBOARD_TOKEN_SECRET is not set');
  return createHmac('sha256', secret).update(`report:${id}`).digest('base64url').slice(0, 22);
}

/** fileId → 서명된 ref(클라이언트에 내려줌). */
export function signReportRef(id) {
  return `${id}~${refSig(id)}`;
}

/** 서명된 ref → fileId(검증 실패 시 null). */
export function verifyReportRef(ref) {
  if (typeof ref !== 'string' || !ref.includes('~')) return null;
  const idx = ref.lastIndexOf('~');
  const id = ref.slice(0, idx);
  const sig = ref.slice(idx + 1);
  if (!id || !sig) return null;
  let expected;
  try {
    expected = refSig(id);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return id;
}

/** Canonical, current reports only. Absence is an empty list; lookup failures throw. */
export async function reportsForMonth({ teamNames, month }, { drive = createDrive(), mainFolderId = MAIN_FOLDER_ID, deadline = Date.now() + 45000 } = {}) {
  const monthName = monthFolderName(month);
  const teamName = normalizeDriveName(teamNames);
  if (!teamName) fail('DASHBOARD_REPORT_TEAM_INVALID', '정산서 팀 이름이 없습니다.');
  const folders = await listAll(drive, `'${driveQueryString(mainFolderId)}' in parents and name = '${monthName}' and mimeType = '${FOLDER_MIME}' and trashed = false`, deadline);
  if (folders.length !== 1) fail('DASHBOARD_REPORT_PATH_AMBIGUOUS', '정산서 월 폴더가 없거나 중복되었습니다.');
  const monthFolder = folders[0];
  identity(monthFolder, mainFolderId, FOLDER_MIME, monthName);
  const teams = await listAll(drive, `'${driveQueryString(monthFolder.id)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`, deadline);
  teams.forEach(folder => identity(folder, monthFolder.id, FOLDER_MIME));
  const matches = teams.filter(folder => normalizeDriveName(folder.name) === teamName);
  if (matches.length > 1) fail('DASHBOARD_REPORT_PATH_AMBIGUOUS', '정산서 팀 폴더가 중복되었습니다.');
  if (!matches.length) return [];
  const team = matches[0];
  const weeks = await listAll(drive, `'${driveQueryString(team.id)}' in parents and mimeType = '${FOLDER_MIME}' and trashed = false`, deadline);
  weeks.forEach(folder => identity(folder, team.id, FOLDER_MIME));
  const currentWeeks = weeks.filter(folder => isTripWeekFolderName(folder.name));
  if (new Set(currentWeeks.map(folder => folder.name)).size !== currentWeeks.length) {
    fail('DASHBOARD_REPORT_PATH_AMBIGUOUS', '정산서 주간 폴더가 중복되었습니다.');
  }
  const reports = [];
  const seen = new Set();
  for (const week of currentWeeks) {
    const files = await listAll(drive, `'${driveQueryString(week.id)}' in parents and name contains '정산서_' and trashed = false`, deadline);
    const reportNames = new Set();
    for (const file of files) {
      // Chunk JSON and archived copies are never downloadable report candidates.
      if (!/^정산서_.+\.pdf$/.test(file.name || '')) continue;
      reportIdentity(file, week.id);
      if (seen.has(file.id) || reportNames.has(file.name)) fail('DASHBOARD_REPORT_PATH_AMBIGUOUS', '정산서 PDF가 중복되었습니다.');
      seen.add(file.id);
      reportNames.add(file.name);
      reports.push({ id: file.id, ref: signReportRef(file.id), label: file.name.slice(0, -4),
        date: week.name === '주간미상' ? null : week.name.slice(0, 10), available: true });
    }
    identity(await getFile(drive, week.id, deadline), team.id, FOLDER_MIME, week.name);
  }
  identity(await getFile(drive, team.id, deadline), monthFolder.id, FOLDER_MIME, team.name);
  identity(await getFile(drive, monthFolder.id, deadline), mainFolderId, FOLDER_MIME, monthName);
  return reports.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')) || a.label.localeCompare(b.label));
}

/** Revalidate signed IDs against their current canonical lineage before reading bytes. */
export async function fetchReportPdf(id, { drive = createDrive(), mainFolderId = MAIN_FOLDER_ID, deadline = Date.now() + 45000 } = {}) {
  if (typeof id !== 'string' || !id) fail('DASHBOARD_REPORT_PATH_INVALID', '정산서 식별값이 없습니다.', 404);
  const before = await getFile(drive, id, deadline);
  if (before.parents?.length !== 1) fail('DASHBOARD_REPORT_PATH_INVALID', '정산서의 경로를 확인할 수 없습니다.', 404);
  reportIdentity(before, before.parents[0]);
  const week = await getFile(drive, before.parents[0], deadline);
  if (week.parents?.length !== 1 || !isTripWeekFolderName(week.name)) fail('DASHBOARD_REPORT_PATH_INVALID', '정산서 주간 경로가 아닙니다.', 404);
  identity(week, week.parents[0], FOLDER_MIME);
  const team = await getFile(drive, week.parents[0], deadline);
  if (team.parents?.length !== 1 || !normalizeDriveName(team.name)) fail('DASHBOARD_REPORT_PATH_INVALID', '정산서 팀 경로가 아닙니다.', 404);
  identity(team, team.parents[0], FOLDER_MIME);
  const monthFolder = await getFile(drive, team.parents[0], deadline);
  identity(monthFolder, mainFolderId, FOLDER_MIME);
  const monthMatch = /^(\d{4})년 (0[1-9]|1[0-2])월$/.exec(monthFolder.name);
  if (!monthMatch) fail('DASHBOARD_REPORT_PATH_INVALID', '정산서 월 경로가 아닙니다.', 404);
  const month = `${monthMatch[1]}-${monthMatch[2]}`;
  const reports = await reportsForMonth({ teamNames: team.name, month }, { drive, mainFolderId, deadline });
  if (!reports.some(report => report.id === id)) fail('DASHBOARD_REPORT_PATH_INVALID', '현재 정산서 목록에 없는 파일입니다.', 404);
  if (Number(before.size) > REPORT_MAX_BYTES) fail('DASHBOARD_REPORT_TOO_LARGE', '정산서 PDF가 화면 조회 크기 한도를 넘었습니다.', 413);
  const downloaded = await request(options => drive.files.get({ fileId: id, alt: 'media' }, { ...options, responseType: 'arraybuffer' }), deadline);
  let bytes;
  if (downloaded?.data instanceof ArrayBuffer) bytes = Buffer.from(downloaded.data);
  else if (downloaded?.data instanceof Uint8Array) bytes = Buffer.from(downloaded.data);
  else fail('DASHBOARD_REPORT_BYTES_INVALID', 'Drive가 PDF 바이트를 반환하지 않았습니다.');
  if (bytes.byteLength > REPORT_MAX_BYTES) fail('DASHBOARD_REPORT_TOO_LARGE', '정산서 PDF가 화면 조회 크기 한도를 넘었습니다.', 413);
  if (bytes.length !== Number(before.size) || bytes.subarray(0, 5).toString('latin1') !== '%PDF-'
    || createHash('md5').update(bytes).digest('hex') !== before.md5Checksum.toLowerCase()) {
    fail('DASHBOARD_REPORT_BYTES_INVALID', '정산서 PDF 바이트와 Drive 파일 정보가 일치하지 않습니다.');
  }
  const after = await getFile(drive, id, deadline);
  reportIdentity(after, week.id);
  if (['name', 'version', 'modifiedTime', 'size', 'md5Checksum'].some(key => before[key] !== after[key])) {
    fail('DASHBOARD_REPORT_CHANGED', '조회 중 정산서가 변경되었습니다. 다시 조회해 주세요.');
  }
  identity(await getFile(drive, week.id, deadline), team.id, FOLDER_MIME, week.name);
  identity(await getFile(drive, team.id, deadline), monthFolder.id, FOLDER_MIME, team.name);
  identity(await getFile(drive, monthFolder.id, deadline), mainFolderId, FOLDER_MIME, monthFolder.name);
  return bytes;
}
