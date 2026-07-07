import { describe, expect, it } from 'vitest';
import {
  computeBackoff,
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
