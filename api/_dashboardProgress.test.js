import { describe, expect, it, vi } from 'vitest';
import { loadDashboardProgress } from './_dashboardProgress.js';

const month = '2026-09';
const root = { id: 'root', name: '_진행현황', mimeType: 'application/vnd.google-apps.folder', parents: ['main'], trashed: false, modifiedTime: '2026-09-01T00:00:00Z', version: '1' };
const monthFolder = { id: 'month', name: '2026년 09월', mimeType: 'application/vnd.google-apps.folder', parents: ['root'], trashed: false, modifiedTime: '2026-09-01T00:00:00Z', version: '1' };
const progress = (overrides = {}) => ({
  schema: 1, teamNames: '홍길동, 성춘향', tripStartDate: '2026-09-01', tripEndDate: '', submitterName: '홍길동', submitterDeviceId: 'device-a', submitted: false,
  sharedAt: '2026-09-10T01:02:03.000Z', receipts: [{ id: 'receipt-1', date: '2026-09-01', useTime: '12:00', storeName: '식당', category: '식비', totalAmount: 100, approvalNum: 'a', note: '' }], ...overrides,
});
const progressFile = overrides => ({
  id: 'progress-file', name: '진행_2026-09-01_device-a.json', mimeType: 'application/json', parents: ['month'], trashed: false,
  size: '200', modifiedTime: '2026-09-10T01:02:03.000Z', version: '1', ...overrides,
});
function driveFor({ lists, records = {}, metadata = {} }) {
  return { files: {
    list: vi.fn(async () => ({ data: lists.shift() })),
    get: vi.fn(async ({ fileId, alt }) => {
      if (alt === 'media') return { data: Buffer.from(JSON.stringify(records[fileId])) };
      return { data: metadata[fileId] };
    }),
  } };
}

describe('dashboard progress reader', () => {
  it('returns no provisional rows when the silent-progress folder does not exist', async () => {
    const drive = driveFor({ lists: [{ files: [] }] });
    await expect(loadDashboardProgress(month, { drive, mainFolderId: 'main' })).resolves.toEqual([]);
  });

  it('uses the newest snapshot for one device and trip only', async () => {
    const first = progressFile({ id: 'first' });
    const second = progressFile({ id: 'second', modifiedTime: '2026-09-11T01:02:03.000Z', version: '2' });
    const drive = driveFor({
      lists: [{ files: [root] }, { files: [monthFolder] }, { files: [first, second] }],
      records: { first: progress(), second: progress({ sharedAt: '2026-09-11T01:02:03.000Z', receipts: [{ ...progress().receipts[0], id: 'receipt-2' }] }) },
      metadata: { root, month: monthFolder, first, second },
    });
    const rows = await loadDashboardProgress(month, { drive, mainFolderId: 'main' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sharedAt: '2026-09-11T01:02:03.000Z' });
    expect(rows[0].receipts[0].id).toBe('receipt-2');
  });

  it('rejects a file whose name cannot prove its record identity', async () => {
    const file = progressFile({ id: 'bad', name: 'other.json' });
    const drive = driveFor({ lists: [{ files: [root] }, { files: [monthFolder] }, { files: [file] }], records: { bad: progress() }, metadata: { root, month: monthFolder, bad: file } });
    await expect(loadDashboardProgress(month, { drive, mainFolderId: 'main' })).rejects.toMatchObject({ code: 'DASHBOARD_PROGRESS_INVALID' });
  });

  it('rejects a progress file changed after its bytes were downloaded', async () => {
    const file = progressFile({ id: 'changed' });
    const drive = driveFor({
      lists: [{ files: [root] }, { files: [monthFolder] }, { files: [file] }],
      records: { changed: progress() },
      metadata: { root, month: monthFolder, changed: { ...file, version: '2' } },
    });
    await expect(loadDashboardProgress(month, { drive, mainFolderId: 'main' })).rejects.toMatchObject({ code: 'DASHBOARD_PROGRESS_CHANGED' });
  });

  it('rejects a silent-progress month folder moved after child records were read', async () => {
    const file = progressFile({ id: 'stable' });
    const drive = driveFor({
      lists: [{ files: [root] }, { files: [monthFolder] }, { files: [file] }],
      records: { stable: progress() },
      metadata: { root, stable: file, month: { ...monthFolder, parents: ['archive'] } },
    });
    await expect(loadDashboardProgress(month, { drive, mainFolderId: 'main' })).rejects.toMatchObject({ code: 'DASHBOARD_PROGRESS_CHANGED' });
  });
});
