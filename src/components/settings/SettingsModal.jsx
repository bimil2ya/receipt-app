import { useState, useEffect, useMemo } from 'react';
import Modal from '../layout/Modal';
import { formatFailureMessage } from '../../utils/errorCopy';
import { summarizeSyncFailureReasons } from '../../utils/syncActivity';
import { APP_VERSION } from '../../utils/version';
import WorkerPickerModal from '../onboarding/WorkerPickerModal';
import TEAMS from '../../config/teams.json';

export default function SettingsModal({
  show,
  onClose,
  showToast,
  names,
  onNamesChange,
  onReset,
  onResetDeviceData,
  onResetActivityLogs,
  saveStatus = 'idle',
  syncStatus = 'idle',
  pendingSyncCount = 0,
  syncEvents = [],
  syncDaily = [],
  onRetrySync,
  onRestoreFromDrive,
  restoreProgress = null,
}) {
  const [healthResult, setHealthResult] = useState({ loading: false, data: null, msg: '' });
  const [showOpsDetail, setShowOpsDetail] = useState(false);
  const [showOpsStats, setShowOpsStats] = useState(false);
  const [eventFilter, setEventFilter] = useState('all');
  const [showLogHistory, setShowLogHistory] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showDataManage, setShowDataManage] = useState(false);
  const [showWorkerPicker, setShowWorkerPicker] = useState(false);

  const matchedTeam = TEAMS.find(t => t.names === names);

  useEffect(() => {
    if (!show) return;
    setShowOpsDetail(false);
    setShowOpsStats(false);
    setShowLogHistory(false);
    setShowDangerZone(false);
    setShowDataManage(false);
    setShowWorkerPicker(false);
    setHealthResult({ loading: false, data: null, msg: '' });
    setEventFilter('all');
  }, [show]);

  const restoring = restoreProgress !== null;

  const checkSystemStatus = async () => {
    setHealthResult({ loading: true, data: null, msg: '시스템 상태 확인 중...' });
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || `상태 확인 실패 (${res.status})`);
      setHealthResult({ loading: false, data, msg: '' });
    } catch (e) {
      setHealthResult({ loading: false, data: null, msg: formatFailureMessage('시스템 점검 실패', e) });
    }
  };

  const saveSettings = () => {
    onClose();
    showToast('🛡️ 저장 완료');
  };

  const statusLabel = (value, kind) => {
    if (kind === 'save') {
      if (value === 'saving') return ['저장 중', 'bg-blue-900/20 border-blue-800 text-blue-200'];
      if (value === 'success') return ['로컬 저장 정상', 'bg-emerald-900/20 border-emerald-800 text-emerald-200'];
      if (value === 'error') return ['로컬 저장 실패', 'bg-red-900/20 border-red-900 text-red-200'];
      return ['대기', 'bg-slate-800 border-slate-700 text-slate-200'];
    }
    if (kind === 'sync') {
      if (value === 'syncing') return ['동기화 중', 'bg-cyan-900/20 border-cyan-800 text-cyan-200'];
      if (value === 'success') return ['서버 정상', 'bg-emerald-900/20 border-emerald-800 text-emerald-200'];
      if (value === 'error') return ['동기화 실패', 'bg-red-900/20 border-red-900 text-red-200'];
      if (value === 'offline') return ['오프라인', 'bg-slate-800 border-slate-700 text-slate-300'];
      return ['대기', 'bg-slate-800 border-slate-700 text-slate-200'];
    }
    return ['대기', 'bg-slate-800 border-slate-700 text-slate-200'];
  };

  const [saveText, saveClass] = statusLabel(saveStatus, 'save');
  const [syncText, syncClass] = statusLabel(syncStatus, 'sync');
  const eventList = useMemo(() => (Array.isArray(syncEvents) ? syncEvents : []), [syncEvents]);
  const dailyList = useMemo(() => (Array.isArray(syncDaily) ? syncDaily : []), [syncDaily]);
  const filteredEvents = useMemo(() => eventList.filter(event => {
    if (eventFilter === 'all') return true;
    if (eventFilter === 'fail') return event.status === 'error';
    if (eventFilter === 'success') return event.status === 'success';
    return event.kind === eventFilter;
  }), [eventList, eventFilter]);
  const recentEvents = useMemo(() => filteredEvents.slice(0, 5), [filteredEvents]);
  const trendDays = useMemo(() => Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (6 - index));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const dayRecord = dailyList.find(item => item.date === key);
    return {
      label: date.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }),
      total: dayRecord?.total || 0,
      success: dayRecord?.success || 0,
      error: dayRecord?.error || 0,
    };
  }), [dailyList]);
  const trendMax = useMemo(() => Math.max(1, ...trendDays.map(day => day.total)), [trendDays]);
  const failureReasons = useMemo(() => summarizeSyncFailureReasons(eventList, 3), [eventList]);
  const eventStats = useMemo(() => {
    const list = eventList;
    const total = list.length;
    const success = list.filter(event => event.status === 'success').length;
    const error = list.filter(event => event.status === 'error').length;
    const save = list.filter(event => event.kind === 'save').length;
    const sync = list.filter(event => event.kind === 'sync').length;
    const deleteCount = list.filter(event => event.kind === 'delete').length;
    const latest = list[0];
    return {
      total,
      success,
      error,
      save,
      sync,
      deleteCount,
      latest,
    };
  }, [eventList]);

  if (!show) return null;

  return (
    <>
    <Modal title="⚙️ 설정" onClose={onClose}>
      <div className="space-y-5 p-1">

        {/* 기본 정보 */}
        <div className="border-b border-slate-800 pb-4 space-y-3">
          {/* 작업자(조) 선택 */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-400 font-black w-12 shrink-0">이름</span>
            <button
              onClick={() => setShowWorkerPicker(true)}
              className="flex-1 h-[52px] bg-slate-900 border-2 border-slate-700 rounded-xl px-4 text-left flex items-center justify-between gap-2 active:border-blue-500 transition-colors"
            >
              <span className="font-black text-base text-white truncate">
                {matchedTeam ? `${matchedTeam.id}조  ${names}` : (names || '조를 선택하세요')}
              </span>
              <span className="text-slate-400 text-sm shrink-0">변경 ›</span>
            </button>
          </div>
        </div>

        {/* 운영 상태 */}
        <div className="border-b border-slate-800 pb-4 space-y-3">
          <button
            onClick={() => setShowOpsDetail(v => !v)}
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
            <div className="space-y-3 pt-1">
              <button
                onClick={() => setShowOpsStats(v => !v)}
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
                                <div
                                  className="w-full bg-emerald-500/80"
                                  style={{ height: `${successHeight}px` }}
                                />
                                {errorHeight > 0 && (
                                  <div
                                    className="w-full bg-red-500/80"
                                    style={{ height: `${errorHeight}px` }}
                                  />
                                )}
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
                        onClick={checkSystemStatus}
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
            </div>
          )}
        </div>

        {showOpsDetail && (
          <div className="border-b border-slate-800 pb-4 space-y-3">
            <button
              onClick={() => setShowLogHistory(v => !v)}
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
                    disabled={!pendingSyncCount || !onRetrySync}
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
                        onClick={() => setEventFilter(value)}
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
                    const time = new Date(event.at || Date.now()).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
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

        {/* 설정 저장 */}
        <button onClick={saveSettings} className="w-full bg-blue-600 py-4 rounded-2xl text-xl font-black">
          설정 저장
        </button>

        {/* 자료 관리 — Drive 복원 등 */}
        <div className="border border-slate-700 rounded-xl bg-slate-900/40 overflow-hidden">
          <button
            onClick={() => setShowDataManage(v => !v)}
            className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left"
          >
            <div>
              <p className="text-sm text-slate-200 font-black">💾 자료 관리</p>
              <p className="text-xs text-slate-400 font-bold mt-1">
                Drive에 남은 영수증을 다시 가져와 복원합니다.
              </p>
            </div>
            <span className="text-slate-400 text-sm font-black">
              {showDataManage ? '접기' : '펼치기'}
            </span>
          </button>

          {showDataManage && (
            <div className="px-3 pb-3 space-y-2">
              <button
                onClick={() => onRestoreFromDrive && onRestoreFromDrive()}
                disabled={!onRestoreFromDrive || restoring}
                className="w-full bg-slate-800 border border-slate-700 text-slate-100 py-3.5 rounded-xl font-black text-base active:scale-95 transition-transform disabled:opacity-50"
              >
                {restoring
                  ? (restoreProgress?.stage === 'list'
                      ? '🔍 Drive 목록 조회 중…'
                      : `🔄 OCR 재분석 중 ${restoreProgress?.current ?? 0}/${restoreProgress?.total ?? 0}장`)
                  : '🔄 Drive에서 영수증 복원'}
              </button>
              {restoring && restoreProgress?.stage === 'process' && restoreProgress?.total > 0 && (
                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/80 transition-all"
                    style={{ width: `${Math.round((restoreProgress.current / restoreProgress.total) * 100)}%` }}
                  />
                </div>
              )}
              <p className="text-xs text-slate-400 leading-4">
                현재 이름·출장 시작일 기준의 Drive 폴더에서 영수증 이미지를 가져와 OCR로 재분석하고
                <b className="text-slate-200"> 기존 영수증에 추가</b>합니다.
                영수증 1장당 약 5초가 걸리고 OCR 비용이 발생합니다.
              </p>
            </div>
          )}
        </div>

        {/* 위험 구역 */}
        <div className="border border-red-900/40 rounded-xl bg-red-900/10 overflow-hidden">
          <button
            onClick={() => setShowDangerZone(v => !v)}
            className="w-full flex items-center justify-between gap-3 px-3 py-3 text-left"
          >
            <div>
              <p className="text-sm text-red-300 font-black">⚠️ 위험 구역</p>
              <p className="text-xs text-red-200/75 font-bold mt-1">
                초기화 작업은 필요할 때만 펼쳐서 사용합니다.
              </p>
            </div>
            <span className="text-red-200/70 text-sm font-black">
              {showDangerZone ? '접기' : '펼치기'}
            </span>
          </button>

          {showDangerZone && (
            <div className="px-3 pb-3 space-y-3">
              <div className="space-y-1.5">
                <button
                  onClick={() => {
                    if (window.confirm('이 기기의 영수증 데이터가 삭제됩니다.\n계속하시겠습니까?')) {
                      (onResetDeviceData || onReset)();
                      onClose();
                    }
                  }}
                  className="w-full bg-red-900/30 border border-red-800 text-red-300 py-3.5 rounded-xl font-black text-base active:scale-95 transition-transform"
                >
                  🗑️ 이 기기 초기화
                </button>
                <p className="text-xs text-red-200/80 leading-4">
                  영수증, 이미지, 변경 이력, 보류 전송을 이 기기에서만 지웁니다.
                </p>
              </div>
              <div className="space-y-1.5">
                <button
                  onClick={() => {
                    if (window.confirm('운영 로그만 삭제합니다.\n계속하시겠습니까?')) {
                      (onResetActivityLogs || onReset)();
                      onClose();
                    }
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 py-3.5 rounded-xl font-black text-base active:scale-95 transition-transform"
                >
                  🧾 운영 로그 초기화
                </button>
                <p className="text-xs text-slate-400 leading-4">
                  로그와 일별 집계만 지우고, 영수증 데이터는 유지합니다.
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-xs text-slate-500 font-bold pt-2">
          {APP_VERSION}
        </p>

      </div>
    </Modal>

    <WorkerPickerModal
      show={showWorkerPicker}
      currentNames={names}
      onSelect={(selected) => { onNamesChange(selected); setShowWorkerPicker(false); }}
      onClose={() => setShowWorkerPicker(false)}
      isOnboarding={false}
    />
    </>
  );
}
