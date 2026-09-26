import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { groupPersonFolders, rerunMonthAggregate, runMonthAggregate } from '../../api/aggregate.js';

function fakeRes() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

describe('rerunMonthAggregate (past month repair)', () => {
  const noLock = { acquireLock: async () => ({ acquired: true }), releaseLock: async () => {} };

  it('rejects a malformed yearMonth before touching Drive', async () => {
    const res = fakeRes();
    const drive = { files: { list: async () => { throw new Error('must not list'); } } };
    await rerunMonthAggregate(drive, '2026-07', res, noLock);
    expect(res.statusCode).toBe(400);
  });

  it('refuses when the month folder is missing or ambiguous', async () => {
    const res = fakeRes();
    const drive = { files: { list: async () => ({ data: { files: [] } }) } };
    await rerunMonthAggregate(drive, '2026년 07월', res, noLock);
    expect(res.statusCode).toBe(404);
  });

  it('does not run while the same month is locked by a submission', async () => {
    const res = fakeRes();
    const drive = { files: { list: async () => ({ data: { files: [{ id: 'm7', name: '2026년 07월' }] } }) } };
    await rerunMonthAggregate(drive, '2026년 07월', res, { acquireLock: async () => ({ acquired: false, ttlSeconds: 30 }), releaseLock: async () => {} });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ error: 'SUBMISSION_IN_PROGRESS' });
  });

  it('re-aggregates only the requested month and always releases the lock', async () => {
    const res = fakeRes();
    let released = false;
    const drive = { files: { list: async ({ q }) => q.includes("name = '2026년 07월'")
      ? { data: { files: [{ id: 'm7', name: '2026년 07월' }] } }
      : { data: { files: [] } } } };
    await rerunMonthAggregate(drive, '2026년 07월', res, { acquireLock: async () => ({ acquired: true }), releaseLock: async () => { released = true; } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, yearMonth: '2026년 07월', count: 0 });
    expect(released).toBe(true);
  });
});

describe('aggregate folder grouping', () => {
  it('groups folders by normalized person name', () => {
    const groups = groupPersonFolders([
      { id: 'a', name: '류준,류수현' },
      { id: 'b', name: '류준, 류수현' },
      { id: 'c', name: '이선수, 박종일' },
    ]);

    expect(groups).toEqual([
      { name: '류준, 류수현', folders: [{ id: 'a', name: '류준,류수현' }, { id: 'b', name: '류준, 류수현' }] },
      { name: '이선수, 박종일', folders: [{ id: 'c', name: '이선수, 박종일' }] },
    ]);
  });
});

describe('month aggregate source integrity', () => {
  it('fails without replacing the aggregate when any source XLSX cannot be read', async () => {
    const drive = {
      files: {
        list: async ({ q }) => {
          if (q.includes("'month' in parents")) {
            return { data: { files: [{ id: 'person', name: '검증팀', mimeType: 'application/vnd.google-apps.folder' }] } };
          }
          return { data: { files: [{ id: 'broken-xlsx', name: '출장비_20260908.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] } };
        },
        get: async () => { throw new Error('download failed'); },
        create: async () => { throw new Error('must not replace aggregate'); },
        update: async () => { throw new Error('must not replace aggregate'); },
      },
    };

    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_SOURCE_READ_FAILED' });
  });

  it('writes review sheets with factual checks for office comparison', async () => {
    const source = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(source, XLSX.utils.json_to_sheet([
      { '날짜': '', '사용처': '수기교통', '금액': 3000, '용도': '', '승인번호': '' },
    ]), '영수증내역');
    const sourceBuffer = XLSX.write(source, { type: 'buffer', bookType: 'xlsx' });
    let aggregateBuffer;
    let aggregateRenamed = false;
    const drive = { files: {
      list: async ({ q }) => {
        if (q.includes("name = '전체집계_2026년09월.xlsx'")) {
          return { data: { files: aggregateRenamed ? [{ id: 'aggregate', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:00:00.000Z', version: '1', trashed: false }] : [] } };
        }
        if (q.includes("'month' in parents")) return { data: { files: [{ id: 'person', name: '검증팀', mimeType: 'application/vnd.google-apps.folder' }] } };
        return { data: { files: [{ id: 'source', name: '출장비_20260908.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] } };
      },
      get: async () => ({ data: sourceBuffer }),
      create: async ({ media, requestBody }) => { for await (const part of media.body) aggregateBuffer = Buffer.from(part); return { data: { id: 'aggregate', name: requestBody.name } }; },
      export: async () => ({ data: aggregateBuffer }),
      update: async ({ fileId, requestBody }) => { if (requestBody.name === '전체집계_2026년09월.xlsx') aggregateRenamed = true; return { data: { id: fileId, name: requestBody.name } }; },
    } };
    await runMonthAggregate(drive, 'month', '2026년09월.xlsx');
    const workbook = XLSX.read(aggregateBuffer, { type: 'buffer' });
    expect(workbook.SheetNames).toEqual(expect.arrayContaining(['검토필요', '팀별검토현황', '변경이력', '검토기록', '검토안내']));
    const review = XLSX.utils.sheet_to_json(workbook.Sheets['검토필요']);
    expect(review[0]['확인 사유']).toContain('날짜 없음');
  });
});

describe('month aggregate archived trip recovery', () => {
  const FOLDER = 'application/vnd.google-apps.folder';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const xlsx = rows => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '영수증내역');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  };
  const receipt = (id, amount, date = '2026-09-02') => ({ 날짜: date, 영수증식별값: id, 사용처: '검증', 금액: amount, 용도: '교통' });

  // month / 검증팀 / {현재 출장 폴더, 보관함 / {이전 출장 폴더, 옛 XLSX, 현재와 같은 이름의 폴더}}
  function driveWithTree({ tree, contents, unreadable = new Set() }) {
    let createdBuffer;
    let renamed = false;
    const drive = { files: {
      list: async ({ q }) => {
        if (q.includes("name = '전체집계_2026년09월'")) {
          return { data: { files: renamed ? [{ id: 'new', name: '전체집계_2026년09월', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-20T00:00:00.000Z', version: '1', trashed: false }] : [] } };
        }
        const parent = q.match(/'([^']+)' in parents/)?.[1];
        return { data: { files: tree[parent] || [] } };
      },
      get: async ({ fileId }) => {
        if (unreadable.has(fileId)) throw new Error('download failed');
        return { data: contents[fileId] };
      },
      create: async ({ media, requestBody }) => { for await (const part of media.body) createdBuffer = Buffer.from(part); return { data: { id: 'new', name: requestBody.name } }; },
      export: async () => ({ data: createdBuffer }),
      update: async ({ fileId, requestBody }) => { if (requestBody.name === '전체집계_2026년09월') renamed = true; return { data: { id: fileId, name: requestBody.name } }; },
    } };
    return { drive, detail: () => XLSX.utils.sheet_to_json(XLSX.read(createdBuffer, { type: 'buffer' }).Sheets['전체내역']) };
  }

  const tree = {
    month: [{ id: 'person', name: '검증팀', mimeType: FOLDER }],
    person: [
      { id: 'week-2', name: '2026-09-14~2026-09-20', mimeType: FOLDER },
      { id: 'archive', name: '보관함', mimeType: FOLDER },
    ],
    'week-2': [{ id: 'x-week-2', name: '출장비_20260918.xlsx', mimeType: XLSX_MIME }],
    archive: [
      { id: 'week-1', name: '2026-09-01~2026-09-07', mimeType: FOLDER, createdTime: '2026-09-03T00:00:00Z' },
      { id: 'week-2-old', name: '2026-09-14~2026-09-20', mimeType: FOLDER, createdTime: '2026-09-15T00:00:00Z' },
      { id: 'x-superseded', name: '출장비_20260902.xlsx', mimeType: XLSX_MIME },
    ],
    'week-1': [{ id: 'x-week-1', name: '출장비_20260905.xlsx', mimeType: XLSX_MIME }],
    'week-2-old': [{ id: 'x-week-2-old', name: '출장비_20260916.xlsx', mimeType: XLSX_MIME }],
  };
  const contents = {
    'x-week-2': xlsx([receipt('r-2', 2000, '2026-09-18'), receipt('r-moved', 500, '2026-09-18')]),
    'x-week-1': xlsx([receipt('r-1', 1000), receipt('r-moved', 500)]),
    'x-week-2-old': xlsx([receipt('r-2', 9999, '2026-09-18')]),
    'x-superseded': xlsx([receipt('r-1', 7777)]),
  };

  it('counts an earlier trip that was wrongly moved into the archive, once, without superseded files', async () => {
    const { drive, detail } = driveWithTree({ tree, contents });
    const result = await runMonthAggregate(drive, 'month', '2026년09월');
    const rows = detail();
    expect(rows.map(row => row['영수증 식별값']).sort()).toEqual(['r-1', 'r-2', 'r-moved']);
    expect(rows.reduce((sum, row) => sum + row['금액(원)'], 0)).toBe(3500);
    expect(result).toMatchObject({ success: true, count: 3 });
  });

  it('does not block the current month aggregate when an archived trip file is unreadable', async () => {
    const { drive, detail } = driveWithTree({ tree, contents, unreadable: new Set(['x-week-1']) });
    await runMonthAggregate(drive, 'month', '2026년09월');
    expect(detail().map(row => row['영수증 식별값']).sort()).toEqual(['r-2', 'r-moved']);
  });
});

describe('month aggregate replacement acknowledgements', () => {
  function sourceBuffer(rows = [{ 날짜: '2026-09-01', 영수증식별값: 'receipt-1', 사용처: '검증', 금액: 1000, 용도: '교통' }]) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), '영수증내역');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  function previousAggregateBuffer() {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['기존 집계']]), '전체내역');
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  function driveForReplacement({ createResult, renameResult, trashResult = { id: 'old', trashed: true }, trashError = null, newExport = null, previousExport = null, sourceRows = undefined, beforeCleanupFiles = () => [] }) {
    const events = [];
    const source = sourceBuffer(sourceRows);
    let createdBuffer;
    return {
      events,
      drive: { files: {
        list: async ({ q }) => {
          if (q.includes("name = '전체집계_2026년09월.xlsx'")) {
            events.push('list-final');
            return { data: { files: beforeCleanupFiles() } };
          }
          if (q.includes("'month' in parents")) return { data: { files: [{ id: 'person', name: '검증팀', mimeType: 'application/vnd.google-apps.folder' }] } };
          return { data: { files: [{ id: 'source', name: '출장비_20260908.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }] } };
        },
        get: async () => ({ data: source }),
        create: async ({ requestBody, media }) => { events.push('create'); for await (const part of media.body) createdBuffer = Buffer.from(part); return { data: typeof createResult === 'function' ? createResult(requestBody) : createResult }; },
        export: async ({ fileId }) => ({ data: fileId === 'new'
          ? (typeof newExport === 'function' ? newExport(createdBuffer) : (newExport || createdBuffer))
          : (previousExport || previousAggregateBuffer()) }),
        update: async ({ requestBody }) => {
          if (requestBody.trashed === true) {
            events.push('trash');
            if (trashError) throw trashError;
            return { data: trashResult };
          }
          if (requestBody.trashed === false) {
            events.push('restore');
            return { data: { id: 'old', trashed: false } };
          }
          events.push('rename');
          return { data: renameResult };
        },
      } },
    };
  }

  it('does not rename or trash when the create acknowledgement is incomplete', async () => {
    const { drive, events } = driveForReplacement({ createResult: {}, renameResult: {} });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_CREATE_UNCONFIRMED' });
    expect(events).toEqual(['list-final', 'list-final', 'create']);
  });

  it('does not create an aggregate when source receipts have duplicate stable IDs', async () => {
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: '전체집계_2026년09월.xlsx' },
      sourceRows: [
        { 날짜: '2026-09-01', 영수증식별값: 'duplicate-id', 사용처: '첫 항목', 금액: 1000, 용도: '교통' },
        { 날짜: '2026-09-02', 영수증식별값: 'duplicate-id', 사용처: '둘째 항목', 금액: 2000, 용도: '식비' },
      ],
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_RECEIPT_ID_DUPLICATE' });
    expect(events).toEqual(['list-final']);
  });

  it('does not replace an aggregate when the previous review ledger has duplicate stable IDs', async () => {
    const old = { id: 'old', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:00:00.000Z', version: '1', trashed: false };
    const previous = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(previous, XLSX.utils.json_to_sheet([
      { '영수증 식별값': 'duplicate-id', '검토 상태': '첫 기록' },
      { '영수증 식별값': 'duplicate-id', '검토 상태': '둘째 기록' },
    ]), '검토기록');
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: old.name },
      previousExport: XLSX.write(previous, { type: 'buffer', bookType: 'xlsx' }),
      beforeCleanupFiles: () => [old],
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_RECEIPT_ID_DUPLICATE' });
    expect(events).toEqual(['list-final']);
  });

  it('keeps the old aggregate when the new temporary Sheet cannot be read back', async () => {
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: '전체집계_2026년09월.xlsx' },
      newExport: Buffer.from('not an xlsx'),
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_READBACK_INVALID' });
    expect(events).toEqual(['list-final', 'list-final', 'create', 'trash']);
  });

  it('keeps the old aggregate when read-back changes a detail amount without changing row count', async () => {
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: '전체집계_2026년09월.xlsx' },
      newExport: buffer => {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets['전체내역'];
        for (const address of Object.keys(sheet)) {
          if (sheet[address]?.v === 1000) sheet[address].v = 9999;
        }
        return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      },
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_READBACK_INVALID' });
    expect(events).toEqual(['list-final', 'list-final', 'create', 'trash']);
  });

  it('keeps the old aggregate when read-back changes a stable review row automatic column', async () => {
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: '전체집계_2026년09월.xlsx' },
      newExport: buffer => {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets['검토기록'];
        for (const address of Object.keys(sheet)) {
          if (sheet[address]?.v === '검증팀') sheet[address].v = '변조팀';
        }
        return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      },
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_READBACK_INVALID' });
    expect(events).toEqual(['list-final', 'list-final', 'create', 'trash']);
  });

  it('keeps the old aggregate when a legacy blank-ID review row changes during read-back', async () => {
    const old = { id: 'old', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:00:00.000Z', version: '1', trashed: false };
    const previous = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(previous, XLSX.utils.json_to_sheet([{
      '영수증 식별값': '', 팀: '구팀', 날짜: '2026-09-01', 사용처: '구사용처', '금액(원)': 7000, '검토 상태': '확인', '담당자 메모': '기존 메모', '추가 자료 요청': '', '검토 담당자': '사무실', '검토 시각': '2026-09-02',
    }]), '검토기록');
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: old.name },
      previousExport: XLSX.write(previous, { type: 'buffer', bookType: 'xlsx' }),
      newExport: buffer => {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheet = workbook.Sheets['검토기록'];
        for (const address of Object.keys(sheet)) {
          if (sheet[address]?.v === 7000) sheet[address].v = 8000;
          if (sheet[address]?.v === '금액(원)') sheet[address].v = '삭제된 열';
        }
        return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      },
      beforeCleanupFiles: () => [old],
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_READBACK_INVALID' });
    expect(events).toEqual(['list-final', 'list-final', 'create', 'trash']);
  });

  it('does not trash an existing aggregate when the rename acknowledgement is incomplete', async () => {
    const old = { id: 'old', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:00:00.000Z', version: '1', trashed: false };
    let finalLookups = 0;
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: 'wrong-name' },
      beforeCleanupFiles: () => (++finalLookups === 1 ? [old] : [old]),
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_RENAME_UNCONFIRMED' });
    expect(events).toEqual(['list-final', 'list-final', 'create', 'rename']);
  });

  it('rechecks the exact final files after rename before trashing the old aggregate', async () => {
    const old = { id: 'old', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:00:00.000Z', version: '1', trashed: false };
    const fresh = { id: 'new', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:01:00.000Z', version: '1', trashed: false };
    let finalLookups = 0;
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: '전체집계_2026년09월.xlsx' },
      beforeCleanupFiles: () => (++finalLookups <= 2 ? [old] : [old, fresh]),
    });
    await runMonthAggregate(drive, 'month', '2026년09월.xlsx');
    expect(events).toEqual(['list-final', 'list-final', 'create', 'rename', 'list-final', 'trash']);
  });

  it('keeps the old aggregate when its Drive version changes before cleanup', async () => {
    const old = { id: 'old', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:00:00.000Z', version: '1', trashed: false };
    const changedOld = { ...old, modifiedTime: '2026-09-11T00:02:00.000Z', version: '2' };
    const fresh = { id: 'new', name: old.name, mimeType: old.mimeType, modifiedTime: '2026-09-11T00:01:00.000Z', version: '1', trashed: false };
    let finalLookups = 0;
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: old.name },
      beforeCleanupFiles: () => (++finalLookups <= 2 ? [old] : [changedOld, fresh]),
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_REPLACEMENT_STATE_CHANGED' });
    expect(events).toEqual(['list-final', 'list-final', 'create', 'rename', 'list-final']);
  });

  it('does not report success when the old aggregate trash acknowledgement is incomplete', async () => {
    const old = { id: 'old', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:00:00.000Z', version: '1', trashed: false };
    const fresh = { id: 'new', name: old.name, mimeType: old.mimeType, modifiedTime: '2026-09-11T00:01:00.000Z', version: '1', trashed: false };
    let finalLookups = 0;
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: old.name },
      trashResult: { id: 'old', trashed: false },
      beforeCleanupFiles: () => (++finalLookups <= 2 ? [old] : [old, fresh]),
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toMatchObject({ code: 'AGGREGATE_TRASH_UNCONFIRMED' });
    expect(events).toEqual(['list-final', 'list-final', 'create', 'rename', 'list-final', 'trash', 'restore']);
  });

  it('tries to restore the old aggregate after a trash network error because Drive state is unknown', async () => {
    const old = { id: 'old', name: '전체집계_2026년09월.xlsx', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-09-11T00:00:00.000Z', version: '1', trashed: false };
    const fresh = { id: 'new', name: old.name, mimeType: old.mimeType, modifiedTime: '2026-09-11T00:01:00.000Z', version: '1', trashed: false };
    let finalLookups = 0;
    const { drive, events } = driveForReplacement({
      createResult: ({ name }) => ({ id: 'new', name }),
      renameResult: { id: 'new', name: old.name },
      trashError: new Error('network lost after request'),
      beforeCleanupFiles: () => (++finalLookups <= 2 ? [old] : [old, fresh]),
    });
    await expect(runMonthAggregate(drive, 'month', '2026년09월.xlsx'))
      .rejects.toThrow('network lost after request');
    expect(events).toEqual(['list-final', 'list-final', 'create', 'rename', 'list-final', 'trash', 'restore']);
  });
});
