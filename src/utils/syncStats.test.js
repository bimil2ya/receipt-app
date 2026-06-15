import { describe, expect, it } from 'vitest';
import { buildDailyRows, pruneByRetention, toDayKey } from './syncStats';

describe('syncStats utils', () => {
  it('builds stable day keys', () => {
    expect(toDayKey('2026-05-19T10:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('aggregates events by day', () => {
    const rows = buildDailyRows([
      { at: '2026-05-19T10:00:00.000Z', status: 'success', kind: 'save' },
      { at: '2026-05-19T11:00:00.000Z', status: 'error', kind: 'sync' },
      { at: '2026-05-18T09:00:00.000Z', status: 'success', kind: 'delete' },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: '2026-05-19',
      total: 2,
      success: 1,
      error: 1,
      save: 1,
      sync: 1,
      deleteCount: 0,
    });
    expect(rows[1]).toMatchObject({
      date: '2026-05-18',
      total: 1,
      success: 1,
      error: 0,
      deleteCount: 1,
    });
  });

  it('prunes to retention limit', () => {
    const items = Array.from({ length: 5 }, (_, index) => ({ at: index }));
    expect(pruneByRetention(items, 3, 'at')).toHaveLength(3);
    expect(pruneByRetention(items, 3, 'at').map(item => item.at)).toEqual([4, 3, 2]);
  });
});
