import { useState, useCallback, useEffect } from 'react';
import BUNDLED_TEAMS from '../config/teams.json';
import { readStorageItem, writeStorageItem } from '../utils/storage';

const CACHE_KEY = 'receipt_teams_cache';

function loadCached() {
  try {
    const raw = readStorageItem(CACHE_KEY, '');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    return null;
  }
  return null;
}

export default function useTeams() {
  const [teams, setTeams] = useState(() => loadCached() || BUNDLED_TEAMS);

  const fetchTeams = useCallback(() => {
    fetch('/api/teams')
      .then(r => r.json())
      .then(data => {
        if (data.success && Array.isArray(data.teams) && data.teams.length > 0) {
          setTeams(data.teams);
          writeStorageItem(CACHE_KEY, JSON.stringify(data.teams));
        }
      })
      .catch(() => {
        return;
      });
  }, []);

  useEffect(() => { fetchTeams(); }, [fetchTeams]);

  return { teams, refreshTeams: fetchTeams };
}
