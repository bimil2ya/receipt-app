// Read-only monthly aggregate adapter. No write, submission or completion-count side effects.
import * as XLSX from 'xlsx';
import { createDrive, driveQueryString, MAIN_FOLDER_ID, normalizeDriveName } from './driveUtils.js';

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CATEGORIES = ['숙박비', '식비', '기타', '유류비', '의료비등'];
const FUEL_MED = new Set(['유류비', '의료비등']);
const DETAIL_COLUMNS = ['날짜', '사용시간', '이름', '사용처', '용도', '금액(원)', '승인번호', '영수증 식별값', '수정 버전'];
const REVIEW_COLUMNS = ['영수증 식별값', '수정 버전', '검토 상태', '담당자 메모', '추가 자료 요청', '검토 담당자', '검토 시각'];
const MAX_BYTES = 20 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

export function resolveDashboardMonth(month) {
  if (month === undefined) {
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month.startsWith('0000-')) {
    fail('DASHBOARD_INVALID_MONTH', '조회 월은 YYYY-MM 형식이어야 합니다.');
  }
  return month;
}

function integer(value, positive = false) {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value)))) {
    fail('DASHBOARD_INVALID_NUMBER', '금액 또는 수정 버전이 정수가 아닙니다.');
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || (positive && number < 1)) {
    fail('DASHBOARD_INVALID_NUMBER', '금액 또는 수정 버전이 안전한 정수 범위를 벗어났습니다.');
  }
  return number;
}

function add(left, right) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) fail('DASHBOARD_AMOUNT_OVERFLOW', '집계 합계가 안전한 정수 범위를 벗어났습니다.');
  return value;
}

function text(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') fail('DASHBOARD_INVALID_CELL', '시트의 값 형식을 확인할 수 없습니다.');
  return String(value);
}

function normalizedCalendarCell(cell, header, date1904) {
  if (!cell || !['날짜', '사용시간'].includes(header) || cell.t !== 'n' || !XLSX.SSF.is_date(cell.z || '')) return cell?.v ?? '';
  const parts = XLSX.SSF.parse_date_code(cell.v, { date1904 });
  if (!parts) fail('DASHBOARD_INVALID_CELL', '시트의 날짜 또는 시간 값을 확인할 수 없습니다.');
  const pad = value => String(value).padStart(2, '0');
  if (header === '사용시간') return `${pad(parts.H)}:${pad(parts.M)}`;
  const date = new Date(Date.UTC(parts.y, parts.m - 1, parts.d));
  if (date.getUTCFullYear() !== parts.y || date.getUTCMonth() + 1 !== parts.m || date.getUTCDate() !== parts.d) {
    fail('DASHBOARD_INVALID_CELL', '시트의 날짜 값을 확인할 수 없습니다.');
  }
  return `${String(parts.y).padStart(4, '0')}-${pad(parts.m)}-${pad(parts.d)}`;
}

function readRows(workbook, name, required) {
  const sheet = workbook.Sheets[name];
  if (!sheet?.['!ref']) fail('DASHBOARD_SCHEMA_INVALID', `필수 시트가 없거나 비어 있습니다: ${name}`);
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 100000 || range.e.c > 150) fail('DASHBOARD_WORKBOOK_TOO_LARGE', '집계 시트의 크기가 조회 한도를 넘었습니다.');
  // Matrix access preserves raw numeric values and does not rewrite header cells.
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: true, defval: '', raw: true });
  const headers = matrix[0] || [];
  const named = headers.filter(header => header !== '');
  if (named.some(header => typeof header !== 'string') || new Set(named).size !== named.length || required.some(header => !headers.includes(header))) {
    fail('DASHBOARD_SCHEMA_INVALID', `필수 열이 없거나 중복되었습니다: ${name}`);
  }
  return matrix.slice(1).map((values, rowIndex) => Object.fromEntries(headers.flatMap((header, index) => {
    if (header === '') return [];
    // Calendar formatting is column-specific. Amounts and revisions retain raw
    // cell values so a formatted or rounded number cannot bypass integer checks.
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + rowIndex + 1, c: range.s.c + index })];
    const value = ['날짜', '사용시간'].includes(header)
      ? normalizedCalendarCell(cell, header, workbook.Workbook?.WBProps?.date1904)
      : values[index] ?? '';
    return [[header, value]];
  }))).filter(row => Object.values(row).some(value => value !== ''));
}

// The aggregate rewrites '수정 버전' while retaining editable review state. Therefore
// that column cannot prove which revision the office actually approved.
export function defaultReviewPolicy(row, detail) {
  const status = text(row['검토 상태']).trim();
  if (!status) return 'none';
  if (row['직전 수정 버전'] !== undefined && row['직전 수정 버전'] !== '') return 'unknown';
  if (row['수정 버전'] === '' || integer(row['수정 버전'], true) !== detail.revision) return 'unknown';
  if (['추가 자료 요청', '확인 필요', '수정 요청', '보완 요청'].includes(status)) return 'req';
  return 'unknown';
}

function matchKey(row) {
  return JSON.stringify([normalizeDriveName(text(row['팀'])), text(row['날짜']), text(row['사용처']), integer(row['금액(원)'])]);
}

/** Pure XLSX byte parser. Legacy blank IDs remain visible but cannot imply approval. */
export function parseDashboardWorkbook(bytes, { month, reviewPolicy = defaultReviewPolicy } = {}) {
  resolveDashboardMonth(month);
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_BYTES || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    fail('DASHBOARD_WORKBOOK_INVALID', '월집계 XLSX 파일을 확인할 수 없습니다.');
  }
  let workbook;
  try { workbook = XLSX.read(bytes, { type: 'buffer', cellNF: true }); }
  catch { fail('DASHBOARD_WORKBOOK_INVALID', '월집계 XLSX 파일을 읽지 못했습니다.'); }
  const details = readRows(workbook, '전체내역', DETAIL_COLUMNS);
  const rawReviews = readRows(workbook, '검토기록', REVIEW_COLUMNS);
  const pivot = readRows(workbook, '날짜별집계', ['날짜', '합계(원)']);
  const ids = new Set();
  const ledger = details.map(row => {
    const id = text(row['영수증 식별값']).trim();
    if (id && ids.has(id)) fail('DASHBOARD_RECEIPT_ID_DUPLICATE', '전체내역의 영수증 식별값이 중복되었습니다.');
    if (id) ids.add(id);
    const team = normalizeDriveName(text(row['이름']));
    if (!team) fail('DASHBOARD_TEAM_MISSING', '전체내역에 팀 이름이 없습니다.');
    return {
      date: text(row['날짜']), time: text(row['사용시간']), team,
      category: text(row['용도']).trim() || '미정', amount: integer(row['금액(원)']),
      store: text(row['사용처']), approvalNum: text(row['승인번호']),
      receiptId: id, revision: row['수정 버전'] === '' ? null : integer(row['수정 버전'], true),
      reviewStatus: null, reviewState: 'none', teamPdfUrl: null,
    };
  });
  const spent = ledger.reduce((total, row) => add(total, row.amount), 0);
  const totalRows = pivot.filter(row => row['날짜'] === '합계');
  if (totalRows.length !== 1 || integer(totalRows[0]['합계(원)']) !== spent) {
    fail('DASHBOARD_TOTAL_MISMATCH', '날짜별집계 합계와 전체내역 합계가 일치하지 않습니다.');
  }

  const reviewIds = new Set();
  // The generator's entirely blank placeholder row is not a review record.
  const reviewsRaw = rawReviews.filter(row => Object.values(row).some(value => value !== ''));
  const reviewsById = new Map();
  const legacyByKey = new Map();
  for (const row of reviewsRaw) {
    const id = text(row['영수증 식별값']).trim();
    if (id && reviewIds.has(id)) fail('DASHBOARD_RECEIPT_ID_DUPLICATE', '검토기록의 영수증 식별값이 중복되었습니다.');
    if (id) {
      reviewIds.add(id);
      reviewsById.set(id, row);
    } else if (['팀', '날짜', '사용처', '금액(원)'].every(key => row[key] !== undefined && row[key] !== '')) {
      const key = matchKey(row);
      legacyByKey.set(key, [...(legacyByKey.get(key) || []), row]);
    }
  }
  const detailKeys = new Map();
  ledger.forEach(row => {
    const key = JSON.stringify([row.team, row.date, row.store, row.amount]);
    detailKeys.set(key, (detailKeys.get(key) || 0) + 1);
  });
  const usedReviews = new Set();
  let unmatchedLedgerCount = 0;
  for (const row of ledger) {
    let review = row.receiptId ? reviewsById.get(row.receiptId) : undefined;
    const key = JSON.stringify([row.team, row.date, row.store, row.amount]);
    const candidates = legacyByKey.get(key) || [];
    if (!review && detailKeys.get(key) === 1 && candidates.length === 1) review = candidates[0];
    if (!review || usedReviews.has(review)) {
      row.reviewState = 'unknown';
      row.reviewStatus = '대조 불가';
      unmatchedLedgerCount += 1;
      continue;
    }
    // Exact IDs still require the same team and receipt values when present.
    const mismatch = [['팀', row.team], ['날짜', row.date], ['사용처', row.store], ['용도', row.category]].some(([column, value]) => {
      if (review[column] === undefined) return false;
      const actual = column === '팀' ? normalizeDriveName(text(review[column])) : (column === '용도' ? text(review[column]).trim() || '미정' : text(review[column]));
      return actual !== value;
    }) || (review['금액(원)'] !== undefined && integer(review['금액(원)']) !== row.amount);
    usedReviews.add(review);
    const state = mismatch ? 'unknown' : reviewPolicy(review, row);
    if (!['ok', 'req', 'none', 'unknown'].includes(state)) fail('DASHBOARD_REVIEW_POLICY_INVALID', '검토 상태 해석 결과가 잘못되었습니다.');
    row.reviewState = state;
    row.reviewStatus = state === 'unknown' ? '대조 불가' : (text(review['검토 상태']).trim() || null);
    if (state === 'unknown') unmatchedLedgerCount += 1;
  }
  const byCategory = Object.assign(Object.create(null), Object.fromEntries(CATEGORIES.map(category => [category, 0])));
  const teamsByName = new Map();
  for (const row of ledger) {
    byCategory[row.category] = add(byCategory[row.category] || 0, row.amount);
    let team = teamsByName.get(row.team);
    if (!team) {
      team = { names: row.team, spent: 0, core: 0, byCategory: Object.assign(Object.create(null), Object.fromEntries(CATEGORIES.map(category => [category, 0]))), receiptCount: 0,
        submitted: false, submissionStatus: 'unverified', aggregateReflected: true, review: { ok: 0, req: 0, none: 0, unknown: 0 }, reports: [] };
      teamsByName.set(row.team, team);
    }
    team.spent = add(team.spent, row.amount);
    if (!FUEL_MED.has(row.category)) team.core = add(team.core, row.amount);
    team.byCategory[row.category] = add(team.byCategory[row.category] || 0, row.amount);
    team.receiptCount += 1;
    team.review[row.reviewState] += 1;
  }
  const teams = [...teamsByName.values()];
  const core = teams.reduce((total, team) => add(total, team.core), 0);
  const fuelMed = ledger.filter(row => FUEL_MED.has(row.category)).reduce((total, row) => add(total, row.amount), 0);
  if (Object.values(byCategory).reduce(add, 0) !== spent || add(core, fuelMed) !== spent) {
    fail('DASHBOARD_TOTAL_MISMATCH', '집계 금액의 분류 합계가 일치하지 않습니다.');
  }
  return { totals: { spent, core, fuelMed, receiptCount: ledger.length, prevMonthSpent: null }, byCategory, teams, ledger, reviewsRaw,
    unmatchedLedgerCount, unmatchedReviewCount: reviewsRaw.length - usedReviews.size };
}

async function requestDrive(operation, deadline) {
  for (let attempt = 0; ; attempt += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) fail('DASHBOARD_DRIVE_TIMEOUT', 'Drive 조회 시간이 초과되었습니다.');
    let timer;
    const controller = new AbortController();
    try {
      return await Promise.race([
        operation({ timeout: Math.min(15000, remaining), signal: controller.signal }),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort();
          const error = new Error('Drive 조회 시간이 초과되었습니다.');
          error.code = 'DASHBOARD_DRIVE_TIMEOUT';
          reject(error);
        }, Math.min(15000, remaining)); }),
      ]);
    } catch (error) {
      const status = Number(error?.response?.status || error?.code);
      if (attempt >= 1 || !(status === 429 || status >= 500 || ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error.code))) throw error;
    } finally { clearTimeout(timer); }
  }
}

async function listAll(drive, query, deadline) {
  const result = [];
  const tokens = new Set();
  const ids = new Set();
  let pageToken;
  do {
    const response = await requestDrive(options => drive.files.list({ q: query, pageSize: 1000, pageToken,
      fields: 'files(id,name,mimeType,parents,modifiedTime,version),nextPageToken,incompleteSearch' }, options), deadline);
    const data = response?.data;
    if (!data || !Array.isArray(data.files) || data.incompleteSearch) fail('DASHBOARD_DRIVE_INCOMPLETE', 'Drive 목록이 완전하지 않습니다.');
    for (const file of data.files) {
      if (!file?.id || ids.has(file.id)) fail('DASHBOARD_DRIVE_INCOMPLETE', 'Drive 목록의 파일 식별값이 없거나 중복되었습니다.');
      ids.add(file.id);
      result.push(file);
    }
    pageToken = data.nextPageToken;
    if (pageToken && (tokens.has(pageToken) || tokens.size >= 100)) fail('DASHBOARD_DRIVE_INCOMPLETE', 'Drive 목록 페이지를 모두 확인할 수 없습니다.');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);
  return result;
}

function checkIdentity(file, name, parent, mime) {
  if (!file?.id || file.name !== name || file.mimeType !== mime || file.trashed || !Array.isArray(file.parents) || !file.parents.includes(parent)) {
    fail('DASHBOARD_SOURCE_MISMATCH', '월집계 파일의 경로와 형식을 확인할 수 없습니다.');
  }
}

/** Reads only the current canonical month folder and Google Sheet. */
export async function loadDashboardMonth(month, { drive = createDrive(), mainFolderId = MAIN_FOLDER_ID, deadline = Date.now() + 45000 } = {}) {
  const resolved = resolveDashboardMonth(month);
  const monthName = `${resolved.slice(0, 4)}년 ${resolved.slice(5)}월`;
  const folders = await listAll(drive, `'${driveQueryString(mainFolderId)}' in parents and name = '${monthName}' and mimeType = '${FOLDER_MIME}' and trashed = false`, deadline);
  if (folders.length !== 1) fail(folders.length ? 'DASHBOARD_SOURCE_AMBIGUOUS' : 'DASHBOARD_SOURCE_MISSING', '월 폴더가 없거나 중복되었습니다.');
  checkIdentity(folders[0], monthName, mainFolderId, FOLDER_MIME);
  const name = `전체집계_${monthName}`;
  const files = await listAll(drive, `'${driveQueryString(folders[0].id)}' in parents and name = '${name}' and trashed = false`, deadline);
  if (files.length !== 1) fail(files.length ? 'DASHBOARD_SOURCE_AMBIGUOUS' : 'DASHBOARD_SOURCE_MISSING', '월집계 파일이 없거나 중복되었습니다.');
  const file = files[0];
  checkIdentity(file, name, folders[0].id, SHEET_MIME);
  if (!file.modifiedTime || !file.version) fail('DASHBOARD_SOURCE_UNVERIFIABLE', '월집계 파일의 버전을 확인할 수 없습니다.');
  const exported = await requestDrive(options => drive.files.export({ fileId: file.id, mimeType: XLSX_MIME }, { ...options, responseType: 'arraybuffer' }), deadline);
  const after = await requestDrive(options => drive.files.get({ fileId: file.id, fields: 'id,name,mimeType,parents,modifiedTime,version,trashed' }, options), deadline);
  checkIdentity(after?.data, name, folders[0].id, SHEET_MIME);
  if (file.version !== after.data.version || file.modifiedTime !== after.data.modifiedTime) fail('DASHBOARD_SOURCE_CHANGED', '조회 중 월집계가 변경되었습니다. 다시 조회해 주세요.');
  const monthAfter = await requestDrive(options => drive.files.get({ fileId: folders[0].id, fields: 'id,name,mimeType,parents,trashed' }, options), deadline);
  checkIdentity(monthAfter?.data, monthName, mainFolderId, FOLDER_MIME);
  let bytes;
  if (exported?.data instanceof ArrayBuffer) bytes = Buffer.from(exported.data);
  else if (exported?.data instanceof Uint8Array) bytes = Buffer.from(exported.data);
  else fail('DASHBOARD_WORKBOOK_INVALID', 'Drive가 XLSX 파일을 반환하지 않았습니다.');
  return { bytes, sheetModifiedTime: file.modifiedTime };
}

/** Dependency injection keeps contract tests independent of credentials and live Drive. */
export async function buildDashboardPayload({ month, role } = {}, { loadMonth = loadDashboardMonth, loadReports = async () => [], reviewPolicy } = {}) {
  const resolvedMonth = resolveDashboardMonth(month);
  const source = await loadMonth(resolvedMonth);
  const parsed = parseDashboardWorkbook(source?.bytes, { month: resolvedMonth, reviewPolicy });
  for (const team of parsed.teams) team.reports = await loadReports({ teamNames: team.names, month: resolvedMonth });
  const payload = { contractVersion: '1.0', month: resolvedMonth, role: role === 'owner' ? 'owner' : 'staff',
    generatedAt: new Date().toISOString(), sheetModifiedTime: source.sheetModifiedTime || null, ...parsed,
    trend: [{ month: resolvedMonth, total: parsed.totals.spent, byCategory: { ...parsed.byCategory } }] };
  if (role === 'owner') {
    payload.flags = [];
    payload.coDining = [];
    payload.analysisStatus = 'not_implemented';
  }
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_JSON_BYTES) fail('DASHBOARD_RESPONSE_TOO_LARGE', '월집계 자료가 조회 크기 한도를 넘었습니다.');
  return payload;
}
