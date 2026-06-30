import { getToday } from '../../utils/formatter';
import { summarizeSyncFailureReasons } from '../../utils/syncActivity';

export function getStatusLabel(value, kind) {
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
}

export function buildSettingsTrendDays(dailyList, todayKst = getToday()) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${todayKst}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - (6 - index));
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
    const dayRecord = (Array.isArray(dailyList) ? dailyList : []).find(item => item.date === key);
    return {
      label: date.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }),
      total: dayRecord?.total || 0,
      success: dayRecord?.success || 0,
      error: dayRecord?.error || 0,
    };
  });
}

export function buildSettingsStats(syncEvents, syncDaily, eventFilter = 'all', todayKst = getToday()) {
  const eventList = Array.isArray(syncEvents) ? syncEvents : [];
  const dailyList = Array.isArray(syncDaily) ? syncDaily : [];
  const filteredEvents = eventList.filter(event => {
    if (eventFilter === 'all') return true;
    if (eventFilter === 'fail') return event.status === 'error';
    if (eventFilter === 'success') return event.status === 'success';
    return event.kind === eventFilter;
  });
  const recentEvents = filteredEvents.slice(0, 5);
  const trendDays = buildSettingsTrendDays(dailyList, todayKst);
  const trendMax = Math.max(1, ...trendDays.map(day => day.total));
  const failureReasons = summarizeSyncFailureReasons(eventList, 3);
  const total = eventList.length;
  const success = eventList.filter(event => event.status === 'success').length;
  const error = eventList.filter(event => event.status === 'error').length;
  const save = eventList.filter(event => event.kind === 'save').length;
  const sync = eventList.filter(event => event.kind === 'sync').length;
  const deleteCount = eventList.filter(event => event.kind === 'delete').length;
  const latest = eventList[0];

  return {
    eventList,
    dailyList,
    filteredEvents,
    recentEvents,
    trendDays,
    trendMax,
    failureReasons,
    eventStats: {
      total,
      success,
      error,
      save,
      sync,
      deleteCount,
      latest,
    },
  };
}
