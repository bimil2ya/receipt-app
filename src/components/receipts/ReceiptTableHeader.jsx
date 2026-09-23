const COLUMNS = [
  ['date', '날짜', 'w-12 text-center'],
  ['storeName', '사용처', 'flex-1 ml-1'],
  ['category', '용도', 'w-12 text-center'],
  ['totalAmount', '금액', 'w-16 text-right'],
];

export default function ReceiptTableHeader({ sortField, sortDir, onSort }) {
  return (
    <div className="bg-slate-900/50 px-4 flex text-sm font-black text-slate-300 gap-1.5 items-stretch">
      {COLUMNS.map(([field, label, className]) => (
        <button
          key={field}
          type="button"
          onClick={() => onSort(field)}
          className={`${className} flex items-center justify-center gap-0.5 py-3 min-h-[44px] active:bg-slate-800 transition-colors ${sortField === field ? 'text-blue-400' : ''}`}
        >
          {label} {sortField === field && (sortDir === 'asc' ? '↑' : '↓')}
        </button>
      ))}
    </div>
  );
}
