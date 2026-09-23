import { Readable } from 'stream';
import crypto from 'crypto';
import { ALLOWED_ORIGINS } from './_cors.js';
import { applyCorsHeaders, checkOriginAllowed } from './_corsNode.js';
import { uploadRateLimiter } from './_rateLimiter.js';
import { jsonError, Errors } from './_errorHandler.js';
import { safeCompare } from './_auth.js';
import * as XLSX from 'xlsx';
import {
  ARCHIVE_FOLDER_NAME,
  createDrive,
  driveQueryString,
  getOrCreateFolder,
  getOrCreateFolderByNormalizedName,
  getWeekFolderName,
  getYearMonth,
  MAIN_FOLDER_ID,
  moveFileToParent,
} from './driveUtils.js';
import { sendKakaoNotification, sendKakaoNotifications } from './notify/kakao.js';
import { runMonthAggregate } from './aggregate.js';
import { acquireArtifactSubmissionLock, acquireSubmissionLock, releaseSubmissionLock, renewSubmissionLock } from './_submissionLock.js';
import { isSubmissionId, readSubmissionJob, reserveFinalSubmission, writeSubmissionJob, writeSubmissionJobIfLockOwned, submissionContractDigest } from './_submissionJob.js';
import { preflightFinalImage, resolveFinalImageEvidence } from './_imageEvidence.js';
import { preflightPdfChunk, processPdfEvidence } from './_pdfEvidence.js';
import { verifySubmissionDrive } from './_submissionDriveEvidence.js';
import { buildApprovalDuplicateReport } from './approvalReport.js';
import {
  buildKakaoChunks,
  formatWon,
  hasControlChars,
  KAKAO_TEXT_LIMIT,
  safeText,
  shorten,
} from './_uploadUtils.js';
// 정산서 PDF 조립은 이 프로젝트에서 가장 무거운 엔드포인트다(청크 다운로드 전량 + 최종 PDF 업로드).
export const config = { maxDuration: 60 };
const ARTIFACT_LOCK_TTL_SECONDS = config.maxDuration * 3;


function sumSafeAmounts(rows) {
  return (rows || []).reduce((total, row) => {
    const amount = Number(row?.amount || 0);
    const next = total + amount;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(next)) {
      const error = new Error('금액 합계가 안전한 정수 범위를 넘었습니다.');
      error.code = 'AMOUNT_OVERFLOW';
      throw error;
    }
    return next;
  }, 0);
}
const ORIGINALS_FOLDER_NAME = '_원본';
function readReceiptRowsFromXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows.map((row) => ({
    date: safeText(row['날짜']),
    useTime: safeText(row['사용시간']),
    storeName: safeText(row['사용처']),
    amount: Number(row['금액']) || 0,
    category: safeText(row['용도']),
    approvalNum: safeText(row['승인번호']),
    bizNum: safeText(row['사업자번호']),
    cardNumber: safeText(row['카드번호']),
    note: safeText(row['비고']),
  })).filter(row => row.date || row.storeName || row.amount);
}

/**
 * Final XLSX requests must be fully understood before they can reserve a
 * submission ID or mutate Drive.  Keeping this pure also makes the replay
 * gate independently testable.
 */
export function preflightXlsxSubmission({ xlsxBase64 }) {
  if (!xlsxBase64 || typeof xlsxBase64 !== 'string') {
    const error = new Error('xlsxBase64 데이터가 없습니다.')
    error.code = 'XLSX_MISSING'
    throw error
  }
  if (xlsxBase64.length > 20 * 1024 * 1024) {
    const error = new Error('xlsxBase64 데이터가 너무 큽니다.')
    error.code = 'XLSX_TOO_LARGE'
    throw error
  }

  const buffer = Buffer.from(xlsxBase64, 'base64')
  let rows
  try {
    rows = readReceiptRowsFromXlsx(buffer)
  } catch {
    const error = new Error('XLSX 파싱 실패')
    error.code = 'XLSX_PARSE_FAILED'
    throw error
  }
  if (rows.length === 0) {
    const error = new Error('빈 영수증 데이터입니다.')
    error.code = 'XLSX_EMPTY'
    throw error
  }
  sumSafeAmounts(rows)
  return {
    buffer,
    rows,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    receiptDuplicateReport: buildApprovalDuplicateReport(rows),
  }
}

function buildReceiptKakaoMessages({ fileName, surveyorName, mmdd, hhmm, rows, imageCount }) {
  const totalAmount = sumSafeAmounts(rows);
  const categoryTotals = rows.reduce((acc, row) => {
    const category = row.category || '기타';
    acc[category] = (acc[category] || 0) + row.amount;
    return acc;
  }, {});

  const summaryLines = [
    '📤 Drive 업로드',
    `파일: ${fileName}`,
    `작업자: ${surveyorName}`,
    `${mmdd} ${hhmm} KST`,
    `합계: ${rows.length}건 / ${formatWon(totalAmount)}`,
  ];

  const categoryLine = Object.entries(categoryTotals)
    .filter(([, amount]) => amount > 0)
    .map(([category, amount]) => `${category} ${formatWon(amount)}`)
    .join(', ');
  if (categoryLine) summaryLines.push(shorten(categoryLine, 80));
  if (imageCount > 0) summaryLines.push(`이미지 ${imageCount}장`);

  const detailLines = rows.map((row, index) => {
    const mmddDate = row.date?.includes('-') ? row.date.slice(5) : row.date;
    const main = `${index + 1}. ${mmddDate} ${shorten(row.storeName || '사용처 없음', 12)}`;
    const approvalTail = row.approvalNum ? ` 승인 ${shorten(row.approvalNum, 12)}` : '';
    return shorten(`${main} ${formatWon(row.amount)} ${row.category || '기타'}${approvalTail}`, 90);
  });

  return buildKakaoChunks(summaryLines, detailLines);
}

/**
 * Drive에 파일 업로드 (이름+크기+MD5 중복 체크 포함)
 * @returns {{status:'uploaded'|'updated'|'replaced', id:string|null}} 업로드 결과
 */
async function uploadFile(drive, buffer, fileName, folderId, mimeType = 'application/octet-stream') {
  // ── 중복 체크: 동일 이름 파일 조회
  const safeFileName = driveQueryString(fileName);
  const { data } = await drive.files.list({
    q: `'${folderId}' in parents and name = '${safeFileName}' and trashed = false`,
    fields: 'files(id, name, size, md5Checksum)',
  });

  if (data.files.length > 0) {
    const localMd5 = crypto.createHash('md5').update(buffer).digest('hex');
    const exactMatches = data.files.filter(file => Number(file.size) === buffer.length && file.md5Checksum === localMd5);

    // 이름 + 크기 + MD5 모두 일치 → 완전히 동일한 파일들만 정리한다.
    // 같은 이름이지만 내용이 다른 파일은 사용자가 의도적으로 남겼을 수 있으므로 건드리지 않는다.
    if (exactMatches.length > 0) {
      const created = await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: { mimeType, body: Readable.from(buffer) },
        fields: 'id,name,size',
      });

      for (const file of exactMatches) {
        await drive.files.update({ fileId: file.id, requestBody: { trashed: true } }).catch(() => {});
      }

      return {
        status: 'replaced',
        id: created.data.id,
        duplicateReason: 'same_name_size_md5_replaced',
        replacedExistingIds: exactMatches.map(file => file.id),
      };
    }

    const existing = data.files[0];

    // 내용이 달라진 경우 → 기존 파일을 삭제하지 않고 안전하게 덮어쓰기
    const updated = await drive.files.update({
      fileId: existing.id,
      requestBody: { name: fileName },
      media: { mimeType, body: Readable.from(buffer) },
      fields: 'id,name,size',
    });
    return {
      status: 'updated',
      id: updated.data.id,
      replacedExistingId: existing.id,
      duplicateReason: 'same_name_different_content',
    };
  }

  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,name,size',
  });
  return { status: 'uploaded', id: created.data.id };
}

const FINAL_XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const FINAL_XLSX_PROPERTIES = Object.freeze({
  submissionId: 'receiptSubmissionId',
  submissionKind: 'receiptSubmissionKind',
  sha256: 'receiptXlsxSha256',
})

export function buildFinalXlsxAppProperties({ submissionId, sha256 }) {
  return {
    [FINAL_XLSX_PROPERTIES.submissionId]: submissionId,
    [FINAL_XLSX_PROPERTIES.submissionKind]: 'final',
    [FINAL_XLSX_PROPERTIES.sha256]: sha256,
  }
}

function isMatchingFinalXlsxEvidence(file, { submissionId, sha256 }) {
  const properties = file?.appProperties || {}
  return properties[FINAL_XLSX_PROPERTIES.submissionId] === submissionId
    && properties[FINAL_XLSX_PROPERTIES.submissionKind] === 'final'
    && properties[FINAL_XLSX_PROPERTIES.sha256] === sha256
}

/**
 * A Drive file is the durable witness for a final XLSX upload. Redis can be
 * unavailable after Drive accepts the bytes, so a retry must find this witness
 * before it creates another XLSX. More than one witness is unsafe to guess.
 */
function md5ForBuffer(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

function isVerifiedFinalXlsxEvidence(file, { weekId, submissionId, sha256, md5, byteLength }) {
  return file?.trashed === false
    && file?.mimeType === FINAL_XLSX_MIME
    && Array.isArray(file?.parents)
    && file.parents.includes(weekId)
    // appProperties describe what the caller intended to upload.  They are
    // not proof that Drive retained the same bytes, so require Drive's
    // content checksum as well before recovering or accepting this witness.
    && Number(file?.size) === byteLength
    && file?.md5Checksum === md5
    && isMatchingFinalXlsxEvidence(file, { submissionId, sha256 })
}

/**
 * A Drive list response is only a hint: parent membership, MIME type and
 * trash state can change between listing and a retry. Read every candidate
 * back before using it as a durable submission witness. A malformed or
 * unreadable same-ID candidate is a conflict, never a reason to upload again.
 */
export async function findFinalXlsxEvidence(drive, { weekId, submissionId, sha256, buffer }) {
  const md5 = md5ForBuffer(buffer)
  const byteLength = buffer.length
  const safeSubmissionId = driveQueryString(submissionId)
  const candidates = []
  const seenPageTokens = new Set()
  let pageToken
  do {
    const response = await drive.files.list({
      // Do not restrict this query to the expected week or active files.
      // A same-submission witness in an archive, another week, or the trash
      // means Drive accepted part of this submission but its current state is
      // no longer safe to resume. Finding it globally lets us fail closed
      // before a retry creates a second XLSX or archives newer source files.
      q: `appProperties has { key='${FINAL_XLSX_PROPERTIES.submissionId}' and value='${safeSubmissionId}' }`,
      fields: 'incompleteSearch,nextPageToken,files(id)',
      pageSize: 1000,
      pageToken,
    })
    const data = response?.data
    const next = data?.nextPageToken
    if (!data || !Array.isArray(data.files)
      || (data.incompleteSearch !== undefined && data.incompleteSearch !== false)
      || data.files.some(file => typeof file?.id !== 'string' || !file.id.trim())
      || (next !== undefined && next !== null && (typeof next !== 'string' || !next.trim()))
      || (next && seenPageTokens.has(next))) {
      const error = new Error('Drive XLSX 증거 목록을 완전하게 확인하지 못했습니다.')
      error.code = 'XLSX_EVIDENCE_LIST_UNCONFIRMED'
      throw error
    }
    candidates.push(...data.files)
    if (next) seenPageTokens.add(next)
    pageToken = next
  } while (pageToken)

  const ids = candidates.map((file) => file?.id).filter(Boolean)
  if (ids.length !== candidates.length || new Set(ids).size !== ids.length) {
    const error = new Error('같은 제출 ID의 Drive XLSX 증거 목록이 불완전하거나 중복됩니다.')
    error.code = 'XLSX_EVIDENCE_AMBIGUOUS'
    error.details = { submissionId, fileIds: ids }
    throw error
  }

  const verified = []
  for (const id of ids) {
    let file
    try {
      const readback = await drive.files.get({
        fileId: id,
        fields: 'id,name,mimeType,parents,appProperties,trashed,size,md5Checksum',
      })
      file = readback.data
    } catch (cause) {
      const error = new Error('Drive XLSX 증거를 다시 읽지 못했습니다.')
      error.code = 'XLSX_EVIDENCE_UNCONFIRMED'
      error.details = { submissionId, fileId: id, cause: cause?.message || String(cause) }
      throw error
    }
    // All artifacts intentionally share the submission ID. Only a positively
    // identified non-XLSX artifact may be excluded from this XLSX witness scan.
    // Retained XLSX properties always take precedence over an artifact-kind tag.
    const properties = file?.appProperties
    if (file?.id === id && properties?.[FINAL_XLSX_PROPERTIES.submissionId] === submissionId
      && ['image', 'pdf', 'pdf-chunk'].includes(properties.receiptArtifactKind)
      && !Object.hasOwn(properties, FINAL_XLSX_PROPERTIES.sha256)) continue
    if (file?.id !== id || !isVerifiedFinalXlsxEvidence(file, {
      weekId, submissionId, sha256, md5, byteLength,
    })) {
      const error = new Error('같은 제출 ID의 Drive XLSX 증거가 현재 위치 또는 속성과 일치하지 않습니다.')
      error.code = 'XLSX_EVIDENCE_CONFLICT'
      error.details = { submissionId, fileId: id, readback: file || null }
      throw error
    }
    verified.push(file)
  }

  if (verified.length > 1) {
    const error = new Error('같은 제출 ID의 Drive XLSX 증거가 둘 이상입니다.')
    error.code = 'XLSX_EVIDENCE_AMBIGUOUS'
    error.details = { submissionId, fileIds: verified.map((file) => file.id) }
    throw error
  }
  return verified[0] || null
}

async function createFinalXlsxEvidence(drive, { buffer, fileName, weekId, submissionId, sha256 }) {
  const expectedProperties = buildFinalXlsxAppProperties({ submissionId, sha256 })
  const md5 = md5ForBuffer(buffer)
  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [weekId], appProperties: expectedProperties },
    media: { mimeType: FINAL_XLSX_MIME, body: Readable.from(buffer) },
    fields: 'id,name,mimeType,parents,appProperties',
  })
  const id = created.data?.id
  if (!id) {
    const error = new Error('새 XLSX 업로드 응답의 파일 ID를 확인하지 못했습니다.')
    error.code = 'XLSX_UPLOAD_UNCONFIRMED'
    throw error
  }

  // create 응답만으로 appProperties 저장을 확정할 수 없으므로 Drive에서 다시 읽는다.
  const readback = await drive.files.get({
    fileId: id,
    fields: 'id,name,mimeType,parents,appProperties,trashed,size,md5Checksum',
  })
  const file = readback.data
  if (file?.id !== id || !isVerifiedFinalXlsxEvidence(file, {
    weekId, submissionId, sha256, md5, byteLength: buffer.length,
  })) {
    const error = new Error('새 XLSX Drive 증거 속성의 읽기 확인에 실패했습니다.')
    error.code = 'XLSX_EVIDENCE_UNCONFIRMED'
    error.details = { uploadedXlsxId: id, readback: file || null }
    throw error
  }
  return { status: 'uploaded', id, evidence: file }
}

export async function resolveFinalXlsxEvidence(drive, options) {
  const found = await findFinalXlsxEvidence(drive, options)
  if (found) return { status: 'recovered', id: found.id, evidence: found }
  return createFinalXlsxEvidence(drive, options)
}

const GOOGLE_SHEET_MIME = 'application/vnd.google-apps.spreadsheet'

async function verifyCompletedReplayEvidence(drive, { job, weekId, monthId, submissionId, sha256, buffer }) {
  const xlsxFileId = job?.artifacts?.xlsx?.fileId || job?.response?.fileId
  const aggregateFileId = job?.artifacts?.aggregate?.fileId || job?.response?.aggregate?.fileId
  if (!xlsxFileId || !aggregateFileId || !weekId || !monthId) {
    const error = new Error('완료된 제출의 Drive 증거 위치를 확인할 수 없습니다.')
    error.code = 'COMPLETED_REPLAY_EVIDENCE_MISSING'
    throw error
  }

  const xlsxEvidence = await findFinalXlsxEvidence(drive, {
    weekId, submissionId, sha256, buffer,
  })
  if (!xlsxEvidence || xlsxEvidence.id !== xlsxFileId) {
    const error = new Error('완료된 제출의 XLSX 증거가 기록과 일치하지 않습니다.')
    error.code = 'COMPLETED_REPLAY_XLSX_MISMATCH'
    throw error
  }

  let aggregate
  try {
    const readback = await drive.files.get({ fileId: aggregateFileId, fields: 'id,mimeType,parents,trashed' })
    aggregate = readback.data
  } catch (cause) {
    const error = new Error('완료된 제출의 월집계 파일을 다시 읽지 못했습니다.')
    error.code = 'COMPLETED_REPLAY_AGGREGATE_UNCONFIRMED'
    error.details = { aggregateFileId, cause: cause?.message || String(cause) }
    throw error
  }
  if (aggregate?.id !== aggregateFileId
    || aggregate?.mimeType !== GOOGLE_SHEET_MIME
    || aggregate?.trashed !== false
    || !Array.isArray(aggregate?.parents)
    || !aggregate.parents.includes(monthId)) {
    const error = new Error('완료된 제출의 월집계 파일 위치 또는 상태가 기록과 일치하지 않습니다.')
    error.code = 'COMPLETED_REPLAY_AGGREGATE_CONFLICT'
    error.details = { aggregateFileId, readback: aggregate || null }
    throw error
  }
}

async function archivePreviousXlsxFiles(drive, weekId, archiveId, newFileId) {
  const files = []
  let pageToken
  do {
    const oldFiles = await drive.files.list({
      q: `'${weekId}' in parents and name contains '출장비' and name contains '.xlsx' and trashed = false`,
      fields: 'nextPageToken,files(id,name)',
      pageSize: 1000,
      pageToken,
    })
    files.push(...(oldFiles.data.files || []))
    pageToken = oldFiles.data.nextPageToken
  } while (pageToken)
  for (const file of files) {
    if (file.id === newFileId) continue
    let moved
    try {
      moved = await moveFileToParent(drive, file.id, weekId, archiveId)
    } catch (cause) {
      const error = new Error('기존 XLSX를 보관함으로 옮기지 못해 월집계를 중단했습니다.')
      error.code = 'XLSX_ARCHIVE_UNCONFIRMED'
      error.details = { uploadedXlsxId: newFileId, failedOldFileId: file.id, cause: cause.message }
      throw error
    }
    const parents = moved.data?.parents || []
    if (moved.data?.id !== file.id || !parents.includes(archiveId) || parents.includes(weekId)) {
      const error = new Error('기존 XLSX 보관 처리 응답을 확인하지 못해 월집계를 중단했습니다.')
      error.code = 'XLSX_ARCHIVE_UNCONFIRMED'
      error.details = { uploadedXlsxId: newFileId, failedOldFileId: file.id, response: moved.data || null }
      throw error
    }
  }
}

async function assertOnlyUploadedXlsxIsActive(drive, weekId, newFileId) {
  const activeIds = []
  let pageToken
  do {
    const response = await drive.files.list({
      q: `'${weekId}' in parents and name contains '출장비' and name contains '.xlsx' and trashed = false`,
      fields: 'nextPageToken,files(id,name)',
      pageSize: 1000,
      pageToken,
    })
    activeIds.push(...(response.data.files || []).map(file => file.id))
    pageToken = response.data.nextPageToken
  } while (pageToken)
  if (activeIds.length !== 1 || activeIds[0] !== newFileId) {
    const error = new Error('월집계 직전 활성 XLSX가 변경되어 집계를 중단했습니다.')
    error.code = 'XLSX_SOURCE_SET_CHANGED'
    error.details = { uploadedXlsxId: newFileId, activeXlsxIds: activeIds }
    throw error
  }
}

export { archivePreviousXlsxFiles, assertOnlyUploadedXlsxIsActive }

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
  // CORS 헤더 설정 (OPTIONS 요청 자동 처리)
  const corsResult = applyCorsHeaders(req, res);
  if (corsResult === true) return; // OPTIONS 처리됨

  const origin = req.headers.origin || '';
  if (!checkOriginAllowed(req, res)) return; // 출처 검증 (프로덕션만)

  if (req.method !== 'POST') return jsonError(res, Errors.methodNotAllowed());

  // ── 호출 빈도 제한
  // 정산서 PDF 청크는 xlsx 요청으로 이미 한 번 게이트된 단일 논리 작업의 일부이고 업로드당 ≤20으로 유계라 카운트 제외.
  if (req.body?.isPdfChunk !== true) {
    const rateKey = origin || 'unknown';
    const rate = uploadRateLimiter(rateKey);
    if (!rate.ok) {
      return jsonError(res, Errors.rateLimit(rate.retryAfterSec));
    }
  }

  // ── 브라우저 번들에 비밀 토큰을 넣지 않는다.
  // Authorization이 있는 서버 간 호출은 검증하되, 앱 브라우저 호출은 위 출처 검증과 입력 검증으로 보호한다.
  const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN;
  const authHeader = req.headers['authorization'] || '';
  if (authHeader) {
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!UPLOAD_TOKEN || !safeCompare(provided, UPLOAD_TOKEN)) {
      return jsonError(res, Errors.unauthorized('유효하지 않은 토큰입니다.'));
    }
  }

  let submissionLock = null;
  let artifactSubmissionLock = null;
  let finalJob = null;
  let finalJobReserved = false;
  try {
    const {
      surveyorName, reportDate, xlsxBase64, images, isImageOnly, receiptSummary,
      teamId, teamNames, tripStartDate, tripEndDate,
      isPdfChunk, reportId, chunkIndex, chunkCount, chunkBase64,
      submissionId, submissionKind, expected,
      isFinalizeOnly,
    } = req.body;

    // Finalization is read-only with respect to Drive. Reject mixed payloads
    // before the default XLSX branch can reserve or mutate anything.
    if (isFinalizeOnly !== undefined && typeof isFinalizeOnly !== 'boolean') {
      return res.status(400).json({ type: 'completion', submissionId, complete: false, success: false, error: 'INVALID_FINALIZATION_REQUEST' });
    }
    if (isFinalizeOnly === true) {
      const failure = (status, error) => res.status(status).json({ type: 'completion', submissionId, complete: false, success: false, error });
      if (submissionKind !== 'final' || !isSubmissionId(submissionId)
        || ['isImageOnly', 'isPdfChunk', 'xlsxBase64', 'images', 'chunkBase64', 'chunkIndex', 'chunkCount', 'reportId', 'expected'].some(key => Object.hasOwn(req.body, key))) {
        return failure(400, 'INVALID_FINALIZATION_REQUEST');
      }
      try {
        const candidate = await readSubmissionJob({ submissionId });
        const validate = job => {
          if (!job || job.id !== submissionId || job.kind !== 'final') throw new Error('SUBMISSION_JOB_UNCONFIRMED');
          if (job.schemaVersion !== 2 || !job.expected) throw new Error('LEGACY_SUBMISSION_RESTART_REQUIRED');
          if (job.contractDigest !== submissionContractDigest(job)) throw new Error('SUBMISSION_CONTRACT_CONFLICT');
          if (typeof surveyorName !== 'string' || typeof reportDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)
            || (tripStartDate !== undefined && (typeof tripStartDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tripStartDate)))
            || job.scope.surveyorName !== surveyorName || job.scope.yearMonth !== getYearMonth(reportDate)
            || job.scope.weekFolderName !== getWeekFolderName(tripStartDate || reportDate)) throw new Error('SUBMISSION_SCOPE_CONFLICT');
          if (!Number.isSafeInteger(job.revision) || job.revision < 1 || job.status !== 'xlsx_response_ready') throw new Error('SUBMISSION_NOT_READY');
        };
        validate(candidate);
        submissionLock = await acquireSubmissionLock({ yearMonth: candidate.scope.yearMonth, ttlSeconds: ARTIFACT_LOCK_TTL_SECONDS });
        if (!submissionLock.acquired) return failure(409, 'SUBMISSION_IN_PROGRESS');
        artifactSubmissionLock = await acquireArtifactSubmissionLock({ submissionId, ttlSeconds: ARTIFACT_LOCK_TTL_SECONDS });
        if (!artifactSubmissionLock.acquired) return failure(409, 'SUBMISSION_IN_PROGRESS');
        const job = await readSubmissionJob({ submissionId });
        validate(job);
        if (job.contractDigest !== candidate.contractDigest || job.revision !== candidate.revision) return failure(409, 'SUBMISSION_REVISION_CONFLICT');
        const assertOwned = async () => {
          if (!await renewSubmissionLock(submissionLock) || !await renewSubmissionLock(artifactSubmissionLock)) throw new Error('SUBMISSION_LOCK_LOST');
        };
        await assertOwned();
        const observation = await verifySubmissionDrive(createDrive(), { job, mainId: MAIN_FOLDER_ID, assertOwned });
        if (!observation || typeof observation.currentAggregateFileId !== 'string' || !observation.currentAggregateFileId
          || observation.receiptCount !== job.expected?.receiptCount || observation.totalAmount !== job.expected?.totalAmount
          || !Number.isSafeInteger(observation.aggregateCount) || observation.aggregateCount < observation.receiptCount
          || !Number.isSafeInteger(observation.aggregateTotal)) throw new Error('COMPLETION_OBSERVATION_UNCONFIRMED');
        await assertOwned();
        const nextJob = { ...job, revision: job.revision + 1, completion: { ...observation, observedAt: new Date().toISOString(), revision: job.revision + 1 } };
        const written = await writeSubmissionJobIfLockOwned({ submissionId, job: nextJob, expectedRevision: job.revision,
          lock: artifactSubmissionLock, monthLock: submissionLock });
        if (!written.written) return failure(409, `SUBMISSION_STATE_WRITE_REJECTED: ${written.reason}`);
        return res.status(200).json({ success: true, type: 'completion', submissionId, complete: true, revision: nextJob.revision });
      } catch (error) {
        return failure(error.code === 'KV_UNAVAILABLE' ? 503 : 409, error.code || error.message || 'COMPLETION_UNCONFIRMED');
      }
    }
    const contentLength = Number(req.headers['content-length'] || 0);
    if (contentLength > 25 * 1024 * 1024) {
      return jsonError(res, Errors.badRequest('요청이 너무 큽니다.'));
    }

    // ── 입력 검증 (서버측) — 클라이언트만 믿지 않고 한 번 더 검사
    if (!surveyorName || typeof surveyorName !== 'string') {
      return jsonError(res, Errors.badRequest('담당자 이름(surveyorName)이 없습니다.'));
    }
    if (surveyorName.length > 80) {
      return jsonError(res, Errors.badRequest('담당자 이름이 너무 깁니다 (최대 80자).'));
    }
    // 경로 분리자/제어문자 차단 — Drive 폴더 경로 조작 방지
    if (/[\\/:*?"<>|]/.test(surveyorName) || hasControlChars(surveyorName)) {
      return jsonError(res, Errors.badRequest('담당자 이름에 사용할 수 없는 문자가 포함됨.'));
    }
    if (reportDate && (typeof reportDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate))) {
      return jsonError(res, Errors.badRequest('reportDate 형식 오류 (YYYY-MM-DD 필요).'));
    }
    for (const [field, value] of Object.entries({ tripStartDate, tripEndDate })) {
      if (value && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))) {
        return jsonError(res, Errors.badRequest(`${field} 형식 오류 (YYYY-MM-DD 필요).`));
      }
    }
    if (teamId !== undefined && teamId !== null && !['string', 'number'].includes(typeof teamId)) {
      return jsonError(res, Errors.badRequest('teamId 형식 오류.'));
    }
    if (teamNames !== undefined && teamNames !== null && typeof teamNames !== 'string') {
      return jsonError(res, Errors.badRequest('teamNames 형식 오류.'));
    }
    if (receiptSummary && typeof receiptSummary !== 'object') {
      return jsonError(res, Errors.badRequest('receiptSummary 형식 오류.'));
    }
    if (submissionKind !== undefined && submissionKind !== 'final') {
      return jsonError(res, Errors.badRequest('submissionKind 형식 오류.'));
    }

    if ((isImageOnly !== undefined && typeof isImageOnly !== 'boolean')
      || (isPdfChunk !== undefined && typeof isPdfChunk !== 'boolean') || (isImageOnly && isPdfChunk)) {
      return jsonError(res, Errors.badRequest('전송 종류 형식 오류.'));
    }

    // ── 최종 XLSX는 Drive를 건드리기 전에 내용을 검증하고 제출 ID를 예약한다.
    // 이 순서가 지켜져야 재생·충돌 요청이 폴더 생성이나 기존 자료 이동을 유발하지 않는다.
    const yearMonth = getYearMonth(reportDate);
    const today = new Date().toLocaleDateString('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).replace(/\. /g, '').replace('.', '').replace(/\s/g, '');
    const weekFolderName = getWeekFolderName(tripStartDate || reportDate || today);
    const isXlsxRequest = !isImageOnly && !isPdfChunk;
    let xlsxPreflight = null;
    if (isXlsxRequest) {
      if (submissionKind !== 'final' || !isSubmissionId(submissionId)
        || !expected || typeof expected !== 'object' || Array.isArray(expected)) {
        return jsonError(res, Errors.badRequest('최종 XLSX 제출에는 유효한 submissionId와 산출물 계약이 필요합니다.'));
      }
      try {
        xlsxPreflight = preflightXlsxSubmission({ xlsxBase64 });
      } catch (error) {
        if (error.code === 'XLSX_TOO_LARGE') {
          return jsonError(res, { statusCode: 413, error: 'PAYLOAD_TOO_LARGE', message: error.message });
        }
        if (error.code === 'XLSX_EMPTY') {
          return res.status(400).json({
            success: false,
            error: error.message,
            detail: '업로드할 영수증이 0건입니다. 기존 집계 파일을 보호하기 위해 거부했습니다.',
          });
        }
        if (error.code === 'AMOUNT_OVERFLOW') {
          return res.status(400).json({ success: false, error: 'AMOUNT_OVERFLOW', detail: '금액 합계가 안전한 정수 범위를 넘어 업로드하지 않았습니다.' });
        }
        return jsonError(res, Errors.badRequest(error.message));
      }

      if (submissionKind === 'final') {
        try {
          finalJob = await reserveFinalSubmission({
            submissionId,
            xlsxSha256: xlsxPreflight.sha256,
            scope: { yearMonth, surveyorName, weekFolderName },
            expected,
          });
        } catch (error) {
          if (error instanceof TypeError) return jsonError(res, Errors.badRequest(error.message));
          throw error;
        }
        if (finalJob.state === 'conflict') {
          if (finalJob.job && (finalJob.job.schemaVersion !== 2 || !finalJob.job.expected)) {
            return res.status(409).json({ success: false, error: 'LEGACY_SUBMISSION_RESTART_REQUIRED' });
          }
          return res.status(409).json({ success: false, error: 'SUBMISSION_ID_CONFLICT' });
        }
        // A processing record can be left behind when Drive accepted the XLSX
        // but the function died before Redis received the response.  Do not
        // create a second file here: after acquiring the month lock we search
        // Drive for the signed evidence and resume only from that evidence.
        // The lock still rejects a genuinely concurrent request below.
        // 실패한 집계 응답은 재생하지 않는다. 같은 제출 ID가 다시 집계를 시도할 수 있어야 한다.
        finalJobReserved = finalJob.state === 'reserved';
      }
    }

    let pdfChunkBuffer = null;
    if (isPdfChunk) {
      if (submissionKind !== 'final' || !isSubmissionId(submissionId)) {
        return jsonError(res, Errors.badRequest('PDF 제출에는 유효한 submissionId가 필요합니다.'));
      }
      artifactSubmissionLock = await acquireArtifactSubmissionLock({ submissionId, ttlSeconds: ARTIFACT_LOCK_TTL_SECONDS });
      if (!artifactSubmissionLock.acquired) {
        return res.status(409).json({ success: false, error: 'SUBMISSION_IN_PROGRESS' });
      }
      const job = await readSubmissionJob({ submissionId });
      if (!job) return res.status(409).json({ success: false, error: 'SUBMISSION_JOB_NOT_FOUND' });
      if (job.schemaVersion !== 2 || !job.expected?.pdf) {
        return res.status(409).json({ success: false, error: 'LEGACY_SUBMISSION_RESTART_REQUIRED' });
      }
      if (job.id !== submissionId || job.scope?.yearMonth !== yearMonth
        || job.scope?.surveyorName !== surveyorName || job.scope?.weekFolderName !== weekFolderName) {
        return res.status(409).json({ success: false, error: 'SUBMISSION_SCOPE_CONFLICT' });
      }
      if (submissionContractDigest(job) !== job.contractDigest) {
        return res.status(409).json({ success: false, error: 'SUBMISSION_CONTRACT_CONFLICT' });
      }
      if (job.artifacts?.xlsx?.status !== 'confirmed' || !job.response?.folders?.weekId) {
        return res.status(409).json({ success: false, error: 'SUBMISSION_XLSX_NOT_CONFIRMED' });
      }
      try {
        pdfChunkBuffer = preflightPdfChunk({ reportId, chunkIndex, chunkCount, chunkBase64, expected: job.expected.pdf });
      } catch (error) {
        return jsonError(res, Errors.badRequest(error.message));
      }
      finalJob = { state: 'existing', job };
    }

    let finalImagePreflight = null;
    if (isImageOnly) {
      if (submissionKind !== 'final' || !isSubmissionId(submissionId) || !Array.isArray(images) || images.length !== 1) {
        return jsonError(res, Errors.badRequest('최종 원본 이미지는 유효한 submissionId와 이미지 한 장이 필요합니다.'));
      }
      const candidateJob = await readSubmissionJob({ submissionId });
      if (!candidateJob) return res.status(409).json({ success: false, error: 'SUBMISSION_JOB_NOT_FOUND' });
      if (candidateJob.schemaVersion !== 2 || !candidateJob.expected) {
        return res.status(409).json({ success: false, error: 'LEGACY_SUBMISSION_RESTART_REQUIRED' });
      }
      if (candidateJob.scope?.yearMonth !== yearMonth || candidateJob.scope?.surveyorName !== surveyorName || candidateJob.scope?.weekFolderName !== weekFolderName) {
        return res.status(409).json({ success: false, error: 'SUBMISSION_SCOPE_CONFLICT' });
      }
      const expectedImage = candidateJob.expected.images?.find(item => item.key === images[0]?.key);
      if (!expectedImage) return res.status(409).json({ success: false, error: 'SUBMISSION_IMAGE_NOT_EXPECTED' });
      try {
        finalImagePreflight = preflightFinalImage({ image: images[0], expected: expectedImage });
      } catch (error) {
        return jsonError(res, Errors.badRequest(error.message));
      }
      artifactSubmissionLock = await acquireArtifactSubmissionLock({ submissionId, ttlSeconds: ARTIFACT_LOCK_TTL_SECONDS });
      if (!artifactSubmissionLock.acquired) {
        return res.status(409).json({ success: false, error: 'SUBMISSION_IN_PROGRESS', retryAfterSec: artifactSubmissionLock.ttlSeconds });
      }
      const lockedJob = await readSubmissionJob({ submissionId });
      if (!lockedJob || lockedJob.contractDigest !== candidateJob.contractDigest || lockedJob.revision !== candidateJob.revision) {
        return res.status(409).json({ success: false, error: 'SUBMISSION_REVISION_CONFLICT' });
      }
      finalJob = { state: 'existing', job: lockedJob };
    }

    // ── 폴더 경로: MAIN / YYYY년 MM월 / 담당자이름 / YYYY-MM-DD~YYYY-MM-DD
    if (isXlsxRequest) {
      submissionLock = await acquireSubmissionLock({ yearMonth });
      if (!submissionLock.acquired) {
        if (finalJobReserved && finalJob?.job?.schemaVersion !== 2) {
          await writeSubmissionJob({
            submissionId: finalJob.job.id,
            job: {
              ...finalJob.job,
              status: 'failed',
              failedAt: new Date().toISOString(),
              error: { code: 'SUBMISSION_LOCK_UNAVAILABLE', message: '같은 월의 다른 제출을 처리 중입니다.' },
            },
          }).catch((jobWriteError) => {
            console.error('Submission job lock failure state write failed:', jobWriteError.message);
          });
          finalJobReserved = false;
        }
        return res.status(409).json({ success: false, error: 'SUBMISSION_IN_PROGRESS', retryAfterSec: submissionLock.ttlSeconds });
      }
      if (finalJob?.job?.schemaVersion === 2) {
        artifactSubmissionLock = await acquireArtifactSubmissionLock({ submissionId, ttlSeconds: ARTIFACT_LOCK_TTL_SECONDS });
        if (!artifactSubmissionLock.acquired) {
          return res.status(409).json({ success: false, error: 'SUBMISSION_IN_PROGRESS', retryAfterSec: artifactSubmissionLock.ttlSeconds });
        }
        const lockedJob = await readSubmissionJob({ submissionId });
        if (!lockedJob || lockedJob.contractDigest !== finalJob.job.contractDigest || lockedJob.revision !== finalJob.job.revision) {
          return res.status(409).json({ success: false, error: 'SUBMISSION_REVISION_CONFLICT' });
        }
        finalJob = { ...finalJob, job: lockedJob };
      }
      // A previously processing job is now exclusively owned by this request:
      // errors from the recovery attempt must not leave it stuck forever.
      if (finalJob?.state === 'processing') finalJobReserved = true;
    }
    const drive = createDrive();

    if (isPdfChunk) {
      const job = finalJob.job;
      const assertOwned = async () => {
        if (!await renewSubmissionLock(artifactSubmissionLock)) {
          throw new Error('SUBMISSION_LOCK_LOST');
        }
      };
      await assertOwned();
      // Reuse the XLSX destination and verify the entire saved folder chain.
      // Missing or moved folders must never be silently recreated on PDF retry.
      const { monthId, personId, weekId } = job.response.folders;
      for (const [fileId, parentId] of [[monthId, MAIN_FOLDER_ID], [personId, monthId], [weekId, personId]]) {
        if (!fileId || !parentId) throw new Error('PDF_DESTINATION_UNCONFIRMED');
        const { data } = await drive.files.get({ fileId, fields: 'id,mimeType,parents,trashed' });
        if (data?.id !== fileId || data.trashed !== false || data.mimeType !== 'application/vnd.google-apps.folder'
          || data.parents?.length !== 1 || data.parents[0] !== parentId) throw new Error('PDF_DESTINATION_CONFLICT');
      }
      const pdfName = `정산서_${surveyorName}_${weekFolderName}.pdf`;
      const result = await processPdfEvidence(drive, {
        submissionId, expected: job.expected.pdf, chunkIndex, buffer: pdfChunkBuffer, weekId, pdfName, assertOwned,
        expectedFileId: job.artifacts?.pdf?.fileId,
      });
      await assertOwned();
      const previousPdf = job.artifacts?.pdf || {};
      const pdfState = result.assembled
        ? { ...previousPdf, status: 'confirmed', fileId: result.id, sha256: job.expected.pdf.sha256,
            byteLength: job.expected.pdf.byteLength }
        : { ...previousPdf, status: 'processing', chunks: {
            ...previousPdf.chunks, [chunkIndex]: { status: 'confirmed', sha256: job.expected.pdf.chunkSha256[chunkIndex] },
          } };
      // Record intent before optional notification. Recovery never repeats an uncertain send.
      const notify = result.assembled && result.status === 'uploaded' && !previousPdf.notification;
      if (notify) pdfState.notification = { status: 'sending' };
      else if (pdfState.notification?.status === 'sending') pdfState.notification = { status: 'unknown' };
      let nextJob = { ...job, revision: job.revision + 1, artifacts: { ...job.artifacts, pdf: pdfState } };
      const save = async (updated, revision) => {
        const written = await writeSubmissionJobIfLockOwned({ submissionId, job: updated,
          expectedRevision: revision, lock: artifactSubmissionLock });
        if (!written.written) throw new Error(`SUBMISSION_STATE_WRITE_REJECTED: ${written.reason}`);
      };
      await save(nextJob, job.revision);
      if (notify) {
        await assertOwned();
        let notification;
        try {
          const sent = await sendKakaoNotification(`📄 정산서 PDF 생성됨\n파일: ${pdfName}\n작업자: ${surveyorName}`);
          notification = { status: sent === true ? 'confirmed' : sent === false ? 'failed' : 'unknown' };
        } catch {
          notification = { status: 'unknown' };
        }
        const notifiedJob = { ...nextJob, revision: nextJob.revision + 1,
          artifacts: { ...nextJob.artifacts, pdf: { ...pdfState, notification } } };
        await save(notifiedJob, nextJob.revision);
        nextJob = notifiedJob;
      }
      return res.status(200).json({
        success: true, type: 'pdf', assembled: result.assembled, received: chunkIndex,
        submissionId, reportId, revision: nextJob.revision, fileId: result.id || null,
        uploadStatus: result.status, file: pdfName,
        kakaoSent: nextJob.artifacts.pdf.notification?.status === 'confirmed',
        kakaoStatus: nextJob.artifacts.pdf.notification?.status || 'not_sent',
      });
    }

    // Redis 완료 상태도 현재 Drive 증거가 모두 확인된 경우에만 재생한다.
    // 확인할 ID가 없는 구형 작업은 성공으로 추정하지 않고 어떤 자료도 덮지 않는다.
    if (isXlsxRequest
      && finalJob?.state === 'existing'
      && finalJob.job?.status === 'xlsx_response_ready'
      && finalJob.job?.response?.success === true) {
      await verifyCompletedReplayEvidence(drive, {
        job: finalJob.job,
        weekId: finalJob.job.response?.folders?.weekId,
        monthId: finalJob.job.response?.folders?.monthId,
        submissionId,
        sha256: xlsxPreflight.sha256,
        buffer: xlsxPreflight.buffer,
      });
      return res.status(200).json({ ...finalJob.job.response, replay: true });
    }

    const monthId   = await getOrCreateFolder(drive, yearMonth,    MAIN_FOLDER_ID);
    const personId  = await getOrCreateFolderByNormalizedName(drive, surveyorName, monthId);
    const archiveId  = await getOrCreateFolder(drive, ARCHIVE_FOLDER_NAME, personId);
    const weekId     = await getOrCreateFolder(drive, weekFolderName, personId);
    const targetPath = `영수증정산관리/${yearMonth}/${surveyorName}/${weekFolderName}`;


    if (!isImageOnly) {
      // ── XLSX 업로드
      const { buffer: xlsxBuffer, rows: parsedRows, receiptDuplicateReport } = xlsxPreflight;

      const xlsxName   = `출장비_${today}.xlsx`;

      const xlsxResult = await resolveFinalXlsxEvidence(drive, {
        buffer: xlsxBuffer,
        fileName: xlsxName,
        weekId,
        submissionId,
        sha256: xlsxPreflight.sha256,
      });

      // 새 증거가 읽기 확인된 뒤에만 기존 person 루트 자료를 보관한다.
      // 응답 유실 복구(recovered)는 과거 제출을 다시 정리하지 않아야 한다.
      if (xlsxResult.status !== 'recovered') {
        const legacyRes = await drive.files.list({
          q: `'${personId}' in parents and trashed = false`,
          fields: 'files(id,name,mimeType)',
          pageSize: 200,
        });
        for (const item of legacyRes.data.files || []) {
          if (item.id === weekId || item.id === archiveId) continue;
          await moveFileToParent(drive, item.id, personId, archiveId).catch(() => {});
        }
      }

      // ── 새 출장비 파일이 안전하게 존재한 뒤, 예전 출장비 파일은 보관함으로 이동
      await archivePreviousXlsxFiles(drive, weekId, archiveId, xlsxResult.id)
      await assertOnlyUploadedXlsxIsActive(drive, weekId, xlsxResult.id)

      // ── 월별 전체집계 자동 업데이트
      // skipped도 이전 요청의 집계 성공을 보장하지 않으므로 실제 집계를 다시 확인한다.
      let aggregateResult = null;
      try {
        aggregateResult = await runMonthAggregate(drive, monthId, yearMonth);
      } catch (aggErr) {
        console.warn('월집계 실패 (업로드는 성공):', aggErr.message);
        aggregateResult = { success: false, error: aggErr.message };
      }

      // ── 카카오톡 알림
      let kakaoSent = false;
      let kakaoError = null;
      try {
        const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
        const mmdd   = `${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}-${String(kstNow.getUTCDate()).padStart(2, '0')}`;
        const hhmm   = `${String(kstNow.getUTCHours()).padStart(2, '0')}:${String(kstNow.getUTCMinutes()).padStart(2, '0')}`;

        if (xlsxResult.status !== 'skipped') {
          const kakaoMessages = buildReceiptKakaoMessages({
            fileName: xlsxName,
            surveyorName,
            mmdd,
            hhmm,
            rows: parsedRows,
            imageCount: receiptSummary?.imageCount || 0,
          });
          kakaoSent = (await sendKakaoNotifications(kakaoMessages)) !== false;
        } else {
          // 이미 동일한 파일이 드라이브에 존재 → 새 업로드 없음을 통보
          kakaoSent = (await sendKakaoNotification(
            `⚠️ 중복 전송 시도\n작업자: ${surveyorName}\n${mmdd} ${hhmm} KST\n이미 전송된 동일 파일 — 새 업로드 없음`
          )) !== false;
        }
      } catch (kakaoErr) {
        kakaoError = kakaoErr.message;
        console.warn('카카오 알림 실패 (업로드는 성공):', kakaoErr.message);
      }

      const response = {
        success: aggregateResult?.success === true,
        type: 'xlsx',
        file: xlsxName,
        skipped: xlsxResult.status === 'skipped',
        uploadStatus: xlsxResult.status,
        duplicateReason: xlsxResult.duplicateReason || null,
        fileId: xlsxResult.id,
        targetPath,
        folders: {
          mainId: MAIN_FOLDER_ID,
          monthId,
          personId,
          weekId,
          archiveId,
        },
        uploadContext: {
          teamId: teamId ?? null,
          teamNames: teamNames || surveyorName,
          tripStartDate: tripStartDate || reportDate || null,
          tripEndDate: tripEndDate || null,
        },
        receiptDuplicateReport,
        aggregate: aggregateResult,
        kakaoSent,
        kakaoError,
      };
      // A final XLSX acknowledgement belongs to one persisted submission job.
      // The client must reject a response that cannot prove that ownership.
      if (finalJob?.job?.schemaVersion === 2) {
        response.submissionId = finalJob.job.id;
        response.revision = finalJob.job.revision + 1;
      }
      if (finalJob) {
        const nextJob = {
            ...finalJob.job,
            ...(finalJob.job.schemaVersion === 2 ? { revision: finalJob.job.revision + 1 } : {}),
            status: response.success ? 'xlsx_response_ready' : 'failed',
            artifacts: {
              ...finalJob.job.artifacts,
              xlsx: { status: 'confirmed', fileId: xlsxResult.id, sha256: finalJob.job.xlsxSha256 },
              aggregate: response.success ? { status: 'confirmed', fileId: aggregateResult.fileId } : { status: 'failed', error: aggregateResult?.error || 'AGGREGATE_UNCONFIRMED' },
              kakao: kakaoSent ? { status: 'confirmed' } : { status: 'failed', error: kakaoError || 'KAKAO_UNCONFIRMED' },
            },
            response,
          };
        if (finalJob.job.schemaVersion === 2) {
          const written = await writeSubmissionJobIfLockOwned({
            submissionId,
            job: nextJob,
            expectedRevision: finalJob.job.revision,
            lock: artifactSubmissionLock,
          });
          if (!written.written) {
            const error = new Error(`submission XLSX state write rejected: ${written.reason}`);
            error.code = 'SUBMISSION_STATE_WRITE_REJECTED';
            throw error;
          }
        } else {
          await writeSubmissionJob({ submissionId, job: nextJob });
        }
        finalJobReserved = false;
      }
      return res.status(response.success ? 200 : 502).json(response);
    }

    // ── 이미지 업로드
    if (!images || images.length === 0) return jsonError(res, Errors.badRequest('이미지 데이터가 없습니다.'));
    if (images.length > 30) {
      return jsonError(res, { statusCode: 413, error: 'PAYLOAD_TOO_LARGE', message: '이미지 개수가 너무 많습니다.' });
    }
    // 이미지별 입력 검증
    const ALLOWED_IMG_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
    const MAX_DECODED_SIZE = 8 * 1024 * 1024; // 8MB per image
    for (const img of images) {
      if (!img || typeof img !== 'object') {
        return jsonError(res, Errors.badRequest('이미지 항목 형식 오류.'));
      }
      if (!img.dataUrl || typeof img.dataUrl !== 'string') {
        return jsonError(res, Errors.badRequest('이미지 dataUrl이 없습니다.'));
      }
      if (!img.filename || typeof img.filename !== 'string' || img.filename.length > 160) {
        return jsonError(res, Errors.badRequest('이미지 파일명 누락 또는 너무 김.'));
      }
      if (/[\\/:*?"<>|]/.test(img.filename) || hasControlChars(img.filename)) {
        return jsonError(res, Errors.badRequest('이미지 파일명에 사용할 수 없는 문자.'));
      }
      // MIME 화이트리스트 (data:image/jpeg;base64,... 패턴)
      const mimeMatch = img.dataUrl.match(/^data:([^;]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      if (!ALLOWED_IMG_MIMES.includes(mime)) {
        return jsonError(res, Errors.unsupportedMediaType(`지원하지 않는 이미지 형식: ${mime}`));
      }
      // base64 디코딩 후 실제 크기 검증 (length * 0.75 근사)
      const base64Part = img.dataUrl.includes(',') ? img.dataUrl.split(',')[1] : img.dataUrl;
      const approxDecodedSize = Math.floor(base64Part.length * 0.75);
      if (approxDecodedSize > MAX_DECODED_SIZE) {
        return jsonError(res, { statusCode: 413, error: 'PAYLOAD_TOO_LARGE', message: `이미지가 너무 큽니다 (최대 ${MAX_DECODED_SIZE / 1024 / 1024}MB).` });
      }
    }
    // ── 낱장 영수증 사진은 담당자 눈에 안 띄는 하위폴더 _원본/ 에 저장 (Drive 복원 기능 전용)
    const originalsId = await getOrCreateFolder(drive, ORIGINALS_FOLDER_NAME, weekId);
    if (finalImagePreflight && finalJob?.job) {
      const stillOwned = await renewSubmissionLock(artifactSubmissionLock);
      if (!stillOwned) {
        const error = new Error('submission image lock ownership was lost before Drive write');
        error.code = 'SUBMISSION_LOCK_LOST';
        throw error;
      }
      const result = await resolveFinalImageEvidence(drive, {
        originalsId,
        submissionId,
        evidence: finalImagePreflight,
      });
      const confirmed = { ...(finalJob.job.artifacts?.images?.confirmed || {}) };
      confirmed[finalImagePreflight.key] = {
        fileId: result.id,
        sha256: finalImagePreflight.sha256,
        byteLength: finalImagePreflight.byteLength,
        mimeType: finalImagePreflight.mimeType,
      };
      const imagesComplete = finalJob.job.expected.images.every(item => confirmed[item.key]?.sha256 === item.sha256);
      const nextJob = {
        ...finalJob.job,
        revision: finalJob.job.revision + 1,
        artifacts: {
          ...finalJob.job.artifacts,
          images: { status: imagesComplete ? 'confirmed' : 'processing', confirmed },
        },
      };
      const written = await writeSubmissionJobIfLockOwned({
        submissionId,
        job: nextJob,
        expectedRevision: finalJob.job.revision,
        lock: artifactSubmissionLock,
      });
      if (!written.written) {
        const error = new Error(`submission image state write rejected: ${written.reason}`);
        error.code = 'SUBMISSION_STATE_WRITE_REJECTED';
        throw error;
      }
      return res.status(200).json({
        success: true,
        type: 'images',
        submissionId,
        key: finalImagePreflight.key,
        fileId: result.id,
        uploadStatus: result.status,
        revision: nextJob.revision,
        imagesComplete,
        files: [finalImagePreflight.filename],
        skipped: result.status === 'recovered' ? [finalImagePreflight.filename] : [],
        details: [{ filename: finalImagePreflight.filename, status: result.status, fileId: result.id }],
        targetPath,
      });
    }
    const uploaded = [];
    const skipped  = [];
    const details = [];
    for (const img of images) {
      const base64Data = img.dataUrl.includes(',') ? img.dataUrl.split(',')[1] : img.dataUrl;
      const imgBuffer  = Buffer.from(base64Data, 'base64');
      // 실제 MIME을 dataUrl 헤더에서 추출해 그대로 Drive에 전달 (이전엔 항상 image/jpeg로 잘못 저장)
      const mimeMatch = img.dataUrl.match(/^data:([^;]+);base64,/);
      const imgMime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const result     = await uploadFile(drive, imgBuffer, img.filename, originalsId, imgMime);
      const detail = {
        filename: img.filename,
        status: result.status,
        fileId: result.id,
        duplicateReason: result.duplicateReason || null,
      };
      details.push(detail);
      if (result.status === 'skipped') skipped.push(img.filename);
      else uploaded.push(img.filename);
    }
    return res.status(200).json({
      success: true,
      type: 'images',
      files: uploaded,
      skipped,
      details,
      targetPath,
      folders: {
        mainId: MAIN_FOLDER_ID,
        monthId,
        personId,
      },
      uploadContext: {
        teamId: teamId ?? null,
        teamNames: teamNames || surveyorName,
        tripStartDate: tripStartDate || reportDate || null,
        tripEndDate: tripEndDate || null,
      },
    });

  } catch (error) {
    console.error('Upload error:', error);
    // Drive 변경 뒤 응답·집계·저장 중 어느 단계에서 실패해도 예약을 processing으로
    // 남겨 두면 같은 제출이 14일 동안 재시도되지 못한다. 원래 오류 응답은 유지하고,
    // 작업 상태 갱신만 최선 노력으로 수행한다.
    if (finalJobReserved && finalJob?.job?.id && finalJob.job.schemaVersion !== 2) {
      await writeSubmissionJob({
        submissionId: finalJob.job.id,
        job: {
          ...finalJob.job,
          status: 'failed',
          failedAt: new Date().toISOString(),
          error: { code: error.code || 'SUBMISSION_FAILED', message: error.message || '최종 제출 처리 실패' },
        },
      }).catch((jobWriteError) => {
        console.error('Submission job failure state write failed:', jobWriteError.message);
      });
    }
    if (/invalid_grant|token.*expired|revoked|unauthorized/i.test(error.message || '')) {
      return jsonError(res, Errors.unauthorized('Google Drive 인증이 만료되었습니다. 관리자에게 Drive 재연결을 요청하세요.'));
    }
    return jsonError(res, Errors.internalError(error.message));
  } finally {
    if (artifactSubmissionLock?.acquired) {
      try {
        await releaseSubmissionLock(artifactSubmissionLock);
      } catch (releaseError) {
        console.error('Artifact submission lock release failed:', releaseError.message);
      }
    }
    if (submissionLock?.acquired) {
      try {
        await releaseSubmissionLock(submissionLock);
      } catch (releaseError) {
        console.error('Submission lock release failed:', releaseError.message);
      }
    }
  }
}
