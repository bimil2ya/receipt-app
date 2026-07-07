import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetDeviceIdCacheForTest, getOrCreateDeviceId } from './storage';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeLocalStorageMock() {
  const store = {};
  return {
    getItem: vi.fn(key => store[key] ?? null),
    setItem: vi.fn((key, val) => { store[key] = String(val); }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
    removeItem: vi.fn(key => { delete store[key]; }),
  };
}

describe('getOrCreateDeviceId', () => {
  let ls;

  beforeEach(() => {
    _resetDeviceIdCacheForTest();
    ls = makeLocalStorageMock();
    vi.stubGlobal('localStorage', ls);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('UUID를 반환한다 (system 아님)', () => {
    const id = getOrCreateDeviceId();
    expect(id).not.toBe('system');
    expect(id).toMatch(UUID_RE);
  });

  it('같은 세션에서 반복 호출해도 동일한 ID를 반환한다', () => {
    expect(getOrCreateDeviceId()).toBe(getOrCreateDeviceId());
  });

  it("localStorage에 'system'이 저장되어 있으면 새 UUID로 교체한다", () => {
    ls.getItem.mockReturnValueOnce('system');
    const id = getOrCreateDeviceId();
    expect(id).not.toBe('system');
    expect(id).toMatch(UUID_RE);
    expect(ls.setItem).toHaveBeenCalledWith('device_num', id);
  });

  it('기존 유효한 UUID가 있으면 그대로 반환한다', () => {
    const existing = '550e8400-e29b-41d4-a716-446655440000';
    ls.getItem.mockReturnValueOnce(existing);
    expect(getOrCreateDeviceId()).toBe(existing);
  });

  it('localStorage가 완전히 막혀도 system을 반환하지 않는다', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    });
    const id = getOrCreateDeviceId();
    expect(id).not.toBe('system');
    expect(id).toMatch(UUID_RE);
  });

  it('localStorage가 막혀도 세션 내 반복 호출 시 동일한 ID를 반환한다', () => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('blocked'); }),
    });
    expect(getOrCreateDeviceId()).toBe(getOrCreateDeviceId());
  });
});
