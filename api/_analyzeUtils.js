import { normalizeApprovalNum } from '../shared/approvalReportCore.js';
export { normalizeApprovalNum };

export function hasMissingApprovalNum(receipts) {
  return Array.isArray(receipts) && receipts.some(receipt => !normalizeApprovalNum(receipt?.approvalNum));
}

export function normalizeIsoDate(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

export function buildTripDateContext({ reportDate, tripStartDate, tripEndDate }) {
  const report = normalizeIsoDate(reportDate);
  const start = normalizeIsoDate(tripStartDate) || report;
  const end = normalizeIsoDate(tripEndDate) || start;
  if (!start && !end && !report) return '';

  const tripYear = (start || end || report || '').slice(0, 4);

  return `
[연도 기준 - CRITICAL]
출장 연도: ${tripYear}년

규칙 (반드시 따를 것):
1. 영수증에서 날짜를 그대로 읽어라. 어떤 이유로도 날짜를 추정하거나 수정하지 마라.
2. 읽은 날짜의 연도가 ${tripYear}년이 아니면 연도만 ${tripYear}년으로 교체하라. 월·일은 건드리지 마라.
3. 날짜를 전혀 읽을 수 없으면 date 필드를 빈 문자열 ""로 반환하라.
`;
}

// AI 응답 날짜를 서버에서 2차 검증
// - 연도가 출장 연도와 다르면 연도만 교정
// - 날짜가 비어 있으면 출장 시작일로 채움
// - 월/일이 출장 기간 밖이어도 절대 수정하지 않음 (예전 영수증 나중에 올리는 경우 있음)
export function repairReceiptDates(receipts, { tripStartDate, tripEndDate, reportDate }) {
  const start = normalizeIsoDate(tripStartDate) || normalizeIsoDate(reportDate);
  if (!start) return receipts;

  const tripYear = start.slice(0, 4);

  return receipts.map(r => {
    const raw = String(r.date || '').trim();

    if (!raw) return { ...r, date: start };

    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return r;

    if (raw.slice(0, 4) === tripYear) return r;

    return { ...r, date: tripYear + raw.slice(4) };
  });
}
