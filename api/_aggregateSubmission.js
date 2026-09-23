import * as XLSX from 'xlsx'

const PROJECTION = [
  ['날짜', '날짜'], ['사용시간', '사용시간'], ['사용처', '사용처'],
  ['용도', '용도'], ['금액', '금액(원)'], ['승인번호', '승인번호'],
  ['사업자번호', '사업자번호'], ['카드번호', '카드번호'], ['비고', '비고'],
  ['영수증식별값', '영수증 식별값'], ['수정버전', '수정 버전'],
]
const REQUIRED_TABS = ['날짜별집계', '전체내역', '검토필요', '팀별검토현황', '변경이력', '검토기록', '검토안내']
// Match the existing aggregate readback schema; editable values remain ignored.
const REQUIRED_REVIEW_COLUMNS = ['영수증 식별값', '수정 버전', '검토 상태', '담당자 메모', '추가 자료 요청', '검토 담당자', '검토 시각']

function fail(code, message) {
  const error = new Error(message)
  error.code = code
  throw error
}

function readSheet(workbook, name, required, code) {
  const sheet = workbook?.Sheets?.[name]
  if (!sheet) fail(code, `필수 시트가 없습니다: ${name}`)
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' })
  const headers = matrix[0] || []
  const present = headers.filter(value => value !== '')
  if (new Set(present).size !== present.length || required.some(header => !headers.includes(header))) {
    fail(code, `필수 열이 없거나 중복되었습니다: ${name}`)
  }
  // Avoid SheetJS's object-header conversion, which caches formatted header
  // text on the caller's cells. Raw matrix values keep this verifier read-only.
  return matrix.slice(1).map(values => Object.fromEntries(
    headers.flatMap((header, index) => header === '' ? [] : [[header, values[index] ?? '']]),
  ))
}

function integer(value, positive = false) {
  // Blank cells and coercible values such as booleans must never become zero.
  if (!(typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value)))) {
    fail('AGGREGATE_INVALID_NUMBER', '금액 또는 수정 버전이 정수가 아닙니다.')
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || (positive && number < 1)) {
    fail('AGGREGATE_INVALID_NUMBER', '금액 또는 수정 버전이 안전한 정수 범위를 벗어났습니다.')
  }
  return number
}

function sum(rows, column) {
  return rows.reduce((total, row) => {
    const next = total + integer(row[column])
    if (!Number.isSafeInteger(next)) fail('AGGREGATE_AMOUNT_OVERFLOW', '집계 합계가 안전한 정수 범위를 벗어났습니다.')
    return next
  }, 0)
}

function indexRows(rows, idColumn, revisionColumn, missingCode) {
  const indexed = new Map()
  for (const row of rows) {
    const id = String(row[idColumn] ?? '')
    if (!id.trim()) fail(missingCode, '영수증 식별값이 없어 대조할 수 없습니다.')
    if (indexed.has(id)) fail('AGGREGATE_RECEIPT_ID_DUPLICATE', '영수증 식별값이 중복되었습니다.')
    integer(row[revisionColumn], true)
    indexed.set(id, row)
  }
  return indexed
}

/**
 * Pure comparison of already parsed workbooks. This is content evidence only:
 * callers must separately verify Drive identity, current folder, bytes and locks.
 * It neither mutates workbooks nor authorizes whole-submission completion.
 */
export function verifyAggregateSubmission({ submissionWorkbook, aggregateWorkbook, expectedPersonName }) {
  if (typeof expectedPersonName !== 'string' || !expectedPersonName.trim()) {
    fail('SUBMISSION_PERSON_UNCONFIRMED', '저장된 제출 팀 이름이 필요합니다.')
  }
  const source = readSheet(submissionWorkbook, '영수증내역', PROJECTION.map(([column]) => column), 'SUBMISSION_WORKBOOK_UNVERIFIABLE')
  if (!source.length) fail('SUBMISSION_WORKBOOK_UNVERIFIABLE', '제출 내역이 비어 있습니다.')
  // Legacy aggregate exports must not be mistaken for comparable current data.
  readSheet(aggregateWorkbook, '전체내역', ['영수증 식별값', '수정 버전'], 'LEGACY_AGGREGATE_UNVERIFIABLE')
  for (const name of REQUIRED_TABS) {
    if (!aggregateWorkbook?.Sheets?.[name]) fail('AGGREGATE_SCHEMA_UNVERIFIABLE', `필수 시트가 없습니다: ${name}`)
  }
  readSheet(aggregateWorkbook, '검토기록', REQUIRED_REVIEW_COLUMNS, 'AGGREGATE_SCHEMA_UNVERIFIABLE')
  const detail = readSheet(aggregateWorkbook, '전체내역', [...PROJECTION.map(([, column]) => column), '이름'], 'AGGREGATE_SCHEMA_UNVERIFIABLE')
  const sourceById = indexRows(source, '영수증식별값', '수정버전', 'SUBMISSION_WORKBOOK_UNVERIFIABLE')
  const detailById = indexRows(detail, '영수증 식별값', '수정 버전', 'LEGACY_AGGREGATE_UNVERIFIABLE')
  const sourceTotal = sum(source, '금액')
  const aggregateTotal = sum(detail, '금액(원)')
  const matched = []
  for (const [id, row] of sourceById) {
    const target = detailById.get(id)
    if (!target) fail('AGGREGATE_SUBMISSION_MISSING', '집계에 제출 영수증이 누락되었습니다.')
    if (target['이름'] !== expectedPersonName) fail('AGGREGATE_SUBMISSION_MISMATCH', '집계의 제출 팀이 일치하지 않습니다.')
    for (const [sourceColumn, targetColumn] of PROJECTION) {
      const numeric = sourceColumn === '금액' || sourceColumn === '수정버전'
      const left = numeric ? integer(row[sourceColumn], sourceColumn === '수정버전') : String(row[sourceColumn] ?? '')
      const right = numeric ? integer(target[targetColumn], sourceColumn === '수정버전') : String(target[targetColumn] ?? '')
      if (left !== right) fail('AGGREGATE_SUBMISSION_MISMATCH', `집계와 제출 내역이 일치하지 않습니다: ${targetColumn}`)
    }
    matched.push(target)
  }
  if (matched.length !== source.length || sum(matched, '금액(원)') !== sourceTotal) {
    fail('AGGREGATE_SUBMISSION_MISMATCH', '집계의 해당 제출 건수 또는 합계가 일치하지 않습니다.')
  }
  const pivot = readSheet(aggregateWorkbook, '날짜별집계', ['날짜', '합계(원)'], 'AGGREGATE_SCHEMA_UNVERIFIABLE')
  const totals = pivot.filter(row => row['날짜'] === '합계')
  if (totals.length !== 1 || integer(totals[0]['합계(원)']) !== aggregateTotal) {
    fail('AGGREGATE_TOTAL_MISMATCH', '월집계 합계와 전체내역 합계가 일치하지 않습니다.')
  }
  return { receiptCount: source.length, totalAmount: sourceTotal, aggregateCount: detail.length, aggregateTotal }
}
