import {
  BarChart3,
  ClipboardList,
  HardDrive,
  Images,
  Loader2,
  Settings,
} from 'lucide-react';
import { formatDateKorean, getToday } from '../../utils/formatter';

const TABS = [
  ['list', '목록', ClipboardList],
  ['images', '영수증', Images],
  ['summary', '집계', BarChart3],
];

export default function AppHeader({
  names,
  tripStartDate,
  tab,
  saveStatus,
  statusPopover,
  statusRef,
  onStatusPopoverChange,
  onSettingsOpen,
  onTabChange,
}) {
  const saveStateLabel = saveStatus === 'saving' ? '저장 중' : saveStatus === 'error' ? '저장 실패' : '저장됨';

  return (
    <div className="shrink-0 shadow-lg">
      <header className="bg-slate-800 border-b border-slate-700 px-3 py-3 flex items-center justify-between" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
          <h1 className="min-w-0 break-words text-xl font-black">{`${names} - ${formatDateKorean(tripStartDate || getToday())}`}</h1>
          <div ref={statusRef} className="flex items-center gap-1 relative">
            <button
              type="button"
              onClick={() => onStatusPopoverChange(statusPopover === 'save' ? null : 'save')}
              className="flex items-center justify-center gap-0.5 shrink-0 active:scale-95 p-2"
              aria-label={`저장 상태: ${saveStateLabel}`}
            >
              {saveStatus === 'saving' ? (
                <Loader2 size={14} className="animate-spin text-blue-300" />
              ) : saveStatus === 'error' ? (
                <span className="flex items-center gap-0.5 text-[11px] font-bold text-red-300">
                  <HardDrive size={14} /> 저장실패
                </span>
              ) : (
                <HardDrive size={14} className="text-emerald-300" />
              )}
            </button>

            {statusPopover === 'save' && (
              <div className="absolute top-full mt-2 right-0 z-50 max-w-[80vw] break-words bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 shadow-2xl">
                {saveStatus === 'saving' ? <span className="font-black text-blue-300">저장 중…</span>
                  : saveStatus === 'error' ? <><span className="font-black text-red-300">저장 실패</span> — 자료관리에서 백업해 보세요</>
                  : <><span className="font-black text-emerald-300">저장됨</span> · 이 기기에 안전</>}
              </div>
            )}

            <div className="sr-only" role="status" aria-live="polite">
              저장 상태: {saveStateLabel}.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={onSettingsOpen} className="w-11 h-11 flex items-center justify-center rounded-xl border bg-slate-900/70 border-slate-700 text-slate-300" aria-label="설정">
            <Settings size={18}/>
          </button>
        </div>
      </header>
      <div className="bg-slate-800 border-b border-slate-700 px-3 py-3">
        <div className="flex bg-slate-900/40 p-1 rounded-2xl gap-1 border border-slate-700/60">
          {TABS.map(([id, label, Icon]) => {
            const isActive = tab === id;
            const tabClass = isActive
              ? 'bg-slate-700 text-slate-50 shadow-sm'
              : 'text-slate-500 hover:text-slate-300';
            return (
              <button key={id} aria-pressed={isActive} onClick={() => onTabChange(id)} className={`flex-1 min-h-11 py-2.5 text-xs font-bold transition-all rounded-xl flex items-center justify-center gap-1.5 ${tabClass}`}>
                <Icon size={14} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
