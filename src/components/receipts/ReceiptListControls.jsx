import { formatCurrency } from '../../utils/formatter';

export default function ReceiptListControls({
  searchQuery,
  filterValue,
  filterOptions,
  visibleCount,
  totalCount,
  grandTotal,
  onSearchChange,
  onSearchClear,
  onFilterChange,
}) {
  if (totalCount <= 0) return null;

  return (
    <>
      <div className="flex gap-2 items-center">
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="🔎 사용처/승인번호 검색"
          className="flex-1 h-11 bg-slate-800 border border-slate-700 rounded-xl px-3 text-white font-bold text-sm"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={onSearchClear}
            className="h-11 px-3 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-black text-sm active:scale-95"
          >
            지우기
          </button>
        )}
      </div>
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {filterOptions.map(([value, label]) => {
          const active = filterValue === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onFilterChange(value)}
              className={`shrink-0 px-3 py-2 rounded-full border text-xs font-black transition-colors ${active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'}`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className="text-center text-sm text-slate-400 px-1 font-bold">
        {visibleCount === totalCount
          ? `${totalCount}건 • ${formatCurrency(grandTotal)}`
          : `${visibleCount}건 표시 / 전체 ${totalCount}건`}
      </div>
    </>
  );
}
