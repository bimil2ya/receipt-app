import { formatCurrency } from '../../utils/formatter';
import BudgetStats from './BudgetStats';

export default function BudgetPanel({
  weeklyBudget,
  budgetTotal,
  budgetRatio,
  remainingBudget,
  fuelTotal,
  medTotal,
  showDetails,
  onToggleDetails,
}) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-2xl p-3.5 shadow-md">
      <div className="flex justify-between items-end mb-1.5 gap-2">
        <div className="flex flex-col min-w-0">
          <span className="text-base text-slate-200 font-black whitespace-nowrap">남은 예산</span>
          <span className="text-xs text-blue-300 font-bold whitespace-nowrap">유류비·의료비등 제외</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xl font-black whitespace-nowrap">{formatCurrency(remainingBudget)}</span>
          <span className="text-xs text-slate-400 whitespace-nowrap">/ {formatCurrency(weeklyBudget)}</span>
        </div>
      </div>
      <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2.5">
        <div className="flex flex-col">
          <span className="text-sm font-black text-slate-300">총예산</span>
          <span className="text-base font-black text-slate-100">{formatCurrency(weeklyBudget)}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-sm font-black text-slate-300">사용액</span>
          <span className="text-base font-black text-blue-300">{formatCurrency(budgetTotal)}</span>
        </div>
        <button
          type="button"
          onClick={onToggleDetails}
          className="ml-1 mt-0.5 rounded-full bg-slate-950/80 border border-slate-600 px-2 py-1 shadow-lg"
          aria-label={showDetails ? '상세 예산 접기' : '상세 예산 펼치기'}
        >
          <span className="sr-only">{showDetails ? '접기' : '펼치기'}</span>
          <span
            className={`block h-0 w-0 border-y-[6px] border-y-transparent border-l-[9px] border-l-slate-100 transition-transform ${
              showDetails ? 'rotate-90' : 'rotate-0'
            }`}
          />
        </button>
      </div>
      {showDetails && (
        <BudgetStats
          weeklyBudget={weeklyBudget}
          budgetTotal={budgetTotal}
          budgetRatio={budgetRatio}
          fuelTotal={fuelTotal}
          medTotal={medTotal}
        />
      )}
    </div>
  );
}
