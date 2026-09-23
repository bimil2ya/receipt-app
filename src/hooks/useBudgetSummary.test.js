import { describe, expect, it } from 'vitest';
import { calculateBudgetSummary } from './useBudgetSummary';

describe('calculateBudgetSummary', () => {
  it('does not return rounded totals when individually valid receipt amounts overflow together', () => {
    const summary = calculateBudgetSummary([
      { totalAmount: Number.MAX_SAFE_INTEGER, category: '식비' },
      { totalAmount: 1, category: '숙박비' },
    ]);

    expect(summary).toEqual({
      amountOverflow: true,
      grandTotal: null,
      budgetTotal: null,
      fuelTotal: null,
      medTotal: null,
    });
  });
});
