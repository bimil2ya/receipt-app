import crypto from 'crypto'
import { KvUnavailableError } from './_kv.js'
import { artifactSubmissionLockKey, monthLockKey, getSubmissionRedis } from './_submissionLock.js'

export const FINAL_SUBMISSION_JOB_TTL_SECONDS = 60 * 60 * 24 * 14
const SUBMISSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_EXPECTED_IMAGES = 100
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_PDF_BYTES = 20 * 1024 * 1024
const MAX_PDF_CHUNKS = 20
const MAX_PDF_CHUNK_BYTES = 4 * 1024 * 1024

export function isSubmissionId(value) {
  return typeof value === 'string' && SUBMISSION_ID_RE.test(value)
}

export function submissionJobKey(submissionId) {
  // 제출 ID는 난수이지만 키 열람만으로도 상관관계를 만들 수 없게 해시한다.
  const digest = crypto.createHash('sha256').update(submissionId).digest('hex')
  return `receipt-submission:v1:${digest}`
}

function parseJob(value) {
  if (!value) return null
  if (typeof value === 'object') return value
  try { return JSON.parse(value) } catch {
    throw new KvUnavailableError('submission job contains invalid data')
  }
}

function sameScope(left, right) {
  return left?.yearMonth === right?.yearMonth
    && left?.surveyorName === right?.surveyorName
    && left?.weekFolderName === right?.weekFolderName
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)
}

function positiveSafeInteger(value, max) {
  return Number.isSafeInteger(value) && value > 0 && value <= max
}

export function normalizeExpectedArtifacts(expected) {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) throw new TypeError('invalid expected artifacts')
  if (!Array.isArray(expected.images) || expected.images.length > MAX_EXPECTED_IMAGES) throw new TypeError('invalid expected images')
  const seenImageKeys = new Set()
  const images = expected.images.map((image) => {
    if (!isSha256(image?.key) || seenImageKeys.has(image.key.toLowerCase())) throw new TypeError('invalid expected image key')
    if (!isSha256(image.sha256)) throw new TypeError('invalid expected image sha256')
    if (!positiveSafeInteger(image.byteLength, MAX_IMAGE_BYTES)) throw new TypeError('invalid expected image byteLength')
    if (!IMAGE_MIME_TYPES.has(image.mimeType)) throw new TypeError('invalid expected image mimeType')
    seenImageKeys.add(image.key.toLowerCase())
    return { key: image.key.toLowerCase(), sha256: image.sha256.toLowerCase(), byteLength: image.byteLength, mimeType: image.mimeType }
  })

  const pdf = expected.pdf
  if (!isSubmissionId(pdf?.reportId)) throw new TypeError('invalid expected PDF reportId')
  if (!isSha256(pdf.sha256)) throw new TypeError('invalid expected PDF sha256')
  if (!positiveSafeInteger(pdf.byteLength, MAX_PDF_BYTES)) throw new TypeError('invalid expected PDF byteLength')
  if (!Number.isSafeInteger(pdf.chunkCount) || pdf.chunkCount < 1 || pdf.chunkCount > MAX_PDF_CHUNKS) throw new TypeError('invalid expected PDF chunkCount')
  if (!Array.isArray(pdf.chunkSha256) || !Array.isArray(pdf.chunkByteLength)
    || pdf.chunkSha256.length !== pdf.chunkCount || pdf.chunkByteLength.length !== pdf.chunkCount) {
    throw new TypeError('invalid expected PDF chunks')
  }
  const chunkSha256 = pdf.chunkSha256.map((sha) => {
    if (!isSha256(sha)) throw new TypeError('invalid expected PDF chunk sha256')
    return sha.toLowerCase()
  })
  const chunkByteLength = pdf.chunkByteLength.map((length) => {
    if (!positiveSafeInteger(length, MAX_PDF_CHUNK_BYTES)) throw new TypeError('invalid expected PDF chunk byteLength')
    return length
  })
  if (chunkByteLength.reduce((sum, length) => sum + length, 0) !== pdf.byteLength) throw new TypeError('expected PDF byte lengths do not match')
  if (!Number.isSafeInteger(expected.receiptCount) || expected.receiptCount < 0) throw new TypeError('invalid expected receiptCount')
  if (!Number.isSafeInteger(expected.totalAmount)) throw new TypeError('invalid expected totalAmount')

  return {
    images,
    pdf: {
      reportId: pdf.reportId,
      sha256: pdf.sha256.toLowerCase(),
      byteLength: pdf.byteLength,
      chunkCount: pdf.chunkCount,
      chunkSha256,
      chunkByteLength,
    },
    receiptCount: expected.receiptCount,
    totalAmount: expected.totalAmount,
  }
}

function sameExpected(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function submissionContractDigest(job) {
  if (job?.kind !== 'final' || !isSha256(job.xlsxSha256) || !isFinalScope(job.scope) || job.schemaVersion !== 2 || !job.expected) {
    throw new TypeError('invalid submission contract')
  }
  const expected = normalizeExpectedArtifacts(job.expected)
  return crypto.createHash('sha256').update(JSON.stringify({
    id: job.id,
    kind: job.kind,
    xlsxSha256: job.xlsxSha256.toLowerCase(),
    scope: {
      yearMonth: job.scope.yearMonth,
      surveyorName: job.scope.surveyorName,
      weekFolderName: job.scope.weekFolderName,
    },
    schemaVersion: job.schemaVersion,
    expected,
  })).digest('hex')
}

function isFinalScope(scope) {
  return typeof scope?.yearMonth === 'string' && scope.yearMonth.length > 0
    && typeof scope?.surveyorName === 'string' && scope.surveyorName.length > 0
    && typeof scope?.weekFolderName === 'string' && scope.weekFolderName.length > 0
}

export async function readSubmissionJob({ submissionId, redis = getSubmissionRedis() }) {
  try {
    return parseJob(await redis.get(submissionJobKey(submissionId)))
  } catch (cause) {
    if (cause instanceof KvUnavailableError) throw cause
    throw new KvUnavailableError(`submission job read: ${cause.message}`)
  }
}

/**
 * First writer reserves the opaque submission ID. Retries may only reuse the
 * same server-calculated XLSX SHA-256 and the same Drive destination scope.
 */
export async function reserveFinalSubmission({
  submissionId,
  xlsxSha256,
  scope,
  expected,
  redis = getSubmissionRedis(),
  now = () => new Date().toISOString(),
  ttlSeconds = FINAL_SUBMISSION_JOB_TTL_SECONDS,
}) {
  if (!isSubmissionId(submissionId)) throw new TypeError('invalid submissionId')
  if (!isSha256(xlsxSha256)) throw new TypeError('invalid xlsxSha256')
  if (!isFinalScope(scope)) throw new TypeError('invalid final submission scope')
  const normalizedExpected = expected === undefined ? undefined : normalizeExpectedArtifacts(expected)
  const job = {
    id: submissionId,
    kind: 'final',
    xlsxSha256,
    scope,
    ...(normalizedExpected ? { schemaVersion: 2, revision: 1, expected: normalizedExpected } : {}),
    status: 'processing',
    artifacts: { xlsx: { status: 'pending' }, images: { status: 'pending' }, pdf: { status: 'pending' }, aggregate: { status: 'pending' }, kakao: { status: 'pending' } },
    createdAt: now(),
  }
  if (normalizedExpected) job.contractDigest = submissionContractDigest(job)
  const key = submissionJobKey(submissionId)
  try {
    const inserted = await redis.set(key, JSON.stringify(job), { nx: true, ex: ttlSeconds })
    if (inserted === 'OK') return { state: 'reserved', job, key, ttlSeconds }
    const existing = parseJob(await redis.get(key))
    if (!existing) throw new KvUnavailableError('submission job reservation disappeared')
    const expectedConflicts = Boolean(existing.expected) !== Boolean(normalizedExpected)
      || (normalizedExpected !== undefined && !sameExpected(existing.expected, normalizedExpected))
    if (existing.kind !== 'final' || existing.xlsxSha256 !== xlsxSha256 || !sameScope(existing.scope, scope) || expectedConflicts) {
      return { state: 'conflict', job: existing, key, ttlSeconds }
    }
    return { state: existing.status === 'processing' ? 'processing' : 'existing', job: existing, key, ttlSeconds }
  } catch (cause) {
    if (cause instanceof KvUnavailableError || cause instanceof TypeError) throw cause
    throw new KvUnavailableError(`submission job reserve: ${cause.message}`)
  }
}

const WRITE_IF_OWNED_SCRIPT = `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return -1 end
if KEYS[3] and redis.call("GET", KEYS[3]) ~= ARGV[6] then return -4 end
local current = redis.call("GET", KEYS[2])
if not current then return -2 end
local decoded = cjson.decode(current)
if tonumber(decoded.revision or 0) ~= tonumber(ARGV[2]) then return 0 end
if decoded.contractDigest ~= ARGV[5] then return -3 end
local next = cjson.decode(ARGV[3])
if next.contractDigest ~= decoded.contractDigest then return -3 end
redis.call("SET", KEYS[2], ARGV[3], "EX", ARGV[4])
return 1
`

export async function writeSubmissionJobIfLockOwned({
  submissionId,
  job,
  expectedRevision,
  lock,
  monthLock,
  redis = getSubmissionRedis(),
  ttlSeconds = FINAL_SUBMISSION_JOB_TTL_SECONDS,
}) {
  if (!isSubmissionId(submissionId) || job?.id !== submissionId) throw new TypeError('invalid submission job')
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || job?.revision !== expectedRevision + 1) throw new TypeError('invalid submission job revision')
  if (lock?.key !== artifactSubmissionLockKey(submissionId) || typeof lock?.token !== 'string' || lock.token.length === 0) throw new TypeError('invalid submission lock')
  if (monthLock !== undefined && (monthLock?.key !== monthLockKey(job.scope?.yearMonth)
    || typeof monthLock?.token !== 'string' || !monthLock.token)) throw new TypeError('invalid month lock')
  const contractDigest = submissionContractDigest(job)
  if (job.contractDigest !== contractDigest) throw new TypeError('invalid submission contract digest')
  try {
    const result = Number(await redis.eval(WRITE_IF_OWNED_SCRIPT, [lock.key, submissionJobKey(submissionId), ...(monthLock ? [monthLock.key] : [])], [
      lock.token,
      String(expectedRevision),
      JSON.stringify(job),
      String(ttlSeconds),
      contractDigest,
      ...(monthLock ? [monthLock.token] : []),
    ]))
    if (result === 1) return { written: true, reason: 'written' }
    if (result === -1) return { written: false, reason: 'lock_lost' }
    if (result === -2) return { written: false, reason: 'job_missing' }
    if (result === -3) return { written: false, reason: 'immutable_conflict' }
    if (result === -4) return { written: false, reason: 'month_lock_lost' }
    return { written: false, reason: 'revision_conflict' }
  } catch (cause) {
    if (cause instanceof TypeError) throw cause
    throw new KvUnavailableError(`submission job conditional write: ${cause.message}`)
  }
}

export async function writeSubmissionJob({ submissionId, job, redis = getSubmissionRedis(), ttlSeconds = FINAL_SUBMISSION_JOB_TTL_SECONDS }) {
  try {
    await redis.set(submissionJobKey(submissionId), JSON.stringify(job), { ex: ttlSeconds })
  } catch (cause) {
    throw new KvUnavailableError(`submission job write: ${cause.message}`)
  }
}
