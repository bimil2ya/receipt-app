// 프론트(IndexedDB receipts) 전용 래퍼. 알고리즘은 shared/approvalReportCore.js 에서 관리.
import { decodeHtmlEntities } from './formatter';
export { normalizeApprovalNum } from '../../shared/approvalReportCore.js';
import { findDuplicateApprovalGroups } from '../../shared/approvalReportCore.js';

function summarizeReceipt(receipt) {
  return {
    id: receipt.id || '',
    date: receipt.date || '',
    useTime: receipt.useTime || '',
    storeName: decodeHtmlEntities(receipt.storeName) || '',
    amount: receipt.totalAmount || 0,
    category: receipt.category || '',
    approvalNum: receipt.approvalNum || '',
  };
}

export function buildApprovalReportFromReceipts(receipts, sampleLimit = 5) {
  const { missingApprovalCount, confirmedGroups, reviewGroups } = findDuplicateApprovalGroups(
    receipts,
    {
      getApprovalNum: r => r.approvalNum,
      getAmount: r => r.totalAmount || 0,
      getDate: r => r.date || '',
    },
    sampleLimit,
  );

  return {
    missingApprovalCount,
    confirmedGroupCount: confirmedGroups.length,
    confirmedReceiptCount: confirmedGroups.reduce((sum, g) => sum + g.count, 0),
    reviewGroupCount: reviewGroups.length,
    confirmedGroups: confirmedGroups.map(g => ({
      approvalKey: g.approvalKey,
      date: g.date,
      amount: g.amount,
      count: g.count,
      receiptIds: g.items.map(r => r.id).filter(Boolean),
      receipts: g.items.map(summarizeReceipt),
    })),
    reviewGroups: reviewGroups.map(g => ({
      approvalKey: g.approvalKey,
      count: g.count,
      reason: g.reason,
      receiptIds: g.items.map(r => r.id).filter(Boolean),
      receipts: g.items.map(summarizeReceipt),
    })),
  };
}
