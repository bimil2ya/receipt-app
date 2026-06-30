import { describe, expect, it } from 'vitest';
import { buildRestoreYearMonth } from './useDriveRestore';

describe('drive restore helpers', () => {
  it('formats the restore month in Korean year-month form', () => {
    expect(buildRestoreYearMonth('2026-06-28')).toBe('2026년 06월');
  });

  it('keeps the month stable when the base date is already normalized', () => {
    expect(buildRestoreYearMonth('2026-01-05')).toBe('2026년 01월');
  });
});
