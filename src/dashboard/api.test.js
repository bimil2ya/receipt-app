import { describe, it, expect, vi, afterEach } from 'vitest';
import { authenticate, fetchDashboardData, fetchReportObjectUrl } from './api';

afterEach(() => vi.unstubAllGlobals());

const pdfResponse = (overrides = {}) => ({
  ok: true,
  status: 200,
  headers: { get: (k) => (k === 'content-type' ? 'application/pdf' : null) },
  blob: async () => ({ size: 100, type: 'application/pdf' }),
  ...overrides,
});

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

describe('fetchReportObjectUrl', () => {
  it('returns an object URL for a PDF response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse()));
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock' });
    await expect(fetchReportObjectUrl('t', 'ref~sig')).resolves.toEqual({ ok: true, url: 'blob:mock' });
  });

  it('rejects a non-PDF 200 (e.g. JSON error body)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        pdfResponse({ headers: { get: () => 'application/json' } }),
      ),
    );
    await expect(fetchReportObjectUrl('t', 'r')).resolves.toEqual({ ok: false, reason: 'error' });
  });

  it('maps 401 to expired', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse({ ok: false, status: 401 })));
    await expect(fetchReportObjectUrl('t', 'r')).resolves.toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects an empty blob', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(pdfResponse({ blob: async () => ({ size: 0 }) })));
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:mock' });
    await expect(fetchReportObjectUrl('t', 'r')).resolves.toEqual({ ok: false, reason: 'error' });
  });
});
