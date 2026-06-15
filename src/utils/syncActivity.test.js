import { describe, expect, it } from 'vitest';
import { getSyncFailureHint, summarizeSyncFailureReasons } from './syncActivity';

describe('syncActivity utils', () => {
  it('summarizes failure reasons', () => {
    const reasons = summarizeSyncFailureReasons([
      { status: 'error', title: '저장 동기화 실패', detail: 'Failed to fetch' },
      { status: 'error', title: '삭제 동기화 실패', detail: '401 unauthorized' },
      { status: 'error', title: '보류 작업 전송 실패', detail: 'timeout while sending' },
    ]);

    expect(reasons.map(item => item.label)).toEqual(['네트워크', '인증']);
    expect(reasons[0].count).toBe(2);
  });

  it('returns a hint for a failure message', () => {
    expect(getSyncFailureHint('401 unauthorized')).toContain('설정');
  });
});
