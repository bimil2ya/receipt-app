import * as XLSX from 'xlsx';
import { describe, expect, it, vi } from 'vitest';
import { filterTeamReviewRows, listReviewFiles, loadTeamReviews, selectReviewSource } from './review.js';

describe('filterTeamReviewRows', () => {
  it('returns only the selected team rows that contain an office-entered record', () => {
    const reviews = filterTeamReviewRows([
      { '팀': '홍길동, 성춘향', '영수증 식별값': 'a', '검토 상태': '추가 자료 요청' },
      { '팀': '강감찬, 이몽룡', '영수증 식별값': 'b', '담당자 메모': '다른 팀 메모' },
      { '팀': '홍길동, 성춘향', '영수증 식별값': 'c' },
    ], '홍길동,성춘향');
    expect(reviews).toEqual([{ '팀': '홍길동, 성춘향', '영수증 식별값': 'a', '검토 상태': '추가 자료 요청' }]);
  });
});

describe('review source discovery', () => {
  const folder = { id: 'month', name: '2026년 09월', mimeType: 'application/vnd.google-apps.folder', parents: ['main'], trashed: false, modifiedTime: '2026-09-01T00:00:00Z', version: '1' };

  it('reads all Drive list pages before accepting one exact source', async () => {
    const drive = { files: { list: vi.fn(async ({ pageToken }) => pageToken
      ? { data: { files: [folder] } }
      : { data: { files: [], nextPageToken: 'next' } }) } };
    const files = await listReviewFiles(drive, 'query');
    expect(files).toEqual([folder]);
    expect(selectReviewSource(files, { parentId: 'main', name: '2026년 09월', mimeType: folder.mimeType })).toEqual(folder);
    expect(drive.files.list).toHaveBeenCalledTimes(2);
  });

  it('does not turn a partial Drive result into no reviews', async () => {
    const data = { files: [], incompleteSearch: true };
    const drive = { files: { list: vi.fn(async () => ({ data })) } };
    await expect(listReviewFiles(drive, 'query')).rejects.toMatchObject({ code: 'REVIEW_SOURCE_UNVERIFIABLE' });
  });

  it('rejects a repeated page token and a malformed canonical entry', async () => {
    const repeated = { files: { list: vi.fn(async () => ({ data: { files: [], nextPageToken: 'again' } })) } };
    await expect(listReviewFiles(repeated, 'query')).rejects.toMatchObject({ code: 'REVIEW_SOURCE_UNVERIFIABLE' });
    expect(() => selectReviewSource([{ ...folder, parents: ['wrong'] }], { parentId: 'main', name: folder.name, mimeType: folder.mimeType }))
      .toThrow(/경로와 형식/);
  });

  it('keeps a confirmed absent source distinct from an ambiguous source', () => {
    expect(selectReviewSource([], { parentId: 'main', name: folder.name, mimeType: folder.mimeType })).toBeNull();
    expect(() => selectReviewSource([folder, { ...folder, id: 'second' }], { parentId: 'main', name: folder.name, mimeType: folder.mimeType }))
      .toThrow(/중복/);
  });

  it('loads only the selected team from the exact monthly aggregate Sheet', async () => {
    const aggregate = { id: 'sheet', name: '전체집계_2026년 09월', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['month'], trashed: false, modifiedTime: '2026-09-01T00:00:00Z', version: '1' };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
      { '팀': '홍길동, 성춘향', '영수증 식별값': 'same-team', '수정 버전': 1, '검토 상태': '', '담당자 메모': '사진을 확인했습니다.', '추가 자료 요청': '', '검토 담당자': '', '검토 시각': '' },
      { '팀': '다른 팀', '영수증 식별값': 'other-team', '수정 버전': 1, '검토 상태': '', '담당자 메모': '보이면 안 됩니다.', '추가 자료 요청': '', '검토 담당자': '', '검토 시각': '' },
    ]), '검토기록');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const drive = { files: {
      list: vi.fn(async ({ q }) => ({ data: { files: q.includes("'main' in parents") ? [folder] : [aggregate] } })),
      get: vi.fn(async ({ fileId }) => ({ data: fileId === 'month' ? folder : aggregate })),
      export: vi.fn(async () => ({ data: bytes })),
    } };
    await expect(loadTeamReviews(drive, { reportDate: '2026-09-02', teamNames: '홍길동,성춘향', mainFolderId: 'main' }))
      .resolves.toMatchObject({ source: 'drive', reviews: [{ '팀': '홍길동, 성춘향', '영수증 식별값': 'same-team', '담당자 메모': '사진을 확인했습니다.' }] });
    expect(drive.files.export).toHaveBeenCalledWith(expect.objectContaining({ fileId: 'sheet' }), expect.any(Object));
  });

  it.each([
    { name: 'missing review tab', workbook: (() => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ '다른 시트': '' }]), '전체내역');
      return workbook;
    })() },
    { name: 'missing required review column', workbook: (() => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ '팀': '홍길동, 성춘향', '검토 상태': '확인 필요' }]), '검토기록');
      return workbook;
    })() },
  ])('rejects a $name instead of returning an empty successful review list', async ({ workbook }) => {
    const aggregate = { id: 'sheet', name: '전체집계_2026년 09월', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['month'], trashed: false, modifiedTime: '2026-09-01T00:00:00Z', version: '1' };
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const drive = { files: {
      list: vi.fn(async ({ q }) => ({ data: { files: q.includes("'main' in parents") ? [folder] : [aggregate] } })),
      get: vi.fn(async ({ fileId }) => ({ data: fileId === 'month' ? folder : aggregate })),
      export: vi.fn(async () => ({ data: bytes })),
    } };
    await expect(loadTeamReviews(drive, { reportDate: '2026-09-02', teamNames: '홍길동,성춘향', mainFolderId: 'main' }))
      .rejects.toMatchObject({ code: 'REVIEW_SOURCE_UNVERIFIABLE' });
  });

  it('rejects a same-name source with the wrong MIME type instead of hiding it as absent', async () => {
    const wrongAggregate = { id: 'wrong', name: '전체집계_2026년 09월', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', parents: ['month'], trashed: false, modifiedTime: '2026-09-01T00:00:00Z', version: '1' };
    const drive = { files: { list: vi.fn(async ({ q }) => ({ data: { files: q.includes("'main' in parents") ? [folder] : [wrongAggregate] } })) } };
    await expect(loadTeamReviews(drive, { reportDate: '2026-09-02', teamNames: '홍길동,성춘향', mainFolderId: 'main' }))
      .rejects.toMatchObject({ code: 'REVIEW_SOURCE_UNVERIFIABLE' });
  });

  it('rejects a Sheet moved or changed while it is being exported', async () => {
    const aggregate = { id: 'sheet', name: '전체집계_2026년 09월', mimeType: 'application/vnd.google-apps.spreadsheet', parents: ['month'], trashed: false, modifiedTime: '2026-09-01T00:00:00Z', version: '1' };
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ '팀': '홍길동, 성춘향', '영수증 식별값': 'r1', '수정 버전': 1, '검토 상태': '', '담당자 메모': '', '추가 자료 요청': '', '검토 담당자': '', '검토 시각': '' }]), '검토기록');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    let exported = false;
    const drive = { files: {
      list: vi.fn(async ({ q }) => ({ data: { files: q.includes("'main' in parents") ? [folder] : [aggregate] } })),
      get: vi.fn(async ({ fileId }) => ({ data: fileId === 'sheet' && exported ? { ...aggregate, version: '2' } : (fileId === 'month' ? folder : aggregate) })),
      export: vi.fn(async () => { exported = true; return { data: bytes }; }),
    } };
    await expect(loadTeamReviews(drive, { reportDate: '2026-09-02', teamNames: '홍길동,성춘향', mainFolderId: 'main' }))
      .rejects.toMatchObject({ code: 'REVIEW_SOURCE_UNVERIFIABLE' });
  });
});
