export default function OfficeReviewNotice({ loading, reviews, error }) {
  if (loading) return <p className="px-2 text-xs font-bold text-slate-400">담당자 검토기록을 확인 중...</p>;
  if (error) return <p className="rounded-xl border border-amber-600/50 bg-amber-950/30 px-3 py-2 text-xs font-bold text-amber-100" role="status">{error}</p>;
  if (!reviews.length) return <p className="rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2 text-xs font-bold text-slate-400">담당자 검토기록이 없습니다. 이는 수신 또는 검수 완료를 뜻하지 않습니다.</p>;
  return <section className="rounded-2xl border border-blue-500/45 bg-blue-950/25 p-3" aria-label="담당자 검토기록">
    <p className="text-sm font-black text-blue-200">담당자 검토기록 {reviews.length}건</p>
    <div className="mt-2 space-y-2">{reviews.map((review, index) => <article key={`${review['영수증 식별값'] || index}-${index}`} className="rounded-xl bg-slate-900/70 p-2 text-xs">
      <p className="font-black text-slate-100">{review['날짜'] || '날짜 없음'} · {review['사용처'] || '사용처 없음'}</p>
      {review['검토 상태'] && <p className="mt-1 font-bold text-blue-200">{review['검토 상태']}</p>}
      {review['담당자 메모'] && <p className="mt-1 text-slate-300 whitespace-pre-wrap">{review['담당자 메모']}</p>}
      {review['추가 자료 요청'] && <p className="mt-1 font-bold text-amber-200">추가 자료: {review['추가 자료 요청']}</p>}
    </article>)}</div>
  </section>;
}
