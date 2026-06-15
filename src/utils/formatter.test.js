import { describe, expect, it } from 'vitest';
import { formatCurrency, formatDateSlash, mergeCardNumbers, parseDate } from './formatter';

describe('formatter utils', () => {
  it('formats currency with Korean locale', () => {
    expect(formatCurrency(123456)).toBe('123,456원');
  });

  it('parses flexible date input', () => {
    expect(parseDate('26.5.9')).toBe('2026-05-09');
    expect(parseDate('2026/5/9')).toBe('2026-05-09');
  });

  it('formats slash date', () => {
    expect(formatDateSlash('2026-05-19')).toBe('05/19');
  });

  it('merges masked card numbers', () => {
    expect(mergeCardNumbers('4890-****-****-****', '****-1604-****-****')).toBe('4890-1604-****-****');
  });
});
