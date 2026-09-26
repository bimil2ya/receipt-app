import { useCallback, useEffect, useRef, useState } from 'react';

// 카메라·카톡 등에서 돌아올 때마다 서버를 부르지 않도록 자동 새로고침 간격을 둔다.
export const OFFICE_REVIEW_AUTO_REFRESH_MS = 30_000;

export default function useOfficeReviews({ teamNames, reportDate }) {
  const scopeKey = teamNames && reportDate ? `${teamNames}|${reportDate}` : '';
  const [state, setState] = useState({ loading: false, reviews: [], error: '', scopeKey: '' });
  const [reloadKey, setReloadKey] = useState(0);
  const lastFetchedAtRef = useRef(0);

  const reload = useCallback(() => setReloadKey(key => key + 1), []);

  useEffect(() => {
    if (!scopeKey) { setState({ loading: false, reviews: [], error: '', scopeKey: '' }); return undefined; }
    let active = true;
    lastFetchedAtRef.current = Date.now();
    // 같은 팀·출장을 다시 읽는 동안에는 기존 목록을 유지하고, 팀이 바뀌면 비운다.
    setState(previous => ({
      loading: true,
      reviews: previous.scopeKey === scopeKey ? previous.reviews : [],
      error: '',
      scopeKey,
    }));
    fetch(`/api/review?reportDate=${encodeURIComponent(reportDate)}&teamNames=${encodeURIComponent(teamNames)}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '검토기록 조회 실패');
        if (active) setState({ loading: false, reviews: Array.isArray(data.reviews) ? data.reviews : [], error: '', scopeKey });
      })
      .catch(() => {
        if (active) setState(previous => ({ ...previous, loading: false, error: '검토기록을 불러오지 못했습니다.' }));
      });
    return () => { active = false; };
  }, [reportDate, teamNames, scopeKey, reloadKey]);

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handleVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchedAtRef.current < OFFICE_REVIEW_AUTO_REFRESH_MS) return;
      reload();
    };
    document.addEventListener('visibilitychange', handleVisible);
    return () => document.removeEventListener('visibilitychange', handleVisible);
  }, [reload]);

  return { loading: state.loading, reviews: state.reviews, error: state.error, reload };
}
