import { describe, expect, it } from 'vitest';
import { formatFailureDetail, formatFailureMessage, getFailureHint, normalizeErrorMessage } from './errorCopy';

describe('errorCopy utils', () => {
  it('normalizes noisy errors', () => {
    expect(normalizeErrorMessage(new Error('  Failed to fetch   '))).toBe('Failed to fetch');
  });

  it('adds a network hint', () => {
    expect(getFailureHint('Failed to fetch')).toContain('네트워크');
  });

  it('formats action-oriented failure copy', () => {
    expect(formatFailureMessage('동기화 실패', 'Unauthorized: token missing')).toContain('설정에서 연결 정보를 다시 확인하세요.');
  });

  it('formats short details for logs', () => {
    expect(formatFailureDetail('timeout')).toContain('잠시 후 다시 시도하세요.');
  });
});
