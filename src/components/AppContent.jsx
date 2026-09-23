import BudgetPanel from './budget/BudgetPanel';
import ImagesTab from './images/ImagesTab';
import ReceiptWorkspace from './list/ReceiptWorkspace';
import SummaryTab from './summary/SummaryTab';

export default function AppContent({
  tab,
  showBudgetPanel,
  weeklyBudget,
  budgetTotal,
  budgetRatio,
  remainingBudget,
  fuelTotal,
  medTotal,
  amountOverflow,
  showBudgetDetails,
  onToggleBudgetDetails,
  listPanel,
  onBudget,
  onInput,
  onManagement,
  onCamera,
  onUpload,
  onManual,
  kakaoSendCount,
  uploadSendCount,
  driveUploading,
  uploadProgress,
  lastUploadFailures,
  submissionNeedsResend,
  duplicateReport,
  onOpenDuplicateReport,
  onKakaoShare,
  onDriveUpload,
  onRetryFailedUploads,
  onSaveBackup,
  onLoadBackup,
  officeReviews,
  backupFileRef,
  cameraRef,
  receiptFileRef,
  onBackupFile,
  onReceiptFiles,
  onCameraFiles,
  processing,
  procMsg,
  searchQuery,
  categoryFilter,
  filterOptions,
  visibleCount,
  totalCount,
  grandTotal,
  onSearchChange,
  onSearchClear,
  onFilterChange,
  sortField,
  sortDir,
  onSort,
  sortedReceipts,
  pinnedNewIds,
  detailId,
  onEdit,
  onViewImage,
  onDelete,
  onAddSupportingMaterial,
  receipts,
  getImageUrl,
  onUpdateRotation,
  onSelectChange,
  summaryTabRef,
  names,
  tripStartDate,
  tripEndDate,
  summaryCapturing,
  onShareComplete,
  onCaptureStart,
  onCaptureEnd,
  onError,
}) {
  return (
    <main className="flex-1 overflow-y-auto pb-8">
      <div className="max-w-2xl mx-auto px-4 py-1.5 space-y-1.5">
        {showBudgetPanel && (
          <BudgetPanel
            weeklyBudget={weeklyBudget}
            budgetTotal={budgetTotal}
            budgetRatio={budgetRatio}
            remainingBudget={remainingBudget}
            fuelTotal={fuelTotal}
            medTotal={medTotal}
            amountOverflow={amountOverflow}
            showDetails={showBudgetDetails}
            onToggleDetails={onToggleBudgetDetails}
          />
        )}

        {tab === 'list' && (
          <ReceiptWorkspace
            listPanel={listPanel}
            onBudget={onBudget}
            onInput={onInput}
            onManagement={onManagement}
            onCamera={onCamera}
            onUpload={onUpload}
            onManual={onManual}
            kakaoSendCount={kakaoSendCount}
            uploadSendCount={uploadSendCount}
            driveUploading={driveUploading}
            uploadProgress={uploadProgress}
            lastUploadFailures={lastUploadFailures}
            submissionNeedsResend={submissionNeedsResend}
            duplicateReport={duplicateReport}
            onOpenDuplicateReport={onOpenDuplicateReport}
            onKakaoShare={onKakaoShare}
            onDriveUpload={onDriveUpload}
            onRetryFailedUploads={onRetryFailedUploads}
            onSaveBackup={onSaveBackup}
            onLoadBackup={onLoadBackup}
            officeReviews={officeReviews}
            backupFileRef={backupFileRef}
            cameraRef={cameraRef}
            receiptFileRef={receiptFileRef}
            onBackupFile={onBackupFile}
            onReceiptFiles={onReceiptFiles}
            onCameraFiles={onCameraFiles}
            processing={processing}
            procMsg={procMsg}
            searchQuery={searchQuery}
            categoryFilter={categoryFilter}
            filterOptions={filterOptions}
            visibleCount={visibleCount}
            totalCount={totalCount}
            grandTotal={grandTotal}
            onSearchChange={onSearchChange}
            onSearchClear={onSearchClear}
            onFilterChange={onFilterChange}
            sortField={sortField}
            sortDir={sortDir}
            onSort={onSort}
            sortedReceipts={sortedReceipts}
            pinnedNewIds={pinnedNewIds}
            detailId={detailId}
            tripStartDate={tripStartDate}
            tripEndDate={tripEndDate}
            onEdit={onEdit}
            onViewImage={onViewImage}
            onDelete={onDelete}
            onAddSupportingMaterial={onAddSupportingMaterial}
          />
        )}

        {tab === 'images' && (
          <ImagesTab
            receipts={receipts}
            getImageUrl={getImageUrl}
            onUpdateRotation={onUpdateRotation}
            selectedId={detailId}
            onSelectChange={onSelectChange}
            onError={onError}
          />
        )}

        <div className={
          tab === 'summary' ? '' :
          summaryCapturing ? 'fixed top-0 left-0 w-screen opacity-0 z-30 pointer-events-none' :
          'fixed left-[-200vw] top-0 w-screen pointer-events-none'
        }>
          <SummaryTab
            ref={summaryTabRef}
            receipts={receipts}
            names={names}
            reportDate={tripStartDate}
            visible={tab === 'summary'}
            onShareComplete={onShareComplete}
            onCaptureStart={onCaptureStart}
            onCaptureEnd={onCaptureEnd}
            onError={onError}
          />
        </div>
      </div>
    </main>
  );
}
