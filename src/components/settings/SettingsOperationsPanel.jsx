const HEALTH_SERVICES = [
  ['Drive', 'drive'],
  ['OCR 구성', 'ocr'],
  ['Kakao', 'kakao'],
  ['전송 인증', 'upload'],
];

export default function SettingsOperationsPanel({
  saveText,
  saveClass,
  showOpsDetail,
  onToggleOpsDetail,
  healthResult,
  onCheckSystemStatus,
}) {
  const services = healthResult.data?.services;
  return (
    <div className="space-y-3">
      <button
        onClick={onToggleOpsDetail}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <div>
          <p className="text-sm text-slate-400 font-black">운영 상태</p>
          <p className="text-base font-black text-slate-100 mt-1">{saveText}</p>
        </div>
        <span className="text-slate-500 text-sm font-black">{showOpsDetail ? '접기' : '펼치기'}</span>
      </button>

      <div className="flex flex-wrap gap-2">
        <div className={`rounded-full border px-3 py-2 text-sm font-black ${saveClass}`}>
          로컬 {saveText}
        </div>
      </div>

      {showOpsDetail && (
        <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs font-black text-slate-300">연결 점검</div>
            <button
              onClick={onCheckSystemStatus}
              disabled={healthResult.loading}
              className="rounded-full border px-3 py-1.5 bg-slate-800 border-slate-700 text-slate-100 text-xs font-black disabled:opacity-50"
            >
              {healthResult.loading ? '점검 중' : '확인'}
            </button>
          </div>
          {healthResult.msg && (
            <div className="rounded-lg border border-red-900 bg-red-900/15 px-3 py-2 text-xs font-bold leading-5 text-red-200">
              {healthResult.msg}
            </div>
          )}
          {services && (
            <div className="flex flex-wrap gap-2">
              {HEALTH_SERVICES.map(([label, key]) => {
                const ok = Boolean(services[key]?.ok);
                return (
                  <div
                    key={key}
                    className={`rounded-full border px-3 py-1 text-[11px] font-black ${
                      ok
                        ? 'bg-emerald-900/15 border-emerald-800 text-emerald-200'
                        : 'bg-red-900/15 border-red-900 text-red-200'
                    }`}
                  >
                    {ok ? '✅' : '❌'} {label}
                  </div>
                );
              })}
            </div>
          )}
          {!healthResult.msg && !services && (
            <div className="text-xs text-slate-500 font-bold">
              서버 설정 상태가 필요할 때만 확인합니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
