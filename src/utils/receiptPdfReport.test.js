import { describe, expect, it } from 'vitest';
import {
  buildCategoryTotals,
  buildCategoryPageHtml,
  buildCoverHtml,
  buildImageCaption,
  escapeHtml,
  groupImagesByCategory,
  sliceIntoChunks,
} from './receiptPdfReport';

describe('buildCategoryTotals', () => {
  it('groups by category in the fixed order and keeps the unknown categories after', () => {
    const receipts = [
      { category: '식비', totalAmount: 10000 },
      { category: '숙박비', totalAmount: 50000 },
      { category: '식비', totalAmount: 5000 },
      { category: '유류비', totalAmount: 3000 },
      { category: '접대비', totalAmount: 7000 },
    ];

    const { totals, orderedCategories, grandTotal, totalCount } = buildCategoryTotals(receipts);

    expect(orderedCategories).toEqual(['숙박비', '식비', '유류비', '접대비']);
    expect(totals.get('식비')).toEqual({ count: 2, amount: 15000 });
    expect(totals.get('숙박비')).toEqual({ count: 1, amount: 50000 });
    expect(grandTotal).toBe(75000);
    expect(totalCount).toBe(5);
  });

  it('falls back to 기타 when category is missing', () => {
    const { orderedCategories, totals } = buildCategoryTotals([{ totalAmount: 1000 }]);
    expect(orderedCategories).toEqual(['기타']);
    expect(totals.get('기타')).toEqual({ count: 1, amount: 1000 });
  });

  it('returns an empty summary for no receipts', () => {
    const { orderedCategories, grandTotal, totalCount } = buildCategoryTotals([]);
    expect(orderedCategories).toEqual([]);
    expect(grandTotal).toBe(0);
    expect(totalCount).toBe(0);
  });
});

describe('groupImagesByCategory', () => {
  it('assigns each image to the category of its first receipt item', () => {
    const images = [
      { id: 'a', receipts: [{ category: '식비' }] },
      { id: 'b', receipts: [{ category: '숙박비' }, { category: '식비' }] },
      { id: 'c', receipts: [] },
    ];

    const byCategory = groupImagesByCategory(images);
    expect(byCategory.get('식비').map((img) => img.id)).toEqual(['a']);
    expect(byCategory.get('숙박비').map((img) => img.id)).toEqual(['b']);
    expect(byCategory.get('기타').map((img) => img.id)).toEqual(['c']);
  });
});

describe('buildImageCaption', () => {
  it('shows date, store and amount for a single-item image', () => {
    const caption = buildImageCaption({
      receipts: [{ date: '2026-09-05', storeName: '스타벅스', totalAmount: 12000 }],
    });
    expect(caption).toBe('2026-09-05 · 스타벅스 · 12,000원');
  });

  it('summarizes count and sum for a multi-item image', () => {
    const caption = buildImageCaption({
      receipts: [
        { date: '2026-09-05', storeName: '이마트', totalAmount: 10000 },
        { date: '2026-09-05', storeName: '이마트', totalAmount: 5000 },
      ],
    });
    expect(caption).toBe('2026-09-05 · 이마트 외 1건 · 합계 15,000원');
  });

  it('appends other categories when an image mixes 용도', () => {
    const caption = buildImageCaption({
      receipts: [
        { date: '2026-09-05', storeName: '휴게소', totalAmount: 10000, category: '식비' },
        { date: '2026-09-05', storeName: '휴게소', totalAmount: 4000, category: '기타' },
      ],
    });
    expect(caption).toContain('(다른 용도 포함: 기타)');
  });

  it('returns empty string for an image with no receipts', () => {
    expect(buildImageCaption({ receipts: [] })).toBe('');
  });

  it('escapes store name and date so injection payloads do not survive', () => {
    const caption = buildImageCaption({
      receipts: [{
        date: '"><img src=x onerror=alert(1)>',
        storeName: '<script>alert(1)</script>',
        totalAmount: 1000,
      }],
    });
    expect(caption).not.toContain('<script>');
    expect(caption).not.toContain('<img');
    expect(caption).toContain('&lt;script&gt;');
  });
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters exactly once', () => {
    expect(escapeHtml('<a href="x" title=\'y\'>&</a>'))
      .toBe('&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  });

  it('does not double-escape an already-escaped string', () => {
    expect(escapeHtml('&lt;b&gt;')).toBe('&amp;lt;b&amp;gt;');
  });

  it('handles null/undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('buildCoverHtml / buildCategoryPageHtml escaping', () => {
  const totalsFixture = buildCategoryTotals([
    { category: '<img src=x onerror=alert(1)>', totalAmount: 1000 },
  ]);

  it('escapes teamNames and category in the cover', () => {
    const html = buildCoverHtml({
      teamNames: '<script>alert(1)</script>',
      tripStartDate: '2026-09-01',
      tripEndDate: '2026-09-03',
      ...totalsFixture,
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes category in the category page header', () => {
    const html = buildCategoryPageHtml('<b>onerror</b>', [], 0, 1);
    expect(html).not.toContain('<b>onerror</b>');
    expect(html).toContain('&lt;b&gt;onerror&lt;/b&gt;');
  });

  it('does not re-escape the already-escaped caption from buildImageCaption', () => {
    const html = buildCategoryPageHtml('식비', [{
      dataUrl: 'data:image/jpeg;base64,AAAA',
      receipts: [{ date: '2026-09-05', storeName: '<x>', totalAmount: 100 }],
    }], 0, 1);
    // caption escaped '<x>' -> '&lt;x&gt;', must not become '&amp;lt;x&amp;gt;'
    expect(html).toContain('&lt;x&gt;');
    expect(html).not.toContain('&amp;lt;x&amp;gt;');
  });
});

describe('sliceIntoChunks', () => {
  it('round-trips to the identical bytes for sizes that are not multiples of 3', () => {
    const original = new Uint8Array(10_000);
    for (let i = 0; i < original.length; i += 1) original[i] = (i * 7 + 13) % 256;

    for (const size of [1, 3, 7, 2999, 4096]) {
      const chunks = sliceIntoChunks(original, size);
      // independent base64 per slice, then independent decode, then concat
      const rejoined = chunks.reduce((acc, chunk) => {
        const b64 = Buffer.from(chunk).toString('base64');
        const decoded = new Uint8Array(Buffer.from(b64, 'base64'));
        const next = new Uint8Array(acc.length + decoded.length);
        next.set(acc, 0);
        next.set(decoded, acc.length);
        return next;
      }, new Uint8Array(0));
      expect(rejoined).toEqual(original);
    }
  });

  it('produces ceil(len/size) chunks', () => {
    expect(sliceIntoChunks(new Uint8Array(10), 4)).toHaveLength(3);
    expect(sliceIntoChunks(new Uint8Array(8), 4)).toHaveLength(2);
    expect(sliceIntoChunks(new Uint8Array(0), 4)).toHaveLength(0);
  });
});
