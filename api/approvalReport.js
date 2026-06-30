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
  const approvalGroups = new Map();
  let missingApprovalCount = 0;

  for (const row of rows || []) {
    const approvalKey = normalizeApprovalNum(row.approvalNum);
    if (!approvalKey) {
      missingApprovalCount += 1;
      continue;
    }
    if (!approvalGroups.has(approvalKey)) approvalGroups.set(approvalKey, []);
    approvalGroups.get(approvalKey).push(row);
  }

  const confirmedGroups = [];
  const reviewGroups = [];

  for (const [approvalKey, groupRows] of approvalGroups.entries()) {
    if (groupRows.length < 2) continue;

    const exactGroups = new Map();
    for (const row of groupRows) {
      const exactKey = `${row.date || ''}|${row.amount || 0}`;
      if (!exactGroups.has(exactKey)) exactGroups.set(exactKey, []);
      exactGroups.get(exactKey).push(row);
    }

    let hasConfirmed = false;
    for (const exactRows of exactGroups.values()) {
      if (exactRows.length < 2) continue;
      hasConfirmed = true;
      confirmedGroups.push({
        approvalKey,
        person: exactRows[0].person || '',
        persons: [...new Set(exactRows.map(row => row.person || '').filter(Boolean))],
        date: exactRows[0].date || '',
        amount: exactRows[0].amount || 0,
        count: exactRows.length,
        receipts: exactRows.slice(0, sampleLimit).map(summarizeReceiptForDuplicate),
      });
    }

    if (!hasConfirmed) {
      reviewGroups.push({
        approvalKey,
        count: groupRows.length,
        reason: 'same_approval_different_date_or_amount',
        receipts: groupRows.slice(0, sampleLimit).map(summarizeReceiptForDuplicate),
      });
    }
  }

  const confirmedReceiptCount = confirmedGroups.reduce((sum, group) => sum + group.count, 0);

  return {
    missingApprovalCount,
    confirmedGroupCount: confirmedGroups.length,
    confirmedReceiptCount,
    reviewGroupCount: reviewGroups.length,
    confirmedGroups: confirmedGroups.slice(0, sampleLimit),
    reviewGroups: reviewGroups.slice(0, sampleLimit),
  };
}
