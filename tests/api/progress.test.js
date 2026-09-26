import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { MAIN_FOLDER_ID } from '../../api/driveUtils.js'
import {
  buildProgressWorkbook, latestRecords, PROGRESS_ROOT_NAME, saveProgressShare, validateProgressPayload,
} from '../../api/_progress.js'

const payload = (overrides = {}) => ({
  teamNames: '류준, 류수현',
  tripStartDate: '2026-09-21',
  tripEndDate: '2026-09-23',
  submitterName: '류준',
  submitterDeviceId: 'aaaaaaaa-0000-4000-8000-000000000001',
  submitted: false,
  receipts: [
    { id: 'r1', date: '2026-09-21', useTime: '12:30', storeName: '검증식당', category: '식비', totalAmount: 12000, approvalNum: '1111', note: '', cardNumber: '1234-5678' },
  ],
  ...overrides,
})

// Minimal Drive fake: folders get deterministic ids (the folder cache in driveUtils is module-wide),
// files keep their id when their content is updated.
function fakeDrive() {
  const files = new Map()
  let seq = 0
  const parentOf = q => q.match(/'([^']+)' in parents/)?.[1]
  const nameOf = q => q.match(/name = '([^']+)'/)?.[1]
  const drive = { files: {
    list: async ({ q }) => {
      const parent = parentOf(q)
      const name = nameOf(q)
      const wantFolder = q.includes("mimeType = 'application/vnd.google-apps.folder'")
      const wantJson = q.includes("mimeType = 'application/json'")
      const matches = [...files.values()].filter(f => f.parents.includes(parent)
        && (!name || f.name === name)
        && (!wantFolder || f.mimeType === 'application/vnd.google-apps.folder')
        && (!wantJson || f.mimeType === 'application/json'))
      return { data: { files: matches.map(({ id, name: n }) => ({ id, name: n })) } }
    },
    create: async ({ requestBody, media }) => {
      const isFolder = requestBody.mimeType === 'application/vnd.google-apps.folder'
      const id = isFolder ? `${requestBody.parents[0]}/${requestBody.name}` : `file-${++seq}`
      let body = null
      if (media) { const parts = []; for await (const p of media.body) parts.push(Buffer.from(p)); body = Buffer.concat(parts) }
      files.set(id, { id, ...requestBody, body })
      return { data: { id } }
    },
    update: async ({ fileId, media }) => {
      const parts = []; for await (const p of media.body) parts.push(Buffer.from(p))
      files.get(fileId).body = Buffer.concat(parts)
      return { data: { id: fileId } }
    },
    get: async ({ fileId }) => ({ data: files.get(fileId).body }),
  } }
  return { drive, files }
}
const freeLock = { acquireLock: async () => ({ acquired: true }), releaseLock: async () => true }
const sheetOf = (files, name) => [...files.values()].find(f => f.name === name)
const readSheet = (file, sheet) => XLSX.utils.sheet_to_json(XLSX.read(file.body, { type: 'buffer' }).Sheets[sheet])

describe('validateProgressPayload', () => {
  it('keeps list fields only and never stores card numbers', () => {
    const result = validateProgressPayload(payload())
    expect(result.receipts[0]).toEqual({ id: 'r1', date: '2026-09-21', useTime: '12:30', storeName: '검증식당', category: '식비', totalAmount: 12000, approvalNum: '1111', note: '' })
    expect(JSON.stringify(result)).not.toContain('1234-5678')
  })

  it('rejects malformed input', () => {
    expect(() => validateProgressPayload(payload({ submitterDeviceId: "x' or 1=1" }))).toThrow('기기')
    expect(() => validateProgressPayload(payload({ tripStartDate: '2026/09/21' }))).toThrow('출장 시작일')
    expect(() => validateProgressPayload(payload({ teamNames: '../etc' }))).toThrow('조 이름')
    expect(() => validateProgressPayload(payload({ receipts: [{ id: 'x', totalAmount: 1.5 }] }))).toThrow('금액')
    expect(() => validateProgressPayload(payload({ receipts: Array.from({ length: 501 }, (_, i) => ({ id: `r${i}` })) }))).toThrow('목록')
  })
})

describe('progress workbook', () => {
  it('keeps only the latest share per device and trip, with status and totals', () => {
    const base = validateProgressPayload(payload())
    const records = [
      { schema: 1, ...base, sharedAt: '2026-09-21T01:00:00.000Z' },
      { schema: 1, ...base, submitted: true, sharedAt: '2026-09-21T05:00:00.000Z' },
    ]
    expect(latestRecords(records)).toHaveLength(1)
    const workbook = XLSX.read(buildProgressWorkbook(records), { type: 'buffer' })
    const summary = XLSX.utils.sheet_to_json(workbook.Sheets['요약'])
    expect(summary).toEqual([expect.objectContaining({ '조': '류준, 류수현', '제출자': '류준', '상태': '제출 완료', '건수': 1, '합계(원)': 12000, '마지막 공유(KST)': '09-21 14:00' })])
  })
})

describe('saveProgressShare', () => {
  it('stores per-device lists outside the official month folders and merges teammates in one sheet', async () => {
    const { drive, files } = fakeDrive()
    await saveProgressShare(drive, validateProgressPayload(payload()), { ...freeLock, now: () => new Date('2026-09-21T03:00:00Z') })
    await saveProgressShare(drive, validateProgressPayload(payload({
      submitterName: '류수현', submitterDeviceId: 'bbbbbbbb-0000-4000-8000-000000000002',
      receipts: [{ id: 'm1', date: '2026-09-22', storeName: '검증주유소', category: '유류비', totalAmount: 50000 }],
    })), { ...freeLock, now: () => new Date('2026-09-21T04:00:00Z') })

    const root = files.get(`${MAIN_FOLDER_ID}/${PROGRESS_ROOT_NAME}`)
    expect(root).toBeTruthy()
    expect(files.get(`${root.id}/2026년 09월`)).toBeTruthy()
    expect([...files.values()].some(f => f.parents.includes(MAIN_FOLDER_ID) && f.name === '2026년 09월')).toBe(false)

    const sheet = sheetOf(files, '진행현황_2026년 09월.xlsx')
    expect(readSheet(sheet, '요약').map(row => [row['제출자'], row['합계(원)']])).toEqual([['류수현', 50000], ['류준', 12000]])
    expect(readSheet(sheet, '영수증목록')).toHaveLength(2)
  })

  it('updates the same files in place when the same device shares again', async () => {
    const { drive, files } = fakeDrive()
    await saveProgressShare(drive, validateProgressPayload(payload()), freeLock)
    const sheetId = sheetOf(files, '진행현황_2026년 09월.xlsx').id
    const fileCount = files.size
    await saveProgressShare(drive, validateProgressPayload(payload({ submitted: true })), freeLock)
    expect(files.size).toBe(fileCount)
    expect(sheetOf(files, '진행현황_2026년 09월.xlsx').id).toBe(sheetId)
    expect(readSheet(sheetOf(files, '진행현황_2026년 09월.xlsx'), '요약')[0]['상태']).toBe('제출 완료')
  })

  it('still saves the list when another share is rebuilding the sheet', async () => {
    const { drive, files } = fakeDrive()
    const result = await saveProgressShare(drive, validateProgressPayload(payload()), { acquireLock: async () => ({ acquired: false }), releaseLock: async () => true })
    expect(result.sheetUpdated).toBe(false)
    expect([...files.values()].some(f => f.name.startsWith('진행_2026-09-21_'))).toBe(true)
    expect(sheetOf(files, '진행현황_2026년 09월.xlsx')).toBeUndefined()
  })
})
