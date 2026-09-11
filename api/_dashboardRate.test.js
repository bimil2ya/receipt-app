import { describe, it, expect, beforeEach } from 'vitest';
import { rlHit, rlReset, forgotGate, throttle } from './_dashboardRate.js';
import { memoryRedis, setTestRedis } from './_kv.js';

beforeEach(() => setTestRedis(memoryRedis()));

describe('rlHit / rlReset', () => {
  it('locks after max failures, then rlReset clears it', async () => {
    for (let i = 0; i < 5; i += 1) {
      expect((await rlHit('auth:x', { max: 5, windowSec: 600 })).ok).toBe(true);
    }
    expect((await rlHit('auth:x', { max: 5, windowSec: 600 })).ok).toBe(false);
    await rlReset('auth:x');
    expect((await rlHit('auth:x', { max: 5, windowSec: 600 })).ok).toBe(true);
  });

  it('different keys are independent buckets', async () => {
    for (let i = 0; i < 6; i += 1) await rlHit('auth:a', { max: 5, windowSec: 600 });
    expect((await rlHit('auth:b', { max: 5, windowSec: 600 })).ok).toBe(true);
  });

  it('propagates KvUnavailableError (fail-closed is the caller job)', async () => {
    const boom = async () => {
      throw new Error('down');
    };
    setTestRedis({ incr: boom, expire: boom, del: boom, get: boom, set: boom });
    await expect(rlHit('auth:x', { max: 5, windowSec: 600 })).rejects.toMatchObject({
      code: 'KV_UNAVAILABLE',
    });
  });
});

describe('forgotGate', () => {
  it('allows perHour then blocks', async () => {
    expect(await forgotGate({ perHour: 1 })).toBe(true);
    expect(await forgotGate({ perHour: 1 })).toBe(false);
  });
});

describe('throttle (best-effort, fail-open)', () => {
  it('allows up to max, then denies', async () => {
    for (let i = 0; i < 40; i += 1) {
      expect(await throttle('data:tok', { max: 40, windowSec: 60 })).toBe(true);
    }
    expect(await throttle('data:tok', { max: 40, windowSec: 60 })).toBe(false);
  });

  it('fails open when KV is unavailable', async () => {
    const boom = async () => {
      throw new Error('down');
    };
    setTestRedis({ incr: boom, expire: boom, del: boom, get: boom, set: boom });
    expect(await throttle('data:tok', { max: 40, windowSec: 60 })).toBe(true);
  });
});
