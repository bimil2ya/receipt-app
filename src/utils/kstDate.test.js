import { describe, expect, it } from 'vitest';
import { getKstWeekRange, getTodayKst } from './kstDate';

describe('kstDate utils', () => {
  it('snaps any date in the same week to monday-sunday in KST', () => {
    expect(getKstWeekRange('2026-06-19')).toEqual({
      startDate: '2026-06-15',
      endDate: '2026-06-21',
    });
    expect(getKstWeekRange('2026-06-21')).toEqual({
      startDate: '2026-06-15',
      endDate: '2026-06-21',
    });
  });

  it('formats today in KST from an arbitrary UTC instant', () => {
    expect(getTodayKst(new Date('2026-06-27T15:30:00Z'))).toBe('2026-06-28');
  });
});
