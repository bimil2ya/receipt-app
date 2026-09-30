import * as XLSX from 'xlsx';
import { createDrive, driveQueryString, MAIN_FOLDER_ID, normalizeDriveName } from './driveUtils.js';
import { applyCorsHeaders, checkOriginAllowed } from './_corsNode.js';
import { jsonError, Errors } from './_errorHandler.js';
import { clientRateKey, progressRateLimiter } from './_rateLimiter.js';
import { saveProgressShare, validateProgressPayload } from './_progress.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const REVIEW_FILE_FIELDS = 'files(id,name,mimeType,parents,trashed,modifiedTime,version),nextPageToken,incompleteSearch';
const REVIEW_COLUMNS = ['영수증 식별값', '팀', '수정 버전', '검토 상태', '담당자 메모', '추가 자료 요청', '검토 담당자', '검토 시각'];

function reviewSourceError(message) {
  const error = new Error(message);
  error.code = 'REVIEW_SOURCE_UNVERIFIABLE';
  return error;
}

/** Read every page. A partial Drive search must never be treated as "no reviews". */
export async function listReviewFiles(drive, query) {
  const files = [];
  const ids = new Set();
  const tokens = new Set();
  let pageToken;
  do {
    const response = await drive.files.list({ q: query, pageSize: 1000, pageToken, fields: REVIEW_FILE_FIELDS });
    const data = response?.data;
    if (!data || !Array.isArray(data.files) || data.incompleteSearch) {
      throw reviewSourceError('검토기록 Drive 목록을 모두 확인하지 못했습니다.');
    }
    for (const file of data.files) {
      if (!file?.id || ids.has(file.id)) throw reviewSourceError('검토기록 Drive 목록의 파일을 확인하지 못했습니다.');
      ids.add(file.id);
      files.push(file);
    }
    pageToken = data.nextPageToken;
    if (pageToken && (typeof pageToken !== 'string' || tokens.has(pageToken) || tokens.size >= 100)) {
      throw reviewSourceError('검토기록 Drive 목록 페이지를 모두 확인하지 못했습니다.');
    }
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  return files;
}

/**
 * A display-only review reader still needs an unambiguous canonical source.
 * Null means the exact folder/file is genuinely absent; ambiguous or malformed
 * search results are errors so the client keeps its prior notices and shows a failure.
 */
export function selectReviewSource(files, { parentId, name, mimeType }) {
  if (!files.length) return null;
  if (files.length !== 1) throw reviewSourceError('검토기록 원본이 중복되어 읽을 수 없습니다.');
  const file = files[0];
  if (file.name !== name || file.mimeType !== mimeType || file.trashed !== false
    || !Array.isArray(file.parents) || file.parents.length !== 1 || file.parents[0] !== parentId) {
    throw reviewSourceError('검토기록 원본 경로와 형식을 확인하지 못했습니다.');
  }
  return file;
}

function reviewVersion(file) {
  if (!file?.modifiedTime || !file?.version) throw reviewSourceError('검토기록 원본의 버전 정보를 확인하지 못했습니다.');
  return { modifiedTime: file.modifiedTime, version: String(file.version) };
}

async function revalidateReviewSource(drive, listed, identity) {
  const response = await drive.files.get({ fileId: listed.id, fields: 'id,name,mimeType,parents,trashed,modifiedTime,version' });
  const current = response?.data;
  if (!current || current.id !== listed.id) throw reviewSourceError('검토기록 원본을 다시 확인하지 못했습니다.');
  selectReviewSource([current], identity);
  const before = reviewVersion(listed);
  const after = reviewVersion(current);
  if (before.modifiedTime !== after.modifiedTime || before.version !== after.version) {
    throw reviewSourceError('조회 중 검토기록 원본이 변경되었습니다. 다시 확인해 주세요.');
  }
  return current;
}

function readReviewRows(workbook) {
  const sheet = workbook?.Sheets?.['검토기록'];
  if (!sheet?.['!ref']) throw reviewSourceError('검토기록 시트가 없거나 비어 있습니다.');
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
  const headers = matrix[0] || [];
  const named = headers.filter(value => value !== '');
  if (named.some(value => typeof value !== 'string') || new Set(named).size !== named.length
    || REVIEW_COLUMNS.some(column => !headers.includes(column))) {
    throw reviewSourceError('검토기록 시트의 필수 열이 없거나 중복되었습니다.');
  }
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

/** Pure Drive-facing read used by the handler and isolated handler-contract tests. */
export async function loadTeamReviews(drive, { reportDate, teamNames, mainFolderId = MAIN_FOLDER_ID }) {
  const yearMonth = `${reportDate.slice(0, 4)}년 ${reportDate.slice(5, 7)}월`;
  const monthIdentity = { parentId: mainFolderId, name: yearMonth, mimeType: FOLDER_MIME };
  const month = selectReviewSource(await listReviewFiles(drive,
    `'${driveQueryString(mainFolderId)}' in parents and name = '${driveQueryString(yearMonth)}' and trashed = false`),
  monthIdentity);
  if (!month) return { reviews: [], source: 'month_not_found' };
  const aggregateName = `전체집계_${yearMonth}`;
  const fileIdentity = { parentId: month.id, name: aggregateName, mimeType: SHEET_MIME };
  const file = selectReviewSource(await listReviewFiles(drive,
    `'${driveQueryString(month.id)}' in parents and name = '${driveQueryString(aggregateName)}' and trashed = false`),
  fileIdentity);
  if (!file) return { reviews: [], source: 'review_sheet_not_found' };
  await revalidateReviewSource(drive, month, monthIdentity);
  await revalidateReviewSource(drive, file, fileIdentity);
  const exported = await drive.files.export({ fileId: file.id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, { responseType: 'arraybuffer' });
  await revalidateReviewSource(drive, file, fileIdentity);
  await revalidateReviewSource(drive, month, monthIdentity);
  const workbook = XLSX.read(Buffer.from(exported.data), { type: 'buffer' });
  return { reviews: filterTeamReviewRows(readReviewRows(workbook), teamNames), source: 'drive' };
}

// POST: 현장 폰의 진행 공유(목록만). 검토기록 GET과 완전히 분리해, 이 분기에 문제가 생겨도
// 앱을 열 때마다 쓰는 검토기록 조회에는 영향이 없게 한다.
async function handleProgressShare(req, res) {
  const rate = progressRateLimiter(clientRateKey(req.headers));
  if (!rate.ok) return jsonError(res, Errors.rateLimit(rate.retryAfterSec));
  let payload;
  try {
    payload = validateProgressPayload(req.body);
  } catch (error) {
    return jsonError(res, Errors.badRequest(error.message));
  }
  try {
    const result = await saveProgressShare(createDrive(), payload);
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('progress share error:', error.message);
    return jsonError(res, Errors.internalError('진행 공유를 저장하지 못했습니다.'));
  }
}

export function filterTeamReviewRows(rows, teamNames) {
  const team = normalizeDriveName(teamNames);
  return (rows || []).filter(row => normalizeDriveName(row?.['팀']) === team)
    .filter(row => ['검토 상태', '담당자 메모', '추가 자료 요청', '검토 담당자', '검토 시각'].some(key => String(row?.[key] || '').trim()));
}

export default async function handler(req, res) {
  if (applyCorsHeaders(req, res) === true) return;
  if (!checkOriginAllowed(req, res)) return;
  if (req.method === 'POST') return handleProgressShare(req, res);
  if (req.method !== 'GET') return jsonError(res, Errors.methodNotAllowed());
  const reportDate = String(req.query?.reportDate || '');
  const teamNames = normalizeDriveName(req.query?.teamNames || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate) || !teamNames) return jsonError(res, Errors.badRequest('reportDate와 teamNames가 필요합니다.'));
  try {
    const result = await loadTeamReviews(createDrive(), { reportDate, teamNames });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('review read error:', error.message);
    return jsonError(res, Errors.internalError('검토기록을 읽지 못했습니다.'));
  }
}
