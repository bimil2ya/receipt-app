import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { preflightXlsxSubmission } from './upload.js'

function encodeWorkbook(rows) {
  const sheet = XLSX.utils.json_to_sheet(rows)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '사용내역')
  return XLSX.write(book, { type: 'base64', bookType: 'xlsx' })
}

describe('XLSX final-submission preflight', () => {
  it('parses rows and produces a stable server-side SHA-256 before Drive work', () => {
    const payload = encodeWorkbook([{ 날짜: '2026-09-11', 사용처: '주유소', 금액: 12000, 용도: '교통' }])
    const first = preflightXlsxSubmission({ xlsxBase64: payload })
    const second = preflightXlsxSubmission({ xlsxBase64: payload })

    expect(first.rows).toHaveLength(1)
    expect(first.rows[0]).toMatchObject({ storeName: '주유소', amount: 12000 })
    expect(first.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(first.sha256).toBe(second.sha256)
  })

  it('rejects unreadable-or-empty and unsafe-amount workbooks before a submission can be reserved', () => {
    // SheetJS tolerates some arbitrary byte streams as an empty worksheet;
    // either interpretation must stop before reservation/Drive mutation.
    expect(() => preflightXlsxSubmission({ xlsxBase64: 'not an xlsx' })).toThrow(/빈 영수증 데이터/)
    expect(() => preflightXlsxSubmission({ xlsxBase64: encodeWorkbook([]) })).toThrow(/빈 영수증 데이터/)
    expect(() => preflightXlsxSubmission({
      xlsxBase64: encodeWorkbook([
        { 날짜: '2026-09-11', 사용처: '초과1', 금액: Number.MAX_SAFE_INTEGER },
        { 날짜: '2026-09-11', 사용처: '초과2', 금액: 1 },
      ]),
    })).toThrow(/안전한 정수 범위를 넘었습니다/)
  })
})
