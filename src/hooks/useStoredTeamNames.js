import { useEffect, useMemo, useState } from 'react';
import { readStorageItem, writeStorageItem } from '../utils/storage';
import { normalizeTeamNames } from '../utils/teamNames';

export default function useStoredTeamNames(teams = [], fallbackKey = 'receipt_names') {
  const [names, setNames] = useState(() => readStorageItem(fallbackKey, ''));
  const canonicalNames = useMemo(() => normalizeTeamNames(names), [names]);
  const selectedTeam = useMemo(
    () => teams.find(team => normalizeTeamNames(team.names) === canonicalNames) || null,
    [teams, canonicalNames]
  );
  const [showWorkerPicker, setShowWorkerPicker] = useState(
    () => !teams.some(team => normalizeTeamNames(team.names) === normalizeTeamNames(readStorageItem(fallbackKey, '')))
  );

  useEffect(() => {
    if (!names || names === canonicalNames) return;
    setNames(canonicalNames);
    writeStorageItem(fallbackKey, canonicalNames);
  }, [canonicalNames, fallbackKey, names]);

  useEffect(() => {
    if (!teams.length) return;
    const storedNames = normalizeTeamNames(readStorageItem(fallbackKey, ''));
    const hasMatch = teams.some(team => normalizeTeamNames(team.names) === storedNames);
    if (hasMatch) setShowWorkerPicker(false);
  }, [fallbackKey, teams]);

  const handleNamesChange = (value) => {
    const next = normalizeTeamNames(value);
    setNames(next);
    writeStorageItem(fallbackKey, next);
  };

  const openWorkerPicker = () => setShowWorkerPicker(true);
  const closeWorkerPicker = () => setShowWorkerPicker(false);

  return {
    names,
    canonicalNames,
    selectedTeam,
    showWorkerPicker,
    openWorkerPicker,
    closeWorkerPicker,
    handleNamesChange,
  };
}
