export default function DuplicateReportNotice({ report, onOpen }) {
  if (!report) return null;
  const confirmed = report.confirmedGroupCount || 0;
  const review = report.reviewGroupCount || 0;
  const missing = report.missingApprovalCount || 0;
  if (confirmed === 0 && review === 0 && missing === 0) return null;

  const parts = [];
  if (confirmed > 0) parts.push(`중복 후보 ${confirmed}건`);
  if (review > 0) parts.push(`확인 필요 ${review}건`);
  if (missing > 0) parts.push(`승인번호 없음 ${missing}건`);

  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2">
      <p className="text-[11px] font-bold text-slate-500 leading-4 truncate">
        승인번호 {parts.join(' · ')}
      </p>
      <button
        type="button"
        onClick={onOpen}
        className="shrink-0 text-[11px] font-black text-slate-400 active:scale-95"
      >
        상세
      </button>
    </div>
  );
}
