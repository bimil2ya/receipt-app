import { useCallback, useEffect, useRef, useState } from 'react';
import { readToken, writeToken, fetchDashboardData } from './api';
import { currentMonth, recentMonths } from './format';
import PasswordGate from './PasswordGate';
import DashboardShell from './DashboardShell';

const MONTHS = recentMonths(6);

export default function DashboardApp() {
  const [token, setToken] = useState(() => readToken());
  const [month, setMonth] = useState(currentMonth());
  const [state, setState] = useState({ status: 'idle', data: null, error: '' });
  const [updatedAt, setUpdatedAt] = useState('');
  const cache = useRef(new Map());
  const latestMonth = useRef(month);
  latestMonth.current = month;

  const load = useCallback(
    async (force) => {
      if (!token) return;
      const key = month;
      if (!force && cache.current.has(key)) {
        setState({ status: 'ready', data: cache.current.get(key), error: '' });
        return;
      }
      setState((s) => ({ ...s, status: 'loading' }));
      const res = await fetchDashboardData(token, month);
      // 월을 빠르게 바꾸면 응답이 뒤섞일 수 있다 — 최신 요청만 반영.
      if (latestMonth.current !== key) return;
      if (res.ok) {
        cache.current.set(key, res.data);
        setState({ status: 'ready', data: res.data, error: '' });
        const g = res.data.generatedAt ? new Date(res.data.generatedAt) : new Date();
        setUpdatedAt(
          `${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')} ${String(g.getHours()).padStart(2, '0')}:${String(g.getMinutes()).padStart(2, '0')}`,
        );
      } else if (res.reason === 'expired') {
        writeToken('');
        setToken('');
        cache.current.clear();
        setState({ status: 'idle', data: null, error: '' });
      } else {
        setState({ status: 'error', data: null, error: '자료를 불러오지 못했습니다. 잠시 후 다시 시도하세요.' });
      }
    },
    [token, month],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const logout = () => {
    writeToken('');
    setToken('');
    cache.current.clear();
    setState({ status: 'idle', data: null, error: '' });
  };

  if (!token) {
    return <PasswordGate onAuthed={() => setToken(readToken())} />;
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
      onRefresh={() => load(true)}
      onLogout={logout}
      updatedAt={updatedAt}
    />
  );
}
