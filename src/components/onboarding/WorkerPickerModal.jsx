import { useState } from 'react';
import AdminTeamModal from './AdminTeamModal';
import { normalizeTeamNames } from '../../utils/teamNames';

/**
 * 작업자(조) 선택 모달
 *
 * isOnboarding=true  → 앱 최초 실행 시 전체화면 강제 선택 (닫기 불가)
 * isOnboarding=false → 설정에서 변경 (닫기 가능)
 */
export default function WorkerPickerModal({ show, currentNames, teams = [], onSelect, onTeamsUpdated, onClose, isOnboarding = false }) {
  const [showAdmin, setShowAdmin] = useState(false);

  if (!show) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex flex-col bg-slate-900"
        style={{ paddingTop: 'max(24px, env(safe-area-inset-top))', paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 pb-4 border-b border-slate-700">
          <div>
            <p className="text-xs text-slate-400 font-bold mb-0.5">
              {isOnboarding ? '시작하기 전에' : '작업자 변경'}
            </p>
            <h2 className="text-xl font-black text-white">내 담당 조를 선택하세요</h2>
          </div>
          {!isOnboarding && (
            <button
              onClick={onClose}
              className="w-11 h-11 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 font-black text-lg active:scale-95"
              aria-label="닫기"
            >
              ✕
            </button>
          )}
        </div>

        {/* 조 목록 */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {teams.map((team) => {
            const isSelected = normalizeTeamNames(team.names) === normalizeTeamNames(currentNames);
            const [leader, member] = team.names.split(', ');
            return (
              <button
                key={team.id}
                onClick={() => onSelect(team.names)}
                className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${
                  isSelected
                    ? 'bg-blue-600/20 border-blue-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-100 active:border-slate-500'
                }`}
              >
                <span className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black ${
                  isSelected ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300'
                }`}>
                  {team.id}조
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-base leading-tight">{leader}</p>
                  {member && (
                    <p className={`text-sm font-bold leading-tight mt-0.5 ${isSelected ? 'text-blue-300' : 'text-slate-400'}`}>
                      {member}
                    </p>
                  )}
                </div>
                {isSelected && (
                  <span className="shrink-0 text-blue-400 font-black text-lg">✓</span>
                )}
              </button>
            );
          })}
        </div>

        {/* 하단 */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-800">
          {isOnboarding
            ? <p className="text-slate-500 text-xs">선택 후 ⚙️ 설정에서 변경 가능</p>
            : <span />
          }
          <button
            onClick={() => setShowAdmin(true)}
            className="text-xs text-slate-600 font-bold py-1 px-2 active:text-slate-400 transition-colors"
          >
            관리자
          </button>
        </div>
      </div>

      <AdminTeamModal
        show={showAdmin}
        currentTeams={teams}
        onSaved={(newTeams) => {
          onTeamsUpdated?.(newTeams);
          setShowAdmin(false);
        }}
        onClose={() => setShowAdmin(false)}
      />
    </>
  );
}
