import { useCallback } from 'react';

export function normalizeBudgetValue(value) {
  return Math.max(0, parseInt(String(value).replace(/,/g, '')) || 0);
}

export default function useBudgetControls({
  tempBudget,
  setShowBudgetCalcModal,
  setWeeklyBudget,
  writeStorageItem,
  resetDeviceData,
  setTripStartDate,
  setTripEndDate,
  tripEndDate,
  showToast,
}) {
  const saveBudget = useCallback(() => {
    const val = normalizeBudgetValue(tempBudget);
    if (val <= 0) {
      showToast('예산액을 임의로 입력하거나 계산된 예산액을 적용해 주세요');
      return;
    }
    setWeeklyBudget(val);
    writeStorageItem('weekly_budget', String(val));
    setShowBudgetCalcModal(false);
  }, [setShowBudgetCalcModal, setWeeklyBudget, showToast, tempBudget, writeStorageItem]);

  const startNewWeek = useCallback(async ({ newDate, newBudget }) => {
    try {
      await resetDeviceData();
      if (newDate) {
        setTripStartDate(newDate);
        writeStorageItem('trip_start_date', newDate);
        if (tripEndDate < newDate) {
          setTripEndDate(newDate);
          writeStorageItem('trip_end_date', newDate);
        }
      }
      const budgetVal = normalizeBudgetValue(newBudget);
      setWeeklyBudget(budgetVal);
      writeStorageItem('weekly_budget', String(budgetVal));
      showToast('🔄 새 주 시작 완료');
    } catch (error) {
      if (import.meta.env.DEV) console.error('startNewWeek failed:', error);
      showToast('서버 삭제 실패 — 앱을 껐다 켜면 데이터가 다시 나타날 수 있습니다. 네트워크 확인 후 재시도해 주세요.');
    }
  }, [resetDeviceData, setTripEndDate, setTripStartDate, setWeeklyBudget, showToast, tripEndDate, writeStorageItem]);

  return { saveBudget, startNewWeek };
}
