import { describe, expect, it } from 'vitest'
import { archivePreviousXlsxFiles, assertOnlyUploadedXlsxIsActive } from '../../api/upload.js'

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
