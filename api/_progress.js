import { Readable } from 'stream'
import * as XLSX from 'xlsx'
import { driveQueryString, getOrCreateFolder, getYearMonth, MAIN_FOLDER_ID } from './driveUtils.js'
import { hasControlChars, isValidSubmitterDeviceId, isValidSubmitterName } from './_uploadUtils.js'
import { acquireProgressLock, releaseSubmissionLock } from './_submissionLock.js'

// 현장 폰이 조용히 보내는 "진행 중" 목록. 공식 제출(월 전체집계·카카오 알림)과 완전히 분리해
// MAIN/_진행현황/ 아래에만 쓴다. 월 폴더 안에 두면 월집계가 조로 오인하고, 조 폴더에 두면
// Drive 저장의 정리 로직이 보관함으로 옮긴다.
export const PROGRESS_ROOT_NAME = '_진행현황'
export const MAX_PROGRESS_RECEIPTS = 500
const JSON_MIME = 'application/json'
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function text(value, max) {
  const result = String(value ?? '').trim()
  if (result.length > max || hasControlChars(result)) throw new TypeError('진행 공유 항목의 글자가 너무 길거나 허용되지 않는 문자가 있습니다.')
  return result
}

function optionalDate(value) {
  const result = String(value ?? '').trim()
  if (result && !DATE_RE.test(result)) throw new TypeError('날짜 형식이 올바르지 않습니다.')
  return result
}

export function validateProgressPayload(body) {
  if (!body || typeof body !== 'object') throw new TypeError('진행 공유 내용이 없습니다.')
  const teamNames = text(body.teamNames, 80)
  if (!teamNames || /[\\/:*?"<>|]/.test(teamNames)) throw new TypeError('조 이름이 올바르지 않습니다.')
  const tripStartDate = String(body.tripStartDate ?? '')
  if (!DATE_RE.test(tripStartDate)) throw new TypeError('출장 시작일이 필요합니다.')
  const tripEndDate = optionalDate(body.tripEndDate)
  if (!isValidSubmitterDeviceId(body.submitterDeviceId)) throw new TypeError('기기 정보가 올바르지 않습니다.')
  if (!Array.isArray(body.receipts) || body.receipts.length > MAX_PROGRESS_RECEIPTS) throw new TypeError('영수증 목록이 올바르지 않습니다.')
  const receipts = body.receipts.map(item => {
    if (!item || typeof item !== 'object') throw new TypeError('영수증 항목이 올바르지 않습니다.')
    const amount = Number(item.totalAmount ?? 0)
    if (!Number.isSafeInteger(amount)) throw new TypeError('금액이 올바르지 않습니다.')
    return {
      id: text(item.id, 64),
      date: optionalDate(item.date),
      useTime: text(item.useTime, 20),
      storeName: text(item.storeName, 100),
      category: text(item.category, 30),
      totalAmount: amount,
      approvalNum: text(item.approvalNum, 40),
      note: text(item.note, 200),
    }
  })
  return {
    teamNames,
    tripStartDate,
    tripEndDate,
    submitterName: isValidSubmitterName(body.submitterName) ? body.submitterName.trim() : '',
    submitterDeviceId: body.submitterDeviceId,
    submitted: body.submitted === true,
    receipts,
  }
}

export function progressFileName({ tripStartDate, submitterDeviceId }) {
  return `진행_${tripStartDate}_${submitterDeviceId}.json`
}

function kstLabel(iso) {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return ''
  const kst = new Date(time + 9 * 3600 * 1000)
  const pad = value => String(value).padStart(2, '0')
  return `${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`
}

// 같은 기기·같은 출장의 기록이 여럿이면(동시 저장 등) 가장 최근 공유만 쓴다.
export function latestRecords(records) {
  const byKey = new Map()
  for (const record of records) {
    const key = `${record.submitterDeviceId}|${record.tripStartDate}`
    const current = byKey.get(key)
    if (!current || String(record.sharedAt) > String(current.sharedAt)) byKey.set(key, record)
  }
  return [...byKey.values()].sort((a, b) => a.teamNames.localeCompare(b.teamNames, 'ko')
    || a.tripStartDate.localeCompare(b.tripStartDate)
    || String(a.submitterName).localeCompare(String(b.submitterName), 'ko'))
}

export function buildProgressWorkbook(records) {
  const rows = latestRecords(records)
  const status = record => (record.submitted ? '제출 완료' : '진행 중')
  const submitter = record => record.submitterName || `기기 ${record.submitterDeviceId.slice(0, 8)}`
  const tripRange = record => (record.tripEndDate && record.tripEndDate !== record.tripStartDate
    ? `${record.tripStartDate}~${record.tripEndDate}` : record.tripStartDate)
  const summary = rows.map(record => ({
    '조': record.teamNames,
    '제출자': submitter(record),
    '출장기간': tripRange(record),
    '상태': status(record),
    '건수': record.receipts.length,
    '합계(원)': record.receipts.reduce((sum, item) => sum + item.totalAmount, 0),
    '마지막 공유(KST)': kstLabel(record.sharedAt),
  }))
  const details = rows.flatMap(record => record.receipts.map(item => ({
    '조': record.teamNames,
    '제출자': submitter(record),
    '상태': status(record),
    '날짜': item.date,
    '사용시간': item.useTime,
    '사용처': item.storeName,
    '용도': item.category,
    '금액(원)': item.totalAmount,
    '승인번호': item.approvalNum,
    '비고': item.note,
    '마지막 공유(KST)': kstLabel(record.sharedAt),
  })))
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summary.length ? summary : [{ '조': '' }]), '요약')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(details.length ? details : [{ '조': '' }]), '영수증목록')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['진행현황 안내'],
    ['내용', '현장 앱이 출장 중에 자동으로 공유한 영수증 목록입니다(사진 제외).'],
    ['기준', '공식 정산 자료는 월 폴더의 전체집계를 기준으로 합니다. 이 파일은 참고용입니다.'],
    ['상태', '진행 중 = 아직 Drive 저장 전이거나 저장 뒤 내용이 바뀜 / 제출 완료 = 현재 목록이 Drive 저장까지 끝남'],
    ['갱신', '현장 앱이 켜져 있고 목록이 바뀌었을 때 자동으로 갱신됩니다. 마지막 공유 시각으로 최신 여부를 확인하세요.'],
  ]), '안내')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}

async function listAll(drive, q, fields = 'files(id,name)') {
  const files = []
  let pageToken
  do {
    const { data } = await drive.files.list({ q, fields: `nextPageToken,${fields}`, pageSize: 1000, pageToken })
    files.push(...(data.files || []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return files
}

// 이름이 같은 파일이 있으면 내용만 바꿔 파일 ID(사무실 즐겨찾기)를 유지한다.
async function upsertFile(drive, { parentId, name, mimeType, buffer, appProperties }) {
  const [existing] = await listAll(drive, `'${driveQueryString(parentId)}' in parents and name = '${driveQueryString(name)}' and trashed = false`)
  if (existing) {
    await drive.files.update({ fileId: existing.id, media: { mimeType, body: Readable.from(buffer) }, fields: 'id' })
    return existing.id
  }
  const created = await drive.files.create({
    requestBody: { name, parents: [parentId], mimeType, ...(appProperties ? { appProperties } : {}) },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id',
  })
  return created.data.id
}

async function readRecords(drive, folderId) {
  const records = []
  for (const file of await listAll(drive, `'${driveQueryString(folderId)}' in parents and trashed = false and mimeType = '${JSON_MIME}'`)) {
    try {
      const res = await drive.files.get({ fileId: file.id, alt: 'media' }, { responseType: 'arraybuffer' })
      const record = JSON.parse(Buffer.from(res.data).toString('utf8'))
      if (record?.schema === 1 && Array.isArray(record.receipts) && record.submitterDeviceId) records.push(record)
    } catch (error) {
      console.warn('진행 공유 기록 읽기 실패:', file.name, error.message)
    }
  }
  return records
}

export async function saveProgressShare(drive, payload, {
  now = () => new Date(),
  acquireLock = acquireProgressLock,
  releaseLock = releaseSubmissionLock,
} = {}) {
  const record = { schema: 1, ...payload, sharedAt: now().toISOString() }
  const yearMonth = getYearMonth(payload.tripStartDate)
  const rootId = await getOrCreateFolder(drive, PROGRESS_ROOT_NAME, MAIN_FOLDER_ID)
  const monthId = await getOrCreateFolder(drive, yearMonth, rootId)
  await upsertFile(drive, {
    parentId: monthId,
    name: progressFileName(payload),
    mimeType: JSON_MIME,
    buffer: Buffer.from(JSON.stringify(record)),
    appProperties: { receiptProgressDevice: payload.submitterDeviceId, receiptProgressTrip: payload.tripStartDate },
  })
  // 목록 저장은 끝났다. 진행현황 파일 재작성이 겹치면 이번엔 건너뛰고 다음 공유 때 반영한다.
  const lock = await acquireLock({ yearMonth })
  if (!lock.acquired) return { sharedAt: record.sharedAt, sheetUpdated: false }
  try {
    const buffer = buildProgressWorkbook(await readRecords(drive, monthId))
    await upsertFile(drive, { parentId: rootId, name: `진행현황_${yearMonth}.xlsx`, mimeType: XLSX_MIME, buffer })
    return { sharedAt: record.sharedAt, sheetUpdated: true }
  } finally {
    await releaseLock(lock).catch(() => {})
  }
}
