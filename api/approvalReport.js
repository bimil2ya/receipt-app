// 서버(Drive XLSX 집계 rows) 전용 래퍼. 알고리즘은 shared/approvalReportCore.js 에서 관리.
export { normalizeApprovalNum } from '../shared/approvalReportCore.js';
import { findDuplicateApprovalGroups } from '../shared/approvalReportCore.js';

function summarizeReceiptForDuplicate(row) {
  return {
    person: row.person || '',
    date: row.date || '',
    useTime: row.useTime || '',
    storeName: row.storeName || '',
    amount: row.amount || 0,
    category: row.category || '',
    approvalNum: row.approvalNum || '',
  };
}

export function buildApprovalDuplicateReport(rows, sampleLimit = 5) {
  const { missingApprovalCount, confirmedGroups, reviewGroups } = findDuplicateApprovalGroups(
    rows,
    {
      getApprovalNum: r => r.approvalNum,
      getAmount: r => r.amount || 0,
      getDate: r => r.date || '',
    },
    sampleLimit,
  );

  const confirmedReceiptCount = confirmedGroups.reduce((sum, g) => sum + g.count, 0);

  return {
    missingApprovalCount,
    confirmedGroupCount: confirmedGroups.length,
    confirmedReceiptCount,
    reviewGroupCount: reviewGroups.length,
    confirmedGroups: confirmedGroups.slice(0, sampleLimit).map(g => ({
      approvalKey: g.approvalKey,
      person: g.items[0]?.person || '',
      persons: [...new Set(g.items.map(r => r.person || '').filter(Boolean))],
      date: g.date,
      amount: g.amount,
      count: g.count,
      receipts: g.items.map(summarizeReceiptForDuplicate),
    })),
    reviewGroups: reviewGroups.slice(0, sampleLimit).map(g => ({
      approvalKey: g.approvalKey,
      count: g.count,
      reason: g.reason,
      receipts: g.items.map(summarizeReceiptForDuplicate),
    })),
  };
}
