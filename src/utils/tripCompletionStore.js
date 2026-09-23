const STORAGE_PREFIX = 'receipt-app:send-count';
const LOCK_PREFIX = 'receipt-app:trip-completion-lock:';

export class TripCompletionStoreError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'TripCompletionStoreError';
    this.code = code;
  }
}

function safeCount(value, field) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TripCompletionStoreError('INVALID_TRIP_RECORD', `${field} must be a non-negative safe integer`);
  }
  return value;
}

function parseCompletedSubmissions(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TripCompletionStoreError('INVALID_TRIP_RECORD', 'completedSubmissions must be an object');
  }
  const result = {};
  for (const [submissionId, item] of Object.entries(value)) {
    if (!submissionId || !item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TripCompletionStoreError('INVALID_TRIP_RECORD', 'invalid completed submission');
    }
    const { fingerprintKey, revision, generation } = item;
    if (typeof fingerprintKey !== 'string' || !fingerprintKey || !Number.isSafeInteger(revision) || revision <= 0) {
      throw new TripCompletionStoreError('INVALID_TRIP_RECORD', 'invalid completed submission identity');
    }
    result[submissionId] = {
      ...item,
      fingerprintKey,
      revision,
      generation: safeCount(generation, 'completed submission generation'),
    };
  }
  return result;
}

export function tripCompletionStorageKey({ canonicalNames, selectedTeam, tripStartDate }) {
  const canonical = String(canonicalNames ?? '').trim() || 'unknown';
  const owner = selectedTeam?.id ? `team-${selectedTeam.id}` : canonical;
  return `${STORAGE_PREFIX}:${owner}:${tripStartDate || 'nodate'}`;
}

export function parseTripCompletionRecord(raw) {
  if (raw === null || raw === '') {
    return { kakaoCount: 0, uploadCount: 0, generation: 0, completedSubmissions: {} };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new TripCompletionStoreError('INVALID_TRIP_RECORD', 'trip record is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TripCompletionStoreError('INVALID_TRIP_RECORD', 'trip record must be an object');
  }
  return {
    ...parsed,
    kakaoCount: safeCount(parsed.kakaoCount, 'kakaoCount'),
    uploadCount: safeCount(parsed.uploadCount, 'uploadCount'),
    generation: safeCount(parsed.generation, 'generation'),
    completedSubmissions: parseCompletedSubmissions(parsed.completedSubmissions),
  };
}

export function readTripCompletionRecord(storageKey, storage = globalThis.localStorage) {
  if (!storage?.getItem) throw new TripCompletionStoreError('STORAGE_UNAVAILABLE');
  return parseTripCompletionRecord(storage.getItem(storageKey));
}

function assertGeneration(generation) {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new TripCompletionStoreError('INVALID_GENERATION');
  }
}

function writeVerified(storageKey, record, storage) {
  const serialized = JSON.stringify(record);
  storage.setItem(storageKey, serialized);
  const readback = storage.getItem(storageKey);
  if (readback !== serialized) throw new TripCompletionStoreError('STORAGE_READBACK_MISMATCH');
  return record;
}

export async function withTripCompletionLock(storageKey, operation, locks = globalThis.navigator?.locks) {
  if (!locks?.request) throw new TripCompletionStoreError('WEB_LOCKS_UNAVAILABLE');
  return locks.request(`${LOCK_PREFIX}${storageKey}`, { mode: 'exclusive' }, operation);
}

async function mutate(storageKey, change, { storage = globalThis.localStorage, locks = globalThis.navigator?.locks } = {}) {
  return withTripCompletionLock(storageKey, () => {
    const current = readTripCompletionRecord(storageKey, storage);
    const next = change(current);
    return writeVerified(storageKey, next, storage);
  }, locks);
}

export async function commitSubmissionCompletion({ storageKey, submissionId, fingerprintKey, revision, generation }, options) {
  if (!submissionId || !fingerprintKey || !Number.isSafeInteger(revision) || revision <= 0) {
    throw new TripCompletionStoreError('INVALID_COMPLETION');
  }
  assertGeneration(generation);
  let applied = false;
  const record = await mutate(storageKey, current => {
    if (current.generation !== generation) throw new TripCompletionStoreError('STALE_GENERATION');
    const existing = current.completedSubmissions[submissionId];
    if (existing) {
      if (existing.generation === generation && existing.fingerprintKey === fingerprintKey) return current;
      throw new TripCompletionStoreError('SUBMISSION_ID_CONFLICT');
    }
    // A second tab can have allocated a different opaque submission ID before
    // it observes this tab's completion. The trip's business identity is the
    // fingerprint, so it must not add a second count for the same payload.
    if (Object.values(current.completedSubmissions).some(item =>
      item.generation === generation && item.fingerprintKey === fingerprintKey)) return current;
    if (current.uploadCount >= Number.MAX_SAFE_INTEGER) throw new TripCompletionStoreError('COUNT_OVERFLOW');
    applied = true;
    return {
      ...current,
      uploadCount: current.uploadCount + 1,
      completedSubmissions: {
        ...current.completedSubmissions,
        [submissionId]: { fingerprintKey, revision, generation },
      },
    };
  }, options);
  return { applied, record };
}

export async function beginTripOperation(storageKey, options) {
  return withTripCompletionLock(storageKey, () => {
    const record = readTripCompletionRecord(storageKey, options?.storage);
    return { storageKey, generation: record.generation, token: crypto.randomUUID() };
  }, options?.locks);
}

export async function commitKakaoOperation(operation, options) {
  if (!operation?.token || !operation.storageKey) throw new TripCompletionStoreError('INVALID_OPERATION');
  assertGeneration(operation.generation);
  const record = await mutate(operation.storageKey, current => {
    if (current.generation !== operation.generation) throw new TripCompletionStoreError('STALE_GENERATION');
    const committed = current.kakaoOperations;
    if (committed !== undefined && (!committed || typeof committed !== 'object' || Array.isArray(committed))) {
      throw new TripCompletionStoreError('INVALID_TRIP_RECORD');
    }
    if (committed?.[operation.token]?.generation === operation.generation) return current;
    if (current.kakaoCount >= Number.MAX_SAFE_INTEGER) throw new TripCompletionStoreError('COUNT_OVERFLOW');
    return {
      ...current,
      kakaoCount: current.kakaoCount + 1,
      kakaoOperations: {
        ...(committed || {}),
        [operation.token]: { generation: operation.generation },
      },
    };
  }, options);
  return record;
}

export async function updateTripCount(storageKey, field, updater, options) {
  if (field !== 'kakaoCount' && field !== 'uploadCount') throw new TripCompletionStoreError('INVALID_COUNT_FIELD');
  return mutate(storageKey, current => {
    const value = typeof updater === 'function' ? updater(current[field]) : updater;
    safeCount(value, field);
    return { ...current, [field]: value };
  }, options);
}

export async function resetTripCompletionRecord(storageKey, options) {
  return mutate(storageKey, current => {
    if (current.generation >= Number.MAX_SAFE_INTEGER) throw new TripCompletionStoreError('GENERATION_OVERFLOW');
    return {
      ...current,
      generation: current.generation + 1,
      kakaoCount: 0,
      uploadCount: 0,
      completedSubmissions: {},
      kakaoOperations: {},
    };
  }, options);
}
