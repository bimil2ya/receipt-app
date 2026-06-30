import { useMemo } from 'react';

const NON_BUDGET_CATEGORIES = ['유류비', '의료비등'];

export default function useBudgetSummary({ receipts, weeklyBudget }) {
  const grandTotal = useMemo(() => (receipts || []).reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0), [receipts]);
  const budgetTotal = useMemo(() => (
    receipts || []
  ).filter(receipt => !NON_BUDGET_CATEGORIES.includes(receipt.category)).reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0), [receipts]);
  const fuelTotal = useMemo(() => (
    receipts || []
  ).filter(receipt => receipt.category === '유류비').reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0), [receipts]);
  const medTotal = useMemo(() => (
    receipts || []
  ).filter(receipt => receipt.category === '의료비등').reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0), [receipts]);
  const budgetRatio = useMemo(() => (budgetTotal / weeklyBudget) * 100, [budgetTotal, weeklyBudget]);
  const remainingBudget = Math.max(0, weeklyBudget - budgetTotal);

  return {
    grandTotal,
    budgetTotal,
    fuelTotal,
    medTotal,
    budgetRatio,
    remainingBudget,
  };
}
