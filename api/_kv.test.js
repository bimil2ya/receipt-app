import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getRedis, memoryRedis, setTestRedis, KvUnavailableError } from './_kv.js';

afterEach(() => setTestRedis(null));

describe('memoryRedis shim', () => {
  let r;
  beforeEach(() => {
    r = memoryRedis();
  });

  it('incr counts up from 0', async () => {
    expect(await r.incr('a')).toBe(1);
    expect(await r.incr('a')).toBe(2);
  });

  it('expire NX fixes the window on first set (not sliding)', async () => {
    vi.useFakeTimers();
    try {
      await r.incr('w');
      await r.expire('w', 10, 'NX'); // exp = now + 10s
      vi.advanceTimersByTime(6000);
      await r.expire('w', 10, 'NX'); // NX — must not extend
      vi.advanceTimersByTime(5000); // total 11s
      expect(await r.get('w')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('set NX refuses to overwrite a live key', async () => {
    expect(await r.set('k', '1', { nx: true, ex: 60 })).toBe('OK');
    expect(await r.set('k', '2', { nx: true, ex: 60 })).toBeNull();
    expect(await r.get('k')).toBe('1');
  });

  it('del removes a key', async () => {
    await r.incr('k');
    expect(await r.del('k')).toBe(1);
    expect(await r.get('k')).toBeNull();
  });
});

describe('getRedis()', () => {
  const orig = { ...process.env };
  afterEach(() => {
    process.env.VERCEL_ENV = orig.VERCEL_ENV;
    process.env.KV_REST_API_URL = orig.KV_REST_API_URL;
    process.env.KV_REST_API_TOKEN = orig.KV_REST_API_TOKEN;
    setTestRedis(null);
  });

  it('returns the injected test client when set', () => {
    const fake = { tag: 'fake' };
    setTestRedis(fake);
    expect(getRedis()).toBe(fake);
  });

  it('uses the in-memory shim locally even when KV creds are present (no prod Redis from local)', () => {
    setTestRedis(null);
    delete process.env.VERCEL_ENV;
    process.env.KV_REST_API_URL = 'https://example.upstash.io';
    process.env.KV_REST_API_TOKEN = 'x'.repeat(64);
    const r = getRedis();
    expect(typeof r.incr).toBe('function');
    expect(typeof r.eval).toBe('undefined'); // shim has no Lua — not a real Redis
  });

  it.each(['production', 'preview'])(
    'throws KV_UNAVAILABLE on a %s deployment with no credentials',
    (envName) => {
      setTestRedis(null);
      process.env.VERCEL_ENV = envName;
      delete process.env.KV_REST_API_URL;
      delete process.env.KV_REST_API_TOKEN;
      expect(() => getRedis()).toThrow(KvUnavailableError);
    },
  );
});
