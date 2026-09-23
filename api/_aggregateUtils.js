import { normalizeDriveName } from './driveUtils.js'
import { normalizeApprovalNum } from '../shared/approvalReportCore.js'

export function sumSafeAmounts(rows) {
  return (rows || []).reduce((total, row) => {
    const next = total + Number(row?.amount || 0)
    if (!Number.isSafeInteger(next)) {
      const error = new Error('월집계 합계가 안전한 정수 범위를 넘었습니다.')
      error.code = 'AGGREGATE_AMOUNT_OVERFLOW'
      throw error
    }
    return next
  }, 0)
}

export function groupPersonFolders(personFolders) {
  const grouped = new Map()
  for (const folder of personFolders || []) {
    const name = normalizeDriveName(folder.name)
    if (!grouped.has(name)) grouped.set(name, { name, folders: [] })
    grouped.get(name).folders.push(folder)
  }
  return [...grouped.values()]
}

export function parseXlsxRow(r, personName) {
  return {
    date:       r['날짜']    || '',
    id:         r['영수증식별값'] || '',
    useTime:    r['사용시간'] || '',
    storeName:  r['사용처']  || '',
    category:   r['용도']    || '',
    amount:     Number(r['금액']) || 0,
    approvalNum: r['승인번호'] || '',
    bizNum:     r['사업자번호'] || '',
    cardNumber: r['카드번호'] || '',
    note:       r['비고']    || '',
    assignmentTeamName: r['작업조'] || '',
    createdByName: r['작성자'] || '',
    deviceId: r['기기태그'] || '',
    createdAt: Number(r['생성시각']) || 0,
    updatedAt: Number(r['수정시각']) || 0,
    revision: Math.max(1, Number(r['수정버전']) || 1),
    relatedReviewReceiptId: r['연결검토영수증'] || '',
    person:     personName,
  }
}

export function buildChangeHistoryRows(allRows) {
  const rows = []
  for (const row of allRows || []) {
    const base = { '팀': row.person || '', '영수증 식별값': row.id || '', '작업조': row.assignmentTeamName || row.person || '', '작성자': row.createdByName || '작성자 미등록', '기기태그': row.deviceId || '' }
    if (row.createdAt) rows.push({ ...base, '시각': row.createdAt, '작업': '영수증 생성' })
    if (row.updatedAt) rows.push({ ...base, '시각': row.updatedAt, '작업': '영수증 수정' })
  }
  return rows.length ? rows.sort((a, b) => a['시각'] - b['시각']) : [{ '작업': '변경 이력 없음' }]
}

export function buildDatePersonMap(allRows) {
  const map = {}
  for (const r of allRows) {
    if (!r.date) continue
    if (!map[r.date]) map[r.date] = {}
    if (!map[r.date][r.person]) map[r.date][r.person] = { count: 0, amount: 0 }
    map[r.date][r.person].count  += 1
    map[r.date][r.person].amount += r.amount
  }
  return map
}

// grandTotal: allRows 전체 금액 합계를 외부에서 전달받아 사용한다.
// datePersonMap은 date 없는 행을 무시하므로, map 기반 계산으로 대체하면
// 날짜 미입력 행의 금액이 합계에서 누락되는 회귀가 발생한다.
export function buildPivotRows(datePersonMap, personOrder, grandTotal) {
  const sortedDates = Object.keys(datePersonMap).sort()

  const pivotRows = sortedDates.map(date => {
    const row = { '날짜': date }
    let dayTotal = 0
    for (const name of personOrder) {
      const d = datePersonMap[date][name]
      row[`${name}(건)`] = d ? d.count  : 0
      row[`${name}(원)`] = d ? d.amount : 0
      dayTotal += d ? d.amount : 0
    }
    row['합계(원)'] = dayTotal
    return row
  })

  const totalRow = { '날짜': '합계' }
  for (const name of personOrder) {
    totalRow[`${name}(건)`] = sortedDates.reduce((s, d) => s + (datePersonMap[d][name]?.count  || 0), 0)
    totalRow[`${name}(원)`] = sortedDates.reduce((s, d) => s + (datePersonMap[d][name]?.amount || 0), 0)
  }
  totalRow['합계(원)'] = grandTotal ?? sortedDates
    .flatMap(d => Object.values(datePersonMap[d]))
    .reduce((s, { amount }) => s + amount, 0)
  pivotRows.push(totalRow)

  return pivotRows
}

export function buildDetailRows(allRows, personOrder) {
  return [...allRows]
    .sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return  1
      return personOrder.indexOf(a.person) - personOrder.indexOf(b.person)
    })
    .map(r => ({
      '날짜':      r.date,
      '사용시간':  r.useTime,
      '이름':      r.person,
      '사용처':    r.storeName,
      '용도':      r.category,
      '금액(원)':  r.amount,
      '승인번호':  r.approvalNum,
      '사업자번호': r.bizNum,
      '카드번호':  r.cardNumber,
      '비고':      r.note,
      '영수증 식별값': r.id || '',
      '수정 버전': r.revision ?? '',
    }))
}

// 담당자 대조용 신호만 나열한다. 반려·승인 판단은 여기서 하지 않는다.
export function buildReviewRows(allRows) {
  const rows = allRows || []
  const approvalCounts = new Map()
  rows.forEach(row => {
    const key = normalizeApprovalNum(row.approvalNum)
    if (key) approvalCounts.set(key, (approvalCounts.get(key) || 0) + 1)
  })
  const reviewRows = rows.flatMap(row => {
    const reasons = []
    const approvalKey = normalizeApprovalNum(row.approvalNum)
    if (!row.date) reasons.push('날짜 없음')
    if (!row.category) reasons.push('분류 없음')
    if (!approvalKey) reasons.push('승인번호 없음')
    else if (approvalCounts.get(approvalKey) > 1) reasons.push('승인번호 중복 후보')
    if (!reasons.length) return []
    return [{
      '확인 사유': reasons.join(' · '),
      '팀': row.person,
      '날짜': row.date,
      '사용처': row.storeName,
      '용도': row.category,
      '금액(원)': row.amount,
      '승인번호': row.approvalNum,
    }]
  })
  return reviewRows.length ? reviewRows : [{ '확인 사유': '확인 필요 항목 없음' }]
}

export function buildTeamReviewSummary(allRows, reviewRows) {
  const summaries = new Map()
  for (const row of allRows || []) {
    const team = row.person || '미지정 팀'
    const current = summaries.get(team) || { '팀': team, '영수증 건수': 0, '사용액(원)': 0, '확인 필요 건수': 0, '검수 상태': '담당자 확인 필요' }
    current['영수증 건수'] += 1
    current['사용액(원)'] += Number(row.amount || 0)
    summaries.set(team, current)
  }
  for (const row of reviewRows || []) {
    if (!row['팀']) continue
    const current = summaries.get(row['팀'])
    if (current) current['확인 필요 건수'] += 1
  }
  return [...summaries.values()]
}

const REVIEW_WRITABLE_COLUMNS = ['검토 상태', '담당자 메모', '추가 자료 요청', '검토 담당자', '검토 시각']

// 담당자가 입력한 열만 이전 집계에서 보존한다. 상태 값의 의미나 승인 규칙은 정하지 않는다.
export function buildReviewLedgerRows(allRows, previousRows = [], previousHeaders = []) {
  const supportingByTargetId = new Map()
  for (const item of allRows || []) {
    const targetId = String(item?.relatedReviewReceiptId || '')
    if (!targetId) continue
    const entries = supportingByTargetId.get(targetId) || []
    entries.push(`${item.id || '식별값 없음'} (v${Math.max(1, Number(item.revision) || 1)})`)
    supportingByTargetId.set(targetId, entries)
  }
  const previousByReceiptId = new Map(
    (previousRows || []).filter(row => row?.['영수증 식별값']).map(row => [String(row['영수증 식별값']), row]),
  )
  const seen = new Set()
  const rows = (allRows || []).map(row => {
    const receiptId = String(row.id || '')
    const hasStableId = Boolean(receiptId)
    const hasPrevious = hasStableId && previousByReceiptId.has(receiptId)
    const previous = hasPrevious ? previousByReceiptId.get(receiptId) : {}
    const currentRevision = Math.max(1, Number(row.revision) || 1)
    const previousRevision = Math.max(1, Number(previous['수정 버전']) || 1)
    seen.add(receiptId)
    const result = {
      '영수증 식별값': receiptId,
      '팀': row.person || '',
      '날짜': row.date || '',
      '사용처': row.storeName || '',
      '용도': row.category || '',
      '금액(원)': row.amount || 0,
      '승인번호': row.approvalNum || '',
      '연결 검토 영수증': row.relatedReviewReceiptId || '',
      '수정 버전': currentRevision,
      '직전 수정 버전': hasPrevious && previousRevision !== currentRevision ? previousRevision : (previous['직전 수정 버전'] || ''),
      '연결 추가 자료': (supportingByTargetId.get(receiptId) || []).join(', '),
      '연결 상태': hasStableId ? '' : '영수증 식별값 없음 — 자동 검토기록 연결 불가',
    }
    REVIEW_WRITABLE_COLUMNS.forEach(column => { result[column] = previous[column] || '' })
    return result
  })
  // 더 이상 원본에 없는 기존 기록은 삭제하지 않는다. 담당자가 과거 제출을 추적할 수 있게 남긴다.
  for (const previous of previousRows || []) {
    const receiptId = String(previous?.['영수증 식별값'] || '')
    if (!receiptId) {
      rows.push({ ...previous, '연결 상태': previous['연결 상태'] || '영수증 식별값 없음 — 자동 검토기록 연결 불가' })
      continue
    }
    if (!seen.has(receiptId)) rows.push({ ...previous })
  }
  const resultRows = rows.length ? rows : [{ '영수증 식별값': '', '검토 상태': '' }]
  // 데이터가 없는 구형 검토기록이라도 담당자가 추가한 열 구조는 다음 집계에 남긴다.
  for (const row of resultRows) {
    for (const header of previousHeaders || []) {
      if (header && !(header in row)) row[header] = ''
    }
  }
  return resultRows
}
