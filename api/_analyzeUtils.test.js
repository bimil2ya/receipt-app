import { describe, expect, it } from 'vitest';
import {
  hasMissingApprovalNum,
  normalizeApprovalNum,
  normalizeIsoDate,
  repairReceiptDates,
} from './_analyzeUtils.js';

describe('normalizeApprovalNum', () => {
  it('OCR 오인 문자를 숫자로 치환한다', () => {
    // O→0, o→0, I→1, i→1, l→1, S→5, s→5, B→8, b→8, Z→2, z→2 (11자리)
    expect(normalizeApprovalNum('OoIilSsBbZz')).toBe('00111558822');
    expect(normalizeApprovalNum('O0I1S5B8Z2')).toBe('0011558822');
  });

  it('숫자 이외 문자를 제거한다', () => {
    expect(normalizeApprovalNum('12-34 56')).toBe('123456');
    // A,C,D,X 등 치환 규칙 없는 문자는 제거됨
    expect(normalizeApprovalNum('AX12CY')).toBe('12');
  });

  it('null/undefined를 빈 문자열로 처리한다', () => {
    expect(normalizeApprovalNum(null)).toBe('');
    expect(normalizeApprovalNum(undefined)).toBe('');
  });

  it('숫자만 있으면 그대로 반환한다', () => {
    expect(normalizeApprovalNum('12345678')).toBe('12345678');
  });
});

describe('normalizeIsoDate', () => {
  it('YYYY-MM-DD 형식이면 그대로 반환한다', () => {
    expect(normalizeIsoDate('2026-07-01')).toBe('2026-07-01');
  });

  it('형식이 다르면 빈 문자열을 반환한다', () => {
    expect(normalizeIsoDate('26-07-01')).toBe('');
    expect(normalizeIsoDate('2026/07/01')).toBe('');
    expect(normalizeIsoDate('20260701')).toBe('');
  });

  it('빈 값이면 빈 문자열을 반환한다', () => {
    expect(normalizeIsoDate('')).toBe('');
    expect(normalizeIsoDate(null)).toBe('');
    expect(normalizeIsoDate(undefined)).toBe('');
  });
});

describe('repairReceiptDates', () => {
  const BASE = { tripStartDate: '2026-07-01', tripEndDate: '2026-07-05', reportDate: '' };

  it('연도가 다르면 출장 연도로 교정한다', () => {
    const [result] = repairReceiptDates([{ date: '2025-07-03' }], BASE);
    expect(result.date).toBe('2026-07-03');
  });

  it('연도가 맞으면 날짜를 건드리지 않는다', () => {
    const [result] = repairReceiptDates([{ date: '2026-06-15' }], BASE);
    expect(result.date).toBe('2026-06-15');
  });

  it('날짜가 비어 있으면 출장 시작일로 채운다', () => {
    const [result] = repairReceiptDates([{ date: '' }], BASE);
    expect(result.date).toBe('2026-07-01');
  });

  it('YYYY-MM-DD 형식이 아니면 건드리지 않는다', () => {
    const [result] = repairReceiptDates([{ date: '26-07-01' }], BASE);
    expect(result.date).toBe('26-07-01');
  });

  it('tripStartDate가 없으면 receipts를 그대로 반환한다', () => {
    const receipts = [{ date: '2025-07-01' }];
    const result = repairReceiptDates(receipts, { tripStartDate: '', reportDate: '' });
    expect(result).toBe(receipts);
  });

  it('reportDate를 tripStartDate 대체로 사용한다', () => {
    const [result] = repairReceiptDates(
      [{ date: '2025-07-03' }],
      { tripStartDate: '', reportDate: '2026-07-01' }
    );
    expect(result.date).toBe('2026-07-03');
  });
});

describe('hasMissingApprovalNum', () => {
  it('승인번호가 모두 있으면 false를 반환한다', () => {
    expect(hasMissingApprovalNum([{ approvalNum: '12345678' }])).toBe(false);
  });

  it('승인번호가 하나라도 비어 있으면 true를 반환한다', () => {
    expect(hasMissingApprovalNum([{ approvalNum: '12345678' }, { approvalNum: '' }])).toBe(true);
    expect(hasMissingApprovalNum([{ approvalNum: null }])).toBe(true);
  });

  it('OCR 노이즈만 있어 정규화 후 빈 문자열이 되면 true를 반환한다', () => {
    // X,Y,A,C 등 치환 규칙 없는 문자 → 제거 후 '' → missing
    expect(hasMissingApprovalNum([{ approvalNum: 'XYA' }])).toBe(true);
    expect(hasMissingApprovalNum([{ approvalNum: '---' }])).toBe(true);
  });

  it('빈 배열이면 false를 반환한다', () => {
    expect(hasMissingApprovalNum([])).toBe(false);
  });

  it('배열이 아니면 false를 반환한다', () => {
    expect(hasMissingApprovalNum(null)).toBe(false);
    expect(hasMissingApprovalNum('string')).toBe(false);
  });
});
