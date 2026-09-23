import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { buildDetailRows, buildReviewLedgerRows, parseXlsxRow } from './_aggregateUtils.js'
import { verifyAggregateSubmission } from './_aggregateSubmission.js'

const originalColumns = ['날짜', '사용시간', '이름', '사용처', '용도', '금액(원)', '승인번호', '사업자번호', '카드번호', '비고']
const sourceRow = (id, amount = 3000) => ({
  날짜: '2026-09-13', 사용시간: '12:30', 사용처: '식당', 용도: '식비', 금액: amount,
  승인번호: '00123', 사업자번호: '001-01', 카드번호: '0010', 비고: '',
  영수증식별값: id, 수정버전: 2,
})
function sheet(workbook, name, rows) {
  workbook.Sheets[name] = XLSX.utils.json_to_sheet(rows)
  if (!workbook.SheetNames.includes(name)) workbook.SheetNames.push(name)
}
function fixture() {
  const source = [sourceRow('r1'), sourceRow('r2', 4000)]
  const detail = buildDetailRows([
    ...source.map(row => parseXlsxRow(row, 'A조')),
    parseXlsxRow(sourceRow('other', 9000), 'B조'),
  ], ['A조', 'B조'])
  const submissionWorkbook = XLSX.utils.book_new()
  const aggregateWorkbook = XLSX.utils.book_new()
  sheet(submissionWorkbook, '영수증내역', source)
  sheet(aggregateWorkbook, '전체내역', detail)
  sheet(aggregateWorkbook, '날짜별집계', [{ 날짜: '2026-09-13', '합계(원)': 16000 }, { 날짜: '합계', '합계(원)': 16000 }])
  for (const name of ['검토필요', '팀별검토현황', '변경이력', '검토기록', '검토안내']) {
    sheet(aggregateWorkbook, name, [{ 안내: '' }])
  }
  sheet(aggregateWorkbook, '검토기록', buildReviewLedgerRows(source.map(row => parseXlsxRow(row, 'A조'))))
  const args = { submissionWorkbook, aggregateWorkbook, expectedPersonName: 'A조' }
  return { args, source, detail }
}
const roundtrip = workbook => XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
function rejectsCode(args, code) {
  let error
  try { verifyAggregateSubmission(args) } catch (caught) { error = caught }
  expect(error?.code).toBe(code)
}

describe('aggregate submission content evidence', () => {
  it('appends identity columns without changing existing column order and survives XLSX serialization', () => {
    const { args, detail } = fixture()
    expect(Object.keys(detail[0])).toEqual([...originalColumns, '영수증 식별값', '수정 버전'])
    expect(detail[0]).toMatchObject({ '영수증 식별값': 'r1', '수정 버전': 2 })
    expect(verifyAggregateSubmission({
      ...args, submissionWorkbook: roundtrip(args.submissionWorkbook), aggregateWorkbook: roundtrip(args.aggregateWorkbook),
    })).toEqual({ receiptCount: 2, totalAmount: 7000, aggregateCount: 3, aggregateTotal: 16000 })
  })
  it('matches by ID despite row reordering and other teams, without mutating workbooks', () => {
    const { args, source, detail } = fixture()
    sheet(args.submissionWorkbook, '영수증내역', [...source].reverse())
    sheet(args.aggregateWorkbook, '전체내역', [...detail].reverse())
    const before = JSON.stringify(args)
    expect(verifyAggregateSubmission(args).totalAmount).toBe(7000)
    expect(JSON.stringify(args)).toBe(before)
  })
  it('ignores office review notes and preserved historical review rows', () => {
    const { args } = fixture()
    sheet(args.aggregateWorkbook, '검토기록', buildReviewLedgerRows(
      [{ id: 'past', revision: 1 }],
      [{ '영수증 식별값': 'past', '담당자 메모': '유선 확인 후 수정', '검토 상태': '자유 상태' }],
    ))
    expect(verifyAggregateSubmission(args).receiptCount).toBe(2)
  })
  it('does not assume revision 1 when building detail rows with missing source revision', () => {
    expect(buildDetailRows([{ id: 'old' }], [])[0]['수정 버전']).toBe('')
  })
  it('rejects a legacy export without the appended columns', () => {
    const { args, detail } = fixture()
    sheet(args.aggregateWorkbook, '전체내역', detail.map(row => Object.fromEntries(originalColumns.map(key => [key, row[key]]))))
    rejectsCode(args, 'LEGACY_AGGREGATE_UNVERIFIABLE')
  })
  it.each(['', '   '])('rejects blank legacy aggregate ID %j, even in another team', value => {
    const { args, detail } = fixture()
    detail[2]['영수증 식별값'] = value
    sheet(args.aggregateWorkbook, '전체내역', detail)
    rejectsCode(args, 'LEGACY_AGGREGATE_UNVERIFIABLE')
  })
  it.each(['source', 'aggregate'])('rejects duplicate IDs in %s', target => {
    const { args, source, detail } = fixture()
    if (target === 'source') sheet(args.submissionWorkbook, '영수증내역', [source[0], source[0]])
    else sheet(args.aggregateWorkbook, '전체내역', [...detail, detail[0]])
    rejectsCode(args, 'AGGREGATE_RECEIPT_ID_DUPLICATE')
  })
  it('rejects source IDs that cannot be matched', () => {
    const { args, source } = fixture()
    source[0].영수증식별값 = ''
    sheet(args.submissionWorkbook, '영수증내역', source)
    rejectsCode(args, 'SUBMISSION_WORKBOOK_UNVERIFIABLE')
  })
  it('rejects a missing submitted receipt', () => {
    const { args, detail } = fixture()
    sheet(args.aggregateWorkbook, '전체내역', detail.slice(1))
    rejectsCode(args, 'AGGREGATE_SUBMISSION_MISSING')
  })
  it.each(['날짜', '사용시간', '이름', '사용처', '용도', '승인번호', '사업자번호', '카드번호', '비고'])('rejects same-ID mismatch in %s', column => {
    const { args, detail } = fixture()
    detail[0][column] = 'changed'
    sheet(args.aggregateWorkbook, '전체내역', detail)
    rejectsCode(args, 'AGGREGATE_SUBMISSION_MISMATCH')
  })
  it.each(['금액(원)', '수정 버전'])('rejects same-ID numeric mismatch in %s', column => {
    const { args, detail } = fixture()
    detail[0][column] += 1
    sheet(args.aggregateWorkbook, '전체내역', detail)
    rejectsCode(args, 'AGGREGATE_SUBMISSION_MISMATCH')
  })
  it.each([0, -1, 1.5, '', true, Number.MAX_SAFE_INTEGER + 1])('rejects invalid revision %j', revision => {
    const { args, detail } = fixture()
    detail[0]['수정 버전'] = revision
    sheet(args.aggregateWorkbook, '전체내역', detail)
    rejectsCode(args, 'AGGREGATE_INVALID_NUMBER')
  })
  it.each(['', true, 'NaN', 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid amount %j even for another team', amount => {
    const { args, detail } = fixture()
    detail[2]['금액(원)'] = amount
    sheet(args.aggregateWorkbook, '전체내역', detail)
    rejectsCode(args, 'AGGREGATE_INVALID_NUMBER')
  })
  it('rejects aggregate total overflow', () => {
    const { args, detail } = fixture()
    detail[2]['금액(원)'] = Number.MAX_SAFE_INTEGER
    sheet(args.aggregateWorkbook, '전체내역', detail)
    rejectsCode(args, 'AGGREGATE_AMOUNT_OVERFLOW')
  })
  it('rejects a wrong monthly grand total separately from submission subtotal', () => {
    const { args } = fixture()
    sheet(args.aggregateWorkbook, '날짜별집계', [{ 날짜: '합계', '합계(원)': 7000 }])
    rejectsCode(args, 'AGGREGATE_TOTAL_MISMATCH')
  })
  it.each(['검토기록', '날짜별집계'])('rejects missing required tab %s', name => {
    const { args } = fixture()
    delete args.aggregateWorkbook.Sheets[name]
    rejectsCode(args, 'AGGREGATE_SCHEMA_UNVERIFIABLE')
  })
  it('rejects duplicate headers rather than trusting auto-renamed columns', () => {
    const { args } = fixture()
    args.submissionWorkbook.Sheets['영수증내역'] = XLSX.utils.aoa_to_sheet([['금액', '금액'], [100, 200]])
    rejectsCode(args, 'SUBMISSION_WORKBOOK_UNVERIFIABLE')
  })
  it.each(['영수증 식별값', '수정 버전', '검토 상태', '담당자 메모', '추가 자료 요청', '검토 담당자', '검토 시각'])('rejects a missing review header %s without requiring any review value', column => {
    const { args } = fixture()
    const rows = XLSX.utils.sheet_to_json(args.aggregateWorkbook.Sheets['검토기록'])
    rows.forEach(row => { delete row[column] })
    sheet(args.aggregateWorkbook, '검토기록', rows)
    rejectsCode(args, 'AGGREGATE_SCHEMA_UNVERIFIABLE')
  })
  it('rejects duplicate review headers', () => {
    const { args } = fixture()
    const rows = XLSX.utils.sheet_to_json(args.aggregateWorkbook.Sheets['검토기록'], { header: 1 })
    rows[0].push('담당자 메모')
    args.aggregateWorkbook.Sheets['검토기록'] = XLSX.utils.aoa_to_sheet(rows)
    rejectsCode(args, 'AGGREGATE_SCHEMA_UNVERIFIABLE')
  })
})
