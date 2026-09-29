import { describe, it, expect, vi } from 'vitest';
import * as XLSX from 'xlsx';
import { buildDashboardPayload, parseDashboardWorkbook, loadDashboardMonth, resolveDashboardMonth } from './_dashboardData.js';

const month = '2026-09';
const detail = (overrides = {}) => ({ '날짜': '2026-09-01', '사용시간': '12:01', '이름': '홍길동, 성춘향', '사용처': '식당', '용도': '식비', '금액(원)': 100,
  '승인번호': 'a', '영수증 식별값': 'r1', '수정 버전': 1, ...overrides });
const review = (overrides = {}) => ({ '영수증 식별값': 'r1', '팀': '홍길동, 성춘향', '날짜': '2026-09-01', '사용처': '식당', '용도': '식비', '금액(원)': 100,
  '수정 버전': 1, '검토 상태': '', '담당자 메모': '', '추가 자료 요청': '', '검토 담당자': '', '검토 시각': '', ...overrides });
function fixture({ details = [detail()], reviews = [review()], pivots, omit, transform } = {}) {
  const wb = XLSX.utils.book_new();
  const sheets = { '전체내역': details, '검토기록': reviews, '날짜별집계': pivots || [{ '날짜': '합계', '합계(원)': details.reduce((total, row) => total + Number(row['금액(원)']), 0) }] };
  for (const [name, rows] of Object.entries(sheets)) if (name !== omit) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  transform?.(wb);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
const parse = options => parseDashboardWorkbook(fixture(options), { month });

describe('monthly aggregate byte parser', () => {
  it('keeps detail, category, team and pivot totals consistent without declaring submission complete', () => {
    const body = parse({ details: [detail(), detail({ '영수증 식별값': 'r2', '용도': '유류비', '금액(원)': 200 }), detail({ '영수증 식별값': 'r3', '날짜': '', '용도': '', '금액(원)': -25 })] });
    expect(body.totals).toEqual({ spent: 275, core: 75, fuelMed: 200, receiptCount: 3, prevMonthSpent: null });
    expect(body.byCategory['미정']).toBe(-25);
    expect(body.ledger.reduce((sum, row) => sum + row.amount, 0)).toBe(275);
    expect(Object.values(body.byCategory).reduce((sum, amount) => sum + amount, 0)).toBe(275);
    expect(body.teams[0]).toMatchObject({ submitted: false, aggregateReflected: true, receiptCount: 3, review: { none: 1, unknown: 2 } });
  });
  it.each(['전체내역', '검토기록', '날짜별집계'])('rejects missing %s', omit => expect(() => parse({ omit })).toThrow(/필수 시트/));
  it('rejects a missing amount header', () => expect(() => parse({ details: [Object.fromEntries(Object.entries(detail()).filter(([key]) => key !== '금액(원)'))] })).toThrow(/필수 열/));
  it('rejects duplicate headers rather than SheetJS renamed headers', () => expect(() => parse({ transform: wb => { wb.Sheets['전체내역']['B1'].v = '날짜'; } })).toThrow(/중복/));
  it.each(['', true, null, '1,000', '1.2', 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects unsafe amount %s', value => {
    expect(() => parse({ details: [detail({ '금액(원)': value })], pivots: [{ '날짜': '합계', '합계(원)': 0 }] })).toThrow(/정수/);
  });
  it('accepts explicit integer strings without coercing blanks to zero', () => expect(parse({ details: [detail({ '금액(원)': '100' })] }).totals.spent).toBe(100));
  it('preserves unknown categories including object-property names', () => {
    const body = parse({ details: [detail({ '용도': '__proto__' })] });
    expect(body.byCategory['__proto__']).toBe(100);
    expect(body.teams[0].byCategory['__proto__']).toBe(100);
  });
  it('normalizes typed XLSX date and time cells before matching reviews', () => {
    const body = parse({ details: [detail({ '날짜': 46266, '사용시간': 721 / 1440 })], reviews: [review({ '날짜': 46266, '검토 상태': '추가 자료 요청' })], transform: wb => {
      wb.Sheets['전체내역'].A2.z = 'yyyy-mm-dd';
      wb.Sheets['전체내역'].B2.z = 'hh:mm';
      wb.Sheets['검토기록'].C2.z = 'yyyy-mm-dd';
    } });
    expect(body.ledger[0]).toMatchObject({ date: '2026-09-01', time: '12:01', amount: 100, reviewState: 'req' });
    expect(body.reviewsRaw[0]['날짜']).toBe('2026-09-01');
  });
  it('uses the workbook date system without applying the computer timezone', () => {
    const body = parse({ details: [detail({ '날짜': 44804, '사용시간': 0 })], transform: wb => {
      wb.Workbook = { WBProps: { date1904: true } };
      wb.Sheets['전체내역'].A2.z = 'yyyy-mm-dd';
      wb.Sheets['전체내역'].B2.z = 'hh:mm';
    } });
    expect(body.ledger[0]).toMatchObject({ date: '2026-09-01', time: '00:00' });
  });
  it('preserves blank dates and does not format raw amounts before integer validation', () => {
    expect(parse({ details: [detail({ '날짜': '', '사용시간': '' })] }).ledger[0]).toMatchObject({ date: '', time: '' });
    expect(() => parse({ details: [detail({ '금액(원)': 100.4 })], pivots: [{ '날짜': '합계', '합계(원)': 100 }], transform: wb => {
      wb.Sheets['전체내역'].F2.z = '0';
    } })).toThrow(/정수/);
  });
  it('normalizes typed dates after blank rows without mixing cell coordinates', () => {
    const body = parse({ transform: wb => {
      const sheet = wb.Sheets['전체내역'];
      for (let column = 0; column < 9; column += 1) {
        const old = XLSX.utils.encode_cell({ r: 1, c: column });
        sheet[XLSX.utils.encode_cell({ r: 2, c: column })] = sheet[old];
        delete sheet[old];
      }
      sheet.A3 = { t: 'n', v: 46266, z: 'yyyy-mm-dd' };
      sheet.B3 = { t: 'n', v: 721 / 1440, z: 'hh:mm' };
      sheet['!ref'] = 'A1:I3';
    } });
    expect(body.ledger).toHaveLength(1);
    expect(body.ledger[0]).toMatchObject({ date: '2026-09-01', time: '12:01' });
  });
  it.each([-1, 60])('rejects invalid formatted calendar date %s', serial => {
    expect(() => parse({ details: [detail({ '날짜': serial })], transform: wb => { wb.Sheets['전체내역'].A2.z = 'yyyy-mm-dd'; } })).toThrow(/날짜/);
  });
  it('rejects overflowing totals even if individual cells are safe', () => expect(() => parse({ details: [detail({ '금액(원)': Number.MAX_SAFE_INTEGER }), detail({ '영수증 식별값': 'r2' })] })).toThrow(/안전한 정수/));
  it.each([{ pivots: [] }, { pivots: [{ '날짜': '합계', '합계(원)': 101 }] }, { pivots: [{ '날짜': '합계', '합계(원)': 100 }, { '날짜': '합계', '합계(원)': 100 }] }])('rejects missing, different or duplicate pivot total %#', ({ pivots }) => {
    // Preserve the required header even for a zero-row pivot.
    expect(() => parse({ pivots: pivots.length ? pivots : [{ '날짜': '2026-09-01', '합계(원)': 100 }] })).toThrow(/합계/);
  });
  it('rejects duplicate current receipt IDs', () => expect(() => parse({ details: [detail(), detail()] })).toThrow(/식별값.*중복/));
  it('rejects duplicate review IDs', () => expect(() => parse({ reviews: [review(), review()] })).toThrow(/식별값.*중복/));
  it('does not hide blank legacy IDs', () => {
    const body = parse({ details: [detail({ '영수증 식별값': '', '수정 버전': '' })], reviews: [review({ '영수증 식별값': '' })] });
    expect(body.totals.spent).toBe(100);
    expect(body.teams[0].review.ok).toBe(0);
  });
  it('allows a unique legacy composite match but never crosses nonempty mismatched IDs', () => {
    expect(parse({ reviews: [review({ '영수증 식별값': '' })] }).unmatchedLedgerCount).toBe(0);
    const unmatched = parse({ reviews: [review({ '영수증 식별값': 'other' })] });
    expect(unmatched.unmatchedLedgerCount).toBe(1);
    expect(unmatched.unmatchedReviewCount).toBe(1);
  });
  it('does not match ambiguous legacy candidates or duplicate detail tuples', () => {
    expect(parse({ reviews: [review({ '영수증 식별값': '' }), review({ '영수증 식별값': '' })] }).unmatchedLedgerCount).toBe(1);
    expect(parse({ details: [detail(), detail({ '영수증 식별값': 'r2' })], reviews: [review({ '영수증 식별값': '' })] }).unmatchedLedgerCount).toBe(2);
  });
  it.each(['완료', '승인', '검수 완료', '자유 상태'])('does not infer current approval from retained status %s', status => {
    const body = parse({ reviews: [review({ '검토 상태': status })] });
    expect(body.teams[0].review).toEqual({ ok: 0, req: 0, none: 0, unknown: 1 });
    expect(body.ledger[0].reviewStatus).toBe('대조 불가');
  });
  it('counts a known request and preserves unmatched historical records', () => {
    const body = parse({ reviews: [review({ '검토 상태': '추가 자료 요청' }), review({ '영수증 식별값': 'deleted', '검토 상태': '승인' })] });
    expect(body.teams[0].review.req).toBe(1);
    expect(body.reviewsRaw).toHaveLength(2);
    expect(body.unmatchedReviewCount).toBe(1);
  });
  it.each([{ '수정 버전': 2 }, { '직전 수정 버전': 1 }, { '금액(원)': 50 }, { '팀': '다른팀' }])('marks changed review evidence unknown %#', changes => {
    expect(parse({ reviews: [review({ '검토 상태': '추가 자료 요청', ...changes })] }).teams[0].review.unknown).toBe(1);
  });
  it('allows an explicit replaceable review policy', () => {
    const body = parseDashboardWorkbook(fixture({ reviews: [review({ '검토 상태': '승인' })] }), { month, reviewPolicy: () => 'ok' });
    expect(body.teams[0].review.ok).toBe(1);
  });
  it.each([Buffer.from('CSV,100'), Buffer.from('PKbroken'), Buffer.alloc(0)])('rejects non XLSX bytes %#', bytes => expect(() => parseDashboardWorkbook(bytes, { month })).toThrow());
});

describe('dashboard payload contract', () => {
  const loadMonth = async () => ({ bytes: fixture(), sheetModifiedTime: '2026-09-29T00:00:00Z' });
  const loadReports = async () => [];
  it('removes stub, keeps server role filtering, and does not offer fake reports', async () => {
    const staff = await buildDashboardPayload({ month, role: 'staff' }, { loadMonth, loadReports });
    expect(staff).toMatchObject({ contractVersion: '1.0', month, role: 'staff', sheetModifiedTime: '2026-09-29T00:00:00Z' });
    expect('stub' in staff).toBe(false);
    expect('flags' in staff).toBe(false);
    expect('coDining' in staff).toBe(false);
    expect(staff.teams[0].reports).toEqual([]);
    const owner = await buildDashboardPayload({ month, role: 'owner' }, { loadMonth, loadReports });
    expect(owner.flags).toEqual([]);
    expect(owner.analysisStatus).toBe('not_implemented');
  });
  it('propagates source errors rather than producing an empty success', async () => {
    await expect(buildDashboardPayload({ month }, { loadMonth: async () => { throw new Error('network'); } })).rejects.toThrow('network');
  });
  it('passes one Drive client and deadline through the sheet and every team lookup', async () => {
    const bytes = fixture({ details: [detail(), detail({ '이름': '강감찬, 이순신', '영수증 식별값': 'r2' })] });
    const drive = { files: {} };
    const deadline = Date.now() + 45000;
    const sourceLoader = vi.fn(async () => ({ bytes }));
    const reportsLoader = vi.fn(async () => []);
    const body = await buildDashboardPayload({ month }, {
      loadMonth: sourceLoader, loadReports: reportsLoader, drive, mainFolderId: 'fixture-main', deadline,
    });
    expect(body.teams).toHaveLength(2);
    const context = sourceLoader.mock.calls[0][1];
    expect(context).toEqual({ drive, deadline, mainFolderId: 'fixture-main' });
    expect(reportsLoader).toHaveBeenCalledTimes(2);
    for (const call of reportsLoader.mock.calls) expect(call[1]).toBe(context);
  });
  it('stops before later teams when export and the first team exhaust the shared budget', async () => {
    const bytes = fixture({ details: [detail(), detail({ '이름': '강감찬, 이순신', '영수증 식별값': 'r2' })] });
    let now = Date.now();
    const deadline = now + 45000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    const sourceLoader = vi.fn(async () => { now += 20000; return { bytes }; });
    const reportsLoader = vi.fn(async () => { now += 25001; return []; });
    try {
      await expect(buildDashboardPayload({ month }, {
        loadMonth: sourceLoader, loadReports: reportsLoader, deadline,
      })).rejects.toMatchObject({ code: 'DASHBOARD_DRIVE_TIMEOUT' });
      expect(reportsLoader).toHaveBeenCalledTimes(1);
      expect(sourceLoader.mock.calls[0][1].deadline).toBe(deadline);
      expect(reportsLoader.mock.calls[0][1].deadline).toBe(deadline);
    } finally { clock.mockRestore(); }
  });
  it('does not begin a source lookup once the total request deadline has elapsed', async () => {
    const sourceLoader = vi.fn(loadMonth);
    await expect(buildDashboardPayload({ month }, {
      loadMonth: sourceLoader, loadReports, deadline: 0,
    })).rejects.toMatchObject({ code: 'DASHBOARD_DRIVE_TIMEOUT' });
    expect(sourceLoader).not.toHaveBeenCalled();
  });
  it.each(['2026-00', '2026-13', '2026-1', '0000-09', '', null, 'wrong'])('rejects invalid month %s before loading', async invalid => {
    const load = vi.fn(loadMonth);
    await expect(buildDashboardPayload({ month: invalid }, { loadMonth: load })).rejects.toThrow(/YYYY-MM/);
    expect(load).not.toHaveBeenCalled();
  });
  it('rejects a large UTF-8 response without silently truncating Korean notes', async () => {
    const bytes = fixture({ reviews: Array.from({ length: 50 }, (_, index) => review({ '영수증 식별값': `past-${index}`, '담당자 메모': '가'.repeat(30000) })) });
    await expect(buildDashboardPayload({ month }, { loadMonth: async () => ({ bytes }), loadReports })).rejects.toThrow(/조회 크기/);
  });
});

const folder = { id: 'm', name: '2026년 09월', mimeType: 'application/vnd.google-apps.folder', parents: ['main'] };
const sheet = { id: 's', name: '전체집계_2026년 09월', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['m'], modifiedTime: '2026-09-29T00:00:00Z', version: '12' };
function mockDrive({ lists = [{ files: [folder] }, { files: [sheet] }], after = sheet, folderAfter = folder, bytes = fixture() } = {}) {
  return { files: { list: vi.fn(async () => ({ data: lists.shift() })), export: vi.fn(async () => ({ data: bytes })), get: vi.fn(async ({ fileId }) => ({ data: fileId === 'm' ? folderAfter : after })) } };
}
const load = drive => loadDashboardMonth(month, { drive, mainFolderId: 'main' });
describe('read-only Drive source loader', () => {
  it('loads the canonical month sheet and checks its version after export', async () => {
    const drive = mockDrive();
    const result = await load(drive);
    expect(parseDashboardWorkbook(result.bytes, { month }).totals.spent).toBe(100);
    expect(drive.files.list.mock.calls[0][0].q).toContain("'main' in parents");
    expect(drive.files.export.mock.calls[0][0]).toMatchObject({ fileId: 's' });
    expect(drive.files.get).toHaveBeenCalledTimes(2);
  });
  it('reads every page before deciding identity is unambiguous', async () => {
    const drive = mockDrive({ lists: [{ files: [], nextPageToken: 'two' }, { files: [folder] }, { files: [sheet] }] });
    await expect(load(drive)).resolves.toMatchObject({ sheetModifiedTime: sheet.modifiedTime });
    expect(drive.files.list.mock.calls[1][0].pageToken).toBe('two');
  });
  it.each([
    [{ files: [] }], [{ files: [folder, { ...folder, id: 'other' }] }],
    [{ files: [folder] }, { files: [] }], [{ files: [folder] }, { files: [sheet, { ...sheet, id: 'other' }] }],
  ])('rejects missing or ambiguous month source %#', async (...responses) => {
    const drive = mockDrive({ lists: responses });
    await expect(load(drive)).rejects.toThrow(/없거나 중복/);
    expect(drive.files.export).not.toHaveBeenCalled();
  });
  it.each([{ files: [], incompleteSearch: true }, {}, { files: [folder, folder] }])('rejects incomplete or malformed list %#', async response => {
    await expect(load(mockDrive({ lists: [response] }))).rejects.toThrow(/목록/);
  });
  it('rejects a repeated pagination token', async () => {
    await expect(load(mockDrive({ lists: [{ files: [], nextPageToken: 'same' }, { files: [], nextPageToken: 'same' }] }))).rejects.toThrow(/페이지/);
  });
  it.each([{ parents: ['archive'] }, { mimeType: 'text/plain' }, { name: '작성중_전체집계' }, { version: '' }])('rejects source metadata mismatch %#', async change => {
    await expect(load(mockDrive({ lists: [{ files: [folder] }, { files: [{ ...sheet, ...change }] }] }))).rejects.toThrow();
  });
  it.each([{ version: '13' }, { modifiedTime: '2026-09-29T01:00:00Z' }, { parents: ['archive'] }])('rejects source changes during export %#', async change => {
    await expect(load(mockDrive({ after: { ...sheet, ...change } }))).rejects.toThrow();
  });
  it('rejects a whole month folder moved into archive during export', async () => {
    await expect(load(mockDrive({ folderAfter: { ...folder, parents: ['archive'] } }))).rejects.toThrow(/경로/);
  });
  it('retries one transient network failure without returning partial results', async () => {
    const drive = mockDrive();
    drive.files.list.mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'ECONNRESET' }));
    await expect(load(drive)).resolves.toBeDefined();
    expect(drive.files.list).toHaveBeenCalledTimes(3);
  });
  it('propagates page and export failures', async () => {
    const drive = mockDrive();
    drive.files.list.mockResolvedValueOnce({ data: { files: [], nextPageToken: 'two' } }).mockRejectedValueOnce(new Error('page failure'));
    await expect(load(drive)).rejects.toThrow('page failure');
    const exportFailure = mockDrive();
    exportFailure.files.export.mockRejectedValue(new Error('export failure'));
    await expect(load(exportFailure)).rejects.toThrow('export failure');
  });
  it('rejects expired total deadlines before making a request', async () => {
    const drive = mockDrive();
    await expect(loadDashboardMonth(month, { drive, deadline: Date.now() - 1 })).rejects.toThrow(/시간/);
    expect(drive.files.list).not.toHaveBeenCalled();
  });
  it('bounds a request that never returns', async () => {
    vi.useFakeTimers();
    try {
      const drive = mockDrive();
      drive.files.list.mockImplementation(() => new Promise(() => {}));
      const promise = expect(loadDashboardMonth(month, { drive, deadline: Date.now() + 10 })).rejects.toThrow(/시간/);
      await vi.advanceTimersByTimeAsync(10);
      await promise;
    } finally { vi.useRealTimers(); }
  });
  it('uses KST for an omitted month', () => expect(resolveDashboardMonth()).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/));
});
