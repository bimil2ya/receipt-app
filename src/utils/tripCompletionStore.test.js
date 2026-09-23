import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TripCompletionStoreError,
  beginTripOperation,
  commitKakaoOperation,
  commitSubmissionCompletion,
  parseTripCompletionRecord,
  readTripCompletionRecord,
  resetTripCompletionRecord,
  tripCompletionStorageKey,
} from './tripCompletionStore';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn(key => values.get(key) ?? null),
    setItem: vi.fn((key, value) => values.set(key, value)),
    values,
  };
}

function serialLocks() {
  const tails = new Map();
  return {
    request: vi.fn(async (name, options, operation) => {
      expect(options).toEqual({ mode: 'exclusive' });
      const previous = tails.get(name) || Promise.resolve();
      let release;
      const current = new Promise(resolve => { release = resolve; });
      tails.set(name, previous.then(() => current));
      await previous;
      try { return await operation(); } finally { release(); }
    }),
  };
}

const key = 'receipt-app:send-count:team-a:2026-09-01';

describe('tripCompletionStore', () => {
  beforeEach(() => vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'operation-id') }));

  it('preserves legacy counts and unknown fields while adding completion metadata', async () => {
    const storage = memoryStorage({ [key]: JSON.stringify({ kakaoCount: 4, uploadCount: 7, future: { kept: true } }) });
    const result = await commitSubmissionCompletion({
      storageKey: key, submissionId: 'submission-1', fingerprintKey: 'fingerprint-1', revision: 3, generation: 0,
    }, { storage, locks: serialLocks() });

    expect(result.applied).toBe(true);
    expect(result.record).toMatchObject({ kakaoCount: 4, uploadCount: 8, generation: 0, future: { kept: true } });
    expect(result.record.completedSubmissions['submission-1']).toEqual({ fingerprintKey: 'fingerprint-1', revision: 3, generation: 0 });
  });

  it('counts the same submission once and counts distinct concurrent submissions', async () => {
    const storage = memoryStorage();
    const locks = serialLocks();
    const first = { storageKey: key, submissionId: 'same', fingerprintKey: 'fp-same', revision: 1, generation: 0 };
    const [a, b] = await Promise.all([
      commitSubmissionCompletion(first, { storage, locks }),
      commitSubmissionCompletion(first, { storage, locks }),
    ]);
    expect([a.applied, b.applied].sort()).toEqual([false, true]);

    await Promise.all([
      commitSubmissionCompletion({ ...first, submissionId: 'other-a', fingerprintKey: 'fp-a' }, { storage, locks }),
      commitSubmissionCompletion({ ...first, submissionId: 'other-b', fingerprintKey: 'fp-b' }, { storage, locks }),
    ]);
    expect(readTripCompletionRecord(key, storage).uploadCount).toBe(3);
  });

  it('does not count a second submission ID for an already completed fingerprint', async () => {
    const storage = memoryStorage();
    const locks = serialLocks();
    await commitSubmissionCompletion({ storageKey: key, submissionId: 'first', fingerprintKey: 'same-payload', revision: 1, generation: 0 }, { storage, locks });
    const replay = await commitSubmissionCompletion({ storageKey: key, submissionId: 'other-tab-id', fingerprintKey: 'same-payload', revision: 2, generation: 0 }, { storage, locks });
    expect(replay.applied).toBe(false);
    expect(readTripCompletionRecord(key, storage).uploadCount).toBe(1);
  });

  it('rejects malformed records instead of replacing them with zeroes', () => {
    expect(() => parseTripCompletionRecord('{')).toThrowError(TripCompletionStoreError);
    expect(() => parseTripCompletionRecord(JSON.stringify({ uploadCount: -1 }))).toThrow(/uploadCount/);
    expect(() => parseTripCompletionRecord(JSON.stringify({ completedSubmissions: [] }))).toThrow(/completedSubmissions/);
  });

  it('fails closed when Web Locks are unavailable or readback differs', async () => {
    const storage = memoryStorage();
    await expect(commitSubmissionCompletion({ storageKey: key, submissionId: 'a', fingerprintKey: 'f', revision: 1, generation: 0 }, { storage, locks: null }))
      .rejects.toMatchObject({ code: 'WEB_LOCKS_UNAVAILABLE' });

    storage.getItem.mockImplementation(() => JSON.stringify({ uploadCount: 999 }));
    await expect(resetTripCompletionRecord(key, { storage, locks: serialLocks() }))
      .rejects.toMatchObject({ code: 'STORAGE_READBACK_MISMATCH' });
  });

  it('reset advances generation, clears counts, and rejects delayed completion', async () => {
    const storage = memoryStorage({ [key]: JSON.stringify({ kakaoCount: 2, uploadCount: 5, generation: 4, completedSubmissions: { old: { fingerprintKey: 'old-fp', revision: 1, generation: 4 } } }) });
    const locks = serialLocks();
    const reset = await resetTripCompletionRecord(key, { storage, locks });
    expect(reset).toMatchObject({ kakaoCount: 0, uploadCount: 0, generation: 5, completedSubmissions: {} });
    await expect(commitSubmissionCompletion({ storageKey: key, submissionId: 'late', fingerprintKey: 'late-fp', revision: 2, generation: 4 }, { storage, locks }))
      .rejects.toMatchObject({ code: 'STALE_GENERATION' });
  });

  it('uses a generation-bound operation token for Kakao commits', async () => {
    const storage = memoryStorage();
    const locks = serialLocks();
    const operation = await beginTripOperation(key, { storage, locks });
    const once = await commitKakaoOperation(operation, { storage, locks });
    const twice = await commitKakaoOperation(operation, { storage, locks });
    expect(once.kakaoCount).toBe(1);
    expect(twice.kakaoCount).toBe(1);
    await resetTripCompletionRecord(key, { storage, locks });
    await expect(commitKakaoOperation(operation, { storage, locks })).rejects.toMatchObject({ code: 'STALE_GENERATION' });
  });

  it('derives stable legacy-compatible trip keys', () => {
    expect(tripCompletionStorageKey({ selectedTeam: { id: '7' }, canonicalNames: 'A', tripStartDate: '2026-09-01' }))
      .toBe('receipt-app:send-count:team-7:2026-09-01');
    expect(tripCompletionStorageKey({ canonicalNames: ' 홍길동 ', tripStartDate: '' }))
      .toBe('receipt-app:send-count:홍길동:nodate');
  });
});
