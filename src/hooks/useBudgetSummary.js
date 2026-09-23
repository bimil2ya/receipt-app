import { useMemo } from 'react';
import { ReceiptAmountOverflowError, sumReceiptAmounts } from '../utils/receiptAmount';

const NON_BUDGET_CATEGORIES = ['유류비', '의료비등'];

export function calculateBudgetSummary(receipts) {
  try {
    const list = Array.isArray(receipts) ? receipts : [];
    return {
      amountOverflow: false,
      grandTotal: sumReceiptAmounts(list),
      budgetTotal: sumReceiptAmounts(list.filter(receipt => !NON_BUDGET_CATEGORIES.includes(receipt.category))),
      fuelTotal: sumReceiptAmounts(list.filter(receipt => receipt.category === '유류비')),
      medTotal: sumReceiptAmounts(list.filter(receipt => receipt.category === '의료비등')),
    };
  } catch (error) {
    if (!(error instanceof ReceiptAmountOverflowError)) throw error;
    return { amountOverflow: true, grandTotal: null, budgetTotal: null, fuelTotal: null, medTotal: null };
  }
}

export default function useBudgetSummary({ receipts, weeklyBudget }) {
  const totals = useMemo(() => calculateBudgetSummary(receipts), [receipts]);
  const { amountOverflow, grandTotal, budgetTotal, fuelTotal, medTotal } = totals;
  const budgetRatio = useMemo(() => amountOverflow ? null : (budgetTotal / weeklyBudget) * 100, [amountOverflow, budgetTotal, weeklyBudget]);
  const remainingBudget = amountOverflow ? null : weeklyBudget - budgetTotal;

  return {
    grandTotal,
    budgetTotal,
    fuelTotal,
    medTotal,
    amountOverflow,
    budgetRatio,
    remainingBudget,
  };
}
