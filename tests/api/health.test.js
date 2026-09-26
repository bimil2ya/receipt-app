import { afterEach, describe, expect, it } from 'vitest';
import handler from '../../api/health.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const get = () => handler(new Request('https://receipt-app-rho.vercel.app/api/health', {
  method: 'GET',
  headers: { origin: 'https://receipt-app-rho.vercel.app' },
}));

describe('GET /api/health', () => {
  it('returns the fields the settings system check reads', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.UPLOAD_API_TOKEN = 'token';
    delete process.env.KAKAO_REST_API_KEY;
    const res = await get();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ status: 'ok', success: true, hasApiKey: true });
    expect(body.services.ocr.ok).toBe(true);
    expect(body.services.upload.ok).toBe(true);
    expect(body.services.kakao.ok).toBe(false);
    expect(Object.keys(body.services).sort()).toEqual(['drive', 'kakao', 'ocr', 'upload']);
  });

  it('never exposes secret values', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-secret-value';
    const text = await (await get()).text();
    expect(text).not.toContain('secret-value');
  });
});
