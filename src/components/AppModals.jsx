import SettingsModal from './settings/SettingsModal';
import WorkerPickerModal from './onboarding/WorkerPickerModal';
import SummaryCaptureOverlay from './summary/SummaryCaptureOverlay';
import ReceiptEditModal from './receipts/ReceiptEditModal';
import DeleteConfirmModal from './receipts/DeleteConfirmModal';
import DuplicateReportModal from './receipts/DuplicateReportModal';
import ManualReceiptModal from './receipts/ManualReceiptModal';
import BudgetModal from './budget/BudgetModal';

export default function AppModals({
  summaryCapturing,
  showSettings,
  onCloseSettings,
  showToast,
  names,
  teams,
  onTeamsUpdated,
  onNamesChange,
  onResetDeviceData,
  saveStatus,
  onRestoreFromDrive,
  restoreProgress,
  showWorkerPicker,
  currentNames,
  onWorkerPick,
  onWorkerPickerTeamsUpdated,
  onCloseWorkerPicker,
  isOnboarding,
  editState,
  editErrors,
  editAmountRef,
  categories,
  onEditChange,
  onEditClose,
  onEditSubmit,
  deleteConfirmId,
  onDeleteCancel,
  onDeleteConfirm,
  showDuplicateReportModal,
  duplicateReport,
  onCloseDuplicateReport,
  showManualModal,
  manualReceipt,
  manualErrors,
  manualStoreRef,
  manualAmountRef,
  onManualChange,
  onManualClose,
  onManualSubmit,
  showBudgetCalcModal,
  tripStartDate,
  tripEndDate,
  calculatedBudget,
  tempBudget,
  onCloseBudgetModal,
  onTripRangeChange,
  onTempBudgetChange,
  onSaveBudget,
  onStartNewTrip,
}) {
  return (
    <>
      <SummaryCaptureOverlay show={summaryCapturing} />

      <SettingsModal
        show={showSettings}
        onClose={onCloseSettings}
        showToast={showToast}
        names={names}
        teams={teams}
        onTeamsUpdated={onTeamsUpdated}
        onNamesChange={onNamesChange}
        onResetDeviceData={onResetDeviceData}
        saveStatus={saveStatus}
        onRestoreFromDrive={onRestoreFromDrive}
        restoreProgress={restoreProgress}
      />

      <WorkerPickerModal
        show={showWorkerPicker}
        currentNames={currentNames}
        teams={teams}
        onSelect={onWorkerPick}
        onTeamsUpdated={onWorkerPickerTeamsUpdated}
        onClose={onCloseWorkerPicker}
        isOnboarding={isOnboarding}
      />

      <ReceiptEditModal
        editState={editState}
        errors={editErrors}
        amountRef={editAmountRef}
        categories={categories}
        onChange={onEditChange}
        onClose={onEditClose}
        onSubmit={onEditSubmit}
      />

      <DeleteConfirmModal
        show={Boolean(deleteConfirmId)}
        onCancel={onDeleteCancel}
        onConfirm={onDeleteConfirm}
      />

      <DuplicateReportModal
        show={showDuplicateReportModal}
        report={duplicateReport}
        onClose={onCloseDuplicateReport}
      />

      <ManualReceiptModal
        show={showManualModal}
        value={manualReceipt}
        errors={manualErrors}
        categories={categories}
        initialFocusRef={manualStoreRef}
        amountRef={manualAmountRef}
        onChange={onManualChange}
        onClose={onManualClose}
        onSubmit={onManualSubmit}
      />

      <BudgetModal
        show={showBudgetCalcModal}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        calculatedBudget={calculatedBudget}
        tempBudget={tempBudget}
        onClose={onCloseBudgetModal}
        onDateRangeChange={onTripRangeChange}
        onTempBudgetChange={onTempBudgetChange}
        onSaveBudget={onSaveBudget}
        onStartNewTrip={onStartNewTrip}
      />
    </>
  );
}
