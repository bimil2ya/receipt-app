const COMMA_AMOUNT = /^(?:0|[1-9]\d{0,2}(?:,\d{3})+)$/;
const PLAIN_AMOUNT = /^(?:0|[1-9]\d*)$/;

export class ReceiptAmountOverflowError extends Error {
  constructor() {
    super('합계가 정확하게 표현할 수 있는 안전한 정수 범위를 넘었습니다.');
    this.name = 'ReceiptAmountOverflowError';
  }
}

export function addReceiptAmounts(total, amount) {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(amount)) throw new ReceiptAmountOverflowError();
  const next = total + amount;
  if (!Number.isSafeInteger(next)) throw new ReceiptAmountOverflowError();
  return next;
}

export function sumReceiptAmounts(receipts) {
  return (Array.isArray(receipts) ? receipts : []).reduce(
    (total, receipt) => addReceiptAmounts(total, Number(receipt?.totalAmount || 0)),
    0,
  );
}

/**
 * Parse a newly entered receipt amount in Korean won.
 * Stored historical values are intentionally not changed by this function.
 */
export function parseReceiptAmount(value) {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return { ok: false, error: '금액은 안전한 정수 범위 안에서 입력해 주세요.' };
    if (value <= 0) return { ok: false, error: '금액은 0원보다 큰 값으로 입력해 주세요.' };
    return { ok: true, value };
  }

  const text = String(value ?? '').trim();
  if (!text) return { ok: false, error: '금액을 입력해 주세요.' };
  if (!COMMA_AMOUNT.test(text) && !PLAIN_AMOUNT.test(text)) {
    return { ok: false, error: '금액은 쉼표를 제외한 양의 정수로 입력해 주세요.' };
  }

  const amount = Number(text.replaceAll(',', ''));
  if (!Number.isSafeInteger(amount)) return { ok: false, error: '금액은 안전한 정수 범위 안에서 입력해 주세요.' };
  if (amount <= 0) return { ok: false, error: '금액은 0원보다 큰 값으로 입력해 주세요.' };
  return { ok: true, value: amount };
}
