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

  const categoryOptions = filterOptions.filter(([, , meta]) => meta?.group !== 'check');
  const checkOptions = filterOptions.filter(([, , meta]) => meta?.group === 'check');
  // 승인번호 없음·중복 후보·확인 필요 중 하나라도 있으면 드롭다운을 노란 테두리로 알린다.
  const needsAttention = checkOptions.some(([, , meta]) => meta.count > 0);
  const filtered = filterValue !== 'all';
  const selectClass = [
    'min-w-0 flex-[2] h-11 rounded-xl border px-2 text-sm font-black',
    filtered ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-100',
    needsAttention ? 'border-amber-400 ring-1 ring-amber-400/70' : filtered ? 'border-blue-500' : 'border-slate-700',
  ].join(' ');
  const renderOption = ([value, label]) => <option key={value} value={value}>{label}</option>;

  return (
    <>
      <div className="flex gap-2 items-center">
        <div className="relative min-w-0 flex-[3]">
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="🔎 사용처/승인번호"
            aria-label="사용처 또는 승인번호 검색"
            className={`w-full h-11 bg-slate-800 border border-slate-700 rounded-xl pl-3 text-white font-bold text-sm ${searchQuery ? 'pr-10' : 'pr-3'}`}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={onSearchClear}
              aria-label="검색어 지우기"
              className="absolute right-1 top-1/2 -translate-y-1/2 h-9 w-9 rounded-lg text-slate-300 font-black text-base active:scale-95"
            >
              ✕
            </button>
          )}
        </div>
        <select
          value={filterValue}
          onChange={e => onFilterChange(e.target.value)}
          aria-label="영수증 거르기"
          className={selectClass}
        >
          <optgroup label="용도">{categoryOptions.map(renderOption)}</optgroup>
          {checkOptions.length > 0 && <optgroup label="확인할 항목">{checkOptions.map(renderOption)}</optgroup>}
        </select>
      </div>
      <div className="text-center text-sm text-slate-400 px-1 font-bold">
        {grandTotal === null
          ? '집계 금액이 안전한 정수 범위를 넘었습니다. 정확한 금액을 표시하지 않았습니다.'
          : visibleCount === totalCount
          ? `${totalCount}건 • ${formatCurrency(grandTotal)}`
          : `${visibleCount}건 표시 / 전체 ${totalCount}건`}
      </div>
    </>
  );
}
