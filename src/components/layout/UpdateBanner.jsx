export default function UpdateBanner({ show, onDismiss, onApply }) {
  if (!show) return null;

  return (
    <div className="fixed top-[calc(env(safe-area-inset-top)+12px)] left-0 right-0 z-[55] flex justify-center px-4 pointer-events-none">
      <div className="w-full max-w-2xl pointer-events-auto rounded-2xl border border-blue-500/40 bg-slate-950/95 px-4 py-3 shadow-2xl flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-blue-300">새 버전이 준비되었습니다</p>
          <p className="text-[11px] font-bold text-slate-400 leading-5">새로고침하면 최신 내용이 반영됩니다.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-300 active:scale-95"
          >
            나중에
          </button>
          <button
            type="button"
            onClick={onApply}
            className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white active:scale-95"
          >
            새로고침
          </button>
        </div>
      </div>
    </div>
  );
}
