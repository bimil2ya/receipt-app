import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  archiveLegacyPersonRootItems, archivePreviousXlsxFiles, assertOnlyUploadedXlsxIsActive,
  isValidSubmitterDeviceId, submitterFileLabel,
} from '../../api/upload.js'

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

const DEVICE = { receiptSubmitterDevice: 'device-a' }
const OTHER_DEVICE = { receiptSubmitterDevice: 'device-b' }
const xlsxWithIds = ids => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ids.map(id => ({ 날짜: '2026-09-22', 영수증식별값: id, 사용처: '검증', 금액: 1000 }))), '영수증내역')
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })
}
function driveWith(files, { contents = {}, moveResult } = {}) {
  const moved = []
  return {
    moved,
    drive: { files: {
      list: async ({ pageToken }) => (typeof files === 'function' ? files(pageToken) : { data: { files } }),
      get: async ({ fileId }) => ({ data: contents[fileId] }),
      update: async args => { moved.push(args.fileId); return { data: moveResult ? moveResult(args) : { id: args.fileId, parents: ['archive'] } } },
    } },
  }
}

describe('archivePreviousXlsxFiles', () => {
  it('archives the same device\'s earlier submission', async () => {
    const { drive, moved } = driveWith([
      { id: 'new', name: '출장비_오늘_노경호.xlsx', appProperties: DEVICE },
      { id: 'old', name: '출장비_어제_노경호.xlsx', appProperties: DEVICE },
    ])
    const kept = await archivePreviousXlsxFiles(drive, 'week', 'archive', 'new', { submitterDeviceId: 'device-a', newReceiptIds: ['r1'] })
    expect(moved).toEqual(['old'])
    expect(kept).toEqual([])
  })

  it('keeps a teammate\'s separately submitted XLSX so the month aggregate counts both members', async () => {
    const { drive, moved } = driveWith([
      { id: 'new', name: '출장비_오늘_노경호.xlsx', appProperties: DEVICE },
      { id: 'mate', name: '출장비_오늘_김영일.xlsx', appProperties: OTHER_DEVICE },
    ])
    const kept = await archivePreviousXlsxFiles(drive, 'week', 'archive', 'new', { submitterDeviceId: 'device-a', newReceiptIds: ['r1'] })
    expect(moved).toEqual([])
    expect(kept).toEqual(['mate'])
  })

  it('archives an unmarked (pre-update) file only when it holds the same receipts', async () => {
    const { drive, moved } = driveWith([
      { id: 'new', name: '출장비_오늘_노경호.xlsx', appProperties: DEVICE },
      { id: 'legacy-mine', name: '출장비_어제.xlsx' },
      { id: 'legacy-mate', name: '출장비_그제.xlsx' },
    ], { contents: { 'legacy-mine': xlsxWithIds(['r1', 'r2']), 'legacy-mate': xlsxWithIds(['m1']) } })
    const kept = await archivePreviousXlsxFiles(drive, 'week', 'archive', 'new', { submitterDeviceId: 'device-a', newReceiptIds: ['r1', 'r2', 'r3'] })
    expect(moved).toEqual(['legacy-mine'])
    expect(kept).toEqual(['legacy-mate'])
  })

  it('never archives a marked teammate file for a submission from a not-yet-updated app', async () => {
    const { drive, moved } = driveWith([
      { id: 'new', name: '출장비_오늘.xlsx' },
      { id: 'mate', name: '출장비_오늘_김영일.xlsx', appProperties: OTHER_DEVICE },
      { id: 'legacy-mine', name: '출장비_어제.xlsx' },
    ], { contents: { 'legacy-mine': xlsxWithIds(['r1']) } })
    const kept = await archivePreviousXlsxFiles(drive, 'week', 'archive', 'new', { newReceiptIds: ['r1'] })
    expect(moved).toEqual(['legacy-mine'])
    expect(kept).toEqual(['mate'])
  })

  it('stops instead of guessing when an unmarked file cannot be read', async () => {
    const { drive } = driveWith([{ id: 'new', name: '출장비_오늘.xlsx', appProperties: DEVICE }, { id: 'legacy', name: '출장비_어제.xlsx' }])
    drive.files.get = async () => { throw new Error('download failed') }
    await expect(archivePreviousXlsxFiles(drive, 'week', 'archive', 'new', { submitterDeviceId: 'device-a', newReceiptIds: ['r1'] }))
      .rejects.toMatchObject({ code: 'XLSX_ARCHIVE_UNCONFIRMED', details: expect.objectContaining({ unreadableFileId: 'legacy' }) })
  })

  it('fails on an unconfirmed move so the caller cannot aggregate duplicate source XLSX files', async () => {
    const { drive } = driveWith([
      { id: 'new', name: '출장비_오늘.xlsx', appProperties: DEVICE },
      { id: 'old', name: '출장비_어제.xlsx', appProperties: DEVICE },
    ], { moveResult: () => ({ id: 'old', parents: ['week'] }) })
    await expect(archivePreviousXlsxFiles(drive, 'week', 'archive', 'new', { submitterDeviceId: 'device-a' }))
      .rejects.toMatchObject({ code: 'XLSX_ARCHIVE_UNCONFIRMED', details: expect.objectContaining({ failedOldFileId: 'old' }) })
  })

  it('reads every Drive page before deciding which old XLSX files are archived', async () => {
    const { drive, moved } = driveWith(pageToken => pageToken
      ? { data: { files: [{ id: 'old-2', name: '출장비_둘째.xlsx', appProperties: DEVICE }] } }
      : { data: { files: [{ id: 'new', name: '출장비_오늘.xlsx', appProperties: DEVICE }, { id: 'old-1', name: '출장비_첫째.xlsx', appProperties: DEVICE }], nextPageToken: 'next' } })
    await archivePreviousXlsxFiles(drive, 'week', 'archive', 'new', { submitterDeviceId: 'device-a' })
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

  it('accepts the new file together with teammates\' files that were deliberately kept', async () => {
    const drive = { files: {
      list: async () => ({ data: { files: [{ id: 'new', name: '출장비_오늘_노경호.xlsx' }, { id: 'mate', name: '출장비_오늘_김영일.xlsx' }] } }),
    } }
    await expect(assertOnlyUploadedXlsxIsActive(drive, 'week', 'new', ['mate'])).resolves.toBeUndefined()
  })
})

describe('submitter labels', () => {
  it('adds a safe submitter name to file names and ignores unsafe or missing names', () => {
    expect(submitterFileLabel('노경호')).toBe('_노경호')
    expect(submitterFileLabel('')).toBe('')
    expect(submitterFileLabel('../x')).toBe('')
    expect(submitterFileLabel(undefined)).toBe('')
    expect(isValidSubmitterDeviceId('0f8b2c4e-1234-4abc-9def-001122334455')).toBe(true)
    expect(isValidSubmitterDeviceId("x' or 1=1")).toBe(false)
  })
})
