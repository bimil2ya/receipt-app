import Modal from '../layout/Modal';
import DateRangePicker from '../calendar/DateRangePicker';

export default function BudgetModal({
  show,
  tripStartDate,
  tripEndDate,
  calculatedBudget,
  tempBudget,
  showResetDanger,
  onClose,
  onDateRangeChange,
  onTempBudgetChange,
  onSaveBudget,
  onToggleResetDanger,
  onStartNewTrip,
}) {
  if (!show) return null;

  const start = new Date(tripStartDate);
  const end = new Date(tripEndDate);
  const dayCount = Math.ceil((end - start) / 86400000) + 1;
  const shouldShowAuto = dayCount > 0 && calculatedBudget > 0;
  const autoDescription = dayCount === 1
    ? '1일 출장 (마지막날만 적용)'
    : `${dayCount}일 출장: ${dayCount - 1}일 × 13만 + 마지막날 8만`;

  return (
    <Modal title="📅 예산 설정" onClose={onClose}>
      <div className="space-y-4 p-3">
        <DateRangePicker
          startDate={tripStartDate}
          endDate={tripEndDate}
          onChange={onDateRangeChange}
        />

        {shouldShowAuto && (
          <button
            type="button"
            onClick={() => onTempBudgetChange(calculatedBudget)}
            className="w-full bg-slate-900/80 rounded-2xl p-3.5 border border-slate-700 text-left active:scale-[0.98] transition-transform"
          >
            <p className="text-xs text-slate-400 font-bold mb-1.5 leading-5">{autoDescription}</p>
            <div className="flex items-center justify-between">
              <span className="text-xl font-black text-blue-300">{calculatedBudget.toLocaleString('ko-KR')}원</span>
              <span className="text-[11px] text-slate-500 font-black">탭하여 적용 ↓</span>
            </div>
          </button>
        )}

        <div>
          <label className="text-xs text-slate-400 font-black mb-1.5 block">예산 직접 입력 (원)</label>
          <input
            type="number"
            value={tempBudget}
            onChange={e => onTempBudgetChange(e.target.value)}
            className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-3 text-xl text-white font-black text-right"
          />
        </div>

        <div className="pt-3 border-t border-slate-800 space-y-2.5">
          <button onClick={onSaveBudget} className="w-full bg-blue-600 py-3.5 rounded-2xl text-lg font-black">
            ✓ 저장 (예산만 변경)
          </button>

          <div className="border border-red-900/40 rounded-2xl bg-red-900/10 overflow-hidden">
            <button
              onClick={onToggleResetDanger}
              className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left"
            >
              <p className="text-xs text-red-300 font-black">⚠️ 새 출장 시작 (영수증 모두 삭제)</p>
              <span className="text-red-300/70 text-[11px] font-black shrink-0">
                {showResetDanger ? '접기' : '펼치기 ▾'}
              </span>
            </button>
            {showResetDanger && (
              <div className="px-4 pb-3 space-y-2.5">
                <p className="text-[11px] text-red-200/80 font-bold leading-5">
                  위에서 정한 시작일 <span className="text-red-100">{tripStartDate}</span>,
                  예산 <span className="text-red-100">{(parseInt(tempBudget) || 0).toLocaleString()}원</span>으로 새 출장을 시작합니다.
                  현재 기기의 영수증·이미지·이력·보류 전송이 모두 삭제되며 되돌릴 수 없습니다.
                </p>
                <button
                  onClick={onStartNewTrip}
                  className="w-full bg-red-900/40 border border-red-700 text-red-100 py-3.5 rounded-2xl text-sm font-black active:scale-95 transition-transform"
                >
                  🔄 새로 시작 (영수증 모두 삭제)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
