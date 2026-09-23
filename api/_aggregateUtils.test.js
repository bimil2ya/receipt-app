import { describe, expect, it } from 'vitest'
import {
  buildDatePersonMap,
  buildDetailRows,
  buildPivotRows,
  groupPersonFolders,
  parseXlsxRow,
  buildReviewRows,
  buildTeamReviewSummary,
  buildReviewLedgerRows,
} from './_aggregateUtils.js'
import { sumSafeAmounts } from './_aggregateUtils.js'

it('rejects aggregate totals outside the safe integer range', () => {
  expect(() => sumSafeAmounts([{ amount: Number.MAX_SAFE_INTEGER }, { amount: 1 }]))
    .toThrow('안전한 정수 범위')
})

it('preserves office-entered review columns by receipt id without deleting removed source rows', () => {
  const rows = buildReviewLedgerRows(
    [{ id: 'current', person: '검증팀', date: '2026-09-10', storeName: '식당', category: '식비', amount: 7000, approvalNum: '1234' }],
    [
      { '영수증 식별값': 'current', '검토 상태': '추가 자료 요청', '담당자 메모': '원본 재확인', '검토 담당자': '사무실' },
      { '영수증 식별값': 'past', '검토 상태': '보관' },
    ],
  )
  expect(rows).toEqual(expect.arrayContaining([
    expect.objectContaining({ '영수증 식별값': 'current', '검토 상태': '추가 자료 요청', '담당자 메모': '원본 재확인', '검토 담당자': '사무실' }),
    expect.objectContaining({ '영수증 식별값': 'past', '검토 상태': '보관' }),
  ]))
})

it('preserves custom review headers even when the previous sheet had no data rows', () => {
  const [row] = buildReviewLedgerRows(
    [{ id: 'current', person: '검증팀', amount: 7000 }],
    [],
    ['영수증 식별값', '검토 상태', '사내 관리번호'],
  )
  expect(row).toMatchObject({ '영수증 식별값': 'current', '사내 관리번호': '' })
})

it('shows the prior submission revision when a receipt is corrected and re-aggregated', () => {
  const [row] = buildReviewLedgerRows(
    [{ id: 'corrected', person: '검증팀', amount: 7000, revision: 2 }],
    [{ '영수증 식별값': 'corrected', '수정 버전': 1, '검토 상태': '확인 필요' }],
  )
  expect(row).toMatchObject({ '수정 버전': 2, '직전 수정 버전': 1, '검토 상태': '확인 필요' })
})

it('shows submitted supporting material on the originally reviewed receipt row', () => {
  const rows = buildReviewLedgerRows([
    { id: 'requested', person: '검증팀', amount: 7000 },
    { id: 'support-photo', person: '검증팀', amount: 0, revision: 2, relatedReviewReceiptId: 'requested' },
  ])
  expect(rows.find(row => row['영수증 식별값'] === 'requested')).toMatchObject({
    '연결 추가 자료': 'support-photo (v2)',
  })
})

it('builds office review rows without changing source rows', () => {
  const rows = [
    { person: '검증팀', date: '', storeName: '수기교통', category: '', amount: 3000, approvalNum: '' },
    { person: '검증팀', date: '2026-09-01', storeName: '식당', category: '식비', amount: 7000, approvalNum: '1234' },
    { person: '현장팀', date: '2026-09-02', storeName: '식당', category: '식비', amount: 7000, approvalNum: '1234' },
  ]
  expect(buildReviewRows(rows)).toEqual(expect.arrayContaining([
    expect.objectContaining({ '확인 사유': '날짜 없음 · 분류 없음 · 승인번호 없음' }),
    expect.objectContaining({ '확인 사유': '승인번호 중복 후보' }),
  ]))
})

it('summarizes office review candidates by team without calling them complete', () => {
  const rows = [{ person: '검증팀', amount: 3000 }, { person: '검증팀', amount: 7000 }, { person: '현장팀', amount: 5000 }]
  const summary = buildTeamReviewSummary(rows, [{ '팀': '검증팀' }])
  expect(summary).toEqual(expect.arrayContaining([
    expect.objectContaining({ '팀': '검증팀', '영수증 건수': 2, '사용액(원)': 10000, '확인 필요 건수': 1, '검수 상태': '담당자 확인 필요' }),
  ]))
})

describe('parseXlsxRow', () => {
  it('xlsx 행을 내부 포맷으로 변환한다', () => {
    const r = {
      '날짜': '2024-01-15',
      '사용시간': '14:30',
      '사용처': '스타벅스',
      '용도': '업무',
      '금액': 5000,
      '승인번호': '12345678',
      '사업자번호': '123-45-67890',
      '카드번호': '1234',
      '비고': '메모',
    }
    const result = parseXlsxRow(r, '홍길동')
    expect(result).toMatchObject({
      date: '2024-01-15',
      useTime: '14:30',
      storeName: '스타벅스',
      category: '업무',
      amount: 5000,
      approvalNum: '12345678',
      bizNum: '123-45-67890',
      cardNumber: '1234',
      note: '메모',
      person: '홍길동',
    })
    expect(result).toMatchObject({ id: '', assignmentTeamName: '', createdByName: '', deviceId: '', createdAt: 0, updatedAt: 0 })
  })

  it('누락된 필드는 빈 문자열/0으로 채운다', () => {
    const result = parseXlsxRow({}, '이순신')
    expect(result.date).toBe('')
    expect(result.amount).toBe(0)
    expect(result.person).toBe('이순신')
  })

  it('금액이 숫자가 아니면 0으로 처리한다', () => {
    const result = parseXlsxRow({ '금액': 'N/A' }, '박영희')
    expect(result.amount).toBe(0)
  })
})

describe('buildDatePersonMap', () => {
  it('날짜별·사람별 건수와 금액을 집계한다', () => {
    const rows = [
      { date: '2024-01-15', person: '홍길동', amount: 3000 },
      { date: '2024-01-15', person: '홍길동', amount: 2000 },
      { date: '2024-01-16', person: '이순신', amount: 5000 },
    ]
    const map = buildDatePersonMap(rows)
    expect(map['2024-01-15']['홍길동']).toEqual({ count: 2, amount: 5000 })
    expect(map['2024-01-16']['이순신']).toEqual({ count: 1, amount: 5000 })
  })

  it('date가 없는 행은 무시한다', () => {
    const rows = [
      { date: '', person: '홍길동', amount: 1000 },
      { date: '2024-01-15', person: '홍길동', amount: 2000 },
    ]
    const map = buildDatePersonMap(rows)
    expect(Object.keys(map)).toEqual(['2024-01-15'])
  })

  it('빈 배열이면 빈 객체를 반환한다', () => {
    expect(buildDatePersonMap([])).toEqual({})
  })
})

describe('buildPivotRows', () => {
  const map = {
    '2024-01-15': { '홍길동': { count: 2, amount: 5000 }, '이순신': { count: 1, amount: 3000 } },
    '2024-01-16': { '홍길동': { count: 1, amount: 2000 } },
  }
  const personOrder = ['홍길동', '이순신']

  it('날짜 오름차순으로 행을 생성한다', () => {
    const rows = buildPivotRows(map, personOrder)
    expect(rows[0]['날짜']).toBe('2024-01-15')
    expect(rows[1]['날짜']).toBe('2024-01-16')
  })

  it('각 행에 사람별 건수·금액과 합계를 포함한다', () => {
    const rows = buildPivotRows(map, personOrder)
    expect(rows[0]['홍길동(건)']).toBe(2)
    expect(rows[0]['홍길동(원)']).toBe(5000)
    expect(rows[0]['이순신(건)']).toBe(1)
    expect(rows[0]['합계(원)']).toBe(8000)
  })

  it('마지막 행이 합계 행이다', () => {
    const rows = buildPivotRows(map, personOrder)
    const total = rows[rows.length - 1]
    expect(total['날짜']).toBe('합계')
    expect(total['홍길동(건)']).toBe(3)
    expect(total['홍길동(원)']).toBe(7000)
    expect(total['이순신(원)']).toBe(3000)
    expect(total['합계(원)']).toBe(10000)
  })

  it('해당 날짜에 없는 사람은 0으로 채운다', () => {
    const rows = buildPivotRows(map, personOrder)
    expect(rows[1]['이순신(건)']).toBe(0)
    expect(rows[1]['이순신(원)']).toBe(0)
  })

  it('grandTotal을 전달하면 합계 행에 그대로 사용한다 (날짜 없는 행 포함)', () => {
    const rows = buildPivotRows(map, personOrder, 99999)
    const total = rows[rows.length - 1]
    expect(total['합계(원)']).toBe(99999)
  })

  it('grandTotal 미전달 시 map 기반 합계를 사용한다', () => {
    const rows = buildPivotRows(map, personOrder)
    const total = rows[rows.length - 1]
    expect(total['합계(원)']).toBe(10000)
  })

  it('날짜 없는 행은 map에서 제외되지만 grandTotal로 전달하면 합계에 포함된다', () => {
    const allRows = [
      { date: '2024-01-15', person: '홍길동', amount: 1000 },
      { date: '', person: '홍길동', amount: 500 },
    ]
    const map2 = buildDatePersonMap(allRows)
    const grandTotal = allRows.reduce((s, r) => s + r.amount, 0)
    const pivot = buildPivotRows(map2, ['홍길동'], grandTotal)
    expect(pivot.at(-1)['합계(원)']).toBe(1500)
  })
})

describe('buildDetailRows', () => {
  const rows = [
    { date: '2024-01-16', person: '이순신', storeName: 'B마트', category: '식비', amount: 3000, useTime: '', approvalNum: '', bizNum: '', cardNumber: '', note: '' },
    { date: '2024-01-15', person: '홍길동', storeName: 'A카페', category: '업무', amount: 5000, useTime: '', approvalNum: '', bizNum: '', cardNumber: '', note: '' },
    { date: '2024-01-15', person: '이순신', storeName: 'A마트', category: '식비', amount: 2000, useTime: '', approvalNum: '', bizNum: '', cardNumber: '', note: '' },
  ]
  const personOrder = ['홍길동', '이순신']

  it('날짜 오름차순, 같은 날짜는 personOrder 순으로 정렬한다', () => {
    const detail = buildDetailRows(rows, personOrder)
    expect(detail[0]['이름']).toBe('홍길동')
    expect(detail[1]['이름']).toBe('이순신')
    expect(detail[2]['날짜']).toBe('2024-01-16')
  })

  it('한국어 컬럼명으로 매핑한다', () => {
    const detail = buildDetailRows(rows, personOrder)
    const first = detail[0]
    expect(first['날짜']).toBe('2024-01-15')
    expect(first['사용처']).toBe('A카페')
    expect(first['금액(원)']).toBe(5000)
  })

  it('원본 배열을 변경하지 않는다', () => {
    const copy = [...rows]
    buildDetailRows(rows, personOrder)
    expect(rows).toEqual(copy)
  })
})

describe('groupPersonFolders', () => {
  it('같은 이름(정규화 후)의 폴더를 하나의 그룹으로 묶는다', () => {
    const folders = [
      { id: '1', name: '홍길동' },
      { id: '2', name: '홍길동' },
      { id: '3', name: '이순신' },
    ]
    const groups = groupPersonFolders(folders)
    expect(groups).toHaveLength(2)
    expect(groups.find(g => g.name === '홍길동').folders).toHaveLength(2)
  })

  it('빈 배열이면 빈 배열을 반환한다', () => {
    expect(groupPersonFolders([])).toEqual([])
    expect(groupPersonFolders(null)).toEqual([])
  })
})
