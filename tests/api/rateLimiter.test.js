import { describe, expect, it } from 'vitest';
import { clientRateKey, createRateLimiter } from '../../api/_rateLimiter.js';

describe('clientRateKey', () => {
  it('uses the client IP from Vercel headers (Node style)', () => {
    expect(clientRateKey({ 'x-real-ip': '203.0.113.7', origin: 'https://receipt-app-rho.vercel.app' })).toBe('203.0.113.7');
  });

  it('uses the first x-forwarded-for address when x-real-ip is absent', () => {
    expect(clientRateKey({ 'x-forwarded-for': '198.51.100.2, 10.0.0.1' })).toBe('198.51.100.2');
  });

  it('reads Edge-style Headers objects', () => {
    const headers = new Headers({ 'x-real-ip': '192.0.2.9' });
    expect(clientRateKey(headers)).toBe('192.0.2.9');
  });

  it('falls back to origin, then a constant, when no IP header exists', () => {
    expect(clientRateKey({ origin: 'http://localhost:5173' })).toBe('http://localhost:5173');
    expect(clientRateKey({})).toBe('unknown');
  });

  it('gives two devices on the same origin separate buckets', () => {
    const limit = createRateLimiter(60_000, 1, 'test-separate');
    const origin = 'https://receipt-app-rho.vercel.app';
    expect(limit(clientRateKey({ 'x-real-ip': '203.0.113.1', origin })).ok).toBe(true);
    expect(limit(clientRateKey({ 'x-real-ip': '203.0.113.2', origin })).ok).toBe(true);
    expect(limit(clientRateKey({ 'x-real-ip': '203.0.113.1', origin })).ok).toBe(false);
  });
});
