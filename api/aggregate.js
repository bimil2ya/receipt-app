import { Readable } from 'stream'
import * as XLSX from 'xlsx'
import { ARCHIVE_FOLDER_NAME, createDrive, getOrCreateFolder, isTripWeekFolderName, MAIN_FOLDER_ID, normalizeDriveName } from './driveUtils.js'
import { buildApprovalDuplicateReport } from './approvalReport.js'
import { ALLOWED_ORIGINS } from './_cors.js'
import { applyCorsHeaders, checkOriginAllowed } from './_corsNode.js'
import { safeCompare } from './_auth.js'
import { jsonError, Errors } from './_errorHandler.js'
import {
  buildDatePersonMap,
  buildDetailRows,
  buildReviewRows,
  buildTeamReviewSummary,
  buildChangeHistoryRows,
  buildReviewLedgerRows,
  buildPivotRows,
  groupPersonFolders,
  parseXlsxRow,
  sumSafeAmounts,
} from './_aggregateUtils.js'

const MONEY_FORMAT = '#,##0'

function applyMoneyFormat(ws, columnNames) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
  const moneyColumns = []

  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const headerCell = ws[XLSX.utils.encode_cell({ r: range.s.r, c: col })]
    if (headerCell && columnNames.some(name => String(headerCell.v || '').includes(name))) {
      moneyColumns.push(col)
    }
  }

  for (const col of moneyColumns) {
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })]
      if (!cell || cell.v === '') continue
      cell.t = 'n'
      cell.z = MONEY_FORMAT
    }
  }
}

function buildWorkbook(pivotRows, detailRows, reviewRows = [], teamReviewRows = [], changeHistoryRows = [], reviewLedgerRows = []) {
  const wb = XLSX.utils.book_new()
  const pivotWs = XLSX.utils.json_to_sheet(pivotRows)
  const detailWs = XLSX.utils.json_to_sheet(detailRows)
  const reviewWs = XLSX.utils.json_to_sheet(reviewRows)
  const teamReviewWs = XLSX.utils.json_to_sheet(teamReviewRows)
  const changeHistoryWs = XLSX.utils.json_to_sheet(changeHistoryRows)
  const reviewLedgerWs = XLSX.utils.json_to_sheet(reviewLedgerRows)
  const reviewGuideWs = XLSX.utils.aoa_to_sheet([
    ['검토기록 사용 안내'],
    ['담당자가 입력하는 열', '검토 상태 / 담당자 메모 / 추가 자료 요청 / 검토 담당자 / 검토 시각'],
    ['자동으로 갱신되는 열', '영수증 식별값, 팀, 날짜, 사용처, 용도, 금액, 승인번호, 수정 버전, 직전 수정 버전, 연결 추가 자료'],
    ['수정 자료 확인', '수정 버전과 직전 수정 버전을 비교하고, 연결 추가 자료가 있으면 원래 요청 행에서 확인합니다.'],
    ['상태값', '승인·반려 등 상태값은 업무 담당자가 자유롭게 입력합니다. 시스템은 상태를 자동 변경하지 않습니다.'],
    ['주의', '다음 집계 시 담당자 입력 열은 영수증 식별값 기준으로 유지됩니다. 자동 갱신 열은 수정하지 마세요.'],
  ])

  applyMoneyFormat(pivotWs, ['(원)', '합계'])
  applyMoneyFormat(detailWs, ['금액'])

  XLSX.utils.book_append_sheet(wb, pivotWs, '날짜별집계')
  XLSX.utils.book_append_sheet(wb, detailWs, '전체내역')
  XLSX.utils.book_append_sheet(wb, reviewWs, '검토필요')
  XLSX.utils.book_append_sheet(wb, teamReviewWs, '팀별검토현황')
  XLSX.utils.book_append_sheet(wb, changeHistoryWs, '변경이력')
  XLSX.utils.book_append_sheet(wb, reviewLedgerWs, '검토기록')
  XLSX.utils.book_append_sheet(wb, reviewGuideWs, '검토안내')
  return wb
}

async function readPreviousReviewLedger(drive, folderId, aggregateName) {
  const files = await listExactAggregateFiles(drive, folderId, aggregateName)
  if (files.length > 1 || files.some(file => file.mimeType !== GOOGLE_SHEET_MIME_TYPE || !file.modifiedTime || !file.version)) {
    const error = new Error('기존 월 집계 파일을 하나의 확인 가능한 Google Sheet로 특정할 수 없습니다.')
    error.code = 'REVIEW_LEDGER_FILE_AMBIGUOUS'
    error.details = { aggregateName, files }
    throw error
  }
  const file = files[0]
  if (!file) return { rows: [], headers: [], file: null }
  try {
    const response = await drive.files.export(
      { fileId: file.id, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { responseType: 'arraybuffer' },
    )
    const workbook = XLSX.read(Buffer.from(response.data), { type: 'buffer' })
    const sheet = workbook.Sheets['검토기록']
    const headers = sheet ? (XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false })[0] || []) : []
    return { rows: sheet ? XLSX.utils.sheet_to_json(sheet, { defval: '' }) : [], headers, file }
  } catch (error) {
    error.code = error.code || 'REVIEW_LEDGER_READ_FAILED'
    throw error
  }
}

async function listExistingAggregateFiles(drive, folderId, namePrefix) {
  const existRes = await drive.files.list({
    q: `'${folderId}' in parents and name contains '${namePrefix}' and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,version,trashed)',
    orderBy: 'modifiedTime desc',
  })

  return existRes.data.files || []
}

const GOOGLE_SHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet'
const REQUIRED_AGGREGATE_SHEETS = ['날짜별집계', '전체내역', '검토필요', '팀별검토현황', '변경이력', '검토기록', '검토안내']
const REVIEW_WRITABLE_COLUMNS = ['검토 상태', '담당자 메모', '추가 자료 요청', '검토 담당자', '검토 시각']
const REQUIRED_REVIEW_COLUMNS = ['영수증 식별값', '수정 버전', ...REVIEW_WRITABLE_COLUMNS]

function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

async function listExactAggregateFiles(drive, folderId, name) {
  const existRes = await drive.files.list({
    q: `'${folderId}' in parents and name = '${escapeDriveQueryValue(name)}' and trashed = false`,
    fields: 'files(id,name,mimeType,modifiedTime,version,trashed)',
    orderBy: 'modifiedTime desc',
  })
  return existRes.data.files || []
}

function assertReplacementState(files, { finalName, expectedPreviousFile, newFileId, phase }) {
  const expectedIds = expectedPreviousFile ? [expectedPreviousFile.id, newFileId] : [newFileId]
  const ids = new Set(files.map(file => file.id))
  const valid = files.length === expectedIds.length
    && expectedIds.every(id => ids.has(id))
    && files.every(file => file.name === finalName
      && file.mimeType === GOOGLE_SHEET_MIME_TYPE
      && file.trashed !== true
      && file.modifiedTime
      && file.version)
  const previous = expectedPreviousFile && files.find(file => file.id === expectedPreviousFile.id)
  const previousUnchanged = !expectedPreviousFile
    || (previous && previous.modifiedTime === expectedPreviousFile.modifiedTime && previous.version === expectedPreviousFile.version)
  if (!valid || !previousUnchanged) {
    const error = new Error('집계 파일이 교체 중 변경되었거나 확인할 수 없어 기존 파일을 유지했습니다.')
    error.code = 'AGGREGATE_REPLACEMENT_STATE_CHANGED'
    error.details = { phase, finalName, expectedPreviousFileId: expectedPreviousFile?.id || null, newFileId, files }
    throw error
  }
}

function assertPreReplacementState(files, { finalName, expectedPreviousFile }) {
  const expectedIds = expectedPreviousFile ? [expectedPreviousFile.id] : []
  const ids = new Set(files.map(file => file.id))
  const valid = files.length === expectedIds.length
    && expectedIds.every(id => ids.has(id))
    && files.every(file => file.name === finalName
      && file.mimeType === GOOGLE_SHEET_MIME_TYPE
      && file.trashed !== true
      && file.modifiedTime
      && file.version)
  const current = expectedPreviousFile && files.find(file => file.id === expectedPreviousFile.id)
  const previousUnchanged = !expectedPreviousFile
    || (current && current.modifiedTime === expectedPreviousFile.modifiedTime && current.version === expectedPreviousFile.version)
  if (!valid || !previousUnchanged) {
    const error = new Error('기존 집계 파일이 변경되었거나 확인할 수 없어 교체하지 않았습니다.')
    error.code = 'AGGREGATE_REPLACEMENT_STATE_CHANGED'
    error.details = { phase: 'before-create', finalName, expectedPreviousFileId: expectedPreviousFile?.id || null, files }
    throw error
  }
}

function readbackError(message, details) {
  const error = new Error(message)
  error.code = 'AGGREGATE_READBACK_INVALID'
  error.details = details
  return error
}

function rowMultiset(rows, headers) {
  return (rows || []).map(row => JSON.stringify(headers.map(header => String(row?.[header] ?? '')))).sort()
}

function assertUniqueReceiptIds(rows, source) {
  const seen = new Set()
  const duplicates = new Set()
  for (const row of rows || []) {
    const id = String(row?.id || row?.['영수증 식별값'] || '')
    if (!id) continue
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  if (duplicates.size) {
    const error = new Error('같은 영수증 식별값이 여러 건 있어 집계를 중단했습니다.')
    error.code = 'AGGREGATE_RECEIPT_ID_DUPLICATE'
    error.details = { source, receiptIds: [...duplicates] }
    throw error
  }
}

async function verifyNewAggregateReadback(drive, fileId, expectedReviewRows, expectedDetailRows) {
  let response
  try {
    response = await drive.files.export(
      { fileId, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      { responseType: 'arraybuffer' },
    )
  } catch (cause) {
    throw readbackError('새 집계 파일을 다시 읽어 확인하지 못했습니다.', { fileId, cause: cause.message })
  }
  if (!response?.data) throw readbackError('새 집계 파일 확인 응답이 비어 있습니다.', { fileId })

  let workbook
  try {
    workbook = XLSX.read(Buffer.from(response.data), { type: 'buffer' })
  } catch (cause) {
    throw readbackError('새 집계 파일 확인 응답을 읽을 수 없습니다.', { fileId, cause: cause.message })
  }
  const missingSheets = REQUIRED_AGGREGATE_SHEETS.filter(name => !workbook.Sheets[name])
  if (missingSheets.length) throw readbackError('새 집계 파일에 필수 시트가 없습니다.', { fileId, missingSheets })

  const reviewRows = XLSX.utils.sheet_to_json(workbook.Sheets['검토기록'], { defval: '' })
  const reviewHeaders = XLSX.utils.sheet_to_json(workbook.Sheets['검토기록'], { header: 1, blankrows: false })[0] || []
  // 구형 검토 행에는 현재 기본 열 외의 보존 대상 열이 있을 수 있다. 생성 전 행에 있던 모든 열을 요구한다.
  const expectedReviewHeaders = new Set((expectedReviewRows || []).flatMap(row => Object.keys(row || {})))
  const missingColumns = [...new Set([...REQUIRED_REVIEW_COLUMNS, ...expectedReviewHeaders])]
    .filter(name => !reviewHeaders.includes(name))
  if (missingColumns.length) throw readbackError('새 집계 파일의 검토기록 열이 부족합니다.', { fileId, missingColumns })
  const detailRows = XLSX.utils.sheet_to_json(workbook.Sheets['전체내역'], { defval: '' })
  const detailHeaders = XLSX.utils.sheet_to_json(workbook.Sheets['전체내역'], { header: 1, blankrows: false })[0] || []
  const expectedDetailHeaders = [...new Set((expectedDetailRows || []).flatMap(row => Object.keys(row || {})))]
  const missingDetailColumns = expectedDetailHeaders.filter(header => !detailHeaders.includes(header))
  if (missingDetailColumns.length) throw readbackError('새 집계 파일의 전체내역 열이 부족합니다.', { fileId, missingDetailColumns })
  const expectedDetail = rowMultiset(expectedDetailRows, expectedDetailHeaders)
  const actualDetail = rowMultiset(detailRows, expectedDetailHeaders)
  if (JSON.stringify(actualDetail) !== JSON.stringify(expectedDetail)) {
    throw readbackError('새 집계 파일의 전체내역이 기대값과 일치하지 않습니다.', { fileId, expectedDetailCount: expectedDetail.length, actualDetailCount: actualDetail.length })
  }

  const expectedById = new Map((expectedReviewRows || [])
    .filter(row => row?.['영수증 식별값'])
    .map(row => [String(row['영수증 식별값']), row]))
  const actualById = new Map()
  for (const row of reviewRows) {
    const id = String(row['영수증 식별값'] || '')
    if (!id) continue
    if (actualById.has(id)) throw readbackError('새 집계 파일의 영수증 식별값이 중복되었습니다.', { fileId, receiptId: id })
    actualById.set(id, row)
  }
  if (actualById.size !== expectedById.size || [...expectedById.keys()].some(id => !actualById.has(id))) {
    throw readbackError('새 집계 파일의 검토기록 영수증 식별값이 일치하지 않습니다.', { fileId, expectedReceiptIds: [...expectedById.keys()], actualReceiptIds: [...actualById.keys()] })
  }
  for (const [id, expected] of expectedById) {
    const actual = actualById.get(id)
    const columns = reviewHeaders
    const mismatch = columns.find(column => String(actual[column] ?? '') !== String(expected[column] ?? ''))
    if (mismatch) throw readbackError('새 집계 파일의 검토기록 값이 일치하지 않습니다.', { fileId, receiptId: id, column: mismatch, expected: expected[mismatch] ?? '', actual: actual[mismatch] ?? '' })
  }
  // 식별값 없는 과거 행은 안정 키가 없으므로, 시트의 모든 열 값을 순서와 무관한 다중집합으로 비교한다.
  // 담당자 입력 열만 비교하면 팀·날짜·금액 등 기존 자료가 사라져도 통과할 수 있다.
  const legacySignature = row => JSON.stringify(reviewHeaders.map(column => String(row[column] ?? '')))
  const expectedLegacy = (expectedReviewRows || []).filter(row => !row?.['영수증 식별값']).map(legacySignature).sort()
  const actualLegacy = reviewRows.filter(row => !row?.['영수증 식별값']).map(legacySignature).sort()
  if (JSON.stringify(actualLegacy) !== JSON.stringify(expectedLegacy)) {
    throw readbackError('새 집계 파일의 식별값 없는 기존 검토기록이 일치하지 않습니다.', { fileId, expectedLegacyCount: expectedLegacy.length, actualLegacyCount: actualLegacy.length })
  }
}

async function cleanupUnverifiedNewAggregate(drive, fileId) {
  try {
    const response = await drive.files.update({ fileId, requestBody: { trashed: true }, fields: 'id,trashed' })
    return { attempted: true, confirmed: response.data?.id === fileId && response.data?.trashed === true }
  } catch (error) {
    return { attempted: true, confirmed: false, message: error.message }
  }
}

async function deleteFiles(drive, files, keepId = null) {
  const attemptedTrashFileIds = []
  try {
    for (const file of files || []) {
      if (file.id === keepId) continue
      // ACK가 유실돼도 Drive가 이미 이동했을 수 있으므로, 요청 전부터 복구 후보로 둔다.
      attemptedTrashFileIds.push(file.id)
      const response = await drive.files.update({
        fileId: file.id,
        requestBody: { trashed: true },
        fields: 'id,trashed',
      })
      if (response.data?.id !== file.id || response.data?.trashed !== true) {
        const error = new Error('기존 집계 파일의 보관 처리 응답을 확인하지 못했습니다.')
        error.code = 'AGGREGATE_TRASH_UNCONFIRMED'
        error.details = { fileId: file.id, response: response.data || null }
        throw error
      }
    }
  } catch (cause) {
    const restoreResults = []
    for (const fileId of [...attemptedTrashFileIds].reverse()) {
      try {
        const response = await drive.files.update({
          fileId,
          requestBody: { trashed: false },
          fields: 'id,trashed',
        })
        restoreResults.push({ fileId, restored: response.data?.id === fileId && response.data?.trashed === false })
      } catch (error) {
        restoreResults.push({ fileId, restored: false, message: error.message })
      }
    }
    cause.details = { ...(cause.details || {}), attemptedTrashFileIds, restoreResults }
    throw cause
  }
}

async function listChildEntries(drive, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,createdTime)',
    pageSize: 200,
  })
  return res.data.files || []
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

// 보관함에서 되살린 출장의 영수증이 현재 출장에도 있으면(출장일을 고쳐 다시 제출한 경우 등)
// 현재 쪽만 센다. 그러지 않으면 금액이 두 번 잡히거나 식별값 중복으로 집계가 중단된다.
export function dropArchivedDuplicateRows(sources) {
  const activeIds = new Set(sources
    .filter(source => !source.archived)
    .flatMap(source => source.rows.map(row => row.id).filter(Boolean)))
  const seenArchivedIds = new Set()
  return sources.flatMap(source => {
    if (!source.archived) return source.rows
    return source.rows.filter(row => {
      if (!row.id) return true
      if (activeIds.has(row.id) || seenArchivedIds.has(row.id)) return false
      seenArchivedIds.add(row.id)
      return true
    })
  })
}

// 2026-06-30~09 사이 Drive 저장이 같은 달의 다른 출장(주) 폴더까지 보관함으로 옮겼다.
// 담당자 폴더에 같은 이름의 출장 폴더가 없을 때만 보관함 속 출장 폴더를 월집계에 되살린다.
// 같은 이름이 보관함에 여럿이면 가장 나중에 만든 폴더(최신 제출)를 쓴다.
async function collectArchivedTripFiles(drive, archiveFolderId, activeTripNames, personName, seenFileIds) {
  const newestByName = new Map()
  for (const entry of await listChildEntries(drive, archiveFolderId)) {
    if (entry.mimeType !== FOLDER_MIME || !isTripWeekFolderName(entry.name)) continue
    const name = normalizeDriveName(entry.name)
    if (activeTripNames.has(name)) continue
    const current = newestByName.get(name)
    if (!current || String(entry.createdTime || '') > String(current.createdTime || '')) newestByName.set(name, entry)
  }
  const files = []
  for (const trip of newestByName.values()) {
    const nested = await collectXlsxFilesRecursive(drive, trip.id, personName, seenFileIds)
    files.push(...nested.map(file => ({ ...file, archived: true })))
  }
  return files
}

async function collectXlsxFilesRecursive(drive, folderId, personName, seenFileIds = new Set(), { includeArchivedTrips = false } = {}) {
  const entries = await listChildEntries(drive, folderId)
  const activeTripNames = new Set(entries
    .filter(entry => entry.mimeType === FOLDER_MIME && isTripWeekFolderName(entry.name))
    .map(entry => normalizeDriveName(entry.name)))
  const files = []
  for (const entry of entries) {
    if (entry.mimeType === FOLDER_MIME) {
      const folderName = normalizeDriveName(entry.name)
      // 보관함 / 낱장 사진 폴더(_원본) / PDF 조립 임시 폴더(_정산서조립_*)는 xlsx가 없으므로 재귀 생략.
      // 단, 담당자 폴더의 보관함에 잘못 옮겨진 출장 폴더는 되살린다(보관함의 낱개 옛 XLSX는 제외).
      if (folderName === ARCHIVE_FOLDER_NAME) {
        if (includeArchivedTrips) files.push(...await collectArchivedTripFiles(drive, entry.id, activeTripNames, personName, seenFileIds))
        continue
      }
      if (folderName === '_원본') continue
      if (folderName.startsWith('_정산서조립_')) continue
      const nested = await collectXlsxFilesRecursive(drive, entry.id, personName, seenFileIds)
      files.push(...nested)
      continue
    }
    if (!String(entry.name || '').includes('출장비') || !String(entry.name || '').includes('.xlsx')) continue
    if (seenFileIds.has(entry.id)) continue
    seenFileIds.add(entry.id)
    files.push({ ...entry, personName })
  }
  return files
}

async function createReplacingAggregateSheet(drive, folderId, finalName, buffer, expectedPreviousFile = null, readbackExpectation = {}) {
  const existingFiles = await listExactAggregateFiles(drive, folderId, finalName)
  assertPreReplacementState(existingFiles, { finalName, expectedPreviousFile })
  const tempName = `${finalName}__업데이트중_${Date.now()}`

  const created = await drive.files.create({
    requestBody: {
      name: tempName,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Readable.from(buffer),
    },
    fields: 'id,name',
  })
  if (!created.data?.id || created.data.name !== tempName) {
    const error = new Error('새 월 집계 파일 생성 응답을 확인하지 못했습니다.')
    error.code = 'AGGREGATE_CREATE_UNCONFIRMED'
    throw error
  }
  try {
    await verifyNewAggregateReadback(drive, created.data.id, readbackExpectation.reviewLedgerRows, readbackExpectation.detailRows)
  } catch (cause) {
    cause.details = { ...(cause.details || {}), newFileId: created.data.id, tempName, cleanup: await cleanupUnverifiedNewAggregate(drive, created.data.id) }
    throw cause
  }

  const renamed = await drive.files.update({
    fileId: created.data.id,
    requestBody: { name: finalName },
    fields: 'id,name',
  })
  if (renamed.data?.id !== created.data.id || renamed.data?.name !== finalName) {
    const error = new Error('새 월 집계 파일의 최종 이름 변경을 확인하지 못했습니다.')
    error.code = 'AGGREGATE_RENAME_UNCONFIRMED'
    throw error
  }

  // 최종 이름으로 바뀐 새 파일과 export 때 읽은 기존 파일만 존재하는지 다시 확인한다.
  // 이 확인이 어긋나면 기존 파일 정리를 시작하지 않는다.
  const filesBeforeCleanup = await listExactAggregateFiles(drive, folderId, finalName)
  assertReplacementState(filesBeforeCleanup, {
    finalName,
    expectedPreviousFile,
    newFileId: created.data.id,
    phase: 'before-cleanup',
  })
  await deleteFiles(drive, existingFiles, created.data.id)

  return created.data.id
}

export { groupPersonFolders }

/**
 * 새 폴더 구조 탐색:
 *   영수증정산관리(미래생태공간) / YYYY년 MM월 / [담당자이름] / 출장비_*.xlsx
 *
 * 집계 결과:
 *   영수증정산관리(미래생태공간) / !전체집계 / 전체집계_YYYY-MM-DD.xlsx
 */
export async function runAggregate(drive) {
  // 전체집계 폴더 확보
  const aggFolderId = await getOrCreateFolder(drive, '!전체집계', MAIN_FOLDER_ID)

  // ── MAIN 아래의 모든 폴더 목록 가져오기
  const topRes = await drive.files.list({
    q: `'${MAIN_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
  })
  const topFolders = topRes.data.files || []

  // "YYYY년 MM월" 형식 폴더만 걸러냄 (집계 폴더 등 제외)
  const monthFolders = topFolders.filter(f => /^\d{4}년 \d{2}월$/.test(f.name))

  // 모든 영수증 row 수집
  // row: { date, storeName, category, amount, note, person }
  const allRows = []
  // 등장한 사람 이름 순서 보존 (날짜순 정렬용)
  const personOrder = []
  const seenFileIds = new Set()

  for (const monthFolder of monthFolders) {
    // 월 폴더 안의 담당자 폴더들
    const personRes = await drive.files.list({
      q: `'${monthFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id,name)',
    })
    const personGroups = groupPersonFolders(personRes.data.files || [])
    const monthSources = []

    for (const personGroup of personGroups) {
      const personName = personGroup.name
      if (!personOrder.includes(personName)) personOrder.push(personName)

      for (const personFolder of personGroup.folders) {
        const xlsxFiles = await collectXlsxFilesRecursive(drive, personFolder.id, personName, new Set(), { includeArchivedTrips: true })

        for (const file of xlsxFiles) {
          if (seenFileIds.has(file.id)) continue
          seenFileIds.add(file.id)
          try {
            const fileRes = await drive.files.get(
              { fileId: file.id, alt: 'media' },
              { responseType: 'arraybuffer' }
            )
            const wb = XLSX.read(Buffer.from(fileRes.data), { type: 'buffer' })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json(ws).map(r => parseXlsxRow(r, personName))
            monthSources.push({ archived: file.archived === true, rows })
          } catch (e) {
            console.warn(`파일 읽기 실패: ${file.name}`, e.message)
          }
        }
      }
    }
    allRows.push(...dropArchivedDuplicateRows(monthSources))
  }

  if (allRows.length === 0) {
    return { success: true, message: '집계할 데이터 없음', count: 0 }
  }
  const duplicateReport = buildApprovalDuplicateReport(allRows)

  const datePersonMap = buildDatePersonMap(allRows)
  const pivotRows = buildPivotRows(datePersonMap, personOrder, sumSafeAmounts(allRows))
  const detailRows = buildDetailRows(allRows, personOrder)

  const reviewRows = buildReviewRows(allRows)
  const reviewLedgerRows = buildReviewLedgerRows(allRows)
  const wb = buildWorkbook(pivotRows, detailRows, reviewRows, buildTeamReviewSummary(allRows, reviewRows), buildChangeHistoryRows(allRows), reviewLedgerRows)
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  // 오늘 날짜 (서울 기준)
  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\. /g, '-').replace('.', '').replace(/\s/g, '')

  // 구글 시트로 저장 (확장자 없음)
  const fname = `전체집계_${today}`

  const existingAll = await listExistingAggregateFiles(drive, aggFolderId, '전체집계_')
  const fileId = await createReplacingAggregateSheet(drive, aggFolderId, fname, buf, null, { reviewLedgerRows, detailRows })
  await deleteFiles(drive, existingAll, fileId)

  return {
    success: true,
    message: `전체집계 완료 (${allRows.length}건)`,
    filename: fname + ' (Google Sheet)',
    count: allRows.length,
    duplicateReport,
  }
}

/**
 * 특정 월 폴더 안의 모든 담당자 xlsx를 읽어 집계 파일을 생성/업데이트
 * 저장 위치: monthFolderId 바로 아래 `전체집계_YYYY년MM월.xlsx` (Google Sheet으로 변환)
 */
export async function runMonthAggregate(drive, monthFolderId, yearMonth) {
  // 월 폴더 안의 담당자 서브폴더 목록
  const personRes = await drive.files.list({
    q: `'${monthFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
  })
  const personGroups = groupPersonFolders(personRes.data.files || [])

  const personOrder = personGroups.map(pg => pg.name)
  const seenFileIds = new Set()

  // 담당자 폴더별 XLSX 목록 조회 — 병렬
  const xlsxLists = await Promise.all(personGroups.map(async pg => {
    const files = [];
    for (const pf of pg.folders) {
      files.push(...await collectXlsxFilesRecursive(drive, pf.id, pg.name, seenFileIds, { includeArchivedTrips: true }));
    }
    return { personName: pg.name, files };
  }))

  // 모든 XLSX 파일 다운로드 — 병렬
  const sourceResults = await Promise.all(
    xlsxLists.flatMap(({ personName, files }) =>
      files.map(async file => {
        try {
          const fileRes = await drive.files.get(
            { fileId: file.id, alt: 'media' },
            { responseType: 'arraybuffer' }
          )
          const wb = XLSX.read(Buffer.from(fileRes.data), { type: 'buffer' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const assignmentWs = wb.Sheets['작업조변경이력']
          const assignmentHistory = assignmentWs ? XLSX.utils.sheet_to_json(assignmentWs).map(row => ({ ...row, '팀': row['새작업조'] || personName })) : []
          return { archived: file.archived === true, rows: XLSX.utils.sheet_to_json(ws).map(r => parseXlsxRow(r, personName)), assignmentHistory, error: null }
        } catch (e) {
          console.warn(`월집계: 파일 읽기 실패 ${file.name}`, e.message)
          // 보관함에서 되살린 과거 출장이 읽히지 않는다고 현재 제출의 월집계까지 막지 않는다.
          if (file.archived === true) return { archived: true, rows: [], assignmentHistory: [], error: null }
          return { rows: [], assignmentHistory: [], error: { fileId: file.id, fileName: file.name, message: e.message } }
        }
      })
    )
  )
  const readFailures = sourceResults.filter(result => result.error).map(result => result.error)
  if (readFailures.length > 0) {
    const error = new Error(`월집계 원본 ${readFailures.length}개 읽기 실패`)
    error.code = 'AGGREGATE_SOURCE_READ_FAILED'
    error.failures = readFailures
    throw error
  }
  const allRows = dropArchivedDuplicateRows(sourceResults)
  const assignmentHistory = sourceResults.flatMap(result => result.assignmentHistory || [])

  if (allRows.length === 0) return { count: 0 }
  const duplicateReport = buildApprovalDuplicateReport(allRows)

  const datePersonMap2 = buildDatePersonMap(allRows)
  const pivotRows2 = buildPivotRows(datePersonMap2, personOrder, sumSafeAmounts(allRows))
  const detailRows2 = buildDetailRows(allRows, personOrder)

  const reviewRows = buildReviewRows(allRows)
  const aggName = `전체집계_${yearMonth}`
  const previousReviewState = await readPreviousReviewLedger(drive, monthFolderId, aggName)
  assertUniqueReceiptIds(allRows, 'source')
  assertUniqueReceiptIds(previousReviewState.rows, 'previous-review-ledger')
  const reviewLedgerRows = buildReviewLedgerRows(allRows, previousReviewState.rows, previousReviewState.headers)
  const wb2 = buildWorkbook(pivotRows2, detailRows2, reviewRows, buildTeamReviewSummary(allRows, reviewRows), [...buildChangeHistoryRows(allRows), ...assignmentHistory], reviewLedgerRows)
  const buf2 = XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' })

  // 새 월별 집계가 성공한 뒤 기존 파일을 정리해 최신 1개만 유지
  const fileId = await createReplacingAggregateSheet(drive, monthFolderId, aggName, buf2, previousReviewState.file, { reviewLedgerRows, detailRows: detailRows2 })

  return { success: true, count: allRows.length, file: aggName, fileId, duplicateReport }
}

/**
 * 스냅샷 백업 방식의 집계 (Phase 1-3 추가)
 * 1. 기존 집계 파일 → 스냅샷으로 복사 (_snapshot_YYYY-MM-DD_HHmmss)
 * 2. 새 집계 파일 생성 (임시 이름)
 * 3. 검증 성공 → 최종 이름 변경
 * 4. 실패 시 스냅샷에서 수동 복구 가능
 *
 * @param {object} drive - googleapis drive 인스턴스
 * @param {string} archiveFolderId - 보관 폴더 ID
 * @param {string} finalName - 최종 파일명 (예: 월별집계_2026-08)
 * @param {Buffer} buffer - XLSX 파일 내용
 * @returns {Promise<string>} 생성된 파일 ID
 */
export async function aggregateMonthWithSnapshot(drive, archiveFolderId, finalName, buffer) {
  const timestamp = Date.now();
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 19).replace(/[-:]/g, '');
  const snapshotName = `_snapshot_${finalName}_${dateStr}`;

  try {
    // Step 1: 기존 집계 파일이 있으면 스냅샷으로 백업
    const existingFiles = await listExistingAggregateFiles(drive, archiveFolderId, finalName);
    if (existingFiles.length > 0) {
      const existingId = existingFiles[0].id;
      await drive.files.copy({
        fileId: existingId,
        requestBody: { name: snapshotName, parents: [archiveFolderId] }
      });
      console.log(`📦 스냅샷 백업 생성: ${snapshotName}`);
    }

    // Step 2: 새 집계 파일 생성 (임시 이름)
    const tempName = `${finalName}__작성중_${timestamp}`;
    const fileId = await createReplacingAggregateSheet(drive, archiveFolderId, tempName, buffer);

    // Step 3: 검증 체크포인트 (추후 validateAggregateFile 함수 추가 가능)
    // 현재는 파일 생성 성공 = 검증 성공으로 간주

    // Step 4: 최종 이름으로 변경 (원자적 연산)
    await drive.files.update({
      fileId: fileId,
      requestBody: { name: finalName },
      fields: 'id,name'
    });

    console.log(`✅ 집계 완료: ${finalName} (스냅샷 백업: ${snapshotName})`);
    return fileId;
  } catch (error) {
    console.error(`❌ 집계 실패: ${error.message}`);
    throw error;
  }
}

/**
 * 오래된 스냅샷 정리 (3개월 이상)
 * 매 분기 1일 자동 실행 권장
 *
 * @param {object} drive - googleapis drive 인스턴스
 * @param {string} archiveFolderId - 보관 폴더 ID
 * @returns {Promise<number>} 삭제된 스냅샷 수
 */
export async function cleanupOldSnapshots(drive, archiveFolderId) {
  try {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // 3개월 이상 된 스냅샷 조회
    const oldSnapshots = await drive.files.list({
      q: `'${archiveFolderId}' in parents and name contains '_snapshot_' and createdTime < '${threeMonthsAgo.toISOString()}' and trashed = false`,
      fields: 'files(id, name, createdTime)',
      pageSize: 1000
    });

    const snapshotsToDelete = oldSnapshots.data.files || [];
    let deletedCount = 0;

    // 스냅샷을 휴지통으로 이동
    for (const file of snapshotsToDelete) {
      await drive.files.update({
        fileId: file.id,
        requestBody: { trashed: true }
      });
      deletedCount++;
    }

    console.log(`🗑️ 오래된 스냅샷 정리 완료: ${deletedCount}개 (3개월 이상)`);
    return deletedCount;
  } catch (error) {
    console.error(`⚠️ 스냅샷 정리 실패: ${error.message}`);
    return 0; // 정리 실패는 조용히 처리
  }
}

export default async function handler(req, res) {
  // CORS 헤더 설정 (OPTIONS 요청 자동 처리)
  const corsResult = applyCorsHeaders(req, res, { methods: 'GET, POST, OPTIONS' })
  if (corsResult === true) return // OPTIONS 처리됨

  const origin = req.headers.origin || ''
  if (!checkOriginAllowed(req, res)) return // 출처 검증 (프로덕션만)

  // ── 인증 토큰 검증 (모든 환경에서 필수)
  const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN
  if (!UPLOAD_TOKEN) {
    return jsonError(res, Errors.internalError('UPLOAD_API_TOKEN이 설정되지 않았습니다.'))
  }
  const authHeader = req.headers['authorization'] || ''
  const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!safeCompare(provided, UPLOAD_TOKEN)) {
    return jsonError(res, Errors.unauthorized('유효하지 않은 토큰입니다.'))
  }

  try {
    const drive = createDrive()
    const result = await runAggregate(drive)
    return res.status(200).json(result)
  } catch (err) {
    console.error('Aggregate error:', err)
    return jsonError(res, Errors.internalError(err.message))
  }
}
