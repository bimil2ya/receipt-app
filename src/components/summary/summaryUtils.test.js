import { describe, it, expect } from 'vitest';
import { buildCategorySummary, buildDateSummary, getReceiptGrandTotal, safeCategory, safeDateLabel } from './summaryUtils';

describe('summary utils', () => {
  const receipts = [
    { id: '1', category: '숙박비', date: '2026-06-20', useTime: '12:00', totalAmount: 120000, storeName: '호텔 A' },
    { id: '2', category: '식비', date: '2026-06-21', useTime: '08:00', totalAmount: 15000, storeName: '식당 B' },
    { id: '3', category: '유류비', date: '2026-06-21', useTime: '09:00', totalAmount: 55000, storeName: '주유소 C' },
    { id: '4', category: '기타', date: '2026-06-19', useTime: '18:00', totalAmount: 3000, storeName: '편의점 D' },
    { id: '5', category: '의료비등', date: '2026-06-19', useTime: '19:00', totalAmount: 7000, storeName: '약국 E' },
  ];

  it('builds category summary with ordered sections and subtotal', () => {
    const summary = buildCategorySummary(receipts);

    expect(summary.sections.map((section) => section.key)).toEqual(['숙박비', '식비', '기타', '유류비', '의료비등']);
    expect(summary.sections[0].items[0].id).toBe('1');
    expect(summary.sections[1].total).toBe(15000);
    expect(summary.subtotal).toBe(138000);
  });

  it('builds date summary in descending order', () => {
    const summary = buildDateSummary(receipts);

    expect(summary.map((item) => item.key)).toEqual(['2026-06-21', '2026-06-20', '2026-06-19']);
    expect(summary[0].items[0].id).toBe('3');
    expect(summary[2].displayDate).toBe('26.06.19');
  });

  it('sums the grand total and normalizes labels', () => {
    expect(getReceiptGrandTotal(receipts)).toBe(200000);
    expect(safeCategory(undefined)).toBe('기타');
    expect(safeDateLabel('2026-06-28')).toBe('26.06.28');
  });

  it('rejects a total beyond the safe integer range instead of rounding it', () => {
    const overflow = [{ totalAmount: Number.MAX_SAFE_INTEGER }, { totalAmount: 1 }];
    expect(() => getReceiptGrandTotal(overflow)).toThrow('안전한 정수 범위');
    expect(() => buildCategorySummary(overflow)).toThrow('안전한 정수 범위');
    expect(() => buildDateSummary(overflow)).toThrow('안전한 정수 범위');
  });
});

describe('legacy and incomplete receipts remain visible', () => {
  const receipts = [
    { id: 'manual', totalAmount: 3000, category: '교통비', date: '' },
    { id: 'photo', totalAmount: 7000, category: '', date: '2026-09-01', imageId: 'img' },
    { id: 'legacy', totalAmount: -1000, date: undefined },
  ];
  it('includes every receipt exactly once in both modes without changing stored data', () => {
    const before = JSON.stringify(receipts);
    for (const groups of [buildCategorySummary(receipts).sections, buildDateSummary(receipts)]) {
      expect(groups.flatMap(group => group.items.map(item => item.id)).sort()).toEqual(['legacy', 'manual', 'photo']);
      expect(groups.reduce((sum, group) => sum + group.total, 0)).toBe(getReceiptGrandTotal(receipts));
    }
    expect(JSON.stringify(receipts)).toBe(before);
    expect(buildDateSummary(receipts).at(-1).displayDate).toBe('날짜 없음');
    expect(buildCategorySummary(receipts).sections.map(group => group.category)).toContain('교통비');
  });
});
