import { describe, it, expect } from 'vitest';
import { buildSettingsStats, buildSettingsTrendDays, getStatusLabel } from './settingsStats';

describe('settings stats', () => {
  const syncEvents = [
    { kind: 'save', status: 'success' },
    { kind: 'sync', status: 'error' },
    { kind: 'delete', status: 'success' },
    { kind: 'sync', status: 'success' },
  ];

  const syncDaily = [
    { date: '2026-06-22', total: 4, success: 3, error: 1 },
    { date: '2026-06-24', total: 2, success: 2, error: 0 },
  ];

  it('maps status labels by category', () => {
    expect(getStatusLabel('saving', 'save')).toEqual(['저장 중', 'bg-blue-900/20 border-blue-800 text-blue-200']);
    expect(getStatusLabel('offline', 'sync')).toEqual(['오프라인', 'bg-slate-800 border-slate-700 text-slate-300']);
  });

  it('builds a seven-day trend window', () => {
    const trend = buildSettingsTrendDays(syncDaily, '2026-06-25');
    expect(trend).toHaveLength(7);
    expect(trend[3].total).toBe(4);
    expect(trend[5].total).toBe(2);
  });

  it('summarizes the filtered event stats', () => {
    const stats = buildSettingsStats(syncEvents, syncDaily, 'sync', '2026-06-25');

    expect(stats.recentEvents).toHaveLength(2);
    expect(stats.trendMax).toBe(4);
    expect(stats.eventStats.total).toBe(4);
    expect(stats.eventStats.success).toBe(3);
    expect(stats.eventStats.error).toBe(1);
  });
});
