import { useCallback, useEffect, useState } from 'react';

export default function useSettingsUiState(show) {
  const [healthResult, setHealthResult] = useState({ loading: false, data: null, msg: '' });
  const [showOpsDetail, setShowOpsDetail] = useState(false);
  const [showOpsStats, setShowOpsStats] = useState(false);
  const [eventFilter, setEventFilter] = useState('all');
  const [showLogHistory, setShowLogHistory] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showDataManage, setShowDataManage] = useState(false);
  const [showWorkerPicker, setShowWorkerPicker] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!show) return;
    setShowOpsDetail(false);
    setShowOpsStats(false);
    setShowLogHistory(false);
    setShowDangerZone(false);
    setShowDataManage(false);
    setShowWorkerPicker(false);
    setShowHelp(false);
    setHealthResult({ loading: false, data: null, msg: '' });
    setEventFilter('all');
  }, [show]);

  const closeWorkerPicker = useCallback(() => setShowWorkerPicker(false), []);
  const openWorkerPicker = useCallback(() => setShowWorkerPicker(true), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);
  const openHelp = useCallback(() => setShowHelp(true), []);
  const toggleOpsDetail = useCallback(() => setShowOpsDetail(v => !v), []);
  const toggleOpsStats = useCallback(() => setShowOpsStats(v => !v), []);
  const toggleLogHistory = useCallback(() => setShowLogHistory(v => !v), []);
  const toggleDangerZone = useCallback(() => setShowDangerZone(v => !v), []);
  const toggleDataManage = useCallback(() => setShowDataManage(v => !v), []);

  return {
    healthResult,
    setHealthResult,
    showOpsDetail,
    showOpsStats,
    eventFilter,
    setEventFilter,
    showLogHistory,
    showDangerZone,
    showDataManage,
    showWorkerPicker,
    showHelp,
    closeWorkerPicker,
    openWorkerPicker,
    closeHelp,
    openHelp,
    toggleOpsDetail,
    toggleOpsStats,
    toggleLogHistory,
    toggleDangerZone,
    toggleDataManage,
  };
}
