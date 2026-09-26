import crypto from 'crypto'
import { Redis } from '@upstash/redis'
import { KvUnavailableError } from './_kv.js'

const DEFAULT_TTL_SECONDS = 120
const SUBMISSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function getSubmissionRedis() {
  const url = process.env.KV_REST_API_URL
  const token = process.env.KV_REST_API_TOKEN
  if (!url || !token) throw new KvUnavailableError('submission lock Redis credentials are missing')
  return new Redis({ url, token })
}

export function monthLockKey(yearMonth) {
  const scope = crypto.createHash('sha256').update(String(yearMonth)).digest('hex')
  return `submission-lock:v1:month:${scope}`
}

export function artifactSubmissionLockKey(submissionId) {
  const scope = crypto.createHash('sha256').update(String(submissionId)).digest('hex')
  return `submission-lock:v1:submission:${scope}`
}

async function acquireLock({ key, redis, ttlSeconds, token }) {
  try {
    const result = await redis.set(key, token, { nx: true, ex: ttlSeconds })
    return { acquired: result === 'OK', key, token, ttlSeconds }
  } catch (cause) {
    throw new KvUnavailableError(`submission lock acquire: ${cause.message}`)
  }
}

export async function acquireSubmissionLock({ yearMonth, redis = getSubmissionRedis(), ttlSeconds = DEFAULT_TTL_SECONDS, token = crypto.randomUUID() }) {
  return acquireLock({ key: monthLockKey(yearMonth), redis, ttlSeconds, token })
}

// 진행 공유는 공식 제출과 다른 키를 써서, 진행현황을 다시 만드는 동안에도 제출이 막히지 않게 한다.
export function progressLockKey(yearMonth) {
  const scope = crypto.createHash('sha256').update(String(yearMonth)).digest('hex')
  return `progress-lock:v1:month:${scope}`
}

export async function acquireProgressLock({ yearMonth, redis = getSubmissionRedis(), ttlSeconds = 60, token = crypto.randomUUID() }) {
  return acquireLock({ key: progressLockKey(yearMonth), redis, ttlSeconds, token })
}

export async function acquireArtifactSubmissionLock({ submissionId, redis = getSubmissionRedis(), ttlSeconds = DEFAULT_TTL_SECONDS, token = crypto.randomUUID() }) {
  if (typeof submissionId !== 'string' || !SUBMISSION_ID_RE.test(submissionId)) throw new TypeError('invalid submissionId')
  return acquireLock({ key: artifactSubmissionLockKey(submissionId), redis, ttlSeconds, token })
}

const RENEW_SCRIPT = 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("EXPIRE", KEYS[1], ARGV[2]) else return 0 end'
const RELEASE_SCRIPT = 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) else return 0 end'

async function tokenScript(redis, script, key, token, args = []) {
  try {
    return await redis.eval(script, [key], [token, ...args])
  } catch (cause) {
    throw new KvUnavailableError(`submission lock operation: ${cause.message}`)
  }
}

export async function renewSubmissionLock({ key, token, ttlSeconds = DEFAULT_TTL_SECONDS, redis = getSubmissionRedis() }) {
  return Number(await tokenScript(redis, RENEW_SCRIPT, key, token, [String(ttlSeconds)])) === 1
}

export async function releaseSubmissionLock({ key, token, redis = getSubmissionRedis() }) {
  return Number(await tokenScript(redis, RELEASE_SCRIPT, key, token)) === 1
}
