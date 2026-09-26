import { describe, expect, it } from 'vitest'
import { archiveLegacyPersonRootItems, archivePreviousXlsxFiles, assertOnlyUploadedXlsxIsActive } from '../../api/upload.js'

describe('archiveLegacyPersonRootItems', () => {
  const FOLDER = 'application/vnd.google-apps.folder'
  it('keeps other trip-week folders in place so the month aggregate still counts them', async () => {
    const moved = []
    const drive = { files: {
      list: async () => ({ data: { files: [
        { id: 'current-week', name: '2026-09-14~2026-09-20', mimeType: FOLDER },
        { id: 'earlier-week', name: '2026-09-01~2026-09-07', mimeType: FOLDER },
        { id: 'unknown-week', name: '주간미상', mimeType: FOLDER },
        { id: 'archive', name: '보관함', mimeType: FOLDER },
        { id: 'legacy-xlsx', name: '출장비_20260620.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        { id: 'legacy-folder', name: '옛자료', mimeType: FOLDER },
      ] } }),
      update: async ({ fileId }) => { moved.push(fileId); return { data: { id: fileId, parents: ['archive'] } } },
    } }
    await archiveLegacyPersonRootItems(drive, { personId: 'person', weekId: 'current-week', archiveId: 'archive' })
    expect(moved).toEqual(['legacy-xlsx', 'legacy-folder'])
  })
})

describe('archivePreviousXlsxFiles', () => {
  it('moves confirmed old XLSX files before aggregation can run', async () => {
    const calls = []
    const drive = { files: {
      list: async () => ({ data: { files: [{ id: 'new', name: '출장비_오늘.xlsx' }, { id: 'old', name: '출장비_어제.xlsx' }] } }),
      update: async args => { calls.push(args); return { data: { id: 'old', parents: ['archive'] } } },
    } }
    await archivePreviousXlsxFiles(drive, 'week', 'archive', 'new')
    expect(calls).toEqual([expect.objectContaining({ fileId: 'old', addParents: 'archive', removeParents: 'week' })])
  })

  it('fails on an unconfirmed move so the caller cannot aggregate duplicate source XLSX files', async () => {
    const drive = { files: {
      list: async () => ({ data: { files: [{ id: 'new', name: '출장비_오늘.xlsx' }, { id: 'old', name: '출장비_어제.xlsx' }] } }),
      update: async () => ({ data: { id: 'old', parents: ['week'] } }),
    } }
    await expect(archivePreviousXlsxFiles(drive, 'week', 'archive', 'new'))
      .rejects.toMatchObject({ code: 'XLSX_ARCHIVE_UNCONFIRMED', details: expect.objectContaining({ failedOldFileId: 'old' }) })
  })

  it('reads every Drive page before deciding that old XLSX files are archived', async () => {
    const moved = []
    const drive = { files: {
      list: async ({ pageToken }) => pageToken
        ? { data: { files: [{ id: 'old-2', name: '출장비_둘째.xlsx' }] } }
        : { data: { files: [{ id: 'new', name: '출장비_오늘.xlsx' }, { id: 'old-1', name: '출장비_첫째.xlsx' }], nextPageToken: 'next' } },
      update: async ({ fileId }) => { moved.push(fileId); return { data: { id: fileId, parents: ['archive'] } } },
    } }
    await archivePreviousXlsxFiles(drive, 'week', 'archive', 'new')
    expect(moved).toEqual(['old-1', 'old-2'])
  })
})

describe('assertOnlyUploadedXlsxIsActive', () => {
  it('stops aggregation when a concurrent XLSX appears after archival', async () => {
    const drive = { files: {
      list: async () => ({ data: { files: [{ id: 'new', name: '출장비_오늘.xlsx' }, { id: 'concurrent', name: '출장비_동시.xlsx' }] } }),
    } }
    await expect(assertOnlyUploadedXlsxIsActive(drive, 'week', 'new'))
      .rejects.toMatchObject({ code: 'XLSX_SOURCE_SET_CHANGED', details: expect.objectContaining({ activeXlsxIds: ['new', 'concurrent'] }) })
  })
})
