import { useEffect, useRef, useState } from 'react';
import { fetchReportObjectUrl } from './api';

// 조별 정산서 PDF — 표지가 용도별 집계장, 이후 페이지가 영수증 이미지.
// 화면으로 보기(인라인) / 인쇄(새 탭 → 브라우저 PDF 뷰어에서 Ctrl+P).
export default function ReportsPanel({ token, reports }) {
  const [openRef, setOpenRef] = useState(null);
  const [state, setState] = useState({ status: 'idle', url: '', error: '' });
  const urlRef = useRef('');
  // 서로 다른 정산서를 연달아 열면(두 번째 클릭이 첫 요청 완료 전에 발생) 응답이
  // 늦게 온 쪽이 화면을 덮어쓸 수 있다 — 이 값과 다르면 그 응답은 버린다.
  const requestedRef = useRef(null);

  // 열려 있던 objectURL 정리
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  function revoke() {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = '';
    }
  }

  async function load(ref) {
    if (openRef === ref) {
      // 토글 닫기
      requestedRef.current = null;
      revoke();
      setOpenRef(null);
      setState({ status: 'idle', url: '', error: '' });
      return;
    }
    revoke();
    setOpenRef(ref);
    requestedRef.current = ref;
    setState({ status: 'loading', url: '', error: '' });
    const res = await fetchReportObjectUrl(token, ref);
    if (requestedRef.current !== ref) {
      // 응답이 오는 사이 다른 정산서를 열었거나 닫았다 — 이 결과는 화면에 반영하지 않는다.
      if (res.ok) URL.revokeObjectURL(res.url);
      return;
    }
    if (res.ok) {
      urlRef.current = res.url;
      setState({ status: 'ready', url: res.url, error: '' });
    } else {
      const msg =
        res.reason === 'expired'
          ? '세션이 만료됐습니다. 다시 로그인하세요.'
          : res.reason === 'toolarge'
            ? '이 정산서는 화면 미리보기가 어려울 만큼 큽니다. Drive에서 직접 확인하세요.'
            : 'PDF를 불러오지 못했습니다.';
      setState({ status: 'error', url: '', error: msg });
    }
  }

  // 인쇄 = 새 탭으로 PDF를 열고 브라우저 PDF 뷰어의 인쇄(Ctrl+P)로 출력.
  // 인라인 보기(load)와 독립 — openRef/state를 건드리지 않는다.
  async function print(ref) {
    const res = await fetchReportObjectUrl(token, ref);
    if (!res.ok) {
      // 실패하면 인라인으로 열어 오류 메시지를 보여준다.
      load(ref);
      return;
    }
    window.open(res.url, '_blank', 'noopener');
    // 탭이 바이트를 복사한 뒤 해제 (탭은 blob 무효화 후에도 로드된 PDF를 유지).
    setTimeout(() => URL.revokeObjectURL(res.url), 30000);
  }

  if (!reports || reports.length === 0) {
    return <p className="text-sm text-slate-500">이 달 정산서 PDF가 없습니다.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {reports.map((r) => {
        const isOpen = !!openRef && openRef === r.ref;
        return (
          <div key={r.ref || r.label} className="rounded-lg border border-slate-200">
            <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
              <span className="font-medium">{r.label}</span>
              {r.date && <span className="font-mono text-xs text-slate-400">{r.date}</span>}
              <span className="ml-auto flex gap-2">
                {r.available ? (
                  <>
                    <button
                      type="button"
                      onClick={() => load(r.ref)}
                      className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-600"
                    >
                      {isOpen ? '닫기' : '화면으로 보기'}
                    </button>
                    <button
                      type="button"
                      onClick={() => print(r.ref)}
                      className="rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
                    >
                      인쇄
                    </button>
                  </>
                ) : (
                  <span className="text-xs text-slate-400">P2 연결 후 사용</span>
                )}
              </span>
            </div>

            {isOpen && (
              <div className="border-t border-slate-100 p-2">
                {state.status === 'loading' && <p className="p-3 text-sm text-slate-400">불러오는 중…</p>}
                {state.status === 'error' && <p className="p-3 text-sm text-rose-600">{state.error}</p>}
                {state.status === 'ready' && (
                  <iframe title={r.label} src={state.url} className="h-[70vh] w-full rounded border border-slate-200" />
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
