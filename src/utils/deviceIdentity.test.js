import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFixedUserName, getOrCreateDeviceId, registerFixedUserName } from './deviceIdentity';

beforeEach(() => {
  const values = new Map();
  vi.stubGlobal('localStorage', { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), clear: () => values.clear() });
});

describe('device identity', () => {
  it('keeps one generated device id and prevents a local name replacement', () => {
    expect(getOrCreateDeviceId()).toBe(getOrCreateDeviceId());
    expect(registerFixedUserName('홍길동')).toBe('홍길동');
    expect(getFixedUserName()).toBe('홍길동');
    expect(() => registerFixedUserName('김영희')).toThrow('변경할 수 없습니다');
  });
});
