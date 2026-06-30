import { describe, expect, it } from 'vitest';
import { buildApprovalReportFromReceipts, normalizeApprovalNum } from './approvalReport';

describe('approval report utils', () => {
  it('normalizes approval numbers for comparison', () => {
    expect(normalizeApprovalNum(' 0I-12 3O ')).toBe('011230');
  });

  it('reports confirmed duplicates only when approval, date, and amount match', () => {
    const report = buildApprovalReportFromReceipts([
      { id: 'a', date: '2026-06-20', storeName: 'A', totalAmount: 1000, approvalNum: '123-456' },
      { id: 'b', date: '2026-06-20', storeName: 'A', totalAmount: 1000, approvalNum: '123456' },
      { id: 'c', date: '2026-06-21', storeName: 'A', totalAmount: 1000, approvalNum: '123456' },
    ]);

    expect(report.confirmedGroupCount).toBe(1);
    expect(report.confirmedGroups[0].receiptIds).toEqual(['a', 'b']);
    expect(report.reviewGroupCount).toBe(0);
  });

  it('reports same approval with different date or amount as review needed', () => {
    const report = buildApprovalReportFromReceipts([
      { id: 'a', date: '2026-06-20', storeName: 'A', totalAmount: 1000, approvalNum: '7777' },
      { id: 'b', date: '2026-06-21', storeName: 'A', totalAmount: 1000, approvalNum: '7777' },
    ]);

    expect(report.confirmedGroupCount).toBe(0);
    expect(report.reviewGroupCount).toBe(1);
    expect(report.reviewGroups[0].receiptIds).toEqual(['a', 'b']);
  });

  it('counts receipts without approval numbers', () => {
    const report = buildApprovalReportFromReceipts([
      { id: 'a', date: '2026-06-20', totalAmount: 1000, approvalNum: '' },
      { id: 'b', date: '2026-06-21', totalAmount: 2000 },
    ]);

    expect(report.missingApprovalCount).toBe(2);
  });
});
