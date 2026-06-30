import { formatCurrency } from '../../utils/formatter';

export default function BudgetStats({ weeklyBudget, budgetTotal, budgetRatio, fuelTotal, medTotal }) {
  return (
    <div className="flex flex-wrap items-baseline mt-3 text-sm font-bold gap-x-2 gap-y-1">
      <span className="text-slate-400 whitespace-nowrap">
        총예산 {Math.round(weeklyBudget / 10000)}만원 중 {(budgetTotal / 10000).toFixed(1)}만원 사용({Math.round(budgetRatio)}%)
      </span>
      <span className="text-emerald-400 whitespace-nowrap shrink-0">
        유류비 {formatCurrency(fuelTotal)}
      </span>
      {medTotal > 0 && (
        <span className="text-pink-300 whitespace-nowrap shrink-0">
          의료비등 {formatCurrency(medTotal)}
        </span>
      )}
    </div>
  );
}
