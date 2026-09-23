import { describe, expect, it } from 'vitest';
import { addReceiptAmounts, parseReceiptAmount } from './receiptAmount';

describe('parseReceiptAmount', () => {
  it.each([['', '금액을 입력해 주세요.'], ['   ', '금액을 입력해 주세요.'], ['0', '금액은 0원보다 큰 값으로 입력해 주세요.'], ['-1', '금액은 쉼표를 제외한 양의 정수로 입력해 주세요.'], ['12원', '금액은 쉼표를 제외한 양의 정수로 입력해 주세요.'], ['1.5', '금액은 쉼표를 제외한 양의 정수로 입력해 주세요.'], ['1,00', '금액은 쉼표를 제외한 양의 정수로 입력해 주세요.']])('rejects %p', (input, error) => {
    expect(parseReceiptAmount(input)).toMatchObject({ ok: false, error });
  });

  it('accepts plain and comma-separated won amounts', () => {
    expect(parseReceiptAmount('12000')).toEqual({ ok: true, value: 12000 });
    expect(parseReceiptAmount('1,234,567')).toEqual({ ok: true, value: 1234567 });
  });

  it('rejects values outside JavaScript safe integer precision', () => {
    expect(parseReceiptAmount('9,007,199,254,740,992')).toMatchObject({ ok: false });
  });

  it('rejects a non-safe legacy amount before a derived total can be rounded', () => {
    expect(() => addReceiptAmounts(0, Number.MAX_SAFE_INTEGER + 1)).toThrow('안전한 정수 범위');
  });
});
