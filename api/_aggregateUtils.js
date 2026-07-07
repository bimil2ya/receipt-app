import { normalizeDriveName } from './driveUtils.js'

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
    useTime:    r['사용시간'] || '',
    storeName:  r['사용처']  || '',
    category:   r['용도']    || '',
    amount:     Number(r['금액']) || 0,
    approvalNum: r['승인번호'] || '',
    bizNum:     r['사업자번호'] || '',
    cardNumber: r['카드번호'] || '',
    note:       r['비고']    || '',
    person:     personName,
  }
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
    }))
}
