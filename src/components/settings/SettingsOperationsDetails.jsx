export default function SettingsOperationsDetails({
  showOpsDetail,
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
    <div className="space-y-3 pt-1">
      <button
        onClick={onToggleOpsStats}
        className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-3 text-left"
      >
        <div>
          <p className="text-xs font-black text-slate-300">활동 / 추세</p>
          <p className="mt-1 text-sm font-black text-slate-100">
            {eventStats.total > 0 ? `${eventStats.total}건 기록` : '기록 없음'}
          </p>
        </div>
        <span className="text-slate-500 text-sm font-black">{showOpsStats ? '접기' : '펼치기'}</span>
      </button>

      {showOpsStats && (
        <>
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-black text-slate-300">활동 요약</div>
              <div className="text-[11px] font-bold text-slate-400">
                {eventStats.total > 0 ? `${eventStats.total}건` : '기록 없음'}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-[11px] font-black text-slate-100">
                성공 {eventStats.success}건
              </span>
              <span className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-1 text-[11px] font-black text-slate-100">
                실패 {eventStats.error}건
              </span>
            </div>
            <div className="mt-3 rounded-lg border border-slate-700 bg-slate-900/60 px-3 py-2">
              <div className="text-[11px] font-black text-slate-300">최근 로그</div>
              <div className="mt-1 text-sm font-black text-slate-100">
                {eventStats.latest?.title || '기록 없음'}
              </div>
              <div className="mt-1 text-xs text-slate-400 font-bold">
                {eventStats.latest?.detail || '동기화 기록이 쌓이면 여기에 표시됩니다.'}
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-black text-slate-300">최근 7일 집계</div>
              <div className="text-[11px] font-bold text-slate-400">성공 / 실패</div>
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2 items-end">
              {trendDays.map(day => {
                const totalHeight = Math.max(8, Math.round((day.total / trendMax) * 44));
                const errorHeight = day.total > 0 ? Math.max(4, Math.round((day.error / day.total) * totalHeight)) : 0;
                const successHeight = Math.max(0, totalHeight - errorHeight);
                return (
                  <div key={day.label} className="flex flex-col items-center gap-2">
                    <div className="h-14 w-full flex items-end justify-center">
                      <div className="w-full max-w-[18px] rounded-full overflow-hidden bg-slate-800 border border-slate-700">
                        <div className="w-full bg-emerald-500/80" style={{ height: `${successHeight}px` }} />
                        {errorHeight > 0 && <div className="w-full bg-red-500/80" style={{ height: `${errorHeight}px` }} />}
                      </div>
                    </div>
                    <div className="text-[11px] font-bold text-slate-400">{day.label}</div>
                    <div className="text-[10px] font-black text-slate-200">{day.total}건</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3">
            <div className="text-xs font-black text-slate-300">실패 원인</div>
            {failureReasons.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {failureReasons.map(item => (
                  <div
                    key={item.label}
                    title={item.hint}
                    className="rounded-full border border-slate-700 bg-slate-900/60 px-3 py-2 text-sm font-black text-slate-100"
                  >
                    {item.label} {item.count}건
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-1 text-sm font-bold text-slate-400">실패 기록이 쌓이면 원인별로 표시됩니다.</div>
            )}
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-black text-slate-300">연결 점검</div>
              <button
                onClick={onCheckSystemStatus}
                disabled={healthResult.loading}
                className="rounded-full border px-3 py-1.5 bg-slate-800 border-slate-700 text-slate-100 text-xs font-black disabled:opacity-50"
              >
                {healthResult.loading ? '점검 중' : '다시 확인'}
              </button>
            </div>
            {(healthResult.msg || healthResult.data?.services) ? (
              <>
                {healthResult.msg && (
                  <div className="rounded-lg border border-red-900 bg-red-900/15 px-3 py-2 text-xs font-bold leading-5 text-red-200">
                    {healthResult.msg}
                  </div>
                )}
                {healthResult.data?.services && (
                  <div className="flex flex-wrap gap-2">
                    {[
                      ['Drive', healthResult.data.services.drive],
                      ['OCR 구성', healthResult.data.services.ocr],
                      ['Kakao', healthResult.data.services.kakao],
                      ['전송 인증', healthResult.data.services.upload],
                    ].map(([label, status]) => (
                      <div
                        key={label}
                        className={`rounded-full border px-3 py-1 text-[11px] font-black ${
                          status.ok
                            ? 'bg-emerald-900/15 border-emerald-800 text-emerald-200'
                            : 'bg-red-900/15 border-red-900 text-red-200'
                        }`}
                      >
                        {status.ok ? '✅' : '❌'} {label}
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-500 font-bold">
                운영 상태가 필요할 때만 확인합니다.
              </div>
            )}
          </div>
        </>
      )}

      {showOpsDetail && (
        <div className="border-b border-slate-800 pb-4 space-y-3">
          <button
            onClick={onToggleLogHistory}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <div>
              <p className="text-sm text-slate-400 font-black">로그 내역</p>
              <p className="text-base font-black text-slate-100 mt-1">
                {recentEvents.length > 0 ? `${recentEvents.length}건 표시` : '표시할 기록 없음'}
              </p>
            </div>
            <span className="text-slate-500 text-sm font-black">{showLogHistory ? '접기' : '펼치기'}</span>
          </button>
          {showLogHistory && (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-bold text-slate-500">필터를 바꿔 최근 로그를 좁혀 볼 수 있습니다.</div>
                <button
                  onClick={onRetrySync}
                  disabled={!onRetrySync}
                  className="px-4 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-slate-100 font-black text-sm disabled:opacity-40"
                >
                  다시 전송
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {[
                  ['all', '전체'],
                  ['fail', '실패'],
                  ['success', '성공'],
                  ['save', '저장'],
                  ['sync', '전송'],
                  ['delete', '삭제'],
                ].map(([value, label]) => {
                  const active = eventFilter === value;
                  return (
                    <button
                      key={value}
                      onClick={() => onEventFilterChange(value)}
                      className={`px-3 py-2 rounded-xl border text-sm font-black transition-colors ${
                        active
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-slate-800 border-slate-700 text-slate-100'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <div className="space-y-2">
                {recentEvents.length > 0 ? recentEvents.map((event) => {
                  const tone = event.status === 'error'
                    ? 'bg-red-900/15 border-red-900 text-red-200'
                    : 'bg-emerald-900/15 border-emerald-800 text-emerald-200';
                  const time = new Date(event.at || Date.now()).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });
                  return (
                    <div key={event.id} className={`rounded-xl border p-3 ${tone}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-black">{event.title || '이력'}</span>
                        <span className="text-xs font-bold opacity-80">{time}</span>
                      </div>
                      {event.detail && <div className="mt-1 text-xs leading-5 opacity-85">{event.detail}</div>}
                    </div>
                  );
                }) : (
                  <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-3 text-sm text-slate-400 font-bold">
                    아직 표시할 이력이 없습니다.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
