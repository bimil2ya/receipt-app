import { useCallback, useEffect, useState } from 'react';

export default function useSettingsUiState(show) {
  const [healthResult, setHealthResult] = useState({ loading: false, data: null, msg: '' });
  const [showOpsDetail, setShowOpsDetail] = useState(false);
  const [showDangerZone, setShowDangerZone] = useState(false);
  const [showDataManage, setShowDataManage] = useState(false);
  const [showWorkerPicker, setShowWorkerPicker] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    if (!show) return;
    setShowOpsDetail(false);
    setShowDangerZone(false);
    setShowDataManage(false);
    setShowWorkerPicker(false);
    setShowHelp(false);
    setHealthResult({ loading: false, data: null, msg: '' });
  }, [show]);

  const closeWorkerPicker = useCallback(() => setShowWorkerPicker(false), []);
  const openWorkerPicker = useCallback(() => setShowWorkerPicker(true), []);
  const closeHelp = useCallback(() => setShowHelp(false), []);
  const openHelp = useCallback(() => setShowHelp(true), []);
  const toggleOpsDetail = useCallback(() => setShowOpsDetail(v => !v), []);
  const toggleDangerZone = useCallback(() => setShowDangerZone(v => !v), []);
  const toggleDataManage = useCallback(() => setShowDataManage(v => !v), []);

  return {
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
  };
}
