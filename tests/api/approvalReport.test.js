import { describe, expect, it } from 'vitest';
import { buildApprovalDuplicateReport, normalizeApprovalNum } from '../../api/approvalReport.js';

describe('api approval duplicate report', () => {
  it('normalizes approval numbers', () => {
    expect(normalizeApprovalNum(' 0I-12 3O ')).toBe('011230');
  });

  it('confirms duplicates by approval, date, and amount across persons', () => {
    const report = buildApprovalDuplicateReport([
      { person: '1조', date: '2026-06-20', amount: 3000, storeName: 'A', approvalNum: '1234' },
      { person: '2조', date: '2026-06-20', amount: 3000, storeName: 'A', approvalNum: '12-34' },
    ]);

    expect(report.confirmedGroupCount).toBe(1);
    expect(report.confirmedGroups[0].persons).toEqual(['1조', '2조']);
    expect(report.reviewGroupCount).toBe(0);
  });

  it('marks same approval with different date or amount for review', () => {
    const report = buildApprovalDuplicateReport([
      { person: '1조', date: '2026-06-20', amount: 3000, approvalNum: '9999' },
      { person: '1조', date: '2026-06-21', amount: 3000, approvalNum: '9999' },
    ]);

    expect(report.confirmedGroupCount).toBe(0);
    expect(report.reviewGroupCount).toBe(1);
  });
});
