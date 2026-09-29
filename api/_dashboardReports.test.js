import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchReportPdf, reportsForMonth, REPORT_MAX_BYTES, signReportRef, verifyReportRef } from './_dashboardReports.js';

const FOLDER = 'application/vnd.google-apps.folder';
const month = '2026-09';
const teamNames = '홍길동, 성춘향';
const pdf = Buffer.from('%PDF-1.4\nfixture\n%%EOF');
const folder = (id, name, parent) => ({ id, name, parents: [parent], mimeType: FOLDER, trashed: false });
const report = (overrides = {}) => ({ id: 'pdf', name: '정산서_홍길동, 성춘향_2026-08-31~2026-09-06.pdf',
  parents: ['week'], mimeType: 'application/pdf', trashed: false,
  modifiedTime: '2026-09-01T00:00:00Z', version: '1', size: String(pdf.length),
  md5Checksum: createHash('md5').update(pdf).digest('hex'), ...overrides });
function mockDrive({ records: extra = [], omitted = [], bytes = pdf, onList, onGet, onMedia } = {}) {
  const records = [folder('month', '2026년 09월', 'main'), folder('team', '홍길동,성춘향', 'month'),
    folder('week', '2026-08-31~2026-09-06', 'team'), report(), ...extra].filter(record => !omitted.includes(record.id));
  const copy = value => structuredClone(value);
  const files = {
    list: vi.fn(async ({ q, pageToken }) => {
      const parent = /^'([^']+)' in parents/.exec(q)?.[1];
      const selected = records.filter(record => record.parents?.includes(parent));
      const data = q.includes(`mimeType = '${FOLDER}'`) ? selected.filter(record => record.mimeType === FOLDER) : selected;
      return { data: onList?.({ q, pageToken, parent, data: copy(data), records }) || { files: copy(data) } };
    }),
    get: vi.fn(async ({ fileId, alt }) => {
      if (alt === 'media') {
        onMedia?.(records);
        return { data: bytes };
      }
      const found = records.find(record => record.id === fileId);
      return { data: onGet?.({ fileId, found: copy(found), records }) || copy(found) };
    }),
  };
  return { files, records };
}
const options = drive => ({ drive, mainFolderId: 'main' });
const list = drive => reportsForMonth({ month, teamNames }, options(drive));
const download = drive => fetchReportPdf('pdf', options(drive));
beforeEach(() => { process.env.DASHBOARD_TOKEN_SECRET = 'report-test-secret'; });

describe('signed report ref contract', () => {
  it('verifies an unchanged ID and rejects tampering', () => {
    expect(verifyReportRef(signReportRef('pdf'))).toBe('pdf');
    expect(verifyReportRef(`${signReportRef('pdf')}x`)).toBeNull();
    expect(verifyReportRef('pdf')).toBeNull();
  });
});

describe('canonical Drive report listing', () => {
  it('lists the real PDF under the requested month and normalized team with a signed ref', async () => {
    const drive = mockDrive();
    expect(await list(drive)).toEqual([{ id: 'pdf', ref: signReportRef('pdf'), label: report().name.slice(0, -4), date: '2026-08-31', available: true }]);
    expect(drive.files.list.mock.calls[0][0].q).toContain("'main' in parents");
    expect(drive.files.get).toHaveBeenCalledTimes(3);
    expect(drive.files.create).toBeUndefined();
  });
  it('preserves distinct submissions, cross-month weeks and unknown weeks while excluding archives/chunks', async () => {
    const drive = mockDrive({ records: [report({ id: 'pdf2', name: '정산서_두번째_제출.pdf' }),
      folder('unknown', '주간미상', 'team'), report({ id: 'pdf3', parents: ['unknown'] }),
      folder('archive', '보관함', 'team'), report({ id: 'old', parents: ['archive'] }),
      { id: 'chunk', name: '정산서_chunk.json', parents: ['week'], mimeType: 'application/json', trashed: false }] });
    const reports = await list(drive);
    expect(reports.map(item => item.id).sort()).toEqual(['pdf', 'pdf2', 'pdf3']);
    expect(reports.find(item => item.id === 'pdf3').date).toBeNull();
  });
  it('reads every page at every level', async () => {
    const drive = mockDrive({ onList: ({ pageToken, data, parent }) => pageToken ? { files: data } : { files: [], nextPageToken: parent } });
    expect(await list(drive)).toHaveLength(1);
    expect(drive.files.list).toHaveBeenCalledTimes(8);
  });
  it.each(['team', 'pdf'])('returns an empty list only for confirmed absent %s', async id => {
    expect(await list(mockDrive({ omitted: [id] }))).toEqual([]);
  });
  it('does not treat a missing month as an empty successful lookup', async () => {
    await expect(list(mockDrive({ omitted: ['month'] }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_PATH_AMBIGUOUS' });
  });
  it.each([
    folder('month2', '2026년 09월', 'main'), folder('team2', '홍길동, 성춘향', 'month'),
    folder('week2', '2026-08-31~2026-09-06', 'team'), report({ id: 'pdf2' }),
  ])('rejects duplicate canonical folders or report names %#', async record => {
    await expect(list(mockDrive({ records: [record] }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_PATH_AMBIGUOUS' });
  });
  it.each([{}, { files: [], incompleteSearch: true }, { files: [folder('month', '2026년 09월', 'main'), folder('month', '2026년 09월', 'main')] }])('rejects incomplete list %#', async data => {
    await expect(list(mockDrive({ onList: () => data }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_LIST_INCOMPLETE' });
  });
  it('rejects repeated pagination tokens', async () => {
    await expect(list(mockDrive({ onList: () => ({ files: [], nextPageToken: 'repeat' }) }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_LIST_INCOMPLETE' });
  });
  it('propagates list network failures', async () => {
    const drive = mockDrive();
    drive.files.list.mockRejectedValueOnce(new Error('offline'));
    await expect(list(drive)).rejects.toThrow('offline');
  });
  it.each([{ mimeType: 'image/jpeg' }, { parents: ['elsewhere'] }, { trashed: true }, { md5Checksum: '' }])('rejects unverifiable listed PDF metadata %#', async override => {
    const drive = mockDrive({ onList: ({ parent, data }) => ({ files: parent === 'week' ? data.map(file => ({ ...file, ...override })) : data }) });
    await expect(list(drive)).rejects.toThrow();
  });
  it('detects a folder move after listing instead of signing stale lineage', async () => {
    await expect(list(mockDrive({ onGet: ({ fileId, found }) => fileId === 'week' ? { ...found, parents: ['archive'] } : found }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_PATH_INVALID' });
  });
  it('times out before touching Drive after the shared deadline', async () => {
    const drive = mockDrive();
    await expect(reportsForMonth({ month, teamNames }, { ...options(drive), deadline: 0 })).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_TIMEOUT' });
    expect(drive.files.list).not.toHaveBeenCalled();
  });
});

describe('verified Drive PDF bytes', () => {
  it('downloads actual media after checking lineage, size and MD5', async () => {
    const drive = mockDrive();
    expect(await download(drive)).toEqual(pdf);
    expect(drive.files.get.mock.calls.some(([arg]) => arg.alt === 'media' && arg.fileId === 'pdf')).toBe(true);
  });
  it('accepts an ArrayBuffer response', async () => {
    expect(await download(mockDrive({ bytes: Uint8Array.from(pdf).buffer }))).toEqual(pdf);
  });
  it.each([
    { mimeType: 'image/jpeg' }, { name: '사진.pdf' }, { parents: ['archive'] }, { parents: ['week', 'other'] }, { trashed: true },
  ])('rejects even a signed forged/non-report ID before media read %#', async override => {
    const drive = mockDrive({ onGet: ({ fileId, found }) => fileId === 'pdf' ? { ...found, ...override } : found });
    await expect(fetchReportPdf(verifyReportRef(signReportRef('pdf')), options(drive))).rejects.toThrow();
    expect(drive.files.get.mock.calls.some(([arg]) => arg.alt === 'media')).toBe(false);
  });
  it('rejects a report in a noncanonical month or unrelated main folder', async () => {
    const drive = mockDrive({ onGet: ({ fileId, found }) => fileId === 'month' ? { ...found, parents: ['other-main'] } : found });
    await expect(download(drive)).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_PATH_INVALID' });
  });
  it('rejects an old ref after its file disappears from the complete current list', async () => {
    const drive = mockDrive({ onList: ({ parent, data }) => ({ files: parent === 'week' ? [] : data }) });
    await expect(download(drive)).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_PATH_INVALID' });
  });
  it('rejects metadata exceeding the response limit before downloading', async () => {
    const drive = mockDrive({ onGet: ({ fileId, found }) => fileId === 'pdf' ? { ...found, size: String(REPORT_MAX_BYTES + 1) } : found });
    await expect(download(drive)).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_TOO_LARGE', status: 413 });
    expect(drive.files.get.mock.calls.some(([arg]) => arg.alt === 'media')).toBe(false);
  });
  it.each([Buffer.alloc(0), '%PDF-plain string', Buffer.from('%PDF-corrupted'), Buffer.from('not a PDF')])('rejects wrong/empty bytes %#', async bytes => {
    await expect(download(mockDrive({ bytes }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_BYTES_INVALID' });
  });
  it('detects a same-size byte alteration through MD5', async () => {
    const changed = Buffer.from(pdf);
    changed[10] += 1;
    await expect(download(mockDrive({ bytes: changed }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_BYTES_INVALID' });
  });
  it('detects a changed file version after download', async () => {
    await expect(download(mockDrive({ onMedia: records => { records.find(file => file.id === 'pdf').version = '2'; } }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_CHANGED' });
  });
  it('detects a moved ancestor after download', async () => {
    await expect(download(mockDrive({ onMedia: records => { records.find(file => file.id === 'month').parents = ['other-main']; } }))).rejects.toMatchObject({ code: 'DASHBOARD_REPORT_PATH_INVALID' });
  });
  it('propagates media network errors without any bytes', async () => {
    const drive = mockDrive();
    const get = drive.files.get.getMockImplementation();
    drive.files.get.mockImplementation(async args => { if (args.alt === 'media') throw new Error('download offline'); return get(args); });
    await expect(download(drive)).rejects.toThrow('download offline');
  });
});
