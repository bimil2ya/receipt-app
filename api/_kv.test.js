import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { kv, kvIncrWithTtl, resetKvToMemory, configureKv, KvUnavailableError } from './_kv.js';

beforeEach(() => resetKvToMemory());

describe('_kv in-memory store', () => {
  it('incr counts up and returns the post-increment value', async () => {
    expect(await kv.incr('a')).toBe(1);
    expect(await kv.incr('a')).toBe(2);
  });

  it('kvIncrWithTtl fixes the window on first set (NX — not sliding)', async () => {
    vi.useFakeTimers();
    try {
      await kvIncrWithTtl('w', 10); // expireAt = now + 10s
      vi.advanceTimersByTime(6000);
      await kvIncrWithTtl('w', 10); // NX — must NOT extend to now+10
      vi.advanceTimersByTime(5000); // total 11s → past original window
      expect(await kv.get('w')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('self-heals a TTL-less key when an earlier expire failed', async () => {
    let failExpire = true;
    configureKv({
      incr: async () => 1,
      // 첫 호출은 실패(고아 키), 이후 성공
      expire: async () => {
        if (failExpire) {
          failExpire = false;
          throw new Error('transient');
        }
        return true;
      },
      get: async () => 1,
      del: async () => 1,
    });
    await expect(kvIncrWithTtl('x', 60)).rejects.toBeInstanceOf(KvUnavailableError);
    // 다음 호출이 expire를 다시 시도한다
    await expect(kvIncrWithTtl('x', 60)).resolves.toBe(1);
  });
});

describe('_kv unconfigured guard (production default)', () => {
  const original = process.env.VERCEL_ENV;
  afterEach(() => {
    process.env.VERCEL_ENV = original;
    vi.resetModules();
  });

  it('throws KV_UNAVAILABLE on every op when VERCEL_ENV=production and no client is injected', async () => {
    process.env.VERCEL_ENV = 'production';
    vi.resetModules();
    const fresh = await import('./_kv.js');
    await expect(fresh.kv.incr('k')).rejects.toMatchObject({ code: 'KV_UNAVAILABLE' });
    await expect(fresh.kvIncrWithTtl('k', 10)).rejects.toMatchObject({ code: 'KV_UNAVAILABLE' });
  });
});
