const LEGACY_ATTEMPTS_KEY = 'receipt-app:submission-attempts:v1';
const ATTEMPT_KEY_PREFIX = 'receipt-app:submission-attempt:v2:';
const LOCK_NAME_PREFIX = 'receipt-app:submission-attempt-lock:v2:';
const LEGACY_LOCK_NAME = 'receipt-app:submission-attempt-legacy-lock:v2';

const ACTIVE_PHASES = new Set(['preparing', 'finalize_pending', 'recovery_required']);
const ALL_PHASES = new Set([...ACTIVE_PHASES, 'stale_generation']);
const TRANSITIONS = {
  preparing: new Set(['preparing', 'finalize_pending', 'recovery_required']),
  finalize_pending: new Set(['finalize_pending', 'recovery_required']),
  recovery_required: new Set(['recovery_required']),
  stale_generation: new Set(['stale_generation']),
};

export class SubmissionAttemptJournalError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'SubmissionAttemptJournalError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new SubmissionAttemptJournalError(code, message);
}

export function fingerprintStorageKey(fingerprint) {
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) {
    fail('ATTEMPT_FINGERPRINT_INVALID', '제출 지문이 비어 있습니다.');
  }
  const hash = seed => {
    let value = seed;
    for (let index = 0; index < fingerprint.length; index += 1) {
      value ^= fingerprint.charCodeAt(index);
      value = Math.imul(value, 0x01000193);
    }
    return (value >>> 0).toString(16).padStart(8, '0');
  };
  return `f${hash(0x811c9dc5)}${hash(0x9e3779b9)}${hash(0x7f4a7c15)}${hash(0x6d2b79f5)}`;
}

function journalKey(fingerprintKey) {
  return `${ATTEMPT_KEY_PREFIX}${fingerprintKey}`;
}

function lockName(fingerprintKey) {
  return `${LOCK_NAME_PREFIX}${fingerprintKey}`;
}

function resolveDependencies(options = {}) {
  const storage = options.storage !== undefined ? options.storage : globalThis.localStorage;
  const locks = options.locks !== undefined ? options.locks : globalThis.navigator?.locks;
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
    || typeof storage.removeItem !== 'function') {
    fail('ATTEMPT_STORAGE_UNAVAILABLE', '제출 시도 저장소를 사용할 수 없습니다.');
  }
  if (!locks || typeof locks.request !== 'function') {
    fail('ATTEMPT_LOCK_UNAVAILABLE', '제출 시도 잠금을 사용할 수 없습니다.');
  }
  return { storage, locks };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneScope(scope) {
  if (!isPlainObject(scope)) fail('ATTEMPT_SCOPE_INVALID', '제출 범위가 올바르지 않습니다.');
  let cloned;
  try {
    cloned = JSON.parse(JSON.stringify(scope));
  } catch {
    fail('ATTEMPT_SCOPE_INVALID', '제출 범위를 직렬화할 수 없습니다.');
  }
  if (!isPlainObject(cloned) || Object.keys(cloned).length === 0) {
    fail('ATTEMPT_SCOPE_INVALID', '제출 범위가 비어 있습니다.');
  }
  return cloned;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]));
  }
  return value;
}

function sameScope(left, right) {
  return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}

function assertGeneration(generation) {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    fail('ATTEMPT_GENERATION_INVALID', '제출 세대가 올바르지 않습니다.');
  }
}

function parseAttempt(raw, expectedFingerprintKey) {
  if (raw === null) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail('ATTEMPT_STORAGE_CORRUPT', '제출 시도 기록을 해석할 수 없습니다.');
  }
  if (!isPlainObject(value)
    || value.schemaVersion !== 2
    || value.fingerprintKey !== expectedFingerprintKey
    || typeof value.submissionId !== 'string' || value.submissionId.length === 0
    || typeof value.pdfReportId !== 'string' || value.pdfReportId.length === 0
    || !ALL_PHASES.has(value.phase)
    || !Number.isSafeInteger(value.generation) || value.generation < 0
    || !isPlainObject(value.scope) || Object.keys(value.scope).length === 0
    || typeof value.createdAt !== 'string' || value.createdAt.length === 0
    || typeof value.updatedAt !== 'string' || value.updatedAt.length === 0) {
    fail('ATTEMPT_STORAGE_CORRUPT', '제출 시도 기록의 형식이 올바르지 않습니다.');
  }
  return value;
}

function parseLegacyMap(raw) {
  if (raw === null) return {};
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail('ATTEMPT_LEGACY_STORAGE_CORRUPT', '기존 제출 시도 기록을 해석할 수 없습니다.');
  }
  if (!isPlainObject(value)) {
    fail('ATTEMPT_LEGACY_STORAGE_CORRUPT', '기존 제출 시도 기록의 형식이 올바르지 않습니다.');
  }
  return value;
}

function parseLegacyAttempt(value) {
  if (value === undefined) return null;
  if (!isPlainObject(value)
    || typeof value.submissionId !== 'string' || value.submissionId.length === 0
    || typeof value.pdfReportId !== 'string' || value.pdfReportId.length === 0) {
    fail('ATTEMPT_LEGACY_STORAGE_CORRUPT', '기존 제출 시도 항목의 형식이 올바르지 않습니다.');
  }
  return value;
}

function readAttempt(storage, fingerprintKey) {
  try {
    return parseAttempt(storage.getItem(journalKey(fingerprintKey)), fingerprintKey);
  } catch (error) {
    if (error instanceof SubmissionAttemptJournalError) throw error;
    fail('ATTEMPT_STORAGE_READ_FAILED', '제출 시도 기록을 읽지 못했습니다.');
  }
}

function writeAndVerify(storage, fingerprintKey, attempt) {
  const key = journalKey(fingerprintKey);
  const serialized = JSON.stringify(attempt);
  try {
    storage.setItem(key, serialized);
  } catch {
    fail('ATTEMPT_STORAGE_WRITE_FAILED', '제출 시도 기록을 저장하지 못했습니다.');
  }
  const readback = readAttempt(storage, fingerprintKey);
  if (!readback || JSON.stringify(readback) !== serialized) {
    fail('ATTEMPT_STORAGE_READBACK_FAILED', '제출 시도 기록 저장을 확인하지 못했습니다.');
  }
  return readback;
}

function removeAndVerify(storage, fingerprintKey) {
  try {
    storage.removeItem(journalKey(fingerprintKey));
    if (storage.getItem(journalKey(fingerprintKey)) !== null) {
      fail('ATTEMPT_STORAGE_READBACK_FAILED', '제출 시도 기록 삭제를 확인하지 못했습니다.');
    }
  } catch (error) {
    if (error instanceof SubmissionAttemptJournalError) throw error;
    fail('ATTEMPT_STORAGE_WRITE_FAILED', '제출 시도 기록을 삭제하지 못했습니다.');
  }
}

// A v1 map entry is only a migration source. Once its v2 successor is
// retired, retaining that source would recreate the same failed identity.
async function removeLegacyEntry(storage, locks, fingerprintKey) {
  // v1 stored every attempt in one shared map. Fingerprint locks protect a
  // single v2 entry, so two different fingerprints still need one lock while
  // they rewrite that shared migration source.
  return locks.request(LEGACY_LOCK_NAME, { mode: 'exclusive' }, () => {
    const legacy = parseLegacyMap(storage.getItem(LEGACY_ATTEMPTS_KEY));
    if (!Object.hasOwn(legacy, fingerprintKey)) return;
    delete legacy[fingerprintKey];
    const serialized = JSON.stringify(legacy);
    try {
      storage.setItem(LEGACY_ATTEMPTS_KEY, serialized);
    } catch {
      fail('ATTEMPT_STORAGE_WRITE_FAILED', '기존 제출 시도 기록을 정리하지 못했습니다.');
    }
    if (storage.getItem(LEGACY_ATTEMPTS_KEY) !== serialized) {
      fail('ATTEMPT_STORAGE_READBACK_FAILED', '기존 제출 시도 정리를 확인하지 못했습니다.');
    }
  });
}

async function withFingerprintLock(fingerprintKey, options, callback) {
  const { storage, locks } = resolveDependencies(options);
  let callbackStarted = false;
  try {
    return await locks.request(lockName(fingerprintKey), { mode: 'exclusive' }, () => {
      callbackStarted = true;
      return callback(storage, locks);
    });
  } catch (error) {
    if (callbackStarted || error instanceof SubmissionAttemptJournalError) throw error;
    fail('ATTEMPT_LOCK_FAILED', '제출 시도 잠금을 얻지 못했습니다.');
  }
}

function assertIdentity(attempt, { submissionId, scope, generation }) {
  if (attempt.submissionId !== submissionId) fail('ATTEMPT_IDENTITY_MISMATCH', '다른 제출 시도 기록입니다.');
  if (attempt.generation !== generation) fail('ATTEMPT_GENERATION_MISMATCH', '다른 출장 세대의 제출 시도입니다.');
  if (!sameScope(attempt.scope, scope)) fail('ATTEMPT_SCOPE_MISMATCH', '제출 범위가 변경되었습니다.');
}

export async function readSubmissionAttempt(fingerprint, options = {}) {
  const fingerprintKey = fingerprintStorageKey(fingerprint);
  return withFingerprintLock(fingerprintKey, options, storage => readAttempt(storage, fingerprintKey));
}

export async function getOrCreateSubmissionAttempt({ fingerprint, scope, generation, now, randomUUID } = {}, options = {}) {
  const fingerprintKey = fingerprintStorageKey(fingerprint);
  const immutableScope = cloneScope(scope);
  assertGeneration(generation);
  const clock = now ?? (() => new Date().toISOString());
  const uuid = randomUUID ?? (() => globalThis.crypto?.randomUUID?.());
  return withFingerprintLock(fingerprintKey, options, async (storage, locks) => {
    const existing = readAttempt(storage, fingerprintKey);
    if (existing) {
      assertIdentity(existing, { submissionId: existing.submissionId, scope: immutableScope, generation });
      return existing;
    }

    let legacy;
    try {
      legacy = await locks.request(LEGACY_LOCK_NAME, { mode: 'exclusive' }, () =>
        parseLegacyAttempt(parseLegacyMap(storage.getItem(LEGACY_ATTEMPTS_KEY))[fingerprintKey]));
    } catch (error) {
      if (error instanceof SubmissionAttemptJournalError) throw error;
      fail('ATTEMPT_STORAGE_READ_FAILED', '기존 제출 시도 기록을 읽지 못했습니다.');
    }
    const createdAt = legacy?.createdAt || clock();
    const submissionId = legacy?.submissionId || uuid();
    const pdfReportId = legacy?.pdfReportId || uuid();
    if (typeof submissionId !== 'string' || submissionId.length === 0
      || typeof pdfReportId !== 'string' || pdfReportId.length === 0
      || typeof createdAt !== 'string' || createdAt.length === 0) {
      fail('ATTEMPT_ID_GENERATION_FAILED', '제출 식별값을 만들지 못했습니다.');
    }
    const attempt = {
      schemaVersion: 2,
      fingerprintKey,
      submissionId,
      pdfReportId,
      scope: immutableScope,
      generation,
      phase: 'preparing',
      createdAt,
      updatedAt: clock(),
    };
    if (legacy?.pdfSha256 !== undefined) attempt.pdfSha256 = legacy.pdfSha256;
    if (legacy?.pdfByteLength !== undefined) attempt.pdfByteLength = legacy.pdfByteLength;
    return writeAndVerify(storage, fingerprintKey, attempt);
  });
}

export async function transitionSubmissionAttempt({ fingerprint, submissionId, scope, generation, phase, patch = {}, now } = {}, options = {}) {
  const fingerprintKey = fingerprintStorageKey(fingerprint);
  const immutableScope = cloneScope(scope);
  assertGeneration(generation);
  if (!ACTIVE_PHASES.has(phase)) fail('ATTEMPT_PHASE_INVALID', '제출 시도 단계가 올바르지 않습니다.');
  if (!isPlainObject(patch)) fail('ATTEMPT_PATCH_INVALID', '제출 시도 변경값이 올바르지 않습니다.');
  const forbidden = ['schemaVersion', 'fingerprintKey', 'submissionId', 'pdfReportId', 'scope', 'generation', 'phase', 'createdAt'];
  if (forbidden.some(key => Object.hasOwn(patch, key))) {
    fail('ATTEMPT_IMMUTABLE_FIELD', '제출 시도의 고정값은 변경할 수 없습니다.');
  }
  const clock = now ?? (() => new Date().toISOString());
  return withFingerprintLock(fingerprintKey, options, storage => {
    const existing = readAttempt(storage, fingerprintKey);
    if (!existing) fail('ATTEMPT_NOT_FOUND', '제출 시도 기록이 없습니다.');
    assertIdentity(existing, { submissionId, scope: immutableScope, generation });
    if (!TRANSITIONS[existing.phase]?.has(phase)) {
      fail('ATTEMPT_PHASE_TRANSITION_INVALID', '허용되지 않은 제출 시도 단계 변경입니다.');
    }
    return writeAndVerify(storage, fingerprintKey, { ...existing, ...patch, phase, updatedAt: clock() });
  });
}

export async function clearSubmissionAttempt({ fingerprint, submissionId } = {}, options = {}) {
  const fingerprintKey = fingerprintStorageKey(fingerprint);
  return withFingerprintLock(fingerprintKey, options, async (storage, locks) => {
    const existing = readAttempt(storage, fingerprintKey);
    if (!existing || existing.submissionId !== submissionId) return false;
    removeAndVerify(storage, fingerprintKey);
    await removeLegacyEntry(storage, locks, fingerprintKey);
    return true;
  });
}

export async function cleanupStaleSubmissionAttempt({ fingerprint, submissionId, currentGeneration, deletePdfArtifact, now } = {}, options = {}) {
  const fingerprintKey = fingerprintStorageKey(fingerprint);
  assertGeneration(currentGeneration);
  if (deletePdfArtifact !== undefined && typeof deletePdfArtifact !== 'function') {
    fail('ATTEMPT_CLEANUP_INVALID', 'PDF 정리 함수가 올바르지 않습니다.');
  }
  const clock = now ?? (() => new Date().toISOString());
  return withFingerprintLock(fingerprintKey, options, async (storage, locks) => {
    const existing = readAttempt(storage, fingerprintKey);
    if (!existing || existing.submissionId !== submissionId || existing.generation >= currentGeneration) {
      return { cleaned: false, reason: 'not_stale' };
    }
    const terminal = existing.phase === 'stale_generation' ? existing : writeAndVerify(storage, fingerprintKey, {
      ...existing,
      phase: 'stale_generation',
      terminalReason: 'stale_generation',
      updatedAt: clock(),
    });
    if (!deletePdfArtifact) return { cleaned: false, reason: 'cleanup_not_requested', attempt: terminal };
    await deletePdfArtifact(terminal.pdfReportId);
    const current = readAttempt(storage, fingerprintKey);
    if (!current || current.submissionId !== submissionId || current.phase !== 'stale_generation') {
      return { cleaned: false, reason: 'identity_changed' };
    }
    removeAndVerify(storage, fingerprintKey);
    await removeLegacyEntry(storage, locks, fingerprintKey);
    return { cleaned: true, pdfReportId: terminal.pdfReportId };
  });
}

export const submissionAttemptJournalKeys = Object.freeze({
  legacy: LEGACY_ATTEMPTS_KEY,
  attemptPrefix: ATTEMPT_KEY_PREFIX,
  lockPrefix: LOCK_NAME_PREFIX,
});
