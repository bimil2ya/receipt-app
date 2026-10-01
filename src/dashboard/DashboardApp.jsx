import { useCallback, useEffect, useRef, useState } from 'react';
import { readToken, writeToken, fetchDashboardData } from './api';
import { currentMonth, recentMonths } from './format';
import PasswordGate from './PasswordGate';
import DashboardShell from './DashboardShell';

const MONTHS = recentMonths(6);
// 캐시된 월 데이터를 그대로 믿는 시간. 이보다 오래된 캐시는 다시 조회한다 —
// 그 사이 시트가 바뀌었을 수 있어서(제출·검수 반영). "새로고침" 버튼은 이 값과
// 무관하게 항상 강제 재조회한다.
const CACHE_TTL_MS = 5 * 60 * 1000;

function formatUpdatedAt(data) {
  const g = data?.generatedAt ? new Date(data.generatedAt) : new Date();
  return `${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')} ${String(g.getHours()).padStart(2, '0')}:${String(g.getMinutes()).padStart(2, '0')}`;
}

function dashboardErrorMessage(reason, includeProgress) {
  if (reason === 'source_missing') return includeProgress
    ? '선택한 월의 공식 집계 또는 임시 진행 자료가 아직 없습니다.'
    : '선택한 월의 공식 집계 자료가 아직 없습니다.';
  return '자료를 불러오지 못했습니다. 잠시 후 다시 시도하세요.';
}

export default function DashboardApp() {
  const [token, setToken] = useState(() => readToken());
  const [month, setMonth] = useState(currentMonth());
  const [includeProgress, setIncludeProgress] = useState(true);
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const [updatedAt, setUpdatedAt] = useState('');
  const cache = useRef(new Map()); // key: month/progress mode → { data, fetchedAt }
  const latestRequestKey = useRef(`${month}:progress`);
  const sessionGeneration = useRef(0);
  latestRequestKey.current = `${month}:${includeProgress ? 'progress' : 'official'}`;

  const load = useCallback(
    async (force) => {
      if (!token) return;
      const key = `${month}:${includeProgress ? 'progress' : 'official'}`;
      const generation = sessionGeneration.current;
      const cached = cache.current.get(key);
      if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        setState({ status: 'ready', data: cached.data, error: '' });
        setUpdatedAt(formatUpdatedAt(cached.data));
        return;
      }
      // 새 월을 선택한 직후 이전 월의 원장을 새 월 선택값 아래에 남기면
      // 담당자가 다른 달 자료를 대조하는 오판이 생긴다. 응답까지 빈 로딩 상태로 둔다.
      setState({ status: 'loading', data: null, error: '' });
      const res = await fetchDashboardData(token, month, { includeProgress });
      // 월을 빠르게 바꾸면 응답이 뒤섞일 수 있다 — 최신 요청만 반영.
      if (latestRequestKey.current !== key || sessionGeneration.current !== generation) return;
      if (res.ok) {
        cache.current.set(key, { data: res.data, fetchedAt: Date.now() });
        setState({ status: 'ready', data: res.data, error: '' });
        setUpdatedAt(formatUpdatedAt(res.data));
      } else if (res.reason === 'expired') {
        writeToken('');
        setToken('');
        cache.current.clear();
        setState({ status: 'idle', data: null, error: '' });
      } else {
        setState({ status: 'error', data: null, error: dashboardErrorMessage(res.reason, includeProgress) });
      }
    },
    [token, month, includeProgress],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const logout = () => {
    sessionGeneration.current += 1;
    writeToken('');
    setToken('');
    cache.current.clear();
    setState({ status: 'idle', data: null, error: '' });
  };

  if (!token) {
    return <PasswordGate onAuthed={() => { sessionGeneration.current += 1; setToken(readToken()); }} />;
  }

  if (state.status === 'loading' && !state.data) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-400">불러오는 중…</div>;
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center text-slate-600">
        <p className="text-sm">{state.error}</p>
        <button onClick={() => load(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm">
          다시 시도
        </button>
        <button onClick={logout} className="text-xs text-slate-400 underline">
          로그아웃
        </button>
      </div>
    );
  }

  if (!state.data) return null;

  return (
    <DashboardShell
      data={state.data}
      token={token}
      month={month}
      months={MONTHS}
      onMonthChange={setMonth}
      includeProgress={includeProgress}
      onIncludeProgressChange={setIncludeProgress}
      onRefresh={() => load(true)}
      onLogout={logout}
      updatedAt={updatedAt}
    />
  );
}
