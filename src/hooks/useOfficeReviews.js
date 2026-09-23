import { useEffect, useState } from 'react';

export default function useOfficeReviews({ teamNames, reportDate }) {
  const [state, setState] = useState({ loading: false, reviews: [], error: '' });
  useEffect(() => {
    if (!teamNames || !reportDate) { setState({ loading: false, reviews: [], error: '' }); return; }
    let active = true;
    setState(previous => ({ ...previous, loading: true, error: '' }));
    fetch(`/api/review?reportDate=${encodeURIComponent(reportDate)}&teamNames=${encodeURIComponent(teamNames)}`, { cache: 'no-store' })
      .then(async response => {
        const data = await response.json();
        if (!response.ok || !data.success) throw new Error(data.error || '검토기록 조회 실패');
        if (active) setState({ loading: false, reviews: Array.isArray(data.reviews) ? data.reviews : [], error: '' });
      })
      .catch(() => { if (active) setState({ loading: false, reviews: [], error: '검토기록을 불러오지 못했습니다.' }); });
    return () => { active = false; };
  }, [reportDate, teamNames]);
  return state;
}
