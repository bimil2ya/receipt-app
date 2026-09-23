import { describe, expect, it, vi } from 'vitest';
import {
  SubmissionAttemptJournalError,
  cleanupStaleSubmissionAttempt,
  clearSubmissionAttempt,
  fingerprintStorageKey,
  getOrCreateSubmissionAttempt,
  readSubmissionAttempt,
  submissionAttemptJournalKeys,
  transitionSubmissionAttempt,
} from './submissionAttemptJournal';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn(key => values.has(key) ? values.get(key) : null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn(key => values.delete(key)),
    values,
  };
}

function createLocks() {
  const tails = new Map();
  return {
    request: vi.fn(async (name, options, callback) => {
      expect(options).toEqual({ mode: 'exclusive' });
      const previous = tails.get(name) || Promise.resolve();
      let release;
      const current = new Promise(resolve => { release = resolve; });
      tails.set(name, previous.then(() => current));
      await previous;
      try {
        return await callback({ name });
      } finally {
        release();
      }
    }),
  };
}

function deps(storage = createStorage()) {
  return { storage, locks: createLocks() };
}

const fingerprint = '{"receipts":["r1"]}';
const scope = { surveyorName: 'A조', reportDate: '2026-09-14', yearMonth: '2026-09' };
const fixedTimes = () => '2026-09-14T00:00:00.000Z';

async function createAttempt(options = {}) {
  const dependencies = options.dependencies || deps();
  const ids = options.ids || ['submission-1', 'pdf-1'];
  let index = 0;
  const attempt = await getOrCreateSubmissionAttempt({
    fingerprint,
    scope,
    generation: options.generation ?? 0,
    now: fixedTimes,
    randomUUID: () => ids[index++],
  }, dependencies);
  return { attempt, dependencies };
}

describe('submission attempt v2 journal', () => {
  it('serializes concurrent creation per fingerprint into one UUID pair', async () => {
    const dependencies = deps();
    let id = 0;
    const create = () => getOrCreateSubmissionAttempt({
      fingerprint,
      scope,
      generation: 0,
      now: fixedTimes,
      randomUUID: () => `id-${++id}`,
    }, dependencies);

    const [first, second] = await Promise.all([create(), create()]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ submissionId: 'id-1', pdfReportId: 'id-2', phase: 'preparing' });
    expect(id).toBe(2);
    expect(dependencies.locks.request).toHaveBeenCalledTimes(3);
  });

  it('reads storage on every call and refuses changed immutable scope or generation', async () => {
    const { attempt, dependencies } = await createAttempt();
    const stored = JSON.parse(dependencies.storage.values.get(`${submissionAttemptJournalKeys.attemptPrefix}${attempt.fingerprintKey}`));
    stored.updatedAt = '2026-09-14T01:00:00.000Z';
    dependencies.storage.values.set(`${submissionAttemptJournalKeys.attemptPrefix}${attempt.fingerprintKey}`, JSON.stringify(stored));

    await expect(readSubmissionAttempt(fingerprint, dependencies)).resolves.toMatchObject({ updatedAt: stored.updatedAt });
    await expect(getOrCreateSubmissionAttempt({ fingerprint, scope: { ...scope, surveyorName: 'B조' }, generation: 0 }, dependencies))
      .rejects.toMatchObject({ code: 'ATTEMPT_SCOPE_MISMATCH' });
    await expect(getOrCreateSubmissionAttempt({ fingerprint, scope, generation: 1 }, dependencies))
      .rejects.toMatchObject({ code: 'ATTEMPT_GENERATION_MISMATCH' });
  });

  it('migrates a valid v1 attempt without deleting or changing its identities', async () => {
    const key = fingerprintStorageKey(fingerprint);
    const legacy = { [key]: { submissionId: 'legacy-submission', pdfReportId: 'legacy-pdf', createdAt: '2026-09-01T00:00:00.000Z', pdfSha256: 'abc', pdfByteLength: 12 } };
    const storage = createStorage({ [submissionAttemptJournalKeys.legacy]: JSON.stringify(legacy) });
    const dependencies = deps(storage);

    const result = await getOrCreateSubmissionAttempt({ fingerprint, scope, generation: 0, now: fixedTimes }, dependencies);

    expect(result).toMatchObject({ submissionId: 'legacy-submission', pdfReportId: 'legacy-pdf', pdfSha256: 'abc', pdfByteLength: 12 });
    expect(storage.values.get(submissionAttemptJournalKeys.legacy)).toBe(JSON.stringify(legacy));
  });

  it('supports only the explicit forward phases and preserves identity fields', async () => {
    const { attempt, dependencies } = await createAttempt();
    const pending = await transitionSubmissionAttempt({
      fingerprint,
      submissionId: attempt.submissionId,
      scope,
      generation: 0,
      phase: 'finalize_pending',
      patch: { pdfSha256: 'sha', pdfByteLength: 123 },
      now: () => '2026-09-14T00:01:00.000Z',
    }, dependencies);
    expect(pending).toMatchObject({ phase: 'finalize_pending', submissionId: attempt.submissionId, pdfReportId: attempt.pdfReportId, pdfSha256: 'sha' });

    await expect(transitionSubmissionAttempt({
      fingerprint, submissionId: attempt.submissionId, scope, generation: 0, phase: 'preparing',
    }, dependencies)).rejects.toMatchObject({ code: 'ATTEMPT_PHASE_TRANSITION_INVALID' });
    await expect(transitionSubmissionAttempt({
      fingerprint, submissionId: attempt.submissionId, scope, generation: 0, phase: 'recovery_required', patch: { submissionId: 'other' },
    }, dependencies)).rejects.toMatchObject({ code: 'ATTEMPT_IMMUTABLE_FIELD' });
  });

  it('clears only when the saved submissionId still matches', async () => {
    const { attempt, dependencies } = await createAttempt();
    await expect(clearSubmissionAttempt({ fingerprint, submissionId: 'other' }, dependencies)).resolves.toBe(false);
    await expect(readSubmissionAttempt(fingerprint, dependencies)).resolves.toMatchObject({ submissionId: attempt.submissionId });
    await expect(clearSubmissionAttempt({ fingerprint, submissionId: attempt.submissionId }, dependencies)).resolves.toBe(true);
    await expect(readSubmissionAttempt(fingerprint, dependencies)).resolves.toBeNull();
  });

  it('does not resurrect either v1 entry when two fingerprints are retired together', async () => {
    const otherFingerprint = '{"receipts":["r2"]}';
    const firstKey = fingerprintStorageKey(fingerprint);
    const secondKey = fingerprintStorageKey(otherFingerprint);
    const storage = createStorage({
      [submissionAttemptJournalKeys.legacy]: JSON.stringify({
        [firstKey]: { submissionId: 'legacy-1', pdfReportId: 'pdf-1' },
        [secondKey]: { submissionId: 'legacy-2', pdfReportId: 'pdf-2' },
      }),
    });
    const dependencies = deps(storage);
    const first = await getOrCreateSubmissionAttempt({ fingerprint, scope, generation: 0, now: fixedTimes }, dependencies);
    const second = await getOrCreateSubmissionAttempt({ fingerprint: otherFingerprint, scope, generation: 0, now: fixedTimes }, dependencies);

    await Promise.all([
      clearSubmissionAttempt({ fingerprint, submissionId: first.submissionId }, dependencies),
      clearSubmissionAttempt({ fingerprint: otherFingerprint, submissionId: second.submissionId }, dependencies),
    ]);

    expect(storage.values.get(submissionAttemptJournalKeys.legacy)).toBe('{}');
  });

  it('marks stale generations terminal but deletes the PDF only on an explicit cleanup call', async () => {
    const { attempt, dependencies } = await createAttempt();
    const deletePdfArtifact = vi.fn().mockResolvedValue(undefined);

    const marked = await cleanupStaleSubmissionAttempt({
      fingerprint, submissionId: attempt.submissionId, currentGeneration: 1, now: fixedTimes,
    }, dependencies);
    expect(marked).toMatchObject({ cleaned: false, reason: 'cleanup_not_requested', attempt: { phase: 'stale_generation' } });
    expect(deletePdfArtifact).not.toHaveBeenCalled();
    await expect(readSubmissionAttempt(fingerprint, dependencies)).resolves.toMatchObject({ phase: 'stale_generation' });

    const cleaned = await cleanupStaleSubmissionAttempt({
      fingerprint, submissionId: attempt.submissionId, currentGeneration: 1, deletePdfArtifact, now: fixedTimes,
    }, dependencies);
    expect(cleaned).toEqual({ cleaned: true, pdfReportId: attempt.pdfReportId });
    expect(deletePdfArtifact).toHaveBeenCalledWith(attempt.pdfReportId);
    await expect(readSubmissionAttempt(fingerprint, dependencies)).resolves.toBeNull();
  });

  it('does not mark or delete a current-generation attempt', async () => {
    const { attempt, dependencies } = await createAttempt({ generation: 2 });
    const deletePdfArtifact = vi.fn();
    await expect(cleanupStaleSubmissionAttempt({
      fingerprint, submissionId: attempt.submissionId, currentGeneration: 2, deletePdfArtifact,
    }, dependencies)).resolves.toEqual({ cleaned: false, reason: 'not_stale' });
    expect(deletePdfArtifact).not.toHaveBeenCalled();
  });

  it('fails closed for unavailable locks, corrupt storage, write failures, and readback mismatch', async () => {
    await expect(getOrCreateSubmissionAttempt({ fingerprint, scope, generation: 0 }, { storage: createStorage(), locks: null }))
      .rejects.toMatchObject({ code: 'ATTEMPT_LOCK_UNAVAILABLE' });

    const key = `${submissionAttemptJournalKeys.attemptPrefix}${fingerprintStorageKey(fingerprint)}`;
    const corrupt = deps(createStorage({ [key]: '{bad' }));
    await expect(readSubmissionAttempt(fingerprint, corrupt)).rejects.toBeInstanceOf(SubmissionAttemptJournalError);
    await expect(readSubmissionAttempt(fingerprint, corrupt)).rejects.toMatchObject({ code: 'ATTEMPT_STORAGE_CORRUPT' });

    const writeFailure = deps(createStorage());
    writeFailure.storage.setItem.mockImplementation(() => { throw new Error('quota'); });
    await expect(getOrCreateSubmissionAttempt({ fingerprint, scope, generation: 0 }, writeFailure))
      .rejects.toMatchObject({ code: 'ATTEMPT_STORAGE_WRITE_FAILED' });

    const readbackFailure = deps(createStorage());
    readbackFailure.storage.setItem.mockImplementation(() => {});
    await expect(getOrCreateSubmissionAttempt({ fingerprint, scope, generation: 0 }, readbackFailure))
      .rejects.toMatchObject({ code: 'ATTEMPT_STORAGE_READBACK_FAILED' });
  });

  it('keeps a stale terminal marker when explicit PDF deletion fails', async () => {
    const { attempt, dependencies } = await createAttempt();
    await expect(cleanupStaleSubmissionAttempt({
      fingerprint,
      submissionId: attempt.submissionId,
      currentGeneration: 1,
      deletePdfArtifact: vi.fn().mockRejectedValue(new Error('idb failed')),
    }, dependencies)).rejects.toThrow('idb failed');
    await expect(readSubmissionAttempt(fingerprint, dependencies)).resolves.toMatchObject({
      submissionId: attempt.submissionId,
      phase: 'stale_generation',
    });
  });
});
