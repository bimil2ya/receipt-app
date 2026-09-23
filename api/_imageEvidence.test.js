import crypto from 'crypto'
import { describe, expect, it, vi } from 'vitest'
import { buildFinalImageAppProperties, preflightFinalImage, resolveFinalImageEvidence } from './_imageEvidence.js'

const submissionId = '11111111-1111-4111-8111-111111111111'
const bytes = Buffer.from('image-bytes')
const expected = {
  key: 'a'.repeat(64), sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  byteLength: bytes.length, mimeType: 'image/jpeg',
}
const image = { key: expected.key, filename: 'receipt.jpg', dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` }
const evidence = preflightFinalImage({ image, expected })

function file(overrides = {}) {
  return {
    id: 'image-file', mimeType: expected.mimeType, parents: ['originals'], trashed: false,
    size: String(bytes.length), md5Checksum: evidence.md5,
    appProperties: buildFinalImageAppProperties({ submissionId, evidence }), ...overrides,
  }
}

describe('final image evidence', () => {
  it('strictly decodes and verifies bytes against expected', () => {
    expect(evidence).toMatchObject({ key: expected.key, sha256: expected.sha256, byteLength: bytes.length, mimeType: 'image/jpeg' })
    expect(() => preflightFinalImage({ image: { ...image, dataUrl: `${image.dataUrl} ` }, expected })).toThrow('data URL')
    expect(() => preflightFinalImage({ image: { ...image, dataUrl: 'not-a-data-url' }, expected })).toThrow('data URL')
    expect(() => preflightFinalImage({ image: { ...image, dataUrl: image.dataUrl.replace('image/jpeg', 'image/png') }, expected })).toThrow('content mismatch')
    expect(() => preflightFinalImage({ image: { ...image, key: 'b'.repeat(64) }, expected })).toThrow('key mismatch')
  })

  it('creates with immutable properties and acknowledges only verified readback', async () => {
    const drive = { files: {
      list: vi.fn(async () => ({ data: { files: [] } })),
      create: vi.fn(async () => ({ data: { id: 'image-file' } })),
      get: vi.fn(async () => ({ data: file() })),
    } }
    await expect(resolveFinalImageEvidence(drive, { originalsId: 'originals', submissionId, evidence })).resolves.toMatchObject({ status: 'uploaded', id: 'image-file' })
    expect(drive.files.create.mock.calls[0][0].requestBody.appProperties).toEqual(buildFinalImageAppProperties({ submissionId, evidence }))
  })

  it.each([
    ['moved', { parents: ['archive'] }], ['trashed', { trashed: true }], ['mime', { mimeType: 'image/png' }],
    ['size', { size: '1' }], ['md5', { md5Checksum: 'bad' }], ['properties', { appProperties: {} }],
  ])('fails closed when recovered evidence is %s', async (_label, override) => {
    const drive = { files: {
      list: vi.fn(async () => ({ data: { files: [{ id: 'image-file' }] } })),
      get: vi.fn(async () => ({ data: file(override) })), create: vi.fn(),
    } }
    await expect(resolveFinalImageEvidence(drive, { originalsId: 'originals', submissionId, evidence })).rejects.toMatchObject({ code: 'IMAGE_EVIDENCE_CONFLICT' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('recovers one valid global witness without creating a duplicate', async () => {
    const drive = { files: {
      list: vi.fn(async () => ({ data: { files: [{ id: 'image-file' }] } })),
      get: vi.fn(async () => ({ data: file() })), create: vi.fn(),
    } }
    await expect(resolveFinalImageEvidence(drive, { originalsId: 'originals', submissionId, evidence })).resolves.toMatchObject({ status: 'recovered', id: 'image-file' })
    expect(drive.files.create).not.toHaveBeenCalled()
    expect(drive.files.list.mock.calls[0][0].q).not.toContain('in parents')
  })

  it('rejects ambiguous witnesses without creating another file', async () => {
    const drive = { files: { list: vi.fn(async () => ({ data: { files: [{ id: 'a' }, { id: 'b' }] } })), get: vi.fn(), create: vi.fn() } }
    await expect(resolveFinalImageEvidence(drive, { originalsId: 'originals', submissionId, evidence })).rejects.toMatchObject({ code: 'IMAGE_EVIDENCE_AMBIGUOUS' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })

  it('checks every Drive result page and rejects a witness on a later page', async () => {
    const drive = { files: {
      list: vi.fn()
        .mockResolvedValueOnce({ data: { files: [{ id: 'a' }], nextPageToken: 'page-2' } })
        .mockResolvedValueOnce({ data: { files: [{ id: 'b' }] } }),
      get: vi.fn(), create: vi.fn(),
    } }
    await expect(resolveFinalImageEvidence(drive, { originalsId: 'originals', submissionId, evidence })).rejects.toMatchObject({ code: 'IMAGE_EVIDENCE_AMBIGUOUS' })
    expect(drive.files.list).toHaveBeenCalledTimes(2)
    expect(drive.files.list.mock.calls[1][0]).toMatchObject({ pageToken: 'page-2' })
    expect(drive.files.create).not.toHaveBeenCalled()
  })
})
