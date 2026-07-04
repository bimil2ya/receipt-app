import { useCallback } from 'react';
import ConfirmModal from '../layout/ConfirmModal';
import useConfirmModal from '../../hooks/useConfirmModal';

export default function SettingsMaintenancePanel({
  showDataManage,
  onToggleDataManage,
  onRestoreFromDrive,
  restoring,
  restoreProgress,
  showDangerZone,
  onToggleDangerZone,
  onResetDeviceData,
  onResetActivityLogs,
  onReset,
  onClose,
}) {
  const { confirmModalProps, showConfirm } = useConfirmModal();

  const handleResetDeviceData = useCallback(async () => {
    const ok = await showConfirm({
      title: '이 기기 초기화',
      message: '영수증, 이미지, 변경 이력, 보류 전송을\n이 기기에서만 삭제합니다.\n되돌릴 수 없습니다.',
      confirmLabel: '초기화',
      variant: 'danger',
    });
    if (ok) { (onResetDeviceData || onReset)(); onClose(); }
  }, [showConfirm, onResetDeviceData, onReset, onClose]);

  const handleResetActivityLogs = useCallback(async () => {
    const ok = await showConfirm({
      title: '운영 로그 초기화',
      message: '로그와 일별 집계만 삭제합니다.\n영수증 데이터는 유지됩니다.',
      confirmLabel: '초기화',
      variant: 'danger',
    });
    if (ok) { (onResetActivityLogs || onReset)(); onClose(); }
  }, [showConfirm, onResetActivityLogs, onReset, onClose]);

  return (
    <>
      <ConfirmModal {...confirmModalProps} />
      <div className="border border-slate-700 rounded-xl bg-slate-900/40 overflow-hidden">
        <button
          onClick={onToggleDataManage}
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

      <div className="border border-red-900/40 rounded-xl bg-red-900/10 overflow-hidden">
        <button
          onClick={onToggleDangerZone}
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
                onClick={handleResetDeviceData}
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
                onClick={handleResetActivityLogs}
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
    </>
  );
}
