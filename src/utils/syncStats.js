export function sortByNewest(items = [], timeKey = 'at') {
  return [...items].sort((a, b) => (b?.[timeKey] || 0) - (a?.[timeKey] || 0));
}

export function toDayKey(value) {
  const date = new Date(value || Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildDailyRows(events = []) {
  const map = new Map();
  for (const event of events) {
    const dateKey = toDayKey(event?.at);
    const current = map.get(dateKey) || {
      date: dateKey,
      total: 0,
      success: 0,
      error: 0,
      save: 0,
      sync: 0,
      deleteCount: 0,
      updatedAt: 0,
    };
    const at = event?.at || 0;
    current.total += 1;
    current.success += event?.status === 'success' ? 1 : 0;
    current.error += event?.status === 'error' ? 1 : 0;
    current.save += event?.kind === 'save' ? 1 : 0;
    current.sync += event?.kind === 'sync' ? 1 : 0;
    current.deleteCount += event?.kind === 'delete' ? 1 : 0;
    current.updatedAt = Math.max(current.updatedAt || 0, at);
    map.set(dateKey, current);
  }
  return sortByNewest([...map.values()], 'updatedAt').slice(0, 60);
}

export function pruneByRetention(items = [], retention = 30, timeKey = 'at') {
  return sortByNewest(items, timeKey).slice(0, retention);
}
