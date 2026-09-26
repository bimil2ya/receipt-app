import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
// Utils & Hooks
import { getToday } from './utils/formatter';
import { readStorageItem, writeStorageItem } from './utils/storage';
import useReceipts from './hooks/useReceipts';
import useUploader from './hooks/useUploader';
import useReceiptBackup from './hooks/useReceiptBackup';
import useStatusPopover from './hooks/useStatusPopover';
import useTripClosingState from './hooks/useTripClosingState';
import useAppUpdatePrompt from './hooks/useAppUpdatePrompt';
import useReceiptListState from './hooks/useReceiptListState';
import useBudgetSummary from './hooks/useBudgetSummary';
import useBudgetControls from './hooks/useBudgetControls';
import useManualReceiptEntry from './hooks/useManualReceiptEntry';
import useReceiptEditing from './hooks/useReceiptEditing';
import useDriveUpload from './hooks/useDriveUpload';
import useDriveRestore from './hooks/useDriveRestore';
import useAppUiState from './hooks/useAppUiState';
import useToastMessage from './hooks/useToastMessage';
import useStoredTeamNames from './hooks/useStoredTeamNames';
import useOfficeReviews from './hooks/useOfficeReviews';
import useProgressShare from './hooks/useProgressShare';
import useConfirmModal from './hooks/useConfirmModal';
import ConfirmModal from './components/layout/ConfirmModal';

// Components
import LaunchSplash from './components/layout/LaunchSplash';
import UpdateBanner from './components/layout/UpdateBanner';
import Toast from './components/layout/Toast';
import AppHeader from './components/layout/AppHeader';
import useTeams from './hooks/useTeams';
import AppModals from './components/AppModals';
import AppContent from './components/AppContent';

// Constants
const ALL_CATS = ['숙박비', '식비', '기타', '유류비', '의료비등'];

export default function App() {
  const { receipts, loading, saveReceipts, deleteReceipt, resetDeviceData, saveStatus, getImageUrl } = useReceipts();

  // ── 탭 & 네비게이션
  const {
    tab,
    setTab,
    listPanel,
    setListPanel,
    detailId,
    setDetailId,
    showSettings,
    showManualModal,
    showBudgetCalcModal,
    showDuplicateReportModal,
    setShowResetDanger,
    tempBudget,
    setTempBudget,
    deleteConfirmId,
    setDeleteConfirmId,
    showBudgetDetails,
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
  } = useAppUiState();

  // ── 공지·알림
  const { message: toastMsg, showToast } = useToastMessage();
  const { message: alertMsg, showToast: showAlertToast } = useToastMessage(5000);
  const { confirmModalProps, showConfirm } = useConfirmModal();
  const { saveToJSON, loadFromFile } = useReceiptBackup({ receipts, getImageUrl, saveReceipts, showToast });

  // ── 헤더 상태 아이콘 말풍선 (저장/동기화 아이콘 탭 시 설명 노출)
  const { statusPopover, setStatusPopover, statusRef } = useStatusPopover();

  const { teams, refreshTeams } = useTeams();
  // ── 앱 설정 (localStorage 동기화)
  const {
    names,
    canonicalNames,
    selectedTeam,
    showWorkerPicker,
    closeWorkerPicker,
    handleNamesChange,
  } = useStoredTeamNames(teams);

  const [weeklyBudget, setWeeklyBudget] = useState(() => parseInt(readStorageItem('weekly_budget', '1000000')));

  // ── 모달 토글
  const { showLaunchSplash, showUpdateBanner, dismissUpdate, applyUpdate } = useAppUpdatePrompt();

  const {
    searchQuery,
    setSearchQuery,
    categoryFilter,
    setCategoryFilter,
    sortField,
    setSortField,
    sortDir,
    setSortDir,
    pinnedNewIds,
    setPinnedNewIds,
    localApprovalReport,
    receiptFilterOptions,
    sortedReceipts,
  } = useReceiptListState({ receipts, categories: ALL_CATS });

  // ── 수정 상태
  // tripStartDate가 단일 진실 공급원 — 헤더/내보내기/보고서 기준일로 모두 사용.
  // 마이그레이션: 기존 receipt_date가 있으면 그걸 초기값으로 사용.
  const [tripStartDate, setTripStartDate] = useState(() => readStorageItem('trip_start_date', '') || readStorageItem('receipt_date', '') || getToday());
  const [tripEndDate, setTripEndDate] = useState(() => readStorageItem('trip_end_date', '') || readStorageItem('trip_start_date', '') || getToday());
  const [reviewTargetId, setReviewTargetId] = useState('');
  const officeReviews = useOfficeReviews({ teamNames: canonicalNames, reportDate: tripStartDate });
  const calculatedBudget = useMemo(() => {
    const s = new Date(tripStartDate);
    const e = new Date(tripEndDate);
    const n = Math.ceil((e - s) / 86400000) + 1;
    if (!Number.isFinite(n) || n <= 0) return 0;
    return n <= 1 ? 80000 : (n - 1) * 130000 + 80000;
  }, [tripStartDate, tripEndDate]);
  const {
    editState,
    editErrors,
    amountRef: editAmountRef,
    setEditState,
    handleEdit,
    handleInlineEdit,
    handleUpdateRotation,
    handleViewImage,
  } = useReceiptEditing({ receipts, saveReceipts, setDetailId, setTab, assignment: { id: selectedTeam?.id, name: canonicalNames } });

  // ── SummaryTab ref — 출장마감 패널에서 카톡 공유를 직접 트리거하기 위해
  const summaryTabRef = useRef(null);
  const backupFileRef = useRef(null);
  const cameraRef = useRef(null);
  const receiptFileRef = useRef(null);

  // ── 출장 마감 전송 횟수 (출장 단위 localStorage 영속)
  const {
    kakaoSendCount,
    uploadSendCount,
    lastDuplicateReport,
    setLastDuplicateReport,
    resetTripClosingState,
    startKakaoOperation,
    finishKakaoOperation,
    storageKey: tripStorageKey,
    generation: tripGeneration,
    completedFingerprintKeys,
    commitUploadCompletion,
  } = useTripClosingState({ canonicalNames, selectedTeam, tripStartDate });
  const kakaoOperationRef = useRef(null);
  // 카톡 캡처 중 — Android GPU가 off-screen 엘리먼트를 제외하는 문제 방지용
  const [summaryCapturing, setSummaryCapturing] = useState(false);

  useEffect(() => {
    if (!showBudgetCalcModal) return;
    setTempBudget(calculatedBudget);
  }, [showBudgetCalcModal, calculatedBudget, setTempBudget]);

  // ── 파일 OCR 업로드 훅
  const { handleFiles, processing, procMsg } = useUploader({
    onUploadSuccess: async (added) => {
      // 저장보다 먼저 핀 등록 → receipts 상태에 영수증이 추가되는 그 렌더부터 즉시 최상단 표시
      setPinnedNewIds(prev => [...prev, ...added.map(r => r.id)]);
      await saveReceipts(added);
      showToast(`${added.length}건 추가 완료`);

      // 출장기간 밖 날짜 체크 — 해당 업로드 배치 내에서만 판단
      const outOfRangeCount = added.filter(r => {
        if (!r.date || !tripStartDate) return false;
        const d = r.date.slice(0, 10);
        const s = tripStartDate.slice(0, 10);
        const e = (tripEndDate || tripStartDate).slice(0, 10);
        return d < s || d > e;
      }).length;
      if (outOfRangeCount > 0) {
        const msg = outOfRangeCount === 1
          ? '날짜가 출장기간과 맞지 않습니다.\n필요하면 ✏️ 연필을 눌러 수정해주세요.'
          : `날짜 불일치 ${outOfRangeCount}건.\n필요하면 ✏️ 연필을 눌러 수정해주세요.`;
        showAlertToast(msg);
      }
    },
    onUploadError: ({ failedFiles, invalidReceipts = [], duplicateCount }) => {
      const parts = [];
      if (failedFiles.length > 0) {
        const failedSummary = failedFiles
          .map(f => `${f.name}${f.error ? ` (${f.error})` : ''}`)
          .join(', ');
        parts.push(`❌ 실패 ${failedFiles.length}건: ${failedSummary}`);
      }
      if (invalidReceipts.length > 0) {
        const invalidSummary = invalidReceipts
          .map(receipt => `${receipt.fileName} · ${receipt.storeName} (${receipt.error})`)
          .join(', ');
        parts.push(`⚠️ 금액 확인 필요 ${invalidReceipts.length}건: ${invalidSummary}`);
      }
      if (duplicateCount > 0) parts.push(`⚠️ 중복 제외 ${duplicateCount}건`);
      showToast(parts.join(' / '));
    },
  });
  const {
    manualReceipt,
    setManualReceipt,
    manualErrors,
    manualStoreRef,
    manualAmountRef,
    handleManualAdd,
  } = useManualReceiptEntry({ saveReceipts, setPinnedNewIds, showToast, onClose: closeManualModal, assignment: { id: selectedTeam?.id, name: canonicalNames }, relatedReviewReceiptId: reviewTargetId, onAdded: () => setReviewTargetId('') });
  const {
    driveUploading,
    uploadProgress,
    lastUploadFailures,
    submissionNeedsResend,
    uploadToDrive,
    retryFailedUploads,
  } = useDriveUpload({
    receipts,
    getImageUrl,
    canonicalNames,
    selectedTeam,
    tripStartDate,
    tripEndDate,
    localApprovalReport,
    setLastDuplicateReport,
    tripStorageKey,
    tripGeneration,
    completedFingerprintKeys,
    commitUploadCompletion,
    showToast,
    showConfirm,
  });
  const { lastSharedAt: progressSharedAt } = useProgressShare({
    receipts,
    teamNames: canonicalNames,
    tripStartDate,
    tripEndDate,
    submitted: receipts.length > 0 && !submissionNeedsResend,
    busy: driveUploading || loading,
  });
  const { restoreProgress, restoreFromDrive } = useDriveRestore({
    canonicalNames,
    tripStartDate,
    driveUploading,
    saveReceipts,
    showToast,
    showConfirm,
  });
  const { saveBudget, startNewWeek } = useBudgetControls({
    tempBudget,
    setShowBudgetCalcModal: closeBudgetModal,
    setWeeklyBudget,
    writeStorageItem,
    resetDeviceData,
    setTripStartDate,
    setTripEndDate,
    tripEndDate,
    showToast,
  });

  useEffect(() => {
    if (tab === 'list') setListPanel('input');
  }, [tab, setListPanel]);

  const duplicateReport = lastDuplicateReport || localApprovalReport;

  // ── 집계
  const { grandTotal, budgetTotal, fuelTotal, medTotal, budgetRatio, remainingBudget, amountOverflow } = useBudgetSummary({ receipts, weeklyBudget });

  const handleBudgetOpen = useCallback(() => {
    setTempBudget(calculatedBudget);
    setShowResetDanger(false);
    openBudgetModal();
  }, [calculatedBudget, openBudgetModal, setShowResetDanger, setTempBudget]);

  const handleSearchChange = useCallback((value) => {
    setSearchQuery(value);
    if (value && pinnedNewIds.length > 0) setPinnedNewIds([]);
  }, [pinnedNewIds.length, setPinnedNewIds, setSearchQuery]);

  const handleSearchClear = useCallback(() => setSearchQuery(''), [setSearchQuery]);

  const handleFilterChange = useCallback((value) => {
    setCategoryFilter(value);
    if (value !== 'all' && pinnedNewIds.length > 0) setPinnedNewIds([]);
  }, [pinnedNewIds.length, setCategoryFilter, setPinnedNewIds]);

  const handleSort = useCallback((field) => {
    setPinnedNewIds([]);
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  }, [setPinnedNewIds, setSortDir, setSortField, sortDir, sortField]);

  const handleWorkerSelect = useCallback((selected) => {
    handleNamesChange(selected);
    closeWorkerPicker();
  }, [closeWorkerPicker, handleNamesChange]);

  const handleDeleteConfirm = useCallback(() => {
    deleteReceipt(deleteConfirmId);
    setDeleteConfirmId(null);
  }, [deleteReceipt, deleteConfirmId, setDeleteConfirmId]);

  const handleDeleteRequest = useCallback((id) => {
    setDeleteConfirmId(id);
  }, [setDeleteConfirmId]);

  const handleTripRangeChange = useCallback((start, end) => {
    setTripStartDate(start);
    setTripEndDate(end);
    writeStorageItem('trip_start_date', start);
    writeStorageItem('trip_end_date', end);
  }, []);

  const handleStartNewTrip = useCallback(async () => {
    const budgetVal = Math.max(0, parseInt(tempBudget) || 0);
    if (budgetVal <= 0) { showToast('예산을 먼저 입력해 주세요.'); return; }
    await startNewWeek({ newDate: tripStartDate, newBudget: budgetVal });
    await resetTripClosingState();
    closeBudgetModal();
  }, [closeBudgetModal, resetTripClosingState, showToast, startNewWeek, tempBudget, tripStartDate]);

  const handleSetKakaoDone = useCallback(async () => {
    const operation = kakaoOperationRef.current;
    kakaoOperationRef.current = null;
    if (!operation) return;
    try { await finishKakaoOperation(operation); } catch { /* 오래된 출장 또는 저장 실패는 완료 횟수에 반영하지 않는다. */ }
  }, [finishKakaoOperation]);
  const handleSummaryCaptureStart = useCallback(() => {
    setSummaryCapturing(true);
    return startKakaoOperation()
      .then(operation => { kakaoOperationRef.current = operation; return operation; })
      .catch(error => { kakaoOperationRef.current = null; throw error; });
  }, [startKakaoOperation]);
  const handleSummaryCaptureEnd = useCallback(() => setSummaryCapturing(false), []);
  if (loading) return <div className="h-screen bg-slate-900 flex items-center justify-center text-slate-400">로드 중...</div>;

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100 overflow-hidden" style={{ lineHeight: 1.5 }}>
      <LaunchSplash show={showLaunchSplash} />
      <UpdateBanner
        show={showUpdateBanner && !showLaunchSplash}
        onDismiss={dismissUpdate}
        onApply={applyUpdate}
      />
      <Toast message={toastMsg} />
      <Toast message={alertMsg} bottomClass="bottom-40" variant="warning" />

      <AppHeader
        names={names}
        tripStartDate={tripStartDate}
        tab={tab}
        saveStatus={saveStatus}
        statusPopover={statusPopover}
        statusRef={statusRef}
        onStatusPopoverChange={setStatusPopover}
        onSettingsOpen={openSettings}
        onTabChange={setTab}
      />

      <AppContent
        tab={tab}
        showBudgetPanel={tab !== 'images'}
        weeklyBudget={weeklyBudget}
        budgetTotal={budgetTotal}
        budgetRatio={budgetRatio}
        remainingBudget={remainingBudget}
        fuelTotal={fuelTotal}
        medTotal={medTotal}
        amountOverflow={amountOverflow}
        showBudgetDetails={showBudgetDetails}
        onToggleBudgetDetails={toggleBudgetDetails}
        listPanel={listPanel}
        onBudget={handleBudgetOpen}
        onInput={() => setListPanel('input')}
        onManagement={() => setListPanel('management')}
        onCamera={() => { setReviewTargetId(''); cameraRef.current?.click(); }}
        onUpload={() => { setReviewTargetId(''); receiptFileRef.current?.click(); }}
        onManual={() => { setReviewTargetId(''); openManualModal(); }}
        kakaoSendCount={kakaoSendCount}
        uploadSendCount={uploadSendCount}
        driveUploading={driveUploading}
        uploadProgress={uploadProgress}
        lastUploadFailures={lastUploadFailures}
        submissionNeedsResend={submissionNeedsResend}
        duplicateReport={duplicateReport}
        onOpenDuplicateReport={openDuplicateReportModal}
        onKakaoShare={() => summaryTabRef.current?.triggerKakaoShare()}
        onDriveUpload={uploadToDrive}
        onRetryFailedUploads={retryFailedUploads}
        onSaveBackup={saveToJSON}
        onLoadBackup={() => backupFileRef.current?.click()}
        officeReviews={officeReviews}
        progressSharedAt={progressSharedAt}
        backupFileRef={backupFileRef}
        cameraRef={cameraRef}
        receiptFileRef={receiptFileRef}
        onBackupFile={loadFromFile}
        onReceiptFiles={async (files) => {
          const result = await handleFiles(files, receipts, { reportDate: tripStartDate, tripStartDate, tripEndDate, assignmentTeamId: selectedTeam?.id || null, assignmentTeamName: canonicalNames, relatedReviewReceiptId: reviewTargetId });
          setReviewTargetId('');
          return result;
        }}
        onCameraFiles={async (files) => {
          const result = await handleFiles(files, receipts, { reportDate: tripStartDate, tripStartDate, tripEndDate, assignmentTeamId: selectedTeam?.id || null, assignmentTeamName: canonicalNames, relatedReviewReceiptId: reviewTargetId });
          setReviewTargetId('');
          return result;
        }}
        processing={processing}
        procMsg={procMsg}
        searchQuery={searchQuery}
        categoryFilter={categoryFilter}
        filterOptions={receiptFilterOptions}
        visibleCount={sortedReceipts.length}
        totalCount={receipts.length}
        grandTotal={grandTotal}
        onSearchChange={handleSearchChange}
        onSearchClear={handleSearchClear}
        onFilterChange={handleFilterChange}
        sortField={sortField}
        sortDir={sortDir}
        onSort={handleSort}
        sortedReceipts={sortedReceipts}
        pinnedNewIds={pinnedNewIds}
        detailId={detailId}
        onEdit={handleEdit}
        onViewImage={handleViewImage}
        onDelete={handleDeleteRequest}
        onAddSupportingMaterial={(receiptId, mode = 'photo') => { setReviewTargetId(receiptId); if (mode === 'manual') openManualModal(); else receiptFileRef.current?.click(); }}
        receipts={receipts}
        getImageUrl={getImageUrl}
        onUpdateRotation={handleUpdateRotation}
        onSelectChange={setDetailId}
        summaryTabRef={summaryTabRef}
        names={names}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        summaryCapturing={summaryCapturing}
        onShareComplete={handleSetKakaoDone}
        onCaptureStart={handleSummaryCaptureStart}
        onCaptureEnd={handleSummaryCaptureEnd}
        onError={showToast}
      />

      <AppModals
        summaryCapturing={summaryCapturing}
        showSettings={showSettings}
        onCloseSettings={closeSettings}
        showToast={showToast}
        names={names}
        teams={teams}
        onTeamsUpdated={refreshTeams}
        onNamesChange={handleNamesChange}
        onResetDeviceData={resetDeviceData}
        saveStatus={saveStatus}
        onRestoreFromDrive={restoreFromDrive}
        restoreProgress={restoreProgress}
        showWorkerPicker={showWorkerPicker}
        currentNames={names}
        onWorkerPick={handleWorkerSelect}
        onWorkerPickerTeamsUpdated={refreshTeams}
        onCloseWorkerPicker={closeWorkerPicker}
        isOnboarding={true}
        editState={editState}
        editErrors={editErrors}
        editAmountRef={editAmountRef}
        categories={ALL_CATS}
        onEditChange={setEditState}
        onEditClose={() => setEditState({ id: null, field: null, value: '' })}
        onEditSubmit={handleInlineEdit}
        deleteConfirmId={deleteConfirmId}
        onDeleteCancel={closeDeleteConfirm}
        onDeleteConfirm={handleDeleteConfirm}
        showDuplicateReportModal={showDuplicateReportModal}
        duplicateReport={duplicateReport}
        onCloseDuplicateReport={closeDuplicateReportModal}
        showManualModal={showManualModal}
        manualReceipt={manualReceipt}
        manualErrors={manualErrors}
        manualStoreRef={manualStoreRef}
        manualAmountRef={manualAmountRef}
        onManualChange={setManualReceipt}
        onManualClose={() => { setReviewTargetId(''); closeManualModal(); }}
        onManualSubmit={handleManualAdd}
        showBudgetCalcModal={showBudgetCalcModal}
        tripStartDate={tripStartDate}
        tripEndDate={tripEndDate}
        calculatedBudget={calculatedBudget}
        tempBudget={tempBudget}
        onCloseBudgetModal={closeBudgetModal}
        onTripRangeChange={handleTripRangeChange}
        onTempBudgetChange={setTempBudget}
        onSaveBudget={saveBudget}
        onStartNewTrip={handleStartNewTrip}
      />
      <ConfirmModal {...confirmModalProps} />
    </div>
  );
}
