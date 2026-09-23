import crypto from 'crypto'
import { Readable } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { verifySubmissionDrive } from './_submissionDriveEvidence.js'
import { submissionContractDigest } from './_submissionJob.js'

const sid = '11111111-1111-4111-8111-111111111111'
const pdfReportId = '22222222-2222-4222-8222-222222222222'
const md5 = bytes => crypto.createHash('md5').update(bytes).digest('hex')
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
const workbookBytes = (sheets) => {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
const xlsxBytes = workbookBytes({ 영수증내역: [{
  날짜: '2026-09-11', 사용시간: '12:00', 사용처: '식당', 용도: '식비', 금액: 12000,
  승인번호: '1', 사업자번호: '', 카드번호: '', 비고: '', 영수증식별값: 'r1', 수정버전: 1,
}] })
const aggregateBytes = workbookBytes({
  날짜별집계: [{ 날짜: '2026-09-11', '합계(원)': 12000 }, { 날짜: '합계', '합계(원)': 12000 }],
  전체내역: [{ 날짜: '2026-09-11', 사용시간: '12:00', 이름: 'A조', 사용처: '식당', 용도: '식비', '금액(원)': 12000,
    승인번호: '1', 사업자번호: '', 카드번호: '', 비고: '', '영수증 식별값': 'r1', '수정 버전': 1 }],
  검토필요: [{ 안내: '' }], 팀별검토현황: [{ 안내: '' }], 변경이력: [{ 안내: '' }],
  검토기록: [{ '영수증 식별값': 'r1', '수정 버전': 1, '검토 상태': '', '담당자 메모': '', '추가 자료 요청': '', '검토 담당자': '', '검토 시각': '' }],
  검토안내: [{ 안내: '' }],
})
const pdfBytes = Buffer.from('%PDF-1.7\nvalid\n%%EOF')
const imageBytes = Buffer.from('valid-image-bytes')
const imageKey = sha(Buffer.from('receipt-image-key'))

function file(id, props = {}) {
  return { id, name: id, mimeType: 'application/vnd.google-apps.folder', parents: [], trashed: false, appProperties: {}, ...props }
}
function fixture({ withImage = false, jobOverrides = {} } = {}) {
  const scope = { yearMonth: '2026년 09월', surveyorName: 'A조', weekFolderName: '2026-09-01~2026-09-02' }
  const expected = { images: withImage ? [{ key: imageKey, sha256: sha(imageBytes), byteLength: imageBytes.length, mimeType: 'image/jpeg' }] : [], pdf: { reportId: pdfReportId, sha256: sha(pdfBytes), byteLength: pdfBytes.length,
    chunkCount: 1, chunkSha256: [sha(pdfBytes)], chunkByteLength: [pdfBytes.length] }, receiptCount: 1, totalAmount: 12000 }
  const base = { id: sid, kind: 'final', schemaVersion: 2, revision: 4, scope, expected, xlsxSha256: sha(xlsxBytes),
    status: 'xlsx_response_ready', response: { folders: { mainId: 'main', monthId: 'month', personId: 'person', weekId: 'week' } },
    artifacts: { xlsx: { status: 'confirmed', fileId: 'xlsx', sha256: sha(xlsxBytes) }, images: { status: 'confirmed', confirmed: {} },
      pdf: { status: 'confirmed', fileId: 'pdf', sha256: sha(pdfBytes), byteLength: pdfBytes.length },
      aggregate: { status: 'confirmed', fileId: 'old-aggregate' } } }
  if (withImage) base.artifacts.images = { status: 'confirmed', confirmed: {
    [imageKey]: { fileId: 'image', sha256: sha(imageBytes), byteLength: imageBytes.length, mimeType: 'image/jpeg' },
  } }
  const job = { ...base, ...jobOverrides }
  job.contractDigest = submissionContractDigest(job)
  const records = new Map([
    ['main', file('main', { name: 'root' })],
    ['month', file('month', { name: scope.yearMonth, parents: ['main'] })],
    ['person', file('person', { name: scope.surveyorName, parents: ['month'] })],
    ['week', file('week', { name: scope.weekFolderName, parents: ['person'] })],
    ['originals', file('originals', { name: '_원본', parents: ['week'] })],
    ['xlsx', file('xlsx', { name: '출장비.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parents: ['week'],
      size: String(xlsxBytes.length), md5Checksum: md5(xlsxBytes), bytes: xlsxBytes,
      appProperties: { receiptSubmissionId: sid, receiptSubmissionKind: 'final', receiptXlsxSha256: sha(xlsxBytes) } })],
    ['pdf', file('pdf', { name: '정산서.pdf', mimeType: 'application/pdf', parents: ['week'], size: String(pdfBytes.length),
      md5Checksum: md5(pdfBytes), bytes: pdfBytes, appProperties: { receiptSubmissionId: sid, receiptSubmissionKind: 'final',
        receiptArtifactKind: 'pdf', receiptPdfReportId: pdfReportId, receiptContentSha256: sha(pdfBytes), receiptContentByteLength: String(pdfBytes.length) } })],
    ['image', file('image', { name: '영수증.jpg', mimeType: 'image/jpeg', parents: ['originals'], size: String(imageBytes.length),
      md5Checksum: md5(imageBytes), bytes: imageBytes, appProperties: { receiptSubmissionId: sid, receiptSubmissionKind: 'final',
        receiptArtifactKind: 'image', receiptArtifactKey: imageKey, receiptContentSha256: sha(imageBytes), receiptContentByteLength: String(imageBytes.length) } })],
    ['current-aggregate', file('current-aggregate', { name: `전체집계_${scope.yearMonth}`, mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['month'] })],
  ])
  const files = {
    list: vi.fn(async ({ q }) => {
      if (q.includes('receiptSubmissionId')) return { data: { files: [{ id: 'xlsx' }, { id: 'pdf' }, ...(withImage ? [{ id: 'image' }] : [])] } }
      if (q.includes("name = '_원본'")) return { data: { files: withImage ? [{ id: 'originals' }] : [] } }
      if (q.includes('전체집계_')) return { data: { files: [{ id: 'current-aggregate' }] } }
      throw new Error(`unexpected query ${q}`)
    }),
    get: vi.fn(async ({ fileId, alt }) => {
      const record = records.get(fileId)
      if (!record) throw new Error('missing')
      if (alt === 'media') return { data: Readable.from([record.bytes]) }
      const { bytes: _bytes, ...metadata } = record
      return { data: metadata }
    }),
    export: vi.fn(async () => ({ data: Readable.from([aggregateBytes]) })),
    create: vi.fn(), update: vi.fn(),
  }
  return { job, drive: { files }, files, records }
}

describe('whole submission Drive evidence', () => {
  it('verifies current aggregate instead of the obsolete aggregate ID without mutating Drive', async () => {
    const { job, drive, files } = fixture()
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).resolves.toEqual({
      currentAggregateFileId: 'current-aggregate', receiptCount: 1, totalAmount: 12000, aggregateCount: 1, aggregateTotal: 12000,
    })
    expect(files.create).not.toHaveBeenCalled()
    expect(files.update).not.toHaveBeenCalled()
  })
  it('does not require an originals folder for a submission without images', async () => {
    const { job, drive, files } = fixture()
    await verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })
    expect(files.list.mock.calls.some(([args]) => args.q.includes("name = '_원본'"))).toBe(false)
  })
  it('verifies a pinned original image under the unique originals folder', async () => {
    const { job, drive, files } = fixture({ withImage: true })
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).resolves.toMatchObject({
      currentAggregateFileId: 'current-aggregate', receiptCount: 1, totalAmount: 12000,
    })
    expect(files.get).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'image', alt: 'media' }), expect.anything())
  })
  it.each([
    ['moved image', { parents: ['week'] }],
    ['trashed image', { trashed: true }],
    ['tampered image checksum', { md5Checksum: '0'.repeat(32) }],
  ])('fails closed for %s', async (_label, patch) => {
    const { job, drive, records } = fixture({ withImage: true })
    records.set('image', { ...records.get('image'), ...patch })
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: expect.stringMatching(/^SUBMISSION_DRIVE_/),
    })
  })
  it('rejects an ambiguous originals folder', async () => {
    const { job, drive, files } = fixture({ withImage: true })
    const original = files.list.getMockImplementation()
    files.list.mockImplementation(args => args.q.includes("name = '_원본'")
      ? Promise.resolve({ data: { files: [{ id: 'originals' }, { id: 'other-originals' }] } })
      : original(args))
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: 'SUBMISSION_DRIVE_ORIGINALS_FOLDER_AMBIGUOUS',
    })
  })
  it.each([
    ['moved XLSX', 'xlsx', { parents: ['archive'] }],
    ['trashed PDF', 'pdf', { trashed: true }],
    ['wrong PDF checksum', 'pdf', { md5Checksum: '0'.repeat(32) }],
  ])('fails closed for %s', async (_label, id, patch) => {
    const { job, drive, records, files } = fixture()
    records.set(id, { ...records.get(id), ...patch })
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: expect.stringMatching(/^SUBMISSION_DRIVE_/),
    })
    expect(files.create).not.toHaveBeenCalled()
  })
  it('rejects incomplete lists and never creates evidence', async () => {
    const { job, drive, files } = fixture()
    files.list.mockResolvedValue({ data: { files: [], incompleteSearch: true } })
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: expect.stringMatching(/^SUBMISSION_DRIVE_/),
    })
    expect(files.create).not.toHaveBeenCalled()
  })
  it('rejects oversized streams even when metadata was valid', async () => {
    const { job, drive, files } = fixture()
    const original = files.get.getMockImplementation()
    files.get.mockImplementation(async (args, options) => args.alt === 'media' && args.fileId === 'pdf'
      ? { data: Readable.from([pdfBytes, Buffer.alloc(20 * 1024 * 1024)]) }
      : original(args, options))
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: 'SUBMISSION_DRIVE_CONTENT_TOO_LARGE',
    })
  })
  it.each([
    ['missing aggregate', []],
    ['duplicate aggregate', [{ id: 'current-aggregate' }, { id: 'other-aggregate' }]],
  ])('rejects a %s', async (_label, aggregateFiles) => {
    const { job, drive, files } = fixture()
    const original = files.list.getMockImplementation()
    files.list.mockImplementation(args => args.q.includes('전체집계_')
      ? Promise.resolve({ data: { files: aggregateFiles } })
      : original(args))
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: 'SUBMISSION_DRIVE_AGGREGATE_AMBIGUOUS',
    })
  })
  it('rejects a moved aggregate and an export read failure', async () => {
    const moved = fixture()
    moved.records.set('current-aggregate', { ...moved.records.get('current-aggregate'), parents: ['archive'] })
    await expect(verifySubmissionDrive(moved.drive, { job: moved.job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: 'SUBMISSION_DRIVE_AGGREGATE_CONFLICT',
    })
    const unreadable = fixture()
    unreadable.files.export.mockRejectedValue(new Error('network'))
    await expect(verifySubmissionDrive(unreadable.drive, { job: unreadable.job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: 'SUBMISSION_DRIVE_CONTENT_UNCONFIRMED',
    })
  })
  it('rejects aggregate content that no longer contains the submitted receipt', async () => {
    const { job, drive, files } = fixture()
    const wrongAggregate = workbookBytes({
      날짜별집계: [{ 날짜: '합계', '합계(원)': 0 }], 전체내역: [], 검토필요: [{ 안내: '' }],
      팀별검토현황: [{ 안내: '' }], 변경이력: [{ 안내: '' }],
      검토기록: [{ '영수증 식별값': 'r1', '수정 버전': 1, '검토 상태': '', '담당자 메모': '', '추가 자료 요청': '', '검토 담당자': '', '검토 시각': '' }],
      검토안내: [{ 안내: '' }],
    })
    files.export.mockResolvedValue({ data: Readable.from([wrongAggregate]) })
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => true })).rejects.toMatchObject({
      code: expect.stringMatching(/^AGGREGATE_|^LEGACY_/),
    })
  })
  it('fails if ownership is lost after Drive I/O has begun', async () => {
    const { job, drive, files } = fixture()
    let checks = 0
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => ++checks < 4 })).rejects.toMatchObject({
      code: 'SUBMISSION_DRIVE_LOCK_LOST',
    })
    expect(files.get).toHaveBeenCalled()
  })
  it('stops immediately when lock ownership is lost', async () => {
    const { job, drive, files } = fixture()
    await expect(verifySubmissionDrive(drive, { job, mainId: 'main', assertOwned: async () => false })).rejects.toMatchObject({
      code: 'SUBMISSION_DRIVE_LOCK_LOST',
    })
    expect(files.get).not.toHaveBeenCalled()
  })
})
