import { Readable } from 'stream'
import * as XLSX from 'xlsx'
import { ARCHIVE_FOLDER_NAME, createDrive, getOrCreateFolder, MAIN_FOLDER_ID } from './driveUtils.js'
import { buildApprovalDuplicateReport } from './approvalReport.js'
import { ALLOWED_ORIGINS, safeCompare } from './_cors.js'
import {
  buildDatePersonMap,
  buildDetailRows,
  buildPivotRows,
  groupPersonFolders,
  parseXlsxRow,
} from './_aggregateUtils.js'

const MONEY_FORMAT = '#,##0'

function applyMoneyFormat(ws, columnNames) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
  const moneyColumns = []

  for (let col = range.s.c; col <= range.e.c; col += 1) {
    const headerCell = ws[XLSX.utils.encode_cell({ r: range.s.r, c: col })]
    if (headerCell && columnNames.some(name => String(headerCell.v || '').includes(name))) {
      moneyColumns.push(col)
    }
  }

  for (const col of moneyColumns) {
    for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
      const cell = ws[XLSX.utils.encode_cell({ r: row, c: col })]
      if (!cell || cell.v === '') continue
      cell.t = 'n'
      cell.z = MONEY_FORMAT
    }
  }
}

function buildWorkbook(pivotRows, detailRows) {
  const wb = XLSX.utils.book_new()
  const pivotWs = XLSX.utils.json_to_sheet(pivotRows)
  const detailWs = XLSX.utils.json_to_sheet(detailRows)

  applyMoneyFormat(pivotWs, ['(원)', '합계'])
  applyMoneyFormat(detailWs, ['금액'])

  XLSX.utils.book_append_sheet(wb, pivotWs, '날짜별집계')
  XLSX.utils.book_append_sheet(wb, detailWs, '전체내역')
  return wb
}

async function listExistingAggregateFiles(drive, folderId, namePrefix) {
  const existRes = await drive.files.list({
    q: `'${folderId}' in parents and name contains '${namePrefix}' and trashed = false`,
    fields: 'files(id,name)',
  })

  return existRes.data.files || []
}

async function deleteFiles(drive, files, keepId = null) {
  await Promise.all((files || []).map(file => {
    if (file.id === keepId) return Promise.resolve()
    return drive.files.update({ fileId: file.id, requestBody: { trashed: true } }).catch(() => {})
  }))
}

async function listChildEntries(drive, parentId) {
  const res = await drive.files.list({
    q: `'${parentId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType)',
    pageSize: 200,
  })
  return res.data.files || []
}

async function collectXlsxFilesRecursive(drive, folderId, personName, seenFileIds = new Set()) {
  const entries = await listChildEntries(drive, folderId)
  const files = []
  for (const entry of entries) {
    if (entry.mimeType === 'application/vnd.google-apps.folder') {
      if (normalizeDriveName(entry.name) === ARCHIVE_FOLDER_NAME) continue
      const nested = await collectXlsxFilesRecursive(drive, entry.id, personName, seenFileIds)
      files.push(...nested)
      continue
    }
    if (!String(entry.name || '').includes('출장비') || !String(entry.name || '').includes('.xlsx')) continue
    if (seenFileIds.has(entry.id)) continue
    seenFileIds.add(entry.id)
    files.push({ ...entry, personName })
  }
  return files
}

async function createReplacingAggregateSheet(drive, folderId, finalName, buffer) {
  const existingFiles = await listExistingAggregateFiles(drive, folderId, finalName)
  const tempName = `${finalName}__업데이트중_${Date.now()}`

  const created = await drive.files.create({
    requestBody: {
      name: tempName,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    media: {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: Readable.from(buffer),
    },
    fields: 'id,name',
  })

  await deleteFiles(drive, existingFiles, created.data.id)
  await drive.files.update({
    fileId: created.data.id,
    requestBody: { name: finalName },
    fields: 'id,name',
  })

  return created.data.id
}

export { groupPersonFolders }

/**
 * 새 폴더 구조 탐색:
 *   영수증정산관리(미래생태공간) / YYYY년 MM월 / [담당자이름] / 출장비_*.xlsx
 *
 * 집계 결과:
 *   영수증정산관리(미래생태공간) / !전체집계 / 전체집계_YYYY-MM-DD.xlsx
 */
export async function runAggregate(drive) {
  // 전체집계 폴더 확보
  const aggFolderId = await getOrCreateFolder(drive, '!전체집계', MAIN_FOLDER_ID)

  // ── MAIN 아래의 모든 폴더 목록 가져오기
  const topRes = await drive.files.list({
    q: `'${MAIN_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
  })
  const topFolders = topRes.data.files || []

  // "YYYY년 MM월" 형식 폴더만 걸러냄 (집계 폴더 등 제외)
  const monthFolders = topFolders.filter(f => /^\d{4}년 \d{2}월$/.test(f.name))

  // 모든 영수증 row 수집
  // row: { date, storeName, category, amount, note, person }
  const allRows = []
  // 등장한 사람 이름 순서 보존 (날짜순 정렬용)
  const personOrder = []
  const seenFileIds = new Set()

  for (const monthFolder of monthFolders) {
    // 월 폴더 안의 담당자 폴더들
    const personRes = await drive.files.list({
      q: `'${monthFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id,name)',
    })
    const personGroups = groupPersonFolders(personRes.data.files || [])

    for (const personGroup of personGroups) {
      const personName = personGroup.name
      if (!personOrder.includes(personName)) personOrder.push(personName)

      for (const personFolder of personGroup.folders) {
        const xlsxFiles = await collectXlsxFilesRecursive(drive, personFolder.id, personName)

        for (const file of xlsxFiles) {
          if (seenFileIds.has(file.id)) continue
          seenFileIds.add(file.id)
          try {
            const fileRes = await drive.files.get(
              { fileId: file.id, alt: 'media' },
              { responseType: 'arraybuffer' }
            )
            const wb = XLSX.read(Buffer.from(fileRes.data), { type: 'buffer' })
            const ws = wb.Sheets[wb.SheetNames[0]]
            const rows = XLSX.utils.sheet_to_json(ws)

            for (const r of rows) {
              allRows.push(parseXlsxRow(r, personName))
            }
          } catch (e) {
            console.warn(`파일 읽기 실패: ${file.name}`, e.message)
          }
        }
      }
    }
  }

  if (allRows.length === 0) {
    return { success: true, message: '집계할 데이터 없음', count: 0 }
  }
  const duplicateReport = buildApprovalDuplicateReport(allRows)

  const datePersonMap = buildDatePersonMap(allRows)
  const pivotRows = buildPivotRows(datePersonMap, personOrder, allRows.reduce((s, r) => s + r.amount, 0))
  const detailRows = buildDetailRows(allRows, personOrder)

  const wb = buildWorkbook(pivotRows, detailRows)
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

  // 오늘 날짜 (서울 기준)
  const today = new Date().toLocaleDateString('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).replace(/\. /g, '-').replace('.', '').replace(/\s/g, '')

  // 구글 시트로 저장 (확장자 없음)
  const fname = `전체집계_${today}`

  const existingAll = await listExistingAggregateFiles(drive, aggFolderId, '전체집계_')
  const fileId = await createReplacingAggregateSheet(drive, aggFolderId, fname, buf)
  await deleteFiles(drive, existingAll, fileId)

  return {
    success: true,
    message: `전체집계 완료 (${allRows.length}건)`,
    filename: fname + ' (Google Sheet)',
    count: allRows.length,
    duplicateReport,
  }
}

/**
 * 특정 월 폴더 안의 모든 담당자 xlsx를 읽어 집계 파일을 생성/업데이트
 * 저장 위치: monthFolderId 바로 아래 `전체집계_YYYY년MM월.xlsx` (Google Sheet으로 변환)
 */
export async function runMonthAggregate(drive, monthFolderId, yearMonth) {
  // 월 폴더 안의 담당자 서브폴더 목록
  const personRes = await drive.files.list({
    q: `'${monthFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: 'files(id,name)',
  })
  const personGroups = groupPersonFolders(personRes.data.files || [])

  const personOrder = personGroups.map(pg => pg.name)
  const seenFileIds = new Set()

  // 담당자 폴더별 XLSX 목록 조회 — 병렬
  const xlsxLists = await Promise.all(personGroups.map(async pg => {
    const files = [];
    for (const pf of pg.folders) {
      files.push(...await collectXlsxFilesRecursive(drive, pf.id, pg.name, seenFileIds));
    }
    return { personName: pg.name, files };
  }))

  // 모든 XLSX 파일 다운로드 — 병렬
  const rowChunks = await Promise.all(
    xlsxLists.flatMap(({ personName, files }) =>
      files.map(async file => {
        try {
          const fileRes = await drive.files.get(
            { fileId: file.id, alt: 'media' },
            { responseType: 'arraybuffer' }
          )
          const wb = XLSX.read(Buffer.from(fileRes.data), { type: 'buffer' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          return XLSX.utils.sheet_to_json(ws).map(r => parseXlsxRow(r, personName))
        } catch (e) {
          console.warn(`월집계: 파일 읽기 실패 ${file.name}`, e.message)
          return []
        }
      })
    )
  )
  const allRows = rowChunks.flat()

  if (allRows.length === 0) return { count: 0 }
  const duplicateReport = buildApprovalDuplicateReport(allRows)

  const datePersonMap2 = buildDatePersonMap(allRows)
  const pivotRows2 = buildPivotRows(datePersonMap2, personOrder, allRows.reduce((s, r) => s + r.amount, 0))
  const detailRows2 = buildDetailRows(allRows, personOrder)

  const wb2 = buildWorkbook(pivotRows2, detailRows2)
  const buf2 = XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' })

  // 새 월별 집계가 성공한 뒤 기존 파일을 정리해 최신 1개만 유지
  const aggName = `전체집계_${yearMonth}`
  const fileId = await createReplacingAggregateSheet(drive, monthFolderId, aggName, buf2)

  return { success: true, count: allRows.length, file: aggName, fileId, duplicateReport }
}

export default async function handler(req, res) {
  // 출처 화이트리스트 + CORS 동적 매칭 (upload.js와 동일 패턴)
  const origin = req.headers.origin || ''
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin)
  res.setHeader('Vary', 'Origin')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // 프로덕션에서 허용되지 않은 출처는 403
  if (process.env.VERCEL_ENV === 'production' && !ALLOWED_ORIGINS.includes(origin)) {
    const referer = req.headers.referer || ''
    const refererOk = ALLOWED_ORIGINS.some(o => referer.startsWith(o + '/') || referer === o)
    if (!refererOk) {
      return res.status(403).json({ success: false, error: '허용되지 않은 출처', detail: `origin: ${origin || '(없음)'}` })
    }
  }

  // ── 인증 토큰 검증 (upload.js와 동일하게 필수)
  const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN
  const isVercelHosted = Boolean(process.env.VERCEL || process.env.VERCEL_ENV)
  if (!UPLOAD_TOKEN && isVercelHosted) {
    return res.status(503).json({
      success: false,
      error: '집계 인증이 설정되지 않았습니다.',
      detail: 'UPLOAD_API_TOKEN 환경변수가 필요합니다.',
    })
  }
  if (UPLOAD_TOKEN) {
    const authHeader = req.headers['authorization'] || ''
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!safeCompare(provided, UPLOAD_TOKEN)) {
      return res.status(401).json({ success: false, error: '인증 실패', detail: '유효하지 않은 토큰입니다.' })
    }
  }

  try {
    const drive = createDrive()
    const result = await runAggregate(drive)
    return res.status(200).json(result)
  } catch (err) {
    console.error('Aggregate error:', err)
    return res.status(500).json({ success: false, error: err.message })
  }
}
