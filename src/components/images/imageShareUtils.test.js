import { describe, it, expect } from 'vitest';
import { buildImageReceipts, buildReceiptImageFileName, getReceiptImageExt } from './imageShareUtils';

describe('image share utils', () => {
  it('keeps one receipt per image and sorts by date then time', () => {
    const receipts = [
      { id: 'a', imageId: 'img-1', date: '2026-06-20', useTime: '10:00' },
      { id: 'b', imageId: 'img-2', date: '2026-06-21', useTime: '09:00' },
      { id: 'c', imageId: 'img-1', date: '2026-06-22', useTime: '11:00' },
      { id: 'd', imageId: 'img-3', date: '2026-06-21', useTime: '12:00' },
    ];

    expect(buildImageReceipts(receipts).map((receipt) => receipt.id)).toEqual(['c', 'd', 'b']);
  });

  it('builds a safe file name and extension from the blob type', () => {
    expect(buildReceiptImageFileName({ date: '2026-06-28', storeName: 'A/B:C*D?E"F<G>H|I' }, 2, 'png'))
      .toBe('2026-06-28_A_B_C_D_E_F_G_H_I_03.png');
    expect(getReceiptImageExt('image/png')).toBe('png');
    expect(getReceiptImageExt('image/jpeg')).toBe('jpg');
  });
});
