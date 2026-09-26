import Modal from '../layout/Modal';
import { formatFailureMessage } from '../../utils/errorCopy';
import { normalizeTeamNames } from '../../utils/teamNames';
import WorkerPickerModal from '../onboarding/WorkerPickerModal';
import SettingsIdentitySection from './SettingsIdentitySection';
import SettingsOperationsPanel from './SettingsOperationsPanel';
import SettingsMaintenancePanel from './SettingsMaintenancePanel';
import SettingsHelpModal from './SettingsHelpModal';
import SettingsVersionFooter from './SettingsVersionFooter';
import { getSaveStatusLabel } from './settingsStats';
import useSettingsUiState from './useSettingsUiState';

export default function SettingsModal({
  show,
  onClose,
  showToast,
  names,
  teams = [],
  onTeamsUpdated,
  onNamesChange,
  onResetDeviceData,
  saveStatus = 'idle',
  onRestoreFromDrive,
  restoreProgress = null,
}) {
  const {
    healthResult,
    setHealthResult,
    showOpsDetail,
    showDangerZone,
    showDataManage,
    showWorkerPicker,
    showHelp,
    closeWorkerPicker,
    openWorkerPicker,
    closeHelp,
    openHelp,
    toggleOpsDetail,
    toggleDangerZone,
    toggleDataManage,
  } = useSettingsUiState(show);

  const matchedTeam = teams.find(t => normalizeTeamNames(t.names) === normalizeTeamNames(names));

  const restoring = restoreProgress !== null;

  const checkSystemStatus = async () => {
    setHealthResult({ loading: true, data: null, msg: '시스템 상태 확인 중...' });
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || data.error || `상태 확인 실패 (${res.status})`);
      setHealthResult({ loading: false, data, msg: '' });
    } catch (e) {
      setHealthResult({ loading: false, data: null, msg: formatFailureMessage('시스템 점검 실패', e) });
    }
  };

  const saveSettings = () => {
    onClose();
    showToast('🛡️ 저장 완료');
  };
  const [saveText, saveClass] = getSaveStatusLabel(saveStatus);

  if (!show) return null;

  return (
    <>
    <Modal title="⚙️ 설정" onClose={onClose}>
      <div className="space-y-5 p-1">
        <SettingsIdentitySection
          matchedTeam={matchedTeam}
          names={names}
          onOpenWorkerPicker={openWorkerPicker}
          onOpenHelp={openHelp}
        />

        <div className="border-b border-slate-800 pb-4 space-y-3">
          <SettingsOperationsPanel
            saveText={saveText}
            saveClass={saveClass}
            showOpsDetail={showOpsDetail}
            onToggleOpsDetail={toggleOpsDetail}
            healthResult={healthResult}
            onCheckSystemStatus={checkSystemStatus}
          />
        </div>

        {/* 설정 저장 */}
        <button onClick={saveSettings} className="w-full bg-blue-600 py-4 rounded-2xl text-xl font-black">
          설정 저장
        </button>

        <SettingsMaintenancePanel
          showDataManage={showDataManage}
          onToggleDataManage={toggleDataManage}
          onRestoreFromDrive={onRestoreFromDrive}
          restoring={restoring}
          restoreProgress={restoreProgress}
          showDangerZone={showDangerZone}
          onToggleDangerZone={toggleDangerZone}
          onResetDeviceData={onResetDeviceData}
          onClose={onClose}
        />

        <SettingsVersionFooter />

      </div>
    </Modal>

    <SettingsHelpModal
      show={showHelp}
      onClose={closeHelp}
      showToast={showToast}
    />

    <WorkerPickerModal
      show={showWorkerPicker}
      currentNames={names}
      teams={teams}
      onSelect={(selected) => { onNamesChange(selected); closeWorkerPicker(); }}
      onTeamsUpdated={onTeamsUpdated}
      onClose={closeWorkerPicker}
      isOnboarding={false}
    />
    </>
  );
}
