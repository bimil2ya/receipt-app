import {
  BarChart3,
  ClipboardList,
  Cloud,
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
  syncStatus,
  statusPopover,
  pendingSyncCount,
  statusRef,
  onStatusPopoverChange,
  onSettingsOpen,
  onTabChange,
}) {
  return (
    <div className="shrink-0 shadow-lg">
      <header className="bg-slate-800 border-b border-slate-700 px-3 py-3 flex items-center justify-between" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <h1 className="text-xl font-black truncate">{`${names} - ${formatDateKorean(tripStartDate || getToday())}`}</h1>
          <div ref={statusRef} className="flex items-center gap-1 relative">
            <button
              type="button"
              onClick={() => onStatusPopoverChange(statusPopover === 'save' ? null : 'save')}
              className="flex items-center gap-0.5 shrink-0 active:scale-95 p-2 -m-2"
              aria-label="저장 상태"
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

            {syncStatus !== 'offline' && (
              <button
                type="button"
                onClick={() => onStatusPopoverChange(statusPopover === 'sync' ? null : 'sync')}
                className="flex items-center gap-0.5 shrink-0 active:scale-95 p-2 -m-2"
                aria-label="동기화 상태"
              >
                {syncStatus === 'syncing' ? (
                  <Loader2 size={14} className="animate-spin text-cyan-300" />
                ) : syncStatus === 'error' ? (
                  <span className="flex items-center gap-0.5 text-[11px] font-bold text-red-300">
                    <Cloud size={14} /> 동기화실패
                  </span>
                ) : (
                  <Cloud size={14} className="text-emerald-300" />
                )}
              </button>
            )}

            {statusPopover && (
              <div className="absolute top-full mt-2 right-0 z-50 max-w-[80vw] bg-slate-700 border border-slate-600 rounded-xl px-3 py-2 text-xs font-bold text-slate-200 whitespace-nowrap shadow-2xl">
                {statusPopover === 'save' && (
                  saveStatus === 'saving' ? <span className="font-black text-blue-300">저장 중…</span>
                  : saveStatus === 'error' ? <><span className="font-black text-red-300">저장 실패</span> — 자료관리에서 백업해 보세요</>
                  : <><span className="font-black text-emerald-300">저장됨</span> · 이 기기에 안전</>
                )}
                {statusPopover === 'sync' && (
                  syncStatus === 'syncing' ? <span className="font-black text-cyan-300">동기화 중…</span>
                  : syncStatus === 'error' ? <><span className="font-black text-red-300">동기화 실패</span> — 잠시 후 자동 재시도</>
                  : <><span className="font-black text-emerald-300">동기화됨</span> · 서버 연결 정상</>
                )}
              </div>
            )}

            {pendingSyncCount > 0 && (
              <span className="ml-1 px-2 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-[11px] font-black text-amber-200 whitespace-nowrap">
                보류 {pendingSyncCount}
              </span>
            )}
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
              <button key={id} onClick={() => onTabChange(id)} className={`flex-1 py-2.5 text-xs font-bold transition-all rounded-xl flex items-center justify-center gap-1.5 ${tabClass}`}>
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
