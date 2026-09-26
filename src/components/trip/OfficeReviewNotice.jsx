function RefreshButton({ loading, onRefresh }) {
  if (!onRefresh) return null;
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={loading}
      className="shrink-0 min-h-9 rounded-lg border border-slate-600 bg-slate-800 px-3 text-xs font-black text-slate-100 disabled:opacity-60"
    >
      {loading ? '확인 중…' : '검토기록 새로고침'}
    </button>
  );
}

export default function OfficeReviewNotice({ loading, reviews, error, onRefresh }) {
  const hasReviews = reviews.length > 0;
  return (
    <section
      className={`rounded-2xl border p-3 ${hasReviews ? 'border-blue-500/45 bg-blue-950/25' : 'border-slate-700 bg-slate-900/50'}`}
      aria-label="담당자 검토기록"
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`font-black ${hasReviews ? 'text-sm text-blue-200' : 'text-xs text-slate-400'}`}>
          {hasReviews
            ? `담당자 검토기록 ${reviews.length}건`
            : loading
              ? '담당자 검토기록을 확인 중...'
              : error
                ? '담당자 검토기록'
                : '담당자 검토기록이 없습니다. 이는 수신 또는 검수 완료를 뜻하지 않습니다.'}
        </p>
        <RefreshButton loading={loading} onRefresh={onRefresh} />
      </div>
      {error && <p className="mt-2 rounded-xl border border-amber-600/50 bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-100" role="status">{error}</p>}
      {hasReviews && <div className="mt-2 space-y-2">{reviews.map((review, index) => <article key={`${review['영수증 식별값'] || index}-${index}`} className="rounded-xl bg-slate-900/70 p-2 text-xs">
        <p className="font-black text-slate-100">{review['날짜'] || '날짜 없음'} · {review['사용처'] || '사용처 없음'}</p>
        {review['검토 상태'] && <p className="mt-1 font-bold text-blue-200">{review['검토 상태']}</p>}
        {review['담당자 메모'] && <p className="mt-1 text-slate-300 whitespace-pre-wrap">{review['담당자 메모']}</p>}
        {review['추가 자료 요청'] && <p className="mt-1 font-bold text-amber-200">추가 자료: {review['추가 자료 요청']}</p>}
      </article>)}</div>}
    </section>
  );
}
