import { useEffect, useState } from 'react';
import Modal from '../layout/Modal';
import ConfirmModal from '../layout/ConfirmModal';
import DateRangePicker from '../calendar/DateRangePicker';
import useConfirmModal from '../../hooks/useConfirmModal';

function formatWithComma(value) {
  const num = parseInt(String(value).replace(/,/g, ''), 10);
  if (isNaN(num) || num === 0) return '';
  return num.toLocaleString('ko-KR');
}

function stripComma(value) {
  return String(value).replace(/,/g, '');
}

export default function BudgetModal({
  show,
  tripStartDate,
  tripEndDate,
  calculatedBudget,
  tempBudget,
  onClose,
  onDateRangeChange,
  onTempBudgetChange,
  onSaveBudget,
  onStartNewTrip,
}) {
  const [displayValue, setDisplayValue] = useState('');
  const { confirmModalProps, showConfirm } = useConfirmModal();

  // 날짜가 바뀌어 calculatedBudget이 달라지면 input 자동 갱신
  useEffect(() => {
    if (calculatedBudget > 0) {
      setDisplayValue(formatWithComma(calculatedBudget));
      onTempBudgetChange(calculatedBudget);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedBudget]);

  // 모달이 처음 열릴 때 초기값 세팅
  useEffect(() => {
    if (!show) return;
    const seed = calculatedBudget > 0 ? calculatedBudget : tempBudget;
    setDisplayValue(formatWithComma(seed));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  if (!show) return null;

  const start = new Date(tripStartDate);
  const end = new Date(tripEndDate);
  const dayCount = Math.ceil((end - start) / 86400000) + 1;
  const shouldShowAuto = dayCount > 0 && calculatedBudget > 0;
  const autoDescription = dayCount === 1
    ? '1일 출장 (마지막날만 적용)'
    : `${dayCount}일 출장: ${dayCount - 1}일 × 13만 + 마지막날 8만`;

  function handleInputChange(e) {
    const raw = stripComma(e.target.value);
    if (raw === '' || /^\d+$/.test(raw)) {
      setDisplayValue(raw === '' ? '' : Number(raw).toLocaleString('ko-KR'));
      onTempBudgetChange(raw);
    }
  }

  async function handleStartNewTrip() {
    const ok = await showConfirm({
      title: '새 출장 시작',
      message: `현재 기기의 영수증·이미지·이력이 모두 삭제되며 되돌릴 수 없습니다.\n\n시작일: ${tripStartDate}\n예산: ${(parseInt(tempBudget) || 0).toLocaleString()}원`,
      confirmLabel: '새로 시작',
      variant: 'danger',
    });
    if (ok) onStartNewTrip();
  }

  return (
    <>
    <Modal title="📅 예산 설정" onClose={onClose} compactTitle>
      <div className="space-y-2 p-1">
        <DateRangePicker
          startDate={tripStartDate}
          endDate={tripEndDate}
          onChange={onDateRangeChange}
        />

        {shouldShowAuto && (
          <div className="w-full bg-slate-900/80 rounded-2xl px-3 py-2 border border-slate-700">
            <p className="text-xs text-slate-400 font-bold leading-5">{autoDescription}</p>
            <span className="text-lg font-black text-blue-300">{calculatedBudget.toLocaleString('ko-KR')}원</span>
          </div>
        )}

        <div className="flex items-center gap-2 min-w-0">
          <label className="text-xs text-slate-400 font-black whitespace-nowrap shrink-0">예산 직접 입력 (원)</label>
          <input
            type="text"
            inputMode="numeric"
            value={displayValue}
            onChange={handleInputChange}
            className="min-w-0 flex-1 bg-slate-900 border-2 border-slate-700 rounded-xl px-3 py-2 text-base text-white font-black text-right"
          />
        </div>

        <div className="pt-1 border-t border-slate-700 space-y-2">
          <button onClick={onSaveBudget} className="w-full bg-blue-600 py-3 rounded-2xl text-base font-black">
            ✓ 예산만 변경 (저장)
          </button>

          <button
            type="button"
            onClick={handleStartNewTrip}
            className="w-full bg-red-900/30 border border-red-700/60 text-red-200 py-3 rounded-2xl text-sm font-black active:scale-[0.98] transition-transform"
          >
            🔄 새로 시작 (영수증 모두 삭제)
          </button>
        </div>
      </div>
    </Modal>
    <ConfirmModal {...confirmModalProps} />
    </>
  );
}
