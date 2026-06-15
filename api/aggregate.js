import { Readable } from 'stream'
import * as XLSX from 'xlsx'
import { createDrive, getOrCreateFolder, MAIN_FOLDER_ID } from './driveUtils.js'

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
  for (const file of files || []) {
    if (file.id === keepId) continue
    await drive.files.delete({ fileId: file.id }).catch(() => {})
  }
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

  for (const monthFolder of monthFolders) {
    // 월 폴더 안의 담당자 폴더들
    const personRes = await drive.files.list({
      q: `'${monthFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id,name)',
    })
    const personFolders = personRes.data.files || []

    for (const personFolder of personFolders) {
      const personName = personFolder.name
      if (!personOrder.includes(personName)) personOrder.push(personName)

      // 담당자 폴더 안의 xlsx 파일 목록 (출장비_*.xlsx)
      const xlsxRes = await drive.files.list({
        q: `'${personFolder.id}' in parents and name contains '출장비' and name contains '.xlsx' and trashed = false`,
        fields: 'files(id,name)',
        orderBy: 'createdTime',
      })
      const xlsxFiles = xlsxRes.data.files || []

      for (const file of xlsxFiles) {
        try {
          const fileRes = await drive.files.get(
            { fileId: file.id, alt: 'media' },
            { responseType: 'arraybuffer' }
          )
          const wb = XLSX.read(Buffer.from(fileRes.data), { type: 'buffer' })
          const ws = wb.Sheets[wb.SheetNames[0]]
          const rows = XLSX.utils.sheet_to_json(ws)

          for (const r of rows) {
            allRows.push({
              date:      r['날짜']  || '',
              storeName: r['사용처'] || '',
              category:  r['용도']  || '',
              amount:    Number(r['금액']) || 0,
              note:      r['비고']  || '',
              person:    personName,
            })
          }
        } catch (e) {
          console.warn(`파일 읽기 실패: ${file.name}`, e.message)
        }
      }
    }
  }

  if (allRows.length === 0) {
    return { success: true, message: '집계할 데이터 없음', count: 0 }
  }

  // ── 날짜별·사람별 집계
  const datePersonMap = {}
  for (const r of allRows) {
    if (!r.date) continue
    if (!datePersonMap[r.date]) datePersonMap[r.date] = {}
    if (!datePersonMap[r.date][r.person]) datePersonMap[r.date][r.person] = { count: 0, amount: 0 }
    datePersonMap[r.date][r.person].count  += 1
    datePersonMap[r.date][r.person].amount += r.amount
  }

  const sortedDates = Object.keys(datePersonMap).sort()
  const memberNames = personOrder  // 폴더에서 발견된 순서 (가나다순으로 자동 정렬됨)

  // Sheet1: 날짜별 × 사람별 피벗표
  const pivotRows = sortedDates.map(date => {
    const row = { '날짜': date }
    let dayTotal = 0
    for (const name of memberNames) {
      const d = datePersonMap[date][name]
      row[`${name}(건)`] = d ? d.count  : 0
      row[`${name}(원)`] = d ? d.amount : 0
      dayTotal += d ? d.amount : 0
    }
    row['합계(원)'] = dayTotal
    return row
  })

  // 합계 행
  const totalRow = { '날짜': '합계' }
  for (const name of memberNames) {
    totalRow[`${name}(건)`] = sortedDates.reduce((s, d) => s + (datePersonMap[d][name]?.count  || 0), 0)
    totalRow[`${name}(원)`] = sortedDates.reduce((s, d) => s + (datePersonMap[d][name]?.amount || 0), 0)
  }
  totalRow['합계(원)'] = allRows.reduce((s, r) => s + r.amount, 0)
  pivotRows.push(totalRow)

  // Sheet2: 전체 내역 (날짜→이름 순 정렬)
  const detailRows = [...allRows]
    .sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return  1
      return memberNames.indexOf(a.person) - memberNames.indexOf(b.person)
    })
    .map(r => ({
      '날짜':    r.date,
      '이름':    r.person,
      '사용처':  r.storeName,
      '용도':    r.category,
      '금액(원)': r.amount,
      '비고':    r.note,
    }))

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
  const personFolders = personRes.data.files || []

  const allRows = []
  const personOrder = []

  for (const pf of personFolders) {
    const personName = pf.name
    if (!personOrder.includes(personName)) personOrder.push(personName)

    // 담당자 폴더 안의 출장비_*.xlsx
    const xlsxRes = await drive.files.list({
      q: `'${pf.id}' in parents and name contains '출장비' and name contains '.xlsx' and trashed = false`,
      fields: 'files(id,name)',
      orderBy: 'createdTime desc',
    })

    for (const file of xlsxRes.data.files || []) {
      try {
        const fileRes = await drive.files.get(
          { fileId: file.id, alt: 'media' },
          { responseType: 'arraybuffer' }
        )
        const wb = XLSX.read(Buffer.from(fileRes.data), { type: 'buffer' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws)
        for (const r of rows) {
          allRows.push({
            date:      r['날짜']  || '',
            storeName: r['사용처'] || '',
            category:  r['용도']  || '',
            amount:    Number(r['금액']) || 0,
            note:      r['비고']  || '',
            person:    personName,
          })
        }
      } catch (e) {
        console.warn(`월집계: 파일 읽기 실패 ${file.name}`, e.message)
      }
    }
  }

  if (allRows.length === 0) return { count: 0 }

  // Sheet1: 날짜×사람 피벗
  const datePersonMap2 = {}
  for (const r of allRows) {
    if (!r.date) continue
    if (!datePersonMap2[r.date]) datePersonMap2[r.date] = {}
    if (!datePersonMap2[r.date][r.person]) datePersonMap2[r.date][r.person] = { count: 0, amount: 0 }
    datePersonMap2[r.date][r.person].count  += 1
    datePersonMap2[r.date][r.person].amount += r.amount
  }
  const sortedDates2 = Object.keys(datePersonMap2).sort()

  const pivotRows2 = sortedDates2.map(date => {
    const row = { '날짜': date }
    let dayTotal = 0
    for (const name of personOrder) {
      const d = datePersonMap2[date][name]
      row[`${name}(건)`] = d ? d.count  : 0
      row[`${name}(원)`] = d ? d.amount : 0
      dayTotal += d ? d.amount : 0
    }
    row['합계(원)'] = dayTotal
    return row
  })
  const totalRow2 = { '날짜': '합계' }
  for (const name of personOrder) {
    totalRow2[`${name}(건)`] = sortedDates2.reduce((s, d) => s + (datePersonMap2[d][name]?.count  || 0), 0)
    totalRow2[`${name}(원)`] = sortedDates2.reduce((s, d) => s + (datePersonMap2[d][name]?.amount || 0), 0)
  }
  totalRow2['합계(원)'] = allRows.reduce((s, r) => s + r.amount, 0)
  pivotRows2.push(totalRow2)

  // Sheet2: 전체내역
  const detailRows2 = [...allRows]
    .sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return  1
      return personOrder.indexOf(a.person) - personOrder.indexOf(b.person)
    })
    .map(r => ({
      '날짜':     r.date,
      '이름':     r.person,
      '사용처':   r.storeName,
      '용도':     r.category,
      '금액(원)': r.amount,
      '비고':     r.note,
    }))

  const wb2 = buildWorkbook(pivotRows2, detailRows2)
  const buf2 = XLSX.write(wb2, { type: 'buffer', bookType: 'xlsx' })

  // 새 월별 집계가 성공한 뒤 기존 파일을 정리해 최신 1개만 유지
  const aggName = `전체집계_${yearMonth}`
  const fileId = await createReplacingAggregateSheet(drive, monthFolderId, aggName, buf2)

  return { success: true, count: allRows.length, file: aggName, fileId }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // ── 인증 토큰 검증 (수동 호출 보호)
  const UPLOAD_TOKEN = process.env.UPLOAD_API_TOKEN
  if (UPLOAD_TOKEN) {
    const authHeader = req.headers['authorization'] || ''
    const provided = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (provided !== UPLOAD_TOKEN) {
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
