import { describe, expect, it } from 'vitest';
import { normalizeDriveName, getYearMonth, getKstWeekRange, getWeekFolderName } from '../../api/driveUtils.js';

describe('drive utils', () => {
  it('normalizes team/person names with consistent spacing', () => {
    expect(normalizeDriveName(' 류준,류수현 ')).toBe('류준, 류수현');
    expect(normalizeDriveName('류준 ,  류수현')).toBe('류준, 류수현');
  });

  it('formats year month from dates', () => {
    expect(getYearMonth('2026-06-20')).toBe('2026년 06월');
  });

  it('snaps week ranges to monday through sunday', () => {
    expect(getKstWeekRange('2026-06-19')).toEqual({
      startDate: '2026-06-15',
      endDate: '2026-06-21',
    });
    expect(getWeekFolderName('2026-06-19')).toBe('2026-06-15~2026-06-21');
  });
});
