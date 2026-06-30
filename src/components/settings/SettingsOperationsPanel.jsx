import SettingsOperationsDetails from './SettingsOperationsDetails';

export default function SettingsOperationsPanel({
  pendingSyncCount = 0,
  saveText,
  saveClass,
  syncText,
  syncClass,
  showOpsDetail,
  onToggleOpsDetail,
  showOpsStats,
  onToggleOpsStats,
  eventStats,
  trendDays = [],
  trendMax = 1,
  failureReasons = [],
  healthResult,
  onCheckSystemStatus,
  onRetrySync,
  showLogHistory,
  onToggleLogHistory,
  eventFilter,
  onEventFilterChange,
  recentEvents = [],
}) {
  return (
    <div className="space-y-3">
      <button
        onClick={onToggleOpsDetail}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="text-sm text-slate-400 font-black">운영 상태</p>
          <p className="text-base font-black text-slate-100 mt-1">
            {pendingSyncCount > 0 ? `보류 ${pendingSyncCount}건` : '정상'}
          </p>
        </div>
        <span className="text-slate-500 text-sm font-black">{showOpsDetail ? '접기' : '펼치기'}</span>
      </button>

      <div className="flex flex-wrap gap-2">
        <div className={`rounded-full border px-3 py-2 text-sm font-black ${saveClass}`}>
          로컬 {saveText}
        </div>
        <div className={`rounded-full border px-3 py-2 text-sm font-black ${syncClass}`}>
          서버 {syncText}
        </div>
        <div className="rounded-full border px-3 py-2 bg-amber-900/15 border-amber-800 text-amber-100 text-sm font-black">
          보류 {pendingSyncCount > 0 ? `${pendingSyncCount}건` : '없음'}
        </div>
      </div>

      {showOpsDetail && (
        <SettingsOperationsDetails
          showOpsDetail={showOpsDetail}
          showOpsStats={showOpsStats}
          onToggleOpsStats={onToggleOpsStats}
          eventStats={eventStats}
          trendDays={trendDays}
          trendMax={trendMax}
          failureReasons={failureReasons}
          healthResult={healthResult}
          onCheckSystemStatus={onCheckSystemStatus}
          onRetrySync={onRetrySync}
          showLogHistory={showLogHistory}
          onToggleLogHistory={onToggleLogHistory}
          eventFilter={eventFilter}
          onEventFilterChange={onEventFilterChange}
          recentEvents={recentEvents}
        />
      )}
    </div>
  );
}
