import TripWorkflowTabs from '../trip/TripWorkflowTabs';
import ReceiptInputActions from '../receipts/ReceiptInputActions';
import TripClosePanel from '../trip/TripClosePanel';
import ReceiptHiddenInputs from '../receipts/ReceiptHiddenInputs';
import ProcessingBanner from '../receipts/ProcessingBanner';
import ReceiptListControls from '../receipts/ReceiptListControls';
import ReceiptTableHeader from '../receipts/ReceiptTableHeader';
import ReceiptRow from '../receipts/ReceiptRow';
import DuplicateReportNotice from '../receipts/DuplicateReportNotice';
import { useMemo } from 'react';

export default function ReceiptWorkspace({
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
  tripStartDate,
  tripEndDate,
  onEdit,
  onViewImage,
  onDelete,
  onAddSupportingMaterial,
}) {
  const officeReviewsByReceiptId = useMemo(() => new Map(
    (officeReviews?.reviews || []).filter(review => review['영수증 식별값']).map(review => [String(review['영수증 식별값']), review]),
  ), [officeReviews?.reviews]);
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
            kakaoSendCount={kakaoSendCount}
            uploadSendCount={uploadSendCount}
            driveUploading={driveUploading}
            uploadProgress={uploadProgress}
            lastUploadFailures={lastUploadFailures}
            submissionNeedsResend={submissionNeedsResend}
            duplicateReportSlot={<DuplicateReportNotice report={duplicateReport} onOpen={onOpenDuplicateReport} />}
            onKakaoShare={onKakaoShare}
            onUpload={onDriveUpload}
            onRetryFailed={onRetryFailedUploads}
            onSaveBackup={onSaveBackup}
            onLoadBackup={onLoadBackup}
            officeReviews={officeReviews}
          />
        )}
        <ReceiptHiddenInputs
          backupFileRef={backupFileRef}
          cameraRef={cameraRef}
          receiptFileRef={receiptFileRef}
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
        {sortedReceipts.length === 0 ? (
          <div className="py-12 flex flex-col items-center gap-2 text-center">
            {totalCount === 0 ? (
              <>
                <p className="text-slate-300 font-bold text-sm">아직 영수증이 없습니다</p>
                <p className="text-slate-500 text-xs">촬영 또는 업로드로 첫 영수증을 추가해 보세요</p>
              </>
            ) : (
              <p className="text-slate-400 font-bold text-sm">검색 결과가 없습니다</p>
            )}
          </div>
        ) : (
          sortedReceipts.map((receipt, index) => (
            <ReceiptRow
              key={receipt.id}
              receipt={receipt}
              officeReview={officeReviewsByReceiptId.get(String(receipt.id))}
              rowIndex={index}
              isSelected={detailId === receipt.id}
              isNew={pinnedNewIds?.includes(receipt.id)}
              tripStartDate={tripStartDate}
              tripEndDate={tripEndDate}
              onEdit={onEdit}
              onViewImage={onViewImage}
              onDelete={onDelete}
              onAddSupportingMaterial={onAddSupportingMaterial}
            />
          ))
        )}
      </div>
    </div>
  );
}
