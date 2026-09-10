import { describe, it, expect, vi, afterEach } from 'vitest';
import { recentMonths, monthLabel, won } from './format';

afterEach(() => vi.useRealTimers());

describe('recentMonths', () => {
  it('returns `count` consecutive descending months', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 15)); // 2026-07-15
    expect(recentMonths(6)).toEqual([
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
    ]);
  });

  it('does not skip or duplicate months on the 31st (setMonth rollover bug)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 31)); // 2026-03-31 — Feb has no 31st
    const months = recentMonths(4);
    expect(months).toEqual(['2026-03', '2026-02', '2026-01', '2025-12']);
    expect(new Set(months).size).toBe(months.length);
  });

  it('crosses the year boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 10)); // 2026-01-10
    expect(recentMonths(3)).toEqual(['2026-01', '2025-12', '2025-11']);
  });
});

describe('monthLabel / won', () => {
  it('formats a YYYY-MM string', () => {
    expect(monthLabel('2026-09')).toBe('2026년 9월');
  });
  it('won coerces junk to 0 and adds thousands separators', () => {
    expect(won('abc')).toBe('0');
    expect(won(1234567)).toBe('1,234,567');
  });
});
