import crypto from 'crypto'
import { Readable } from 'stream'
import { describe, expect, it, vi } from 'vitest'
import { PDF_EVIDENCE_PROPERTIES, preflightPdfChunk, processPdfEvidence } from './_pdfEvidence.js'

const submissionId = '11111111-1111-4111-8111-111111111111'
const reportId = '22222222-2222-4222-8222-222222222222'
const weekId = 'week-folder'
const pdfName = '정산서_홍길동_2026-09-07~2026-09-13.pdf'
const chunkBytes = [Buffer.from('%PDF-1.7\nfirst chunk\n'), Buffer.from('second chunk\n%%EOF')]
const pdfBytes = Buffer.concat(chunkBytes)
const digest = (algorithm, bytes) => crypto.createHash(algorithm).update(bytes).digest('hex')
const expected = {
  reportId,
  sha256: digest('sha256', pdfBytes),
  byteLength: pdfBytes.length,
  chunkCount: chunkBytes.length,
  chunkSha256: chunkBytes.map((bytes) => digest('sha256', bytes)),
  chunkByteLength: chunkBytes.map((bytes) => bytes.length),
}

function properties(kind, index) {
  const result = {
    [PDF_EVIDENCE_PROPERTIES.submissionId]: submissionId,
    [PDF_EVIDENCE_PROPERTIES.artifactKind]: kind,
    [PDF_EVIDENCE_PROPERTIES.reportId]: reportId,
    [PDF_EVIDENCE_PROPERTIES.sha256]: kind === 'pdf' ? expected.sha256 : expected.chunkSha256[index],
    [PDF_EVIDENCE_PROPERTIES.byteLength]: String(kind === 'pdf' ? expected.byteLength : expected.chunkByteLength[index]),
  }
  if (kind === 'pdf') result[PDF_EVIDENCE_PROPERTIES.submissionKind] = 'final'
  else result[PDF_EVIDENCE_PROPERTIES.chunkIndex] = String(index)
  return result
}

function record({ id, kind, index, bytes, ...overrides }) {
  const content = Buffer.from(bytes)
  return {
    id,
    name: kind === 'pdf' ? pdfName : `_정산서청크_${reportId}_${index}.bin`,
    mimeType: kind === 'pdf' ? 'application/pdf' : 'application/octet-stream',
    parents: [weekId],
    trashed: false,
    size: String(content.length),
    md5Checksum: digest('md5', content),
    appProperties: properties(kind, index),
    bytes: content,
    ...overrides,
  }
}

async function readBody(body) {
  const parts = []
  for await (const part of body) parts.push(Buffer.from(part))
  return Buffer.concat(parts)
}

function createDrive(initial = []) {
  const filesById = new Map(initial.map((file) => [file.id, file]))
  let sequence = 0
  const files = {
    list: vi.fn(async ({ q }) => {
      const artifact = q.includes("value='pdf-chunk'") ? 'pdf-chunk' : 'pdf'
      const indexMatch = q.match(/key='receiptPdfChunkIndex' and value='(\d+)'/)
      const matches = [...filesById.values()].filter((file) => {
        const props = file.appProperties || {}
        return props[PDF_EVIDENCE_PROPERTIES.submissionId] === submissionId
          && props[PDF_EVIDENCE_PROPERTIES.artifactKind] === artifact
          && (!indexMatch || props[PDF_EVIDENCE_PROPERTIES.chunkIndex] === indexMatch[1])
      })
      return { data: { files: matches.map(({ id }) => ({ id })) } }
    }),
    get: vi.fn(async ({ fileId, alt }) => {
      const file = filesById.get(fileId)
      if (!file) throw new Error('not found')
      if (alt === 'media') return { data: Readable.from([Buffer.from(file.bytes)]) }
      const { bytes: _bytes, ...metadata } = file
      return { data: { ...metadata } }
    }),
    create: vi.fn(async ({ requestBody, media }) => {
      const bytes = await readBody(media.body)
      const id = `created-${++sequence}`
      filesById.set(id, {
        id,
        ...requestBody,
        mimeType: media.mimeType,
        trashed: false,
        size: String(bytes.length),
        md5Checksum: digest('md5', bytes),
        bytes,
      })
      return { data: { id } }
    }),
  }
  return { drive: { files }, filesById }
}

function options(index, driveOptions = {}) {
  return {
    submissionId,
    expected,
    chunkIndex: index,
    buffer: chunkBytes[index],
    weekId,
    pdfName,
    assertOwned: vi.fn(async () => true),
    ...driveOptions,
  }
}

describe('PDF evidence', () => {
  it('strictly decodes only the exact expected chunk', () => {
    const chunkBase64 = chunkBytes[0].toString('base64')
    expect(preflightPdfChunk({ reportId, chunkIndex: 0, chunkCount: 2, chunkBase64, expected })).toEqual(chunkBytes[0])
    expect(() => preflightPdfChunk({ reportId, chunkIndex: 0, chunkCount: 2, chunkBase64: `${chunkBase64}\n`, expected })).toThrow('base64')
    expect(() => preflightPdfChunk({ reportId, chunkIndex: 0, chunkCount: 2, chunkBase64: 'Zh==', expected })).toThrow('base64')
    expect(() => preflightPdfChunk({ reportId, chunkIndex: 1, chunkCount: 2, chunkBase64, expected })).toThrow('content mismatch')
    expect(() => preflightPdfChunk({ reportId: submissionId, chunkIndex: 0, chunkCount: 2, chunkBase64, expected })).toThrow('reportId mismatch')
    expect(() => preflightPdfChunk({ reportId, chunkIndex: 0, chunkCount: 1, chunkBase64, expected })).toThrow('chunkCount mismatch')
  })

  it('stores chunks in the week folder and assembles a byte-verified final PDF', async () => {
    const { drive, filesById } = createDrive()
    await expect(processPdfEvidence(drive, options(0))).resolves.toEqual({ assembled: false, status: 'uploaded', received: 0 })
    const result = await processPdfEvidence(drive, options(1))
    expect(result).toMatchObject({ assembled: true, status: 'uploaded', id: 'created-3', received: 1, file: pdfName })
    expect([...filesById.values()].map((file) => file.name)).toEqual([
      `_정산서청크_${reportId}_0.bin`, `_정산서청크_${reportId}_1.bin`, pdfName,
    ])
    expect(filesById.get('created-3').bytes).toEqual(pdfBytes)
    expect(filesById.get('created-3').appProperties).toEqual(properties('pdf'))
    expect(drive.files.create).toHaveBeenCalledTimes(3)
  })

  it('completes when Drive re-labels a chunk that starts with a PDF header as application/pdf', async () => {
    const { drive, filesById } = createDrive()
    const create = drive.files.create
    drive.files.create = vi.fn(async (request) => {
      const result = await create(request)
      const stored = filesById.get(result.data.id)
      // Real Drive sniffs content: the first chunk begins with "%PDF-".
      if (stored.bytes.subarray(0, 5).toString() === '%PDF-') stored.mimeType = 'application/pdf'
      return result
    })
    await expect(processPdfEvidence(drive, options(0))).resolves.toMatchObject({ assembled: false, received: 0 })
    await expect(processPdfEvidence(drive, options(1))).resolves.toMatchObject({ assembled: true, received: 1 })
    expect(filesById.get('created-1').mimeType).toBe('application/pdf')
  })

  it('recovers a valid final witness globally without any mutation', async () => {
    const final = record({ id: 'final-id', kind: 'pdf', bytes: pdfBytes })
    const { drive } = createDrive([final])
    await expect(processPdfEvidence(drive, options(0))).resolves.toMatchObject({
      assembled: true, status: 'recovered', id: 'final-id', received: 0,
    })
    expect(drive.files.create).not.toHaveBeenCalled()
    expect(drive.files.list.mock.calls[0][0].q).not.toContain('in parents')
    expect(drive.files.get).toHaveBeenCalledWith({ fileId: 'final-id', alt: 'media' }, { responseType: 'stream' })
  })

  it('recovers a valid chunk without replacing or duplicating it', async () => {
    const chunk = record({ id: 'chunk-id', kind: 'pdf-chunk', index: 0, bytes: chunkBytes[0] })
    const { drive } = createDrive([chunk])
    await expect(processPdfEvidence(drive, options(0))).resolves.toEqual({ assembled: false, status: 'recovered', received: 0 })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it.each([
    ['a moved final', { parents: ['archive'] }],
    ['a trashed final', { trashed: true }],
    ['a final with different downloaded bytes', { bytes: Buffer.from('%PDF-different') }],
  ])('fails closed for %s', async (_label, patch) => {
    const final = record({ id: 'final-id', kind: 'pdf', bytes: pdfBytes, ...patch })
    const { drive } = createDrive([final])
    await expect(processPdfEvidence(drive, options(0))).rejects.toMatchObject({ code: 'PDF_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('reads every result page and rejects duplicate final evidence', async () => {
    const drive = { files: {
      list: vi.fn()
        .mockResolvedValueOnce({ data: { files: [{ id: 'first' }], nextPageToken: 'page-2' } })
        .mockResolvedValueOnce({ data: { files: [{ id: 'second' }] } }),
      get: vi.fn(),
      create: vi.fn(),
    } }
    await expect(processPdfEvidence(drive, options(0))).rejects.toMatchObject({ code: 'PDF_EVIDENCE_AMBIGUOUS' })
    expect(drive.files.list).toHaveBeenCalledTimes(2)
    expect(drive.files.list.mock.calls[1][0]).toMatchObject({ pageToken: 'page-2' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('reads every result page and rejects duplicate chunk evidence', async () => {
    const drive = { files: {
      list: vi.fn()
        .mockResolvedValueOnce({ data: { files: [] } })
        .mockResolvedValueOnce({ data: { files: [{ id: 'first' }], nextPageToken: 'page-2' } })
        .mockResolvedValueOnce({ data: { files: [{ id: 'second' }] } }),
      get: vi.fn(),
      create: vi.fn(),
    } }
    await expect(processPdfEvidence(drive, options(0))).rejects.toMatchObject({ code: 'PDF_CHUNK_AMBIGUOUS' })
    expect(drive.files.list).toHaveBeenCalledTimes(3)
    expect(drive.files.list.mock.calls[2][0]).toMatchObject({ pageToken: 'page-2' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it.each([
    ['a missing data object', {}],
    ['a missing files array', { data: {} }],
    ['an incomplete Drive search', { data: { files: [], incompleteSearch: true } }],
    ['a malformed incomplete-search flag', { data: { files: [], incompleteSearch: 'false' } }],
    ['a malformed candidate', { data: { files: [{}] } }],
  ])('does not interpret %s as no evidence', async (_label, response) => {
    const drive = { files: { list: vi.fn(async () => response), get: vi.fn(), create: vi.fn() } }
    await expect(processPdfEvidence(drive, options(0))).rejects.toMatchObject({ code: 'PDF_EVIDENCE_LIST_UNCONFIRMED' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('fails assembly when any expected chunk is missing', async () => {
    const { drive } = createDrive()
    await expect(processPdfEvidence(drive, options(1))).rejects.toMatchObject({
      code: 'PDF_ASSEMBLY_INCOMPLETE', details: { chunkIndex: 0 },
    })
    expect(drive.files.create).toHaveBeenCalledTimes(1)
  })

  it('rejects bytes stored under the wrong chunk index contract', async () => {
    const wrong = record({ id: 'wrong-chunk', kind: 'pdf-chunk', index: 0, bytes: chunkBytes[1] })
    // Keep the claimed index/hash properties while exposing different actual bytes.
    wrong.appProperties = properties('pdf-chunk', 0)
    const { drive } = createDrive([wrong])
    await expect(processPdfEvidence(drive, options(0))).rejects.toMatchObject({ code: 'PDF_CHUNK_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('rejects mismatched metadata before downloading the file body', async () => {
    const final = record({ id: 'final-id', kind: 'pdf', bytes: pdfBytes, size: String(expected.byteLength + 1) })
    const { drive } = createDrive([final])
    await expect(processPdfEvidence(drive, options(0))).rejects.toMatchObject({ code: 'PDF_EVIDENCE_CONFLICT' })
    expect(drive.files.get).toHaveBeenCalledTimes(1)
    expect(drive.files.get).not.toHaveBeenCalledWith(expect.objectContaining({ alt: 'media' }), expect.anything())
  })

  it('stops a media stream that exceeds the metadata-verified length', async () => {
    const final = record({ id: 'final-id', kind: 'pdf', bytes: pdfBytes })
    const { drive } = createDrive([final])
    drive.files.get.mockImplementation(async ({ fileId, alt }) => {
      if (alt === 'media') return { data: Readable.from([Buffer.concat([pdfBytes, Buffer.from('extra')])]) }
      const { bytes: _bytes, ...metadata } = final
      return { data: { ...metadata, id: fileId } }
    })
    await expect(processPdfEvidence(drive, options(0))).rejects.toMatchObject({ code: 'PDF_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('requires a pinned final id to be present and exact before chunk mutation', async () => {
    const { drive: missingDrive } = createDrive()
    await expect(processPdfEvidence(missingDrive, options(0, { expectedFileId: 'pinned' }))).rejects.toMatchObject({ code: 'PDF_EVIDENCE_PIN_MISMATCH' })
    expect(missingDrive.files.create).not.toHaveBeenCalled()

    const final = record({ id: 'different', kind: 'pdf', bytes: pdfBytes })
    const { drive: mismatchDrive } = createDrive([final])
    await expect(processPdfEvidence(mismatchDrive, options(0, { expectedFileId: 'pinned' }))).rejects.toMatchObject({ code: 'PDF_EVIDENCE_PIN_MISMATCH' })
    expect(mismatchDrive.files.create).not.toHaveBeenCalled()
  })

  it('checks ownership immediately before and after a chunk mutation', async () => {
    const before = vi.fn(async () => false)
    const { drive: blockedDrive } = createDrive()
    await expect(processPdfEvidence(blockedDrive, options(0, { assertOwned: before }))).rejects.toMatchObject({ code: 'PDF_LOCK_LOST' })
    expect(blockedDrive.files.create).not.toHaveBeenCalled()

    const after = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    const { drive: lostDrive } = createDrive()
    await expect(processPdfEvidence(lostDrive, options(0, { assertOwned: after }))).rejects.toMatchObject({ code: 'PDF_LOCK_LOST' })
    expect(lostDrive.files.create).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(2)
  })

  it('recovers the committed final PDF when its create response was lost', async () => {
    const { drive } = createDrive()
    await processPdfEvidence(drive, options(0))
    const create = drive.files.create.getMockImplementation()
    let loseFinalResponse = true
    drive.files.create.mockImplementation(async (request) => {
      const response = await create(request)
      if (request.media.mimeType === 'application/pdf' && loseFinalResponse) {
        loseFinalResponse = false
        throw new Error('connection closed after commit')
      }
      return response
    })

    await expect(processPdfEvidence(drive, options(1))).rejects.toThrow('connection closed after commit')
    expect(drive.files.create).toHaveBeenCalledTimes(3)
    await expect(processPdfEvidence(drive, options(1))).resolves.toMatchObject({
      assembled: true, status: 'recovered', id: 'created-3', received: 1,
    })
    expect(drive.files.create).toHaveBeenCalledTimes(3)
  })
})
