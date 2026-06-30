import TripWorkflowTabs from '../trip/TripWorkflowTabs';
import ReceiptInputActions from '../receipts/ReceiptInputActions';
import TripClosePanel from '../trip/TripClosePanel';
import ReceiptHiddenInputs from '../receipts/ReceiptHiddenInputs';
import ProcessingBanner from '../receipts/ProcessingBanner';
import ReceiptListControls from '../receipts/ReceiptListControls';
import ReceiptTableHeader from '../receipts/ReceiptTableHeader';
import ReceiptRow from '../receipts/ReceiptRow';
import DuplicateReportNotice from '../receipts/DuplicateReportNotice';

export default function ReceiptWorkspace({
  listPanel,
  onBudget,
  onInput,
  onManagement,
  onCamera,
  onUpload,
  onManual,
  kakaoDone,
  uploadDone,
  driveUploading,
  uploadProgress,
  lastUploadFailures,
  duplicateReport,
  onOpenDuplicateReport,
  onKakaoShare,
  onDriveUpload,
  onRetryFailedUploads,
  onSaveBackup,
  onLoadBackup,
  backupFileRef,
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
  detailId,
  onEdit,
  onViewImage,
  onDelete,
}) {
  return (
    <div className="space-y-3">
      <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-3 space-y-2 shadow-lg">
        <TripWorkflowTabs
          activePanel={listPanel}
          onBudget={onBudget}
          onInput={onInput}
          onManagement={onManagement}
        />
        {listPanel === 'input' ? (
          <ReceiptInputActions
            onCamera={onCamera}
            onUpload={onUpload}
            onManual={onManual}
          />
        ) : (
          <TripClosePanel
            kakaoDone={kakaoDone}
            uploadDone={uploadDone}
            driveUploading={driveUploading}
            uploadProgress={uploadProgress}
            lastUploadFailures={lastUploadFailures}
            duplicateReportSlot={<DuplicateReportNotice report={duplicateReport} onOpen={onOpenDuplicateReport} />}
            onKakaoShare={onKakaoShare}
            onUpload={onDriveUpload}
            onRetryFailed={onRetryFailedUploads}
            onSaveBackup={onSaveBackup}
            onLoadBackup={onLoadBackup}
          />
        )}
        <ReceiptHiddenInputs
          backupFileRef={backupFileRef}
          onBackupFile={onBackupFile}
          onReceiptFiles={onReceiptFiles}
          onCameraFiles={onCameraFiles}
        />
      </div>

      <ProcessingBanner show={processing} message={procMsg} />

      <ReceiptListControls
        searchQuery={searchQuery}
        filterValue={categoryFilter}
        filterOptions={filterOptions}
        visibleCount={visibleCount}
        totalCount={totalCount}
        grandTotal={grandTotal}
        onSearchChange={onSearchChange}
        onSearchClear={onSearchClear}
        onFilterChange={onFilterChange}
      />

      <div className="bg-slate-800 rounded-3xl border-2 border-slate-700 overflow-hidden">
        <ReceiptTableHeader
          sortField={sortField}
          sortDir={sortDir}
          onSort={onSort}
        />
        {sortedReceipts.map((receipt, index) => (
          <ReceiptRow
            key={receipt.id}
            receipt={receipt}
            rowIndex={index}
            isSelected={detailId === receipt.id}
            onEdit={onEdit}
            onViewImage={onViewImage}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}
