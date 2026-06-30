export default function SettingsIdentitySection({ matchedTeam, names, onOpenWorkerPicker, onOpenHelp }) {
  return (
    <>
      <div className="border-b border-slate-800 pb-4 space-y-3">
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400 font-black w-12 shrink-0">이름</span>
          <button
            onClick={onOpenWorkerPicker}
            className="flex-1 h-[52px] bg-slate-900 border-2 border-slate-700 rounded-xl px-4 text-left flex items-center justify-between gap-2 active:border-blue-500 transition-colors"
          >
            <span className="font-black text-base text-white truncate">
              {matchedTeam ? `${matchedTeam.id}조  ${names}` : (names || '조를 선택하세요')}
            </span>
            <span className="text-slate-400 text-sm shrink-0">변경 ›</span>
          </button>
        </div>
      </div>

      <div className="border-b border-slate-800 pb-4">
        <button
          onClick={onOpenHelp}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-amber-500/35 bg-slate-900/50 px-4 py-3.5 text-left active:border-amber-400/70"
        >
          <div className="min-w-0">
            <p className="text-sm font-black text-amber-300">도움말</p>
            <p className="mt-1 text-base font-black text-slate-100">
              문제가 생기면 여기서 확인하세요
            </p>
          </div>
          <span className="shrink-0 text-sm font-black text-amber-300">열기 ›</span>
        </button>
      </div>
    </>
  );
}
