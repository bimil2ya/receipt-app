import { afterEach, describe, expect, it } from 'vitest';
import { getAppBaseUrl } from '../../api/notify/kakao.js';

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('kakao notify url', () => {
  it('uses VERCEL_URL outside production', () => {
    process.env.VERCEL_ENV = 'preview';
    process.env.VERCEL_URL = 'example.vercel.app';
    delete process.env.APP_BASE_URL;
    expect(getAppBaseUrl()).toBe('https://example.vercel.app');
  });

  it('uses the fixed app URL in production even when VERCEL_URL is set', () => {
    process.env.VERCEL_ENV = 'production';
    process.env.VERCEL_URL = 'example.vercel.app';
    delete process.env.APP_BASE_URL;
    expect(getAppBaseUrl()).toBe('https://receipt-app-rho.vercel.app');
  });

  it('falls back to APP_BASE_URL', () => {
    delete process.env.VERCEL_URL;
    process.env.APP_BASE_URL = 'https://custom.example.com';
    expect(getAppBaseUrl()).toBe('https://custom.example.com');
  });
});
