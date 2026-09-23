import crypto from 'crypto'
import * as XLSX from 'xlsx'
import { driveQueryString, normalizeDriveName } from './driveUtils.js'
import { verifyAggregateSubmission } from './_aggregateSubmission.js'
import { submissionContractDigest } from './_submissionJob.js'

const FOLDER_MIME = 'application/vnd.google-apps.folder'
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const PDF_MIME = 'application/pdf'
const MAX_XLSX_BYTES = 15 * 1024 * 1024
const MAX_AGGREGATE_BYTES = 20 * 1024 * 1024
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MD5_RE = /^[0-9a-f]{32}$/i

const PROPS = Object.freeze({
  submissionId: 'receiptSubmissionId',
  submissionKind: 'receiptSubmissionKind',
  artifactKind: 'receiptArtifactKind',
  key: 'receiptArtifactKey',
  xlsxSha256: 'receiptXlsxSha256',
  sha256: 'receiptContentSha256',
  byteLength: 'receiptContentByteLength',
  reportId: 'receiptPdfReportId',
})

function fail(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  throw error
}

function nonempty(value) {
  return typeof value === 'string' && value.length > 0
}

async function assertOwnership(assertOwned) {
  let owned
  try {
    owned = await assertOwned()
  } catch (cause) {
    fail('SUBMISSION_DRIVE_LOCK_LOST', '제출 증거를 확인하는 동안 잠금 소유권을 잃었습니다.', { cause: cause?.message || String(cause) })
  }
  if (owned === false) fail('SUBMISSION_DRIVE_LOCK_LOST', '제출 증거를 확인하는 동안 잠금 소유권을 잃었습니다.')
}

async function ownedIo(assertOwned, operation, code, message) {
  await assertOwnership(assertOwned)
  let result
  let ioError
  try {
    result = await operation()
  } catch (cause) {
    ioError = cause
  }
  await assertOwnership(assertOwned)
  if (ioError) fail(code, message, { cause: ioError?.message || String(ioError) })
  return result
}

function validListData(data) {
  const next = data?.nextPageToken
  return data && Array.isArray(data.files)
    && (data.incompleteSearch === undefined || data.incompleteSearch === false)
    && data.files.every(file => nonempty(file?.id))
    && (next === undefined || next === null || nonempty(next))
}

async function listAllIds(drive, { query, assertOwned, code }) {
  const ids = []
  const seenTokens = new Set()
  let pageToken
  do {
    const response = await ownedIo(
      assertOwned,
      () => drive.files.list({
        q: query,
        fields: 'incompleteSearch,nextPageToken,files(id)',
        pageSize: 1000,
        ...(pageToken ? { pageToken } : {}),
      }),
      code,
      'Drive 증거 목록을 읽지 못했습니다.',
    )
    const data = response?.data
    if (!validListData(data)) fail(code, 'Drive 증거 목록이 불완전하거나 형식이 잘못되었습니다.')
    ids.push(...data.files.map(file => file.id))
    const next = data.nextPageToken || undefined
    if (next && seenTokens.has(next)) fail(code, 'Drive 증거 목록 페이지가 반복되었습니다.')
    if (next) seenTokens.add(next)
    pageToken = next
  } while (pageToken)
  if (new Set(ids).size !== ids.length) fail(code, 'Drive 증거 목록에 중복 파일 ID가 있습니다.', { fileIds: ids })
  return ids
}

async function readMetadata(drive, fileId, assertOwned, code = 'SUBMISSION_DRIVE_METADATA_UNCONFIRMED') {
  const response = await ownedIo(
    assertOwned,
    () => drive.files.get({
      fileId,
      fields: 'id,name,mimeType,parents,appProperties,trashed,size,md5Checksum',
    }),
    code,
    'Drive 증거 메타데이터를 읽지 못했습니다.',
  )
  const file = response?.data
  if (!file || typeof file !== 'object' || file.id !== fileId) {
    fail(code, 'Drive 증거 메타데이터 읽기 결과가 일치하지 않습니다.', { fileId })
  }
  return file
}

function exactParent(file, parentId) {
  return Array.isArray(file?.parents) && file.parents.length === 1 && file.parents[0] === parentId
}

function finitePositiveSize(value, max) {
  const size = Number(value)
  return Number.isSafeInteger(size) && size > 0 && size <= max ? size : null
}

async function readBoundedStream(drive, { fileId, maxBytes, assertOwned, exportMimeType }) {
  const response = await ownedIo(
    assertOwned,
    () => exportMimeType
      ? drive.files.export({ fileId, mimeType: exportMimeType }, { responseType: 'stream' })
      : drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' }),
    'SUBMISSION_DRIVE_CONTENT_UNCONFIRMED',
    'Drive 증거 파일 내용을 읽지 못했습니다.',
  )
  const body = response?.data
  if (!body || Buffer.isBuffer(body) || typeof body[Symbol.asyncIterator] !== 'function') {
    fail('SUBMISSION_DRIVE_CONTENT_UNCONFIRMED', 'Drive 증거 파일의 스트림 응답 형식이 잘못되었습니다.', { fileId })
  }
  const chunks = []
  let length = 0
  let streamError
  await assertOwnership(assertOwned)
  try {
    for await (const value of body) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      length += chunk.length
      if (length > maxBytes) {
        if (typeof body.destroy === 'function') body.destroy()
        fail('SUBMISSION_DRIVE_CONTENT_TOO_LARGE', 'Drive 증거 파일이 허용 크기를 초과했습니다.', { fileId, maxBytes })
      }
      chunks.push(chunk)
    }
  } catch (cause) {
    streamError = cause
  }
  await assertOwnership(assertOwned)
  if (streamError) {
    if (streamError?.code) throw streamError
    fail('SUBMISSION_DRIVE_CONTENT_UNCONFIRMED', 'Drive 증거 파일 스트림을 끝까지 읽지 못했습니다.', {
      fileId, cause: streamError?.message || String(streamError),
    })
  }
  return Buffer.concat(chunks, length)
}

function assertFolder(file, { parentId, name, normalizedName, code }) {
  const validName = normalizedName === undefined ? file.name === name : normalizeDriveName(file.name) === normalizedName
  if (file.trashed !== false || file.mimeType !== FOLDER_MIME || !exactParent(file, parentId) || !validName) {
    fail(code, '제출 폴더 위치 또는 이름이 저장된 범위와 일치하지 않습니다.', { fileId: file.id })
  }
}

async function verifyFolderChain(drive, { job, mainId, assertOwned }) {
  const folders = job?.response?.folders
  if (!folders || folders.mainId !== mainId
    || ![folders.monthId, folders.personId, folders.weekId].every(nonempty)) {
    fail('SUBMISSION_DRIVE_FOLDER_PIN_MISMATCH', '저장된 제출 폴더 ID를 확인할 수 없습니다.')
  }
  const main = await readMetadata(drive, mainId, assertOwned)
  if (main.trashed !== false || main.mimeType !== FOLDER_MIME) {
    fail('SUBMISSION_DRIVE_MAIN_FOLDER_CONFLICT', '기준 Drive 폴더가 현재 활성 폴더가 아닙니다.')
  }
  const month = await readMetadata(drive, folders.monthId, assertOwned)
  assertFolder(month, { parentId: mainId, name: job.scope.yearMonth, code: 'SUBMISSION_DRIVE_MONTH_FOLDER_CONFLICT' })
  const person = await readMetadata(drive, folders.personId, assertOwned)
  assertFolder(person, {
    parentId: folders.monthId,
    normalizedName: normalizeDriveName(job.scope.surveyorName),
    code: 'SUBMISSION_DRIVE_PERSON_FOLDER_CONFLICT',
  })
  const week = await readMetadata(drive, folders.weekId, assertOwned)
  assertFolder(week, { parentId: folders.personId, name: job.scope.weekFolderName, code: 'SUBMISSION_DRIVE_WEEK_FOLDER_CONFLICT' })
  return folders
}

function assertPinnedArtifactState(job) {
  const xlsx = job?.artifacts?.xlsx
  const pdf = job?.artifacts?.pdf
  if (xlsx?.status !== 'confirmed' || !nonempty(xlsx.fileId) || xlsx.sha256 !== job.xlsxSha256) {
    fail('SUBMISSION_DRIVE_XLSX_PIN_MISMATCH', '확정된 XLSX 파일 ID 또는 해시가 없습니다.')
  }
  if (pdf?.status !== 'confirmed' || !nonempty(pdf.fileId)
    || pdf.sha256 !== job.expected.pdf.sha256 || pdf.byteLength !== job.expected.pdf.byteLength) {
    fail('SUBMISSION_DRIVE_PDF_PIN_MISMATCH', '확정된 PDF 파일 ID 또는 계약 정보가 없습니다.')
  }
  const expectedKeys = job.expected.images.map(image => image.key).sort()
  const confirmed = job?.artifacts?.images?.confirmed
  const actual = confirmed && typeof confirmed === 'object' && !Array.isArray(confirmed) ? confirmed : {}
  const actualKeys = Object.keys(actual).sort()
  if ((expectedKeys.length > 0 && job?.artifacts?.images?.status !== 'confirmed')
    || JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)
    || actualKeys.some(key => !nonempty(actual[key]?.fileId))) {
    fail('SUBMISSION_DRIVE_IMAGE_PIN_MISMATCH', '확정된 원본 이미지 파일 ID가 제출 계약과 일치하지 않습니다.')
  }
  if (new Set([xlsx.fileId, pdf.fileId, ...actualKeys.map(key => actual[key].fileId)]).size !== 2 + actualKeys.length) {
    fail('SUBMISSION_DRIVE_ARTIFACT_ID_CONFLICT', '서로 다른 제출 증거가 같은 Drive 파일 ID를 사용합니다.')
  }
  return { xlsx, pdf, confirmed: actual }
}

async function findOriginalsFolder(drive, { weekId, required, assertOwned }) {
  if (!required) return null
  const safeWeek = driveQueryString(weekId)
  const ids = await listAllIds(drive, {
    query: `'${safeWeek}' in parents and name = '_원본' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    assertOwned,
    code: 'SUBMISSION_DRIVE_ORIGINALS_LIST_UNCONFIRMED',
  })
  if (ids.length !== 1) fail('SUBMISSION_DRIVE_ORIGINALS_FOLDER_AMBIGUOUS', '활성 원본 이미지 폴더가 정확히 하나가 아닙니다.', { fileIds: ids })
  const folder = await readMetadata(drive, ids[0], assertOwned)
  assertFolder(folder, { parentId: weekId, name: '_원본', code: 'SUBMISSION_DRIVE_ORIGINALS_FOLDER_CONFLICT' })
  return folder.id
}

function classifyEvidence(file, submissionId) {
  const props = file.appProperties
  if (!props || props[PROPS.submissionId] !== submissionId) {
    fail('SUBMISSION_DRIVE_ARTIFACT_CONFLICT', '제출 증거의 제출 ID가 일치하지 않습니다.', { fileId: file.id })
  }
  if (Object.hasOwn(props, PROPS.xlsxSha256)) return 'xlsx'
  if (['image', 'pdf', 'pdf-chunk'].includes(props[PROPS.artifactKind])) return props[PROPS.artifactKind]
  fail('SUBMISSION_DRIVE_UNKNOWN_ARTIFACT', '분류할 수 없는 제출 ID 증거가 Drive에 있습니다.', { fileId: file.id })
}

async function verifyBinaryFile(drive, { file, expected, assertOwned, kind, weekId, originalsId, submissionId }) {
  const props = file.appProperties || {}
  let maxBytes
  let metadataValid
  if (kind === 'xlsx') {
    maxBytes = MAX_XLSX_BYTES
    metadataValid = file.mimeType === XLSX_MIME && exactParent(file, weekId)
      && props[PROPS.submissionId] === submissionId && props[PROPS.submissionKind] === 'final'
      && props[PROPS.xlsxSha256] === expected.sha256
  } else if (kind === 'pdf') {
    maxBytes = MAX_PDF_BYTES
    metadataValid = file.mimeType === PDF_MIME && exactParent(file, weekId)
      && props[PROPS.submissionId] === submissionId && props[PROPS.submissionKind] === 'final'
      && props[PROPS.artifactKind] === 'pdf' && props[PROPS.reportId] === expected.reportId
      && props[PROPS.sha256] === expected.sha256 && props[PROPS.byteLength] === String(expected.byteLength)
  } else {
    maxBytes = MAX_IMAGE_BYTES
    metadataValid = file.mimeType === expected.mimeType && exactParent(file, originalsId)
      && props[PROPS.submissionId] === submissionId && props[PROPS.submissionKind] === 'final'
      && props[PROPS.artifactKind] === 'image' && props[PROPS.key] === expected.key
      && props[PROPS.sha256] === expected.sha256
  }
  const size = finitePositiveSize(file.size, maxBytes)
  metadataValid = metadataValid && file.trashed === false && size !== null && MD5_RE.test(file.md5Checksum || '')
  if (kind !== 'xlsx') metadataValid = metadataValid && size === expected.byteLength
  if (!metadataValid) fail('SUBMISSION_DRIVE_ARTIFACT_CONFLICT', '제출 증거 메타데이터가 계약과 일치하지 않습니다.', { fileId: file.id, kind })
  const bytes = await readBoundedStream(drive, { fileId: file.id, maxBytes, assertOwned })
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const md5 = crypto.createHash('md5').update(bytes).digest('hex')
  if (bytes.length !== size || sha256 !== expected.sha256 || md5 !== file.md5Checksum.toLowerCase()) {
    fail('SUBMISSION_DRIVE_ARTIFACT_CONTENT_CONFLICT', '제출 증거 파일 내용이 계약과 일치하지 않습니다.', { fileId: file.id, kind })
  }
  if (kind === 'xlsx' && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) {
    fail('SUBMISSION_DRIVE_XLSX_INVALID', '제출 XLSX 파일이 ZIP 형식이 아닙니다.', { fileId: file.id })
  }
  if (kind === 'pdf' && bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    fail('SUBMISSION_DRIVE_PDF_INVALID', '제출 PDF 파일 형식이 올바르지 않습니다.', { fileId: file.id })
  }
  return bytes
}

async function verifyArtifacts(drive, { job, folders, originalsId, pins, assertOwned }) {
  const sid = driveQueryString(job.id)
  const ids = await listAllIds(drive, {
    query: `appProperties has { key='${PROPS.submissionId}' and value='${sid}' }`,
    assertOwned,
    code: 'SUBMISSION_DRIVE_ARTIFACT_LIST_UNCONFIRMED',
  })
  const classified = { xlsx: [], pdf: [], image: [], 'pdf-chunk': [] }
  const files = new Map()
  for (const id of ids) {
    const file = await readMetadata(drive, id, assertOwned)
    const kind = classifyEvidence(file, job.id)
    classified[kind].push(file)
    files.set(id, file)
  }
  if (classified.xlsx.length !== 1 || classified.xlsx[0].id !== pins.xlsx.fileId) {
    fail('SUBMISSION_DRIVE_XLSX_AMBIGUOUS', 'Drive의 XLSX 증거가 확정 파일과 정확히 일치하지 않습니다.', { fileIds: classified.xlsx.map(file => file.id) })
  }
  if (classified.pdf.length !== 1 || classified.pdf[0].id !== pins.pdf.fileId) {
    fail('SUBMISSION_DRIVE_PDF_AMBIGUOUS', 'Drive의 최종 PDF 증거가 확정 파일과 정확히 일치하지 않습니다.', { fileIds: classified.pdf.map(file => file.id) })
  }
  const imageByKey = new Map()
  for (const file of classified.image) {
    const key = file.appProperties?.[PROPS.key]
    if (!nonempty(key) || imageByKey.has(key)) fail('SUBMISSION_DRIVE_IMAGE_AMBIGUOUS', 'Drive 원본 이미지 증거 키가 없거나 중복됩니다.', { fileId: file.id, key })
    imageByKey.set(key, file)
  }
  const expectedKeys = job.expected.images.map(image => image.key).sort()
  if (JSON.stringify([...imageByKey.keys()].sort()) !== JSON.stringify(expectedKeys)
    || expectedKeys.some(key => imageByKey.get(key)?.id !== pins.confirmed[key].fileId)) {
    fail('SUBMISSION_DRIVE_IMAGE_AMBIGUOUS', 'Drive 원본 이미지 증거가 확정된 키와 정확히 일치하지 않습니다.')
  }
  const submissionBytes = await verifyBinaryFile(drive, {
    file: classified.xlsx[0], expected: { sha256: job.xlsxSha256 }, assertOwned,
    kind: 'xlsx', weekId: folders.weekId, submissionId: job.id,
  })
  await verifyBinaryFile(drive, {
    file: classified.pdf[0], expected: job.expected.pdf, assertOwned,
    kind: 'pdf', weekId: folders.weekId, submissionId: job.id,
  })
  for (const expected of job.expected.images) {
    await verifyBinaryFile(drive, {
      file: imageByKey.get(expected.key), expected, assertOwned,
      kind: 'image', originalsId, submissionId: job.id,
    })
  }
  return submissionBytes
}

async function readCurrentAggregate(drive, { monthId, yearMonth, assertOwned }) {
  const name = `전체집계_${yearMonth}`
  const safeMonth = driveQueryString(monthId)
  const safeName = driveQueryString(name)
  const ids = await listAllIds(drive, {
    query: `'${safeMonth}' in parents and name = '${safeName}' and mimeType = '${SHEET_MIME}' and trashed = false`,
    assertOwned,
    code: 'SUBMISSION_DRIVE_AGGREGATE_LIST_UNCONFIRMED',
  })
  if (ids.length !== 1) fail('SUBMISSION_DRIVE_AGGREGATE_AMBIGUOUS', '현재 월집계 Google Sheet가 정확히 하나가 아닙니다.', { fileIds: ids })
  const file = await readMetadata(drive, ids[0], assertOwned)
  if (file.name !== name || file.mimeType !== SHEET_MIME || file.trashed !== false || !exactParent(file, monthId)) {
    fail('SUBMISSION_DRIVE_AGGREGATE_CONFLICT', '현재 월집계 Google Sheet 위치 또는 이름이 일치하지 않습니다.', { fileId: file.id })
  }
  const bytes = await readBoundedStream(drive, {
    fileId: file.id,
    maxBytes: MAX_AGGREGATE_BYTES,
    exportMimeType: XLSX_MIME,
    assertOwned,
  })
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail('SUBMISSION_DRIVE_AGGREGATE_INVALID', '월집계 내보내기가 XLSX ZIP 형식이 아닙니다.')
  let workbook
  try {
    workbook = XLSX.read(bytes, { type: 'buffer' })
  } catch (cause) {
    fail('SUBMISSION_DRIVE_AGGREGATE_INVALID', '월집계 XLSX를 해석하지 못했습니다.', { cause: cause?.message || String(cause) })
  }
  return { fileId: file.id, workbook }
}

/**
 * Re-establish every durable Drive fact needed to finalize a schema-v2 job.
 * This helper is intentionally read-only; callers own lock acquisition and CAS.
 */
export async function verifySubmissionDrive(drive, { job, mainId, assertOwned }) {
  if (!drive?.files || typeof drive.files.list !== 'function' || typeof drive.files.get !== 'function'
    || typeof drive.files.export !== 'function' || typeof assertOwned !== 'function' || !nonempty(mainId)) {
    throw new TypeError('invalid submission Drive verification options')
  }
  let digest
  try {
    digest = submissionContractDigest(job)
  } catch (cause) {
    fail('SUBMISSION_DRIVE_CONTRACT_INVALID', '제출 계약 형식이 올바르지 않습니다.', { cause: cause?.message || String(cause) })
  }
  if (job.contractDigest !== digest) fail('SUBMISSION_DRIVE_CONTRACT_CONFLICT', '제출 계약 다이제스트가 일치하지 않습니다.')
  const pins = assertPinnedArtifactState(job)
  const folders = await verifyFolderChain(drive, { job, mainId, assertOwned })
  const originalsId = await findOriginalsFolder(drive, {
    weekId: folders.weekId,
    required: job.expected.images.length > 0,
    assertOwned,
  })
  const submissionBytes = await verifyArtifacts(drive, { job, folders, originalsId, pins, assertOwned })
  let submissionWorkbook
  try {
    submissionWorkbook = XLSX.read(submissionBytes, { type: 'buffer' })
  } catch (cause) {
    fail('SUBMISSION_DRIVE_XLSX_INVALID', '제출 XLSX를 해석하지 못했습니다.', { cause: cause?.message || String(cause) })
  }
  const current = await readCurrentAggregate(drive, {
    monthId: folders.monthId,
    yearMonth: job.scope.yearMonth,
    assertOwned,
  })
  const result = verifyAggregateSubmission({
    submissionWorkbook,
    aggregateWorkbook: current.workbook,
    expectedPersonName: job.scope.surveyorName,
  })
  if (result.receiptCount !== job.expected.receiptCount || result.totalAmount !== job.expected.totalAmount) {
    fail('SUBMISSION_DRIVE_EXPECTED_TOTAL_MISMATCH', '제출 XLSX의 건수 또는 합계가 제출 계약과 일치하지 않습니다.', {
      expectedReceiptCount: job.expected.receiptCount,
      expectedTotalAmount: job.expected.totalAmount,
      receiptCount: result.receiptCount,
      totalAmount: result.totalAmount,
    })
  }
  return { currentAggregateFileId: current.fileId, ...result }
}
