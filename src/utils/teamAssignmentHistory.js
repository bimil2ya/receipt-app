import { getFixedUserName, getOrCreateDeviceId } from './deviceIdentity';
import { readStorageItem, writeStorageItem } from './storage';

const HISTORY_KEY = 'receipt_team_assignment_history';

export function readTeamAssignmentHistory() {
  try { return JSON.parse(readStorageItem(HISTORY_KEY, '[]')) || []; } catch { return []; }
}

export function recordTeamAssignmentChange(previousTeam, nextTeam) {
  if (!nextTeam || previousTeam === nextTeam) return null;
  const entry = {
    id: crypto.randomUUID(), action: 'team_assignment_changed', at: Date.now(),
    previousTeam: previousTeam || '', nextTeam,
    userName: getFixedUserName() || '작성자 미등록', deviceId: getOrCreateDeviceId(),
  };
  writeStorageItem(HISTORY_KEY, JSON.stringify([...readTeamAssignmentHistory(), entry].slice(-200)));
  return entry;
}
