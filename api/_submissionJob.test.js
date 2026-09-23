import { describe, expect, it } from 'vitest'
import {
  FINAL_SUBMISSION_JOB_TTL_SECONDS,
  isSubmissionId,
  reserveFinalSubmission,
  normalizeExpectedArtifacts,
  submissionContractDigest,
  submissionJobKey,
  writeSubmissionJob,
  writeSubmissionJobIfLockOwned,
} from './_submissionJob.js'
import { artifactSubmissionLockKey, monthLockKey } from './_submissionLock.js'

const id = '9f7dfaf1-a4bd-44f1-83e1-c2a1e4f27f20'
const scope = { yearMonth: '2026년 09월', surveyorName: 'A조', weekFolderName: '2026-09-01~2026-09-02' }
const expected = {
  images: [{ key: 'b'.repeat(64), sha256: 'c'.repeat(64), byteLength: 1234, mimeType: 'image/jpeg' }],
  pdf: {
    reportId: '5f7dfaf1-a4bd-44f1-83e1-c2a1e4f27f20',
    sha256: 'd'.repeat(64),
    byteLength: 3000,
    chunkCount: 2,
    chunkSha256: ['e'.repeat(64), 'f'.repeat(64)],
    chunkByteLength: [1500, 1500],
  },
  receiptCount: 1,
  totalAmount: 12000,
}

describe('final submission jobs', () => {
  it('uses a stable opaque key and validates UUID submission IDs', () => {
    expect(isSubmissionId(id)).toBe(true)
    expect(isSubmissionId('not-a-uuid')).toBe(false)
    expect(submissionJobKey(id)).toBe(submissionJobKey(id))
    expect(submissionJobKey(id)).not.toContain(id)
  })

  it('atomically reserves a final submission with isolated artifact states', async () => {
    const calls = []
    const redis = { set: async (...args) => { calls.push(args); return 'OK' } }
    const result = await reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, redis, now: () => '2026-09-11T00:00:00.000Z' })
    expect(result.state).toBe('reserved')
    expect(result.job).toMatchObject({ id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, status: 'processing' })
    expect(result.job.artifacts).toEqual({
      xlsx: { status: 'pending' }, images: { status: 'pending' }, pdf: { status: 'pending' }, aggregate: { status: 'pending' }, kakao: { status: 'pending' },
    })
    expect(calls[0][2]).toEqual({ nx: true, ex: FINAL_SUBMISSION_JOB_TTL_SECONDS })
  })

  it('returns an existing matching job without accepting a different payload or destination', async () => {
    const job = { id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, status: 'xlsx_confirmed' }
    const redis = { set: async () => null, get: async () => JSON.stringify(job) }
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, redis })).resolves.toMatchObject({ state: 'existing', job })
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'b'.repeat(64), scope, redis })).resolves.toMatchObject({ state: 'conflict' })
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope: { ...scope, surveyorName: 'B조' }, redis })).resolves.toMatchObject({ state: 'conflict' })
  })

  it('normalizes and reserves the immutable expected artifact contract', async () => {
    expect(normalizeExpectedArtifacts(expected)).toEqual(expected)
    const redis = { set: async () => 'OK' }
    const result = await reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, expected, redis })
    expect(result.job).toMatchObject({ schemaVersion: 2, revision: 1, expected, contractDigest: submissionContractDigest(result.job) })
  })

  it('rejects malformed expected artifacts before Redis and treats a changed contract as a conflict', async () => {
    const untouched = { set: async () => { throw new Error('must not run') } }
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, expected: { ...expected, pdf: { ...expected.pdf, chunkByteLength: [1499, 1500] } }, redis: untouched }))
      .rejects.toThrow('expected PDF byte lengths do not match')
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, expected: { ...expected, images: [...expected.images, expected.images[0]] }, redis: untouched }))
      .rejects.toThrow('invalid expected image key')

    const existing = { id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, status: 'processing', expected }
    const redis = { set: async () => null, get: async () => JSON.stringify(existing) }
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, expected, redis })).resolves.toMatchObject({ state: 'processing' })
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, redis })).resolves.toMatchObject({ state: 'conflict' })
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, expected: { ...expected, totalAmount: 12001 }, redis })).resolves.toMatchObject({ state: 'conflict' })
  })

  it('reports a matching processing job and fails closed when Redis is unavailable', async () => {
    const redis = { set: async () => null, get: async () => JSON.stringify({ id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, status: 'processing' }) }
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, redis })).resolves.toMatchObject({ state: 'processing' })
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope, redis: { set: async () => { throw new Error('offline') } } }))
      .rejects.toMatchObject({ code: 'KV_UNAVAILABLE' })
  })

  it('rejects missing or malformed hash and scope before touching Redis', async () => {
    const redis = { set: async () => { throw new Error('must not run') } }
    await expect(reserveFinalSubmission({ submissionId: 'bad', xlsxSha256: 'a'.repeat(64), scope, redis })).rejects.toThrow('invalid submissionId')
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'bad', scope, redis })).rejects.toThrow('invalid xlsxSha256')
    await expect(reserveFinalSubmission({ submissionId: id, xlsxSha256: 'a'.repeat(64), scope: {}, redis })).rejects.toThrow('invalid final submission scope')
  })

  it('writes a replacement job state with a bounded TTL', async () => {
    const calls = []
    await writeSubmissionJob({ submissionId: id, job: { id, status: 'xlsx_confirmed' }, redis: { set: async (...args) => calls.push(args) } })
    expect(calls[0][0]).toBe(submissionJobKey(id))
    expect(JSON.parse(calls[0][1])).toMatchObject({ status: 'xlsx_confirmed' })
    expect(calls[0][2]).toEqual({ ex: FINAL_SUBMISSION_JOB_TTL_SECONDS })
  })

  it('writes a newer revision only while the caller still owns the submission lock', async () => {
    const calls = []
    const baseJob = { id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, schemaVersion: 2, expected }
    const nextJob = { ...baseJob, contractDigest: submissionContractDigest(baseJob), revision: 2, status: 'processing' }
    const redis = { eval: async (...args) => { calls.push(args); return 1 } }
    const lockKey = artifactSubmissionLockKey(id)
    await expect(writeSubmissionJobIfLockOwned({ submissionId: id, job: nextJob, expectedRevision: 1, lock: { key: lockKey, token: 'owner' }, redis }))
      .resolves.toEqual({ written: true, reason: 'written' })
    expect(calls[0][1]).toEqual([lockKey, submissionJobKey(id)])
    expect(calls[0][2]).toEqual(['owner', '1', JSON.stringify(nextJob), String(FINAL_SUBMISSION_JOB_TTL_SECONDS), nextJob.contractDigest])
  })

  it.each([
    [-1, 'lock_lost'],
    [-2, 'job_missing'],
    [-3, 'immutable_conflict'],
    [-4, 'month_lock_lost'],
    [0, 'revision_conflict'],
  ])('fails closed for conditional-write result %s', async (result, reason) => {
    const baseJob = { id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, schemaVersion: 2, expected }
    const job = { ...baseJob, contractDigest: submissionContractDigest(baseJob), revision: 2 }
    await expect(writeSubmissionJobIfLockOwned({ submissionId: id, job, expectedRevision: 1, lock: { key: artifactSubmissionLockKey(id), token: 'owner' }, redis: { eval: async () => result } }))
      .resolves.toEqual({ written: false, reason })
  })

  it('rejects a month lock or another submission lock before conditional write', async () => {
    const redis = { eval: async () => { throw new Error('must not run') } }
    const baseJob = { id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, schemaVersion: 2, expected }
    const job = { ...baseJob, contractDigest: submissionContractDigest(baseJob), revision: 2 }
    await expect(writeSubmissionJobIfLockOwned({ submissionId: id, job, expectedRevision: 1, lock: { key: monthLockKey(scope.yearMonth), token: 'owner' }, redis }))
      .rejects.toThrow('invalid submission lock')
    await expect(writeSubmissionJobIfLockOwned({ submissionId: id, job, expectedRevision: 1, lock: { key: artifactSubmissionLockKey('11111111-1111-4111-8111-111111111111'), token: 'owner' }, redis }))
      .rejects.toThrow('invalid submission lock')
  })
  it('includes the matching month token in the same atomic revision write', async () => {
    const base = { id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, schemaVersion: 2, expected }
    const job = { ...base, contractDigest: submissionContractDigest(base), revision: 2 }
    const calls = []
    const redis = { eval: async (...args) => { calls.push(args); return 1 } }
    const lock = { key: artifactSubmissionLockKey(id), token: 'artifact-owner' }
    const monthLock = { key: monthLockKey(scope.yearMonth), token: 'month-owner' }
    await expect(writeSubmissionJobIfLockOwned({ submissionId: id, job, expectedRevision: 1, lock, monthLock, redis })).resolves.toMatchObject({ written: true })
    expect(calls[0][1]).toEqual([lock.key, submissionJobKey(id), monthLock.key])
    expect(calls[0][2].at(-1)).toBe(monthLock.token)
    expect(calls[0][0]).toContain('redis.call("GET", KEYS[3]) ~= ARGV[6]')
    await expect(writeSubmissionJobIfLockOwned({ submissionId: id, job, expectedRevision: 1, lock,
      monthLock: { ...monthLock, key: monthLockKey('different') }, redis })).rejects.toThrow('invalid month lock')
    expect(calls).toHaveLength(1)
  })

  it.each([
    ['expected', (job) => ({ ...job, expected: { ...job.expected, totalAmount: job.expected.totalAmount + 1 } })],
    ['scope', (job) => ({ ...job, scope: { ...job.scope, surveyorName: 'B조' } })],
    ['xlsx hash', (job) => ({ ...job, xlsxSha256: '9'.repeat(64) })],
  ])('rejects a changed immutable %s before Redis when its digest is stale', async (_label, mutate) => {
    const baseJob = { id, kind: 'final', xlsxSha256: 'a'.repeat(64), scope, schemaVersion: 2, expected }
    const job = mutate({ ...baseJob, contractDigest: submissionContractDigest(baseJob), revision: 2 })
    await expect(writeSubmissionJobIfLockOwned({ submissionId: id, job, expectedRevision: 1, lock: { key: artifactSubmissionLockKey(id), token: 'owner' }, redis: { eval: async () => { throw new Error('must not run') } } }))
      .rejects.toThrow('invalid submission contract digest')
  })
})
