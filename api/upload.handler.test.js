import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import crypto from 'crypto'

const state = vi.hoisted(() => ({
  verifyCompletion: vi.fn(),
  pdf: vi.fn(),
  reserve: vi.fn(),
  readJob: vi.fn(),
  writeJob: vi.fn(),
  conditionalWrite: vi.fn(),
  createDrive: vi.fn(),
  getFolder: vi.fn(),
  getNormalizedFolder: vi.fn(),
  moveFile: vi.fn(),
  acquireLock: vi.fn(),
  acquireArtifactLock: vi.fn(),
  releaseLock: vi.fn(),
  renewLock: vi.fn(),
  aggregate: vi.fn(),
  kakao: vi.fn(),
  kakaoMany: vi.fn(),
}))

vi.mock('./_corsNode.js', () => ({
  applyCorsHeaders: () => false,
  checkOriginAllowed: () => true,
}))
vi.mock('./_rateLimiter.js', () => ({ uploadRateLimiter: () => ({ ok: true }), clientRateKey: () => 'test-client' }))
vi.mock('./_auth.js', () => ({ safeCompare: () => true }))
vi.mock('./_errorHandler.js', () => ({
  jsonError: (res, error) => res.status(error.statusCode || 400).json({ success: false, error: error.error, message: error.message }),
  Errors: {
    methodNotAllowed: () => ({ statusCode: 405, error: 'METHOD_NOT_ALLOWED' }),
    rateLimit: () => ({ statusCode: 429, error: 'RATE_LIMITED' }),
    unauthorized: (message) => ({ statusCode: 401, error: 'UNAUTHORIZED', message }),
    badRequest: (message) => ({ statusCode: 400, error: 'BAD_REQUEST', message }),
    unsupportedMediaType: (message) => ({ statusCode: 415, error: 'UNSUPPORTED_MEDIA_TYPE', message }),
    internalError: (message) => ({ statusCode: 500, error: 'INTERNAL_ERROR', message }),
  },
}))
vi.mock('./driveUtils.js', () => ({
  ARCHIVE_FOLDER_NAME: '_보관함',
  MAIN_FOLDER_ID: 'main',
  createDrive: state.createDrive,
  driveQueryString: (value) => value,
  getOrCreateFolder: state.getFolder,
  getOrCreateFolderByNormalizedName: state.getNormalizedFolder,
  getWeekFolderName: () => '2026-09-01~2026-09-02',
  getYearMonth: () => '2026년 09월',
  isTripWeekFolderName: (name) => /^\d{4}-\d{2}-\d{2}~\d{4}-\d{2}-\d{2}$/.test(String(name || '')),
  moveFileToParent: state.moveFile,
}))
vi.mock('./_pdfEvidence.js', async importOriginal => ({
  ...await importOriginal(), processPdfEvidence: state.pdf,
}))
vi.mock('./_submissionDriveEvidence.js', () => ({ verifySubmissionDrive: state.verifyCompletion }))
vi.mock('./_submissionJob.js', () => ({
  submissionContractDigest: () => 'contract',
  isSubmissionId: (value) => typeof value === 'string' && value.startsWith('valid-'),
  reserveFinalSubmission: state.reserve,
  readSubmissionJob: state.readJob,
  writeSubmissionJob: state.writeJob,
  writeSubmissionJobIfLockOwned: state.conditionalWrite,
}))
vi.mock('./_submissionLock.js', () => ({
  acquireArtifactSubmissionLock: state.acquireArtifactLock,
  acquireSubmissionLock: state.acquireLock,
  releaseSubmissionLock: state.releaseLock,
  renewSubmissionLock: state.renewLock,
}))
vi.mock('./aggregate.js', () => ({ runMonthAggregate: state.aggregate }))
vi.mock('./notify/kakao.js', () => ({
  sendKakaoNotification: state.kakao,
  sendKakaoNotifications: state.kakaoMany,
}))

import handler from './upload.js'

describe('read-only whole submission finalization API', () => {
  const body = { isFinalizeOnly: true, submissionKind: 'final', submissionId: 'valid-finalization', surveyorName: 'A조', reportDate: '2026-09-11' }
  let job
  beforeEach(() => {
    job = { id: body.submissionId, kind: 'final', schemaVersion: 2, revision: 4, contractDigest: 'contract',
      status: 'xlsx_response_ready', scope: { yearMonth: '2026년 09월', surveyorName: 'A조', weekFolderName: '2026-09-01~2026-09-02' },
      artifacts: { xlsx: { status: 'confirmed' } }, expected: { receiptCount: 1, totalAmount: 12000 } }
    state.readJob.mockImplementation(async () => structuredClone(job))
    state.verifyCompletion.mockResolvedValue({ currentAggregateFileId: 'new-current', receiptCount: 1, totalAmount: 12000, aggregateCount: 3, aggregateTotal: 20000 })
    state.conditionalWrite.mockImplementation(async ({ job: next }) => { job = structuredClone(next); return { written: true } })
  })
  it('rechecks Drive on every completion and preserves XLSX replay status', async () => {
    const first = await call(body)
    expect(first.body).toMatchObject({ type: 'completion', complete: true, submissionId: body.submissionId, revision: 5 })
    expect(job.status).toBe('xlsx_response_ready')
    expect(job.completion.currentAggregateFileId).toBe('new-current')
    expect(state.conditionalWrite).toHaveBeenCalledWith(expect.objectContaining({
      lock: expect.objectContaining({ token: 'artifact-owner' }), monthLock: expect.objectContaining({ token: 'lock' }),
    }))
    expect(state.getFolder).not.toHaveBeenCalled()
    expect(state.aggregate).not.toHaveBeenCalled()
    expect(state.reserve).not.toHaveBeenCalled()
    const second = await call(body)
    expect(second.body.revision).toBe(6)
    expect(state.verifyCompletion).toHaveBeenCalledTimes(2)
    expect(state.releaseLock.mock.calls.slice(0, 2).map(([lock]) => lock.token)).toEqual(['artifact-owner', 'lock'])
  })
  it.each(['xlsxBase64', 'images', 'isImageOnly', 'isPdfChunk', 'chunkIndex', 'expected'])('blocks mixed %s payload before Drive', async key => {
    const res = await call({ ...body, [key]: false })
    expect(res.statusCode).toBe(400)
    expect(res.body.complete).toBe(false)
    expect(state.readJob).not.toHaveBeenCalled()
    expect(state.createDrive).not.toHaveBeenCalled()
  })
  it.each(['missing', 'legacy', 'wrong-scope', 'bad-contract', 'not-ready'])('blocks %s state before Drive', async scenario => {
    if (scenario === 'missing') state.readJob.mockResolvedValue(null)
    if (scenario === 'legacy') job.schemaVersion = 1
    if (scenario === 'wrong-scope') job.scope.surveyorName = 'B조'
    if (scenario === 'bad-contract') job.contractDigest = 'different'
    if (scenario === 'not-ready') job.status = 'processing'
    const res = await call(body)
    expect(res.body).toMatchObject({ type: 'completion', complete: false })
    expect(state.createDrive).not.toHaveBeenCalled()
    expect(state.conditionalWrite).not.toHaveBeenCalled()
  })
  it('returns the restart-required code for a contractless legacy job before Drive', async () => {
    job.schemaVersion = 1
    delete job.expected
    const res = await call(body)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ type: 'completion', complete: false, error: 'LEGACY_SUBMISSION_RESTART_REQUIRED' })
    expect(state.createDrive).not.toHaveBeenCalled()
    expect(state.conditionalWrite).not.toHaveBeenCalled()
  })
  it('blocks a revision that changed before acquiring both locks', async () => {
    state.readJob.mockResolvedValueOnce(structuredClone(job)).mockResolvedValueOnce({ ...job, revision: 5 })
    expect((await call(body)).body.error).toBe('SUBMISSION_REVISION_CONFLICT')
    expect(state.createDrive).not.toHaveBeenCalled()
  })
  it('never records completion if Drive evidence is missing or unconfirmed', async () => {
    state.verifyCompletion.mockRejectedValue(Object.assign(new Error('missing'), { code: 'EVIDENCE_MISSING' }))
    expect((await call(body)).body).toMatchObject({ type: 'completion', complete: false, error: 'EVIDENCE_MISSING' })
    expect(state.conditionalWrite).not.toHaveBeenCalled()
    expect(job.completion).toBeUndefined()
  })
  it.each([null, {}, { currentAggregateFileId: 'file', receiptCount: 0, totalAmount: 0 }])('rejects an empty or mismatched verification result', async observation => {
    state.verifyCompletion.mockResolvedValue(observation)
    expect((await call(body)).body.complete).toBe(false)
    expect(state.conditionalWrite).not.toHaveBeenCalled()
  })
  it.each(['lock_lost', 'month_lock_lost', 'revision_conflict'])('does not return completion when CAS rejects %s', async reason => {
    state.conditionalWrite.mockResolvedValue({ written: false, reason })
    expect((await call(body)).body.complete).toBe(false)
    expect(job.completion).toBeUndefined()
  })
  it('blocks before Drive when a lock cannot be renewed', async () => {
    state.renewLock.mockResolvedValue(false)
    expect((await call(body)).body.complete).toBe(false)
    expect(state.createDrive).not.toHaveBeenCalled()
  })
})

const submissionId = 'valid-9f7dfaf1-a4bd-44f1-83e1-c2a1e4f27f20'
const scope = { yearMonth: '2026년 09월', surveyorName: 'A조', weekFolderName: '2026-09-01~2026-09-02' }

function encodeWorkbook() {
  const sheet = XLSX.utils.json_to_sheet([{ 날짜: '2026-09-11', 사용처: '주유소', 금액: 12000, 용도: '교통' }])
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, sheet, '사용내역')
  return XLSX.write(book, { type: 'base64', bookType: 'xlsx' })
}

function makeReq(body) {
  return { method: 'POST', body, headers: { origin: 'http://localhost:5173' } }
}

function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this },
    setHeader() {},
    end() {},
  }
}

async function call(body) {
  const res = makeRes()
  await handler(makeReq(body), res)
  return res
}

function finalBody(overrides = {}) {
  return {
    surveyorName: 'A조',
    reportDate: '2026-09-11',
    xlsxBase64: encodeWorkbook(),
    submissionKind: 'final',
    submissionId,
    expected: {
      images: [], receiptCount: 1, totalAmount: 12000,
      pdf: { reportId: '22222222-2222-4222-8222-222222222222', sha256: 'a'.repeat(64), byteLength: 4,
        chunkCount: 1, chunkSha256: ['b'.repeat(64)], chunkByteLength: [4] },
    },
    ...overrides,
  }
}

function completedReplayFixture(overrides = {}) {
  const xlsxBase64 = encodeWorkbook()
  const bytes = Buffer.from(xlsxBase64, 'base64')
  const witness = {
    id: 'already-there', name: '출장비_오늘.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    parents: ['week'], trashed: false, size: String(bytes.length),
    md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'),
    appProperties: {
      receiptSubmissionId: submissionId,
      receiptSubmissionKind: 'final',
      receiptXlsxSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  }
  const aggregate = { id: 'aggregate', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['month'], trashed: false }
  const files = {
    list: vi.fn(async ({ q }) => q.includes('appProperties has') ? { data: { files: [{ id: witness.id }] } } : { data: { files: [] } }),
    get: vi.fn(async ({ fileId }) => {
      if (fileId === witness.id) {
        if (overrides.witnessError) throw overrides.witnessError
        return { data: overrides.witness ?? witness }
      }
      if (fileId === aggregate.id) {
        if (overrides.aggregateError) throw overrides.aggregateError
        return { data: overrides.aggregate ?? aggregate }
      }
      throw new Error('missing')
    }),
    create: vi.fn(), update: vi.fn(),
  }
  const response = { success: true, type: 'xlsx', fileId: witness.id, folders: { weekId: 'week', monthId: 'month' }, aggregate: { success: true, fileId: aggregate.id } }
  const job = { status: 'xlsx_response_ready', artifacts: { xlsx: { status: 'confirmed', fileId: witness.id }, aggregate: { status: 'confirmed', fileId: aggregate.id } }, response }
  return { xlsxBase64, witness, aggregate, files, job }
}

function expectNoDriveMutation() {
  expect(state.createDrive).not.toHaveBeenCalled()
  expect(state.getFolder).not.toHaveBeenCalled()
  expect(state.getNormalizedFolder).not.toHaveBeenCalled()
  expect(state.moveFile).not.toHaveBeenCalled()
}

async function readableToBuffer(readable) {
  const chunks = []
  for await (const chunk of readable) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.reserve.mockResolvedValue({ state: 'reserved', job: { id: submissionId, artifacts: {} } })
  state.writeJob.mockResolvedValue(undefined)
  state.conditionalWrite.mockResolvedValue({ written: true, reason: 'written' })
  state.acquireLock.mockResolvedValue({ acquired: true, token: 'lock' })
  state.acquireArtifactLock.mockResolvedValue({ acquired: true, key: 'artifact-lock', token: 'artifact-owner', ttlSeconds: 120 })
  state.releaseLock.mockResolvedValue(true)
  state.renewLock.mockResolvedValue(true)
  state.aggregate.mockResolvedValue({ success: true, fileId: 'aggregate' })
  state.kakao.mockResolvedValue(true)
  state.kakaoMany.mockResolvedValue(true)
  state.getFolder.mockImplementation(async (_drive, name) => ({ '2026년 09월': 'month', '_보관함': 'archive', '2026-09-01~2026-09-02': 'week' }[name] || 'folder'))
  state.getNormalizedFolder.mockResolvedValue('person')
  state.moveFile.mockResolvedValue({ data: { id: 'old', parents: ['archive'] } })
  state.createDrive.mockImplementation(() => {
    const files = {
      list: vi.fn(async ({ q }) => q.includes("name contains '출장비'")
        ? { data: { files: [{ id: 'xlsx-new', name: '출장비_오늘.xlsx' }] } }
        : { data: { files: [] } }),
      create: vi.fn(async () => ({ data: { id: 'xlsx-new', name: '출장비_오늘.xlsx', size: '1' } })),
      update: vi.fn(),
    }
    files.get = vi.fn(async ({ fileId }) => {
      const createdRequest = files.create.mock.calls.at(-1)[0]
      const bytes = await readableToBuffer(createdRequest.media.body)
      return { data: {
      id: fileId,
      parents: ['week'],
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      appProperties: createdRequest.requestBody.appProperties,
      trashed: false,
      size: String(bytes.length),
      md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'),
    } }
    })
    return { files }
  })
})

describe('legacy request fail-closed boundary', () => {
  it.each([
    ['XLSX', { surveyorName: 'A조', reportDate: '2026-09-11', xlsxBase64: encodeWorkbook(), isImageOnly: false }],
    ['image', { surveyorName: 'A조', reportDate: '2026-09-11', isImageOnly: true,
      images: [{ filename: 'receipt.jpg', dataUrl: 'data:image/jpeg;base64,aW1hZ2U=' }] }],
    ['PDF chunk', { surveyorName: 'A조', reportDate: '2026-09-11', isPdfChunk: true,
      reportId: '22222222-2222-4222-8222-222222222222', chunkIndex: 0, chunkCount: 1, chunkBase64: 'JVBERi0=' }],
  ])('rejects a pre-contract %s upload before Drive mutation', async (_label, legacyBody) => {
    const res = await call(legacyBody)
    expect(res.statusCode).toBe(400)
    expect(res.body.success).toBe(false)
    expectNoDriveMutation()
  })
  it('rejects a final XLSX request whose artifact contract is missing', async () => {
    const res = await call(finalBody({ expected: undefined }))
    expect(res.statusCode).toBe(400)
    expect(state.reserve).not.toHaveBeenCalled()
    expectNoDriveMutation()
  })
  it('distinguishes an existing contractless job from an ordinary ID conflict', async () => {
    state.reserve.mockResolvedValue({ state: 'conflict', job: { id: submissionId, kind: 'final', status: 'failed' } })
    const res = await call(finalBody())
    expect(res.statusCode).toBe(409)
    expect(res.body.error).toBe('LEGACY_SUBMISSION_RESTART_REQUIRED')
    expectNoDriveMutation()
  })
})

describe('upload handler final image gate', () => {
  const imageBytes = Buffer.from('image-bytes')
  const imageKey = 'b'.repeat(64)
  const imageSha = crypto.createHash('sha256').update(imageBytes).digest('hex')
  const expected = { key: imageKey, sha256: imageSha, byteLength: imageBytes.length, mimeType: 'image/jpeg' }
  const job = {
    id: submissionId,
    kind: 'final',
    schemaVersion: 2,
    revision: 1,
    contractDigest: 'contract',
    scope,
    expected: { images: [expected] },
    artifacts: { images: { status: 'pending' } },
  }
  const body = {
    surveyorName: 'A조', reportDate: '2026-09-11', tripStartDate: '2026-09-01',
    isImageOnly: true, submissionKind: 'final', submissionId,
    images: [{ key: imageKey, filename: 'receipt.jpg', dataUrl: `data:image/jpeg;base64,${imageBytes.toString('base64')}` }],
  }

  it('fails before Drive when the submission job is missing', async () => {
    state.readJob.mockResolvedValue(null)
    const res = await call(body)
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ success: false, error: 'SUBMISSION_JOB_NOT_FOUND' })
    expectNoDriveMutation()
  })

  it('writes verified image evidence under the artifact lock before ACK', async () => {
    state.readJob.mockResolvedValue(job)
    const md5 = crypto.createHash('md5').update(imageBytes).digest('hex')
    const drive = { files: {
      list: vi.fn(async () => ({ data: { files: [] } })),
      create: vi.fn(async () => ({ data: { id: 'image-file' } })),
      get: vi.fn(async () => ({ data: {
        id: 'image-file', mimeType: 'image/jpeg', parents: ['originals'], trashed: false,
        size: String(imageBytes.length), md5Checksum: md5,
        appProperties: {
          receiptSubmissionId: submissionId, receiptSubmissionKind: 'final', receiptArtifactKind: 'image',
          receiptArtifactKey: imageKey, receiptContentSha256: imageSha,
        },
      } })),
      update: vi.fn(),
    } }
    state.createDrive.mockReturnValue(drive)
    state.getFolder.mockImplementation(async (_drive, name) => ({
      '2026년 09월': 'month', '_보관함': 'archive', '2026-09-01~2026-09-02': 'week', '_원본': 'originals',
    }[name] || 'folder'))
    const res = await call(body)
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, submissionId, key: imageKey, fileId: 'image-file', revision: 2, imagesComplete: true })
    expect(state.conditionalWrite).toHaveBeenCalledWith(expect.objectContaining({ submissionId, expectedRevision: 1, lock: expect.objectContaining({ token: 'artifact-owner' }) }))
    expect(state.acquireArtifactLock).toHaveBeenCalledWith(expect.objectContaining({ submissionId, ttlSeconds: 180 }))
    expect(state.releaseLock).toHaveBeenCalledWith(expect.objectContaining({ token: 'artifact-owner' }))
  })

  it('does not ACK when the conditional state write loses ownership', async () => {
    state.readJob.mockResolvedValue(job)
    state.conditionalWrite.mockResolvedValue({ written: false, reason: 'lock_lost' })
    const md5 = crypto.createHash('md5').update(imageBytes).digest('hex')
    state.createDrive.mockReturnValue({ files: {
      list: vi.fn(async () => ({ data: { files: [{ id: 'image-file' }] } })),
      get: vi.fn(async () => ({ data: { id: 'image-file', mimeType: 'image/jpeg', parents: ['originals'], trashed: false, size: String(imageBytes.length), md5Checksum: md5, appProperties: { receiptSubmissionId: submissionId, receiptSubmissionKind: 'final', receiptArtifactKind: 'image', receiptArtifactKey: imageKey, receiptContentSha256: imageSha } } })),
      create: vi.fn(), update: vi.fn(),
    } })
    state.getFolder.mockImplementation(async (_drive, name) => name === '_원본' ? 'originals' : ({ '2026년 09월': 'month', '_보관함': 'archive', '2026-09-01~2026-09-02': 'week' }[name] || 'folder'))
    const res = await call(body)
    expect(res.statusCode).toBe(500)
    expect(res.body.success).toBe(false)
  })

  it('does not create an image when lock renewal fails before the Drive write', async () => {
    state.readJob.mockResolvedValue(job)
    state.renewLock.mockResolvedValue(false)
    const drive = { files: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() } }
    state.createDrive.mockReturnValue(drive)
    const res = await call(body)
    expect(res.statusCode).toBe(500)
    expect(res.body.success).toBe(false)
    expect(drive.files.list).not.toHaveBeenCalled()
    expect(drive.files.create).not.toHaveBeenCalled()
    expect(state.conditionalWrite).not.toHaveBeenCalled()
  })
})

describe('upload handler final XLSX preflight gate', () => {
  it('replays a completed matching submission only after checking current Drive evidence under the lock', async () => {
    const fixture = completedReplayFixture()
    state.createDrive.mockReturnValue({ files: fixture.files })
    state.reserve.mockResolvedValue({ state: 'existing', job: fixture.job })
    const res = await call(finalBody({ xlsxBase64: fixture.xlsxBase64 }))
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, replay: true, fileId: 'already-there' })
    expect(state.acquireLock).toHaveBeenCalledTimes(1)
    expect(fixture.files.get).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'already-there' }))
    expect(fixture.files.get).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'aggregate' }))
    expect(state.getFolder).not.toHaveBeenCalled()
    expect(fixture.files.create).not.toHaveBeenCalled()
    expect(fixture.files.update).not.toHaveBeenCalled()
    expect(state.moveFile).not.toHaveBeenCalled()
    expect(state.aggregate).not.toHaveBeenCalled()
  })

  it.each([
    ['trashed XLSX', ({ witness }) => ({ witness: { ...witness, trashed: true } })],
    ['moved XLSX', ({ witness }) => ({ witness: { ...witness, parents: ['archive'] } })],
    ['deleted XLSX', () => ({ witness: null })],
    ['unreadable XLSX', () => ({ witnessError: new Error('readback failed') })],
    ['trashed aggregate', ({ aggregate }) => ({ aggregate: { ...aggregate, trashed: true } })],
    ['moved aggregate', ({ aggregate }) => ({ aggregate: { ...aggregate, parents: ['other-month'] } })],
    ['deleted aggregate', () => ({ aggregateError: new Error('not found') })],
  ])('fails closed without mutations when completed replay has %s', async (_label, alter) => {
    const base = completedReplayFixture()
    const changes = alter(base)
    const fixture = completedReplayFixture(changes)
    if (changes.witness === null) fixture.files.list.mockResolvedValue({ data: { files: [] } })
    state.createDrive.mockReturnValue({ files: fixture.files })
    state.reserve.mockResolvedValue({ state: 'existing', job: fixture.job })

    const res = await call(finalBody({ xlsxBase64: fixture.xlsxBase64 }))

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ success: false, error: 'INTERNAL_ERROR' })
    expect(state.getFolder).not.toHaveBeenCalled()
    expect(fixture.files.create).not.toHaveBeenCalled()
    expect(fixture.files.update).not.toHaveBeenCalled()
    expect(state.moveFile).not.toHaveBeenCalled()
    expect(state.aggregate).not.toHaveBeenCalled()
  })

  it('does not replay a legacy completed job without persisted evidence IDs', async () => {
    state.reserve.mockResolvedValue({ state: 'existing', job: { status: 'xlsx_response_ready', response: { success: true, type: 'xlsx' } } })
    const drive = { files: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() } }
    state.createDrive.mockReturnValue(drive)

    const res = await call(finalBody())

    expect(res.statusCode).toBe(500)
    expect(state.getFolder).not.toHaveBeenCalled()
    expect(drive.files.list).not.toHaveBeenCalled()
    expect(drive.files.create).not.toHaveBeenCalled()
    expect(state.aggregate).not.toHaveBeenCalled()
  })

  it('rejects a submission ID conflict before creating or moving Drive resources', async () => {
    state.reserve.mockResolvedValue({ state: 'conflict' })
    const res = await call(finalBody())
    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ success: false, error: 'SUBMISSION_ID_CONFLICT' })
    expectNoDriveMutation()
  })

  it('uses the month lock to recover a matching processing submission', async () => {
    state.reserve.mockResolvedValue({ state: 'processing', ttlSeconds: 120, job: { id: submissionId, artifacts: {} } })
    const res = await call(finalBody())
    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, type: 'xlsx' })
    expect(state.createDrive).toHaveBeenCalledTimes(1)
  })

  it('recovers a processing submission from its Drive evidence without a second XLSX create', async () => {
    const xlsxBase64 = encodeWorkbook()
    const sha256 = crypto.createHash('sha256').update(Buffer.from(xlsxBase64, 'base64')).digest('hex')
    const witness = {
      id: 'xlsx-witness', name: '출장비_오늘.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parents: ['week'],
      appProperties: { receiptSubmissionId: submissionId, receiptSubmissionKind: 'final', receiptXlsxSha256: sha256 },
      trashed: false,
      size: String(Buffer.from(xlsxBase64, 'base64').length),
      md5Checksum: crypto.createHash('md5').update(Buffer.from(xlsxBase64, 'base64')).digest('hex'),
    }
    const files = {
      list: vi.fn(async ({ q }) => {
        if (q.includes('appProperties has')) return { data: { files: [witness] } }
        if (q.includes("name contains '출장비'")) return { data: { files: [witness] } }
        if (q.includes("'person' in parents")) return { data: { files: [{ id: 'legacy-root', name: '과거파일.pdf' }] } }
        return { data: { files: [] } }
      }),
      create: vi.fn(), update: vi.fn(), get: vi.fn(async () => ({ data: witness })),
    }
    state.createDrive.mockReturnValue({ files })
    state.reserve.mockResolvedValue({ state: 'processing', ttlSeconds: 120, job: { id: submissionId, artifacts: {} } })

    const res = await call(finalBody({ xlsxBase64 }))

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, fileId: 'xlsx-witness', uploadStatus: 'recovered' })
    expect(files.create).not.toHaveBeenCalled()
    expect(state.moveFile).not.toHaveBeenCalled()
  })

  it('does not sweep legacy person-root files when a malformed evidence candidate fails closed', async () => {
    const xlsxBase64 = encodeWorkbook()
    const sha256 = crypto.createHash('sha256').update(Buffer.from(xlsxBase64, 'base64')).digest('hex')
    const malformed = {
      id: 'xlsx-moved', parents: ['other-week'], trashed: false,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      appProperties: { receiptSubmissionId: submissionId, receiptSubmissionKind: 'final', receiptXlsxSha256: sha256 },
    }
    const files = {
      list: vi.fn(async ({ q }) => q.includes('appProperties has')
        ? { data: { files: [malformed] } }
        : { data: { files: [{ id: 'legacy-root', name: '과거파일.pdf' }] } }),
      create: vi.fn(), update: vi.fn(), get: vi.fn(async () => ({ data: malformed })),
    }
    state.createDrive.mockReturnValue({ files })
    state.reserve.mockResolvedValue({ state: 'processing', ttlSeconds: 120, job: { id: submissionId, artifacts: {} } })

    const res = await call(finalBody({ xlsxBase64 }))

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ success: false, error: 'INTERNAL_ERROR' })
    expect(files.create).not.toHaveBeenCalled()
    expect(state.moveFile).not.toHaveBeenCalled()
  })

  it('does not create, archive, or aggregate when a matching witness was archived while a newer XLSX is active', async () => {
    const xlsxBase64 = encodeWorkbook()
    const bytes = Buffer.from(xlsxBase64, 'base64')
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
    const archivedWitness = {
      id: 'xlsx-archived', name: '출장비_이전.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parents: ['archive'],
      appProperties: { receiptSubmissionId: submissionId, receiptSubmissionKind: 'final', receiptXlsxSha256: sha256 },
      trashed: false, size: String(bytes.length),
      md5Checksum: crypto.createHash('md5').update(bytes).digest('hex'),
    }
    const files = {
      list: vi.fn(async ({ q }) => {
        if (q.includes('appProperties has')) return { data: { files: [archivedWitness] } }
        if (q.includes("name contains '출장비'")) return { data: { files: [{ id: 'xlsx-newer', name: '출장비_새로운.xlsx' }] } }
        return { data: { files: [] } }
      }),
      create: vi.fn(), update: vi.fn(), get: vi.fn(async () => ({ data: archivedWitness })),
    }
    state.createDrive.mockReturnValue({ files })
    state.reserve.mockResolvedValue({ state: 'processing', ttlSeconds: 120, job: { id: submissionId, artifacts: {} } })

    const res = await call(finalBody({ xlsxBase64 }))

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ success: false, error: 'INTERNAL_ERROR' })
    expect(files.create).not.toHaveBeenCalled()
    expect(state.moveFile).not.toHaveBeenCalled()
    expect(state.aggregate).not.toHaveBeenCalled()
    expect(files.list).not.toHaveBeenCalledWith(expect.objectContaining({ q: expect.stringContaining("name contains '출장비'") }))
  })

  it('retries a failed matching submission through Drive instead of replaying its failed result', async () => {
    state.reserve.mockResolvedValue({
      state: 'existing',
      job: {
        id: submissionId,
        status: 'failed',
        xlsxSha256: 'a'.repeat(64),
        artifacts: {},
        response: { success: false, type: 'xlsx', error: 'old aggregate failure' },
      },
    })

    const res = await call(finalBody())

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ success: true, type: 'xlsx' })
    expect(res.body.replay).toBeUndefined()
    expect(state.createDrive).toHaveBeenCalledTimes(1)
    expect(state.aggregate).toHaveBeenCalledTimes(1)
  })

  it('rejects an invalid submission ID before reserving or changing Drive', async () => {
    const res = await call(finalBody({ submissionId: 'invalid' }))
    expect(res.statusCode).toBe(400)
    expect(state.reserve).not.toHaveBeenCalled()
    expectNoDriveMutation()
  })

  it('does not change Drive when final-job reservation cannot reach Redis', async () => {
    state.reserve.mockRejectedValue(new Error('Redis unavailable'))

    const res = await call(finalBody())

    expect(res.statusCode).toBe(500)
    expect(res.body).toMatchObject({ success: false, error: 'INTERNAL_ERROR' })
    expectNoDriveMutation()
    expect(state.acquireLock).not.toHaveBeenCalled()
  })

  it('does not change Drive when the monthly submission lock is already held', async () => {
    state.acquireLock.mockResolvedValue({ acquired: false, ttlSeconds: 57 })

    const res = await call(finalBody())

    expect(res.statusCode).toBe(409)
    expect(res.body).toMatchObject({ success: false, error: 'SUBMISSION_IN_PROGRESS', retryAfterSec: 57 })
    expectNoDriveMutation()
    expect(state.writeJob).toHaveBeenCalledWith(expect.objectContaining({
      submissionId,
      job: expect.objectContaining({ status: 'failed' }),
    }))
  })

  it('reports aggregate failure as an unsuccessful XLSX request', async () => {
    state.aggregate.mockResolvedValue({ success: false, error: 'aggregate readback failed' })
    const res = await call(finalBody())
    expect(res.statusCode).toBe(502)
    expect(res.body).toMatchObject({ success: false, type: 'xlsx', aggregate: { success: false, error: 'aggregate readback failed' } })
    expect(state.createDrive).toHaveBeenCalledTimes(1)
    expect(state.writeJob).toHaveBeenCalledWith(expect.objectContaining({
      submissionId,
      job: expect.objectContaining({ status: 'failed' }),
    }))
  })
})

describe('PDF submission evidence gate', () => {
  const reportId = '11111111-1111-4111-8111-111111111111'
  const buffer = Buffer.from('%PDF-1.7\nexample')
  const sha = crypto.createHash('sha256').update(buffer).digest('hex')
  const body = { surveyorName: 'A조', reportDate: '2026-09-11', submissionKind: 'final', submissionId,
    isPdfChunk: true, reportId, chunkCount: 1, chunkIndex: 0, chunkBase64: buffer.toString('base64') }
  let job
  let files
  beforeEach(() => {
    job = { id: submissionId, schemaVersion: 2, contractDigest: 'contract', revision: 3, scope,
      expected: { pdf: { reportId, sha256: sha, byteLength: buffer.length, chunkCount: 1,
        chunkSha256: [sha], chunkByteLength: [buffer.length] } },
      artifacts: { xlsx: { status: 'confirmed' }, pdf: { status: 'pending' }, images: { confirmed: { image: {} } } },
      response: { folders: { monthId: 'month', personId: 'person', weekId: 'week' } } }
    state.readJob.mockImplementation(async () => structuredClone(job))
    state.pdf.mockResolvedValue({ assembled: true, status: 'uploaded', id: 'pdf' })
    files = { get: vi.fn(async ({ fileId }) => ({ data: { id: fileId, mimeType: 'application/vnd.google-apps.folder',
      trashed: false, parents: [{ month: 'main', person: 'month', week: 'person' }[fileId]] } })), create: vi.fn() }
    state.createDrive.mockReturnValue({ files })
    state.conditionalWrite.mockImplementation(async ({ job: next }) => { job = structuredClone(next); return { written: true } })
  })
  it.each([
    ['missing', () => state.readJob.mockResolvedValue(null)],
    ['legacy', () => { job.schemaVersion = 1 }],
    ['scope', () => { job.scope = { ...scope, surveyorName: 'B조' } }],
    ['contract', () => { job.contractDigest = 'corrupted' }],
    ['xlsx pending', () => { job.artifacts.xlsx.status = 'pending' }],
  ])('blocks %s before Drive access', async (_label, setup) => {
    setup()
    const res = await call(body)
    expect(res.statusCode).toBe(409)
    expectNoDriveMutation()
    expect(state.pdf).not.toHaveBeenCalled()
  })
  it('rejects conflicting chunk bytes and mixed request flags before Drive', async () => {
    expect((await call({ ...body, chunkBase64: Buffer.from('wrong').toString('base64') })).statusCode).toBe(400)
    expect((await call({ ...body, isImageOnly: true })).statusCode).toBe(400)
    expectNoDriveMutation()
  })
  it('checks saved folder lineage, persists PDF before notification and retains other artifacts', async () => {
    state.kakao.mockImplementation(async () => {
      expect(job.artifacts.pdf.status).toBe('confirmed')
      expect(job.artifacts.pdf.notification.status).toBe('sending')
      return true
    })
    const res = await call(body)
    expect(res.body).toMatchObject({ success: true, assembled: true, fileId: 'pdf', reportId, submissionId, revision: 5 })
    expect(state.getFolder).not.toHaveBeenCalled()
    expect(job.artifacts.images.confirmed.image).toEqual({})
    expect(job.artifacts.pdf.notification.status).toBe('confirmed')
    expect(state.writeJob).not.toHaveBeenCalled()
  })
  it('rejects moved saved folders without PDF mutation', async () => {
    files.get.mockResolvedValue({ data: { id: 'month', mimeType: 'application/vnd.google-apps.folder', trashed: false, parents: ['archive'] } })
    expect((await call(body)).body.success).toBe(false)
    expect(state.pdf).not.toHaveBeenCalled()
    expect(state.getFolder).not.toHaveBeenCalled()
  })
  it('does not acknowledge an intermediate chunk as assembled', async () => {
    state.pdf.mockResolvedValue({ assembled: false, status: 'uploaded', received: 0 })
    const res = await call(body)
    expect(res.body).toMatchObject({ success: true, assembled: false, fileId: null, revision: 4 })
    expect(state.kakao).not.toHaveBeenCalled()
  })
  it('recovers final PDF after Redis write failure without notifying or rebuilding', async () => {
    state.conditionalWrite.mockResolvedValueOnce({ written: false, reason: 'lock_lost' })
    expect((await call(body)).body.success).toBe(false)
    expect(state.kakao).not.toHaveBeenCalled()
    state.pdf.mockResolvedValue({ assembled: true, status: 'recovered', id: 'pdf' })
    expect((await call(body)).body).toMatchObject({ success: true, assembled: true, uploadStatus: 'recovered' })
    expect(state.kakao).not.toHaveBeenCalled()
  })
  it('preserves pinned PDF ID and does not resend an uncertain notification on replay', async () => {
    job.artifacts.pdf = { status: 'confirmed', fileId: 'pdf', notification: { status: 'sending' } }
    state.pdf.mockResolvedValue({ assembled: true, status: 'recovered', id: 'pdf' })
    const res = await call(body)
    expect(state.pdf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expectedFileId: 'pdf' }))
    expect(res.body.kakaoStatus).toBe('unknown')
    expect(state.kakao).not.toHaveBeenCalled()
  })
})
