// 대시보드 데이터 페이로드 빌더.
// 착수 키트 §7. 응답 계약(필드·역할 분리)은 확정, 데이터 소스는 아직 스텁이다.
//
// ⚠️ P2(검토기록/검토필요/변경이력 시트 + buildDetailRows의 영수증식별값)가 커밋·동결되면
//    여기를 실제 Google Sheet export 파싱으로 교체한다. 착수 키트 §2 참고.
//    지금은 고정 예시를 반환하되, 계약 테스트(합계 정합·역할별 키)는 통과하도록 만들어 둔다.

import { reportsForMonth, signReportRef } from './_dashboardReports.js';

const CATEGORIES = ['숙박비', '식비', '기타', '유류비', '의료비등'];
const FUEL_MED = new Set(['유류비', '의료비등']);

// 현행 7개 조 (src/config/teams.json과 동일한 이름).
const SAMPLE_TEAMS = [
  { names: '류준, 류수현',   byCategory: { 숙박비: 280000, 식비: 170000, 기타: 22000, 유류비: 120000, 의료비등: 20000 }, receiptCount: 11, review: { ok: 8, req: 1, none: 2 } },
  { names: '이선수, 박종일', byCategory: { 숙박비: 240000, 식비: 150000, 기타: 15000, 유류비: 90000,  의료비등: 10000 }, receiptCount: 9,  review: { ok: 6, req: 0, none: 3 } },
  { names: '박정환, 김금섭', byCategory: { 숙박비: 220000, 식비: 150000, 기타: 28000, 유류비: 80000,  의료비등: 10000 }, receiptCount: 8,  review: { ok: 5, req: 2, none: 1 } },
  { names: '오수재, 권승호', byCategory: { 숙박비: 320000, 식비: 210000, 기타: 36000, 유류비: 140000, 의료비등: 25000 }, receiptCount: 10, review: { ok: 5, req: 1, none: 4 } },
  { names: '송승수, 전상현', byCategory: { 숙박비: 360000, 식비: 250000, 기타: 41000, 유류비: 180000, 의료비등: 30000 }, receiptCount: 12, review: { ok: 9, req: 0, none: 3 } },
  { names: '노경호, 김영일', byCategory: { 숙박비: 160000, 식비: 132000, 기타: 12000, 유류비: 45000,  의료비등: 0 },     receiptCount: 9,  review: { ok: 9, req: 0, none: 0 } },
  { names: '신상대, 함윤성', byCategory: { 숙박비: 230000, 식비: 160000, 기타: 15000, 유류비: 47000,  의료비등: 0 },     receiptCount: 7,  review: { ok: 4, req: 1, none: 2 } },
];

const sumValues = (obj) => Object.values(obj).reduce((a, b) => a + b, 0);
const coreOf = (byCategory) =>
  CATEGORIES.reduce((a, c) => a + (FUEL_MED.has(c) ? 0 : byCategory[c] || 0), 0);

// 내부 도구는 KST 기준. 클라이언트가 항상 &month=를 보내므로 이 폴백은 드물게만 쓰인다.
function currentMonth() {
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * @param {{ month?: string, role: 'owner' | 'staff' }} params
 * @returns {Promise<object>} 착수 키트 §7의 응답 계약
 */
export async function buildDashboardPayload({ month, role } = {}) {
  const resolvedMonth = /^\d{4}-\d{2}$/.test(month || '') ? month : currentMonth();
  const isOwner = role === 'owner';

  const teams = SAMPLE_TEAMS.map((t) => ({
    names: t.names,
    spent: sumValues(t.byCategory),
    core: coreOf(t.byCategory),
    byCategory: { ...t.byCategory },
    receiptCount: t.receiptCount,
    submitted: true,
    review: { ...t.review },
    // 조별 정산서 PDF(표지 = 집계장, 이후 = 영수증 이미지). ref는 서명된 값.
    reports: reportsForMonth({ teamNames: t.names, month: resolvedMonth }).map((r) => ({
      label: r.label,
      date: r.date,
      available: r.available,
      ref: r.available ? signReportRef(r.id) : null,
    })),
  }));

  const byCategory = CATEGORIES.reduce((acc, c) => {
    acc[c] = teams.reduce((a, t) => a + (t.byCategory[c] || 0), 0);
    return acc;
  }, {});
  const spent = sumValues(byCategory);
  const core = teams.reduce((a, t) => a + t.core, 0);
  const receiptCount = teams.reduce((a, t) => a + t.receiptCount, 0);

  // 원장: 합계가 totals.spent와 정확히 일치하도록 조별 1행씩(스텁).
  const ledger = teams.map((t) => ({
    date: `${resolvedMonth}-05`,
    team: t.names,
    category: '숙박비',
    amount: t.spent,
    store: '(스텁) 조별 합계 1행',
    approvalNum: '',
    reviewStatus: null,
    teamPdfUrl: null,
  }));

  const payload = {
    contractVersion: '1.0',
    month: resolvedMonth,
    role: isOwner ? 'owner' : 'staff',
    generatedAt: new Date().toISOString(),
    sheetModifiedTime: null,
    stub: true, // ← P2 후 실데이터로 교체되면 제거
    totals: { spent, core, fuelMed: spent - core, receiptCount, prevMonthSpent: null },
    byCategory,
    teams,
    unmatchedLedgerCount: 0,
    ledger,
    reviewsRaw: [],
    trend: [{ month: resolvedMonth, total: spent, byCategory: { ...byCategory } }],
  };

  // 역할 분리는 서버에서 — staff 응답엔 flags/coDining 키 자체가 없다.
  if (isOwner) {
    payload.flags = [
      {
        rule: '검수 정체',
        severity: 'critical',
        teams: ['박정환, 김금섭'],
        date: `${resolvedMonth}-02`,
        store: '(스텁) 평창게스트하우스',
        amount: 120000,
        approvalNum: '',
      },
    ];
    payload.coDining = [
      {
        date: `${resolvedMonth}-08`,
        store: '(스텁) 오대산내고향',
        members: [
          { team: '노경호, 김영일', time: '17:27' },
          { team: '이선수, 박종일', time: '17:29' },
        ],
        confidence: 'time',
      },
    ];
  }

  return payload;
}
