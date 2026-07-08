// 승인번호 중복 검사 — 프론트(IndexedDB receipts) 전용.
// 서버 측 Drive XLSX 집계용은 api/approvalReport.js 참고.
// 핵심 알고리즘(normalizeApprovalNum, 그룹핑 로직)을 양쪽에서 동일하게 유지할 것.
import { decodeHtmlEntities } from './formatter';

function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export function normalizeApprovalNum(value) {
  return safeText(value)
    .replace(/[Oo]/g, '0')
    .replace(/[Iil|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8')
    .replace(/[Zz]/g, '2')
    .replace(/[^0-9]/g, '');
}

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
  const approvalGroups = new Map();
  let missingApprovalCount = 0;

  for (const receipt of receipts || []) {
    const approvalKey = normalizeApprovalNum(receipt.approvalNum);
    if (!approvalKey) {
      missingApprovalCount += 1;
      continue;
    }
    if (!approvalGroups.has(approvalKey)) approvalGroups.set(approvalKey, []);
    approvalGroups.get(approvalKey).push(receipt);
  }

  const confirmedGroups = [];
  const reviewGroups = [];
  for (const [approvalKey, groupReceipts] of approvalGroups.entries()) {
    if (groupReceipts.length < 2) continue;
    const exactGroups = new Map();
    for (const receipt of groupReceipts) {
      const exactKey = `${receipt.date || ''}|${receipt.totalAmount || 0}`;
      if (!exactGroups.has(exactKey)) exactGroups.set(exactKey, []);
      exactGroups.get(exactKey).push(receipt);
    }

    let hasConfirmed = false;
    for (const exactReceipts of exactGroups.values()) {
      if (exactReceipts.length < 2) continue;
      hasConfirmed = true;
      confirmedGroups.push({
        approvalKey,
        date: exactReceipts[0].date || '',
        amount: exactReceipts[0].totalAmount || 0,
        count: exactReceipts.length,
        receiptIds: exactReceipts.map(r => r.id).filter(Boolean),
        receipts: exactReceipts.slice(0, sampleLimit).map(summarizeReceipt),
      });
    }
    if (!hasConfirmed) {
      reviewGroups.push({
        approvalKey,
        count: groupReceipts.length,
        reason: 'same_approval_different_date_or_amount',
        receiptIds: groupReceipts.map(r => r.id).filter(Boolean),
        receipts: groupReceipts.slice(0, sampleLimit).map(summarizeReceipt),
      });
    }
  }

  return {
    missingApprovalCount,
    confirmedGroupCount: confirmedGroups.length,
    confirmedReceiptCount: confirmedGroups.reduce((sum, group) => sum + group.count, 0),
    reviewGroupCount: reviewGroups.length,
    confirmedGroups,
    reviewGroups,
  };
}
