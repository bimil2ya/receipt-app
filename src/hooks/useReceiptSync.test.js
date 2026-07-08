import { describe, expect, it, vi } from 'vitest';
import {
  computeBackoff,
  processQueue,
  shouldDeferOp,
  shouldDropOp,
  SYNC_BASE_DELAY_MS,
  SYNC_MAX_ATTEMPTS,
  SYNC_MAX_DELAY_MS,
} from './useReceiptSync';

describe('computeBackoff', () => {
  it('첫 실패(attempts=0)는 기본 지연을 반환한다', () => {
    expect(computeBackoff(0)).toBe(SYNC_BASE_DELAY_MS);
  });

  it('지수적으로 증가한다', () => {
    expect(computeBackoff(1)).toBe(SYNC_BASE_DELAY_MS * 2);
    expect(computeBackoff(2)).toBe(SYNC_BASE_DELAY_MS * 4);
    expect(computeBackoff(3)).toBe(SYNC_BASE_DELAY_MS * 8);
  });

  it('SYNC_MAX_DELAY_MS를 초과하지 않는다', () => {
    expect(computeBackoff(100)).toBe(SYNC_MAX_DELAY_MS);
    expect(computeBackoff(20)).toBe(SYNC_MAX_DELAY_MS);
  });

  it('사용자 지정 baseDelay와 maxDelay를 사용한다', () => {
    expect(computeBackoff(0, 1000, 10000)).toBe(1000);
    expect(computeBackoff(4, 1000, 10000)).toBe(10000);
  });
});

describe('shouldDropOp', () => {
  it('attempts가 SYNC_MAX_ATTEMPTS 이상이면 true를 반환한다', () => {
    expect(shouldDropOp({ attempts: SYNC_MAX_ATTEMPTS })).toBe(true);
    expect(shouldDropOp({ attempts: SYNC_MAX_ATTEMPTS + 1 })).toBe(true);
  });

  it('attempts가 SYNC_MAX_ATTEMPTS 미만이면 false를 반환한다', () => {
    expect(shouldDropOp({ attempts: SYNC_MAX_ATTEMPTS - 1 })).toBe(false);
    expect(shouldDropOp({ attempts: 0 })).toBe(false);
  });

  it('attempts가 없으면 false를 반환한다', () => {
    expect(shouldDropOp({})).toBe(false);
  });
});

describe('shouldDeferOp', () => {
  it('nextAttemptAt이 미래이면 true를 반환한다', () => {
    const futureTs = Date.now() + 60_000;
    expect(shouldDeferOp({ nextAttemptAt: futureTs }, Date.now())).toBe(true);
  });

  it('nextAttemptAt이 과거이면 false를 반환한다', () => {
    const pastTs = Date.now() - 1000;
    expect(shouldDeferOp({ nextAttemptAt: pastTs }, Date.now())).toBe(false);
  });

  it('nextAttemptAt이 없으면 false를 반환한다', () => {
    expect(shouldDeferOp({}, Date.now())).toBe(false);
    expect(shouldDeferOp({ nextAttemptAt: 0 }, Date.now())).toBe(false);
  });
});

// 의존성 주입 헬퍼
function makeSupabase({ upsertError = null, deleteError = null } = {}) {
  return {
    from: () => ({
      upsert: vi.fn().mockResolvedValue({ error: upsertError }),
      delete: () => ({ eq: vi.fn().mockResolvedValue({ error: deleteError }) }),
    }),
  };
}

function makeDeps(overrides = {}) {
  return {
    supabase: makeSupabase(),
    deleteQueueItem: vi.fn().mockResolvedValue(undefined),
    updateQueueItem: vi.fn().mockResolvedValue(undefined),
    recordSyncEvent: vi.fn(),
    now: 1_000_000,
    ...overrides,
  };
}

describe('processQueue', () => {
  it('upsert 성공 시 deleteQueueItem을 호출하고 processed를 증가시킨다', async () => {
    const deps = makeDeps();
    const op = { queueId: 'q1', type: 'upsert', items: [{ id: 'r1' }], attempts: 0 };

    const result = await processQueue([op], deps);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(0);
    expect(deps.deleteQueueItem).toHaveBeenCalledWith('q1');
    expect(deps.updateQueueItem).not.toHaveBeenCalled();
  });

  it('delete 성공 시 deleteQueueItem을 호출하고 userId 조건을 포함한다', async () => {
    const eq = vi.fn();
    const query = { eq, then: (res) => Promise.resolve({ error: null }).then(res) };
    eq.mockReturnValue(query);
    const supabase = { from: () => ({ delete: () => query }) };
    const deps = makeDeps({ supabase });
    const op = { queueId: 'q2', type: 'delete', id: 'r2', userId: 'u1', attempts: 0 };

    const result = await processQueue([op], deps);

    expect(result.processed).toBe(1);
    expect(deps.deleteQueueItem).toHaveBeenCalledWith('q2');
    expect(eq).toHaveBeenCalledWith('id', 'r2');
    expect(eq).toHaveBeenCalledWith('userId', 'u1');
  });

  it('delete op에 userId가 없으면 deviceUserId로 fallback한다 (구버전 호환)', async () => {
    const eq = vi.fn();
    const query = { eq, then: (res) => Promise.resolve({ error: null }).then(res) };
    eq.mockReturnValue(query);
    const supabase = { from: () => ({ delete: () => query }) };
    const deps = makeDeps({ supabase, deviceUserId: 'device-fallback' });
    const op = { queueId: 'q2b', type: 'delete', id: 'r2b', attempts: 0 };

    const result = await processQueue([op], deps);

    expect(result.processed).toBe(1);
    expect(eq).toHaveBeenCalledWith('id', 'r2b');
    expect(eq).toHaveBeenCalledWith('userId', 'device-fallback');
  });

  it('delete op에 userId도 deviceUserId도 없으면 에러를 던진다', async () => {
    const deps = makeDeps({ deviceUserId: undefined });
    const op = { queueId: 'q2c', type: 'delete', id: 'r2c', attempts: 0 };

    const result = await processQueue([op], deps);

    expect(result.failed).toBe(1);
    expect(result.lastError?.message).toBe('delete op: userId missing');
  });

  it('Supabase 오류 시 updateQueueItem에 backoff가 적용된 항목을 저장한다', async () => {
    const dbError = new Error('DB error');
    const deps = makeDeps({ supabase: makeSupabase({ upsertError: dbError }) });
    const op = { queueId: 'q3', type: 'upsert', items: [], attempts: 0 };

    const result = await processQueue([op], deps);

    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
    expect(deps.updateQueueItem).toHaveBeenCalledWith(
      expect.objectContaining({
        queueId: 'q3',
        attempts: 1,
        nextAttemptAt: deps.now + computeBackoff(0),
      }),
    );
    expect(deps.deleteQueueItem).not.toHaveBeenCalled();
  });

  it('attempts >= SYNC_MAX_ATTEMPTS인 항목은 drop하고 recordSyncEvent를 호출한다', async () => {
    const deps = makeDeps();
    const op = { queueId: 'q4', type: 'upsert', items: [], attempts: SYNC_MAX_ATTEMPTS };

    const result = await processQueue([op], deps);

    expect(result.dropped).toBe(1);
    expect(result.processed).toBe(0);
    expect(deps.deleteQueueItem).toHaveBeenCalledWith('q4');
    expect(deps.recordSyncEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'error', title: '보류 작업 포기' }),
    );
  });

  it('nextAttemptAt이 미래인 항목은 deferred로 건너뛴다', async () => {
    const now = 1_000_000;
    const deps = makeDeps({ now });
    const op = { queueId: 'q5', type: 'upsert', items: [], attempts: 0, nextAttemptAt: now + 60_000 };

    const result = await processQueue([op], deps);

    expect(result.deferred).toBe(1);
    expect(result.processed).toBe(0);
    expect(deps.deleteQueueItem).not.toHaveBeenCalled();
    expect(deps.updateQueueItem).not.toHaveBeenCalled();
  });

  it('혼합 큐 — 성공·실패·drop·defer를 각각 집계한다', async () => {
    const now = 1_000_000;
    let upsertCallCount = 0;
    const upsert = vi.fn().mockImplementation(() => {
      upsertCallCount += 1;
      return Promise.resolve({ error: upsertCallCount === 1 ? null : new Error('fail') });
    });
    const supabase = { from: () => ({ upsert, delete: () => ({ eq: vi.fn().mockResolvedValue({ error: null }) }) }) };
    const deps = makeDeps({ supabase, now });

    const queue = [
      { queueId: 'ok', type: 'upsert', items: [], attempts: 0 },
      { queueId: 'fail', type: 'upsert', items: [], attempts: 0 },
      { queueId: 'drop', type: 'upsert', items: [], attempts: SYNC_MAX_ATTEMPTS },
      { queueId: 'defer', type: 'upsert', items: [], attempts: 0, nextAttemptAt: now + 60_000 },
    ];

    const result = await processQueue(queue, deps);

    expect(result.processed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.dropped).toBe(1);
    expect(result.deferred).toBe(1);
  });
});
