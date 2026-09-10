import { describe, it, expect, vi, afterEach } from 'vitest';
import { authenticate, fetchDashboardData } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('authenticate', () => {
  it('returns reason:network when fetch rejects (offline)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(authenticate('x')).resolves.toEqual({ ok: false, reason: 'network' });
  });

  it('maps 429 to locked with retryAfter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({ retryAfter: 42 }) }),
    );
    await expect(authenticate('x')).resolves.toEqual({ ok: false, reason: 'locked', retryAfter: 42 });
  });

  it('maps 503 to unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    await expect(authenticate('x')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('returns the token on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ token: 'tok' }) }),
    );
    await expect(authenticate('x')).resolves.toEqual({ ok: true, token: 'tok' });
  });
});

describe('fetchDashboardData', () => {
  it('returns reason:error when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(fetchDashboardData('t', '2026-09')).resolves.toEqual({ ok: false, reason: 'error' });
  });

  it('returns reason:expired on 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }));
    await expect(fetchDashboardData('t')).resolves.toEqual({ ok: false, reason: 'expired' });
  });

  it('returns reason:error when the body is not an object', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null }));
    await expect(fetchDashboardData('t')).resolves.toEqual({ ok: false, reason: 'error' });
  });

  it('passes the token as a Bearer header and returns data', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ role: 'staff' }) });
    vi.stubGlobal('fetch', f);
    const res = await fetchDashboardData('mytoken', '2026-09');
    expect(res).toEqual({ ok: true, data: { role: 'staff' } });
    expect(f).toHaveBeenCalledWith(
      expect.stringContaining('action=data&month=2026-09'),
      expect.objectContaining({ headers: { Authorization: 'Bearer mytoken' } }),
    );
  });
});
