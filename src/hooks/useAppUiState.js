import { useCallback, useState } from 'react';

export default function useAppUiState() {
  const [tab, setTab] = useState('list');
  const [listPanel, setListPanel] = useState('input');
  const [detailId, setDetailId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showBudgetCalcModal, setShowBudgetCalcModal] = useState(false);
  const [showDuplicateReportModal, setShowDuplicateReportModal] = useState(false);
  const [showResetDanger, setShowResetDanger] = useState(false);
  const [tempBudget, setTempBudget] = useState(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [showBudgetDetails, setShowBudgetDetails] = useState(false);

  const closeBudgetModal = useCallback(() => setShowBudgetCalcModal(false), []);
  const closeManualModal = useCallback(() => setShowManualModal(false), []);
  const closeDuplicateReportModal = useCallback(() => setShowDuplicateReportModal(false), []);
  const closeDeleteConfirm = useCallback(() => setDeleteConfirmId(null), []);
  const openSettings = useCallback(() => setShowSettings(true), []);
  const closeSettings = useCallback(() => setShowSettings(false), []);
  const openManualModal = useCallback(() => setShowManualModal(true), []);
  const openBudgetModal = useCallback(() => setShowBudgetCalcModal(true), []);
  const openDuplicateReportModal = useCallback(() => setShowDuplicateReportModal(true), []);
  const toggleBudgetDetails = useCallback(() => setShowBudgetDetails(v => !v), []);
  const toggleResetDanger = useCallback(() => setShowResetDanger(v => !v), []);

  return {
    tab,
    setTab,
    listPanel,
    setListPanel,
    detailId,
    setDetailId,
    showSettings,
    setShowSettings,
    showManualModal,
    setShowManualModal,
    showBudgetCalcModal,
    setShowBudgetCalcModal,
    showDuplicateReportModal,
    setShowDuplicateReportModal,
    showResetDanger,
    setShowResetDanger,
    tempBudget,
    setTempBudget,
    deleteConfirmId,
    setDeleteConfirmId,
    showBudgetDetails,
    setShowBudgetDetails,
    closeBudgetModal,
    closeManualModal,
    closeDuplicateReportModal,
    closeDeleteConfirm,
    openSettings,
    closeSettings,
    openManualModal,
    openBudgetModal,
    openDuplicateReportModal,
    toggleBudgetDetails,
    toggleResetDanger,
  };
}
