import { describe, expect, it, vi } from 'vitest'
import crypto from 'crypto'
import {
  buildFinalXlsxAppProperties,
  findFinalXlsxEvidence,
  resolveFinalXlsxEvidence,
} from './upload.js'

const submissionId = '9f7dfaf1-a4bd-44f1-83e1-c2a1e4f27f20'
const sha256 = 'a'.repeat(64)
const options = {
  weekId: 'week',
  submissionId,
  sha256,
  fileName: '출장비_20260911.xlsx',
  buffer: Buffer.from('xlsx bytes'),
}

function evidence(id = 'xlsx-1') {
  return {
    id,
    name: options.fileName,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    parents: ['week'],
    trashed: false,
    size: String(options.buffer.length),
    md5Checksum: crypto.createHash('md5').update(options.buffer).digest('hex'),
    appProperties: buildFinalXlsxAppProperties(options),
  }
}

function recoveredDrive(files, readbacks = {}) {
  return { files: {
    list: vi.fn(async ({ pageToken }) => ({ data: pageToken ? { files: [] } : { files } })),
    get: vi.fn(async ({ fileId }) => ({ data: readbacks[fileId] || files.find((file) => file.id === fileId) })),
    create: vi.fn(),
  } }
}

describe('final XLSX Drive evidence', () => {
  it('recovers XLSX when the same submission also has image, PDF and chunk evidence', async () => {
    const other = ['image', 'pdf', 'pdf-chunk'].map(kind => ({
      id: kind, mimeType: kind === 'image' ? 'image/png' : kind === 'pdf' ? 'application/pdf' : 'application/octet-stream',
      appProperties: { receiptSubmissionId: submissionId, receiptArtifactKind: kind },
    }))
    const drive = recoveredDrive([evidence(), ...other])
    await expect(resolveFinalXlsxEvidence(drive, options)).resolves.toMatchObject({ status: 'recovered', id: 'xlsx-1' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })
  it.each(['image', 'pdf', 'pdf-chunk'])('never skips an XLSX hash property tagged as %s', async kind => {
    const candidate = { ...evidence(), mimeType: 'application/pdf', appProperties: {
      receiptSubmissionId: submissionId, receiptArtifactKind: kind, receiptXlsxSha256: '',
    } }
    const drive = recoveredDrive([candidate])
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })
  it.each([
    { receiptSubmissionId: submissionId },
    { receiptSubmissionId: submissionId, receiptArtifactKind: 'unknown' },
    { receiptSubmissionId: 'other', receiptArtifactKind: 'image' },
  ])('does not ignore an unclassified or different-submission file', async appProperties => {
    const drive = recoveredDrive([{ id: 'unknown', appProperties }])
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })
  it('does not skip a readback with a different file ID', async () => {
    const drive = recoveredDrive([{ id: 'listed' }], { listed: {
      id: 'different', appProperties: { receiptSubmissionId: submissionId, receiptArtifactKind: 'image' },
    } })
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_CONFLICT' })
  })
  it.each([{ parents: ['archive'] }, { trashed: true }])('still rejects moved or deleted XLSX among mixed artifacts', async patch => {
    const drive = recoveredDrive([{ ...evidence(), ...patch }, {
      id: 'image', appProperties: { receiptSubmissionId: submissionId, receiptArtifactKind: 'image' },
    }])
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })
  it.each([{}, { data: {} }, { data: { files: null } }, { data: { files: [], incompleteSearch: true } },
    { data: { files: [], incompleteSearch: 'false' } }, { data: { files: [{ id: 1 }] } },
    { data: { files: [], nextPageToken: 4 } }, { data: { files: [], nextPageToken: '' } },
  ])('never treats an incomplete or malformed list as no evidence', async response => {
    const drive = recoveredDrive([])
    drive.files.list.mockResolvedValue(response)
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_LIST_UNCONFIRMED' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })
  it('rejects repeated pagination tokens without creating files', async () => {
    const drive = recoveredDrive([])
    drive.files.list.mockResolvedValue({ data: { files: [], nextPageToken: 'repeat' } })
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_LIST_UNCONFIRMED' })
    expect(drive.files.list).toHaveBeenCalledTimes(2)
    expect(drive.files.create).not.toHaveBeenCalled()
  })
  it('returns one exact, read-back Drive witness without creating another XLSX', async () => {
    const drive = recoveredDrive([evidence()])
    await expect(resolveFinalXlsxEvidence(drive, options)).resolves.toMatchObject({ status: 'recovered', id: 'xlsx-1' })
    expect(drive.files.create).not.toHaveBeenCalled()
    expect(drive.files.list.mock.calls[0][0].q).toContain("appProperties has { key='receiptSubmissionId'")
    expect(drive.files.list.mock.calls[0][0].q).not.toContain("'week' in parents")
    expect(drive.files.list.mock.calls[0][0].q).not.toContain('trashed = false')
    expect(drive.files.get).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'xlsx-1' }))
  })

  it('creates appProperties and requires Drive readback before confirming a new XLSX', async () => {
    const created = evidence('xlsx-new')
    const drive = { files: {
      list: vi.fn(async () => ({ data: { files: [] } })),
      create: vi.fn(async () => ({ data: { id: 'xlsx-new' } })),
      get: vi.fn(async () => ({ data: created })),
    } }
    await expect(resolveFinalXlsxEvidence(drive, options)).resolves.toMatchObject({ status: 'uploaded', id: 'xlsx-new' })
    expect(drive.files.create).toHaveBeenCalledWith(expect.objectContaining({
      requestBody: expect.objectContaining({ appProperties: buildFinalXlsxAppProperties(options) }),
    }))
    expect(drive.files.get).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'xlsx-new' }))
  })

  it('does not guess when Drive has conflicting or duplicate witnesses', async () => {
    const conflicting = { ...evidence(), appProperties: buildFinalXlsxAppProperties({ submissionId, sha256: 'b'.repeat(64) }) }
    const conflictDrive = recoveredDrive([conflicting])
    await expect(findFinalXlsxEvidence(conflictDrive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_CONFLICT' })

    const duplicateDrive = recoveredDrive([evidence('one'), evidence('two')])
    await expect(findFinalXlsxEvidence(duplicateDrive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_AMBIGUOUS' })
  })

  it.each([
    ['a wrong MIME type', { mimeType: 'application/pdf' }],
    ['a moved file', { parents: ['other-week'] }],
    ['a trashed file', { trashed: true }],
  ])('fails closed for %s returned by Drive readback', async (_label, patch) => {
    const candidate = evidence()
    const drive = recoveredDrive([candidate], { [candidate.id]: { ...candidate, ...patch } })
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it.each([
    ['an archived matching witness', { parents: ['archive'] }],
    ['an out-of-week matching witness', { parents: ['other-week'] }],
    ['a trashed matching witness', { trashed: true }],
  ])('finds and rejects %s globally before creating another XLSX', async (_label, patch) => {
    const candidate = { ...evidence(), ...patch }
    const drive = recoveredDrive([candidate])
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it.each([
    ['a different Drive MD5 checksum', { md5Checksum: '0'.repeat(32) }],
    ['a different Drive byte length', { size: String(options.buffer.length + 1) }],
  ])('fails closed when %s', async (_label, patch) => {
    const candidate = evidence()
    const drive = recoveredDrive([candidate], { [candidate.id]: { ...candidate, ...patch } })
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('reads and validates every page before recovering an evidence file', async () => {
    const first = evidence('first')
    const second = evidence('second')
    const drive = { files: {
      list: vi.fn(async ({ pageToken }) => pageToken
        ? { data: { files: [second] } }
        : { data: { files: [first], nextPageToken: 'next' } }),
      get: vi.fn(async ({ fileId }) => ({ data: fileId === 'first' ? first : second })),
      create: vi.fn(),
    } }
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_AMBIGUOUS' })
    expect(drive.files.get).toHaveBeenCalledTimes(2)
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('refuses a create response whose readback does not preserve the evidence', async () => {
    const drive = { files: {
      list: vi.fn(async () => ({ data: { files: [] } })),
      create: vi.fn(async () => ({ data: { id: 'xlsx-new' } })),
      get: vi.fn(async () => ({ data: { ...evidence('xlsx-new'), appProperties: {} } })),
    } }
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_UNCONFIRMED' })
  })

  it('refuses a create response whose readback has different bytes', async () => {
    const drive = { files: {
      list: vi.fn(async () => ({ data: { files: [] } })),
      create: vi.fn(async () => ({ data: { id: 'xlsx-new' } })),
      get: vi.fn(async () => ({ data: { ...evidence('xlsx-new'), md5Checksum: 'f'.repeat(32) } })),
    } }
    await expect(resolveFinalXlsxEvidence(drive, options)).rejects.toMatchObject({ code: 'XLSX_EVIDENCE_UNCONFIRMED' })
  })
})
