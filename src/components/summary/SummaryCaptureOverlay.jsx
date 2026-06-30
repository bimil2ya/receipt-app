export default function SummaryCaptureOverlay({ show }) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/90 flex items-center justify-center pointer-events-none">
      <p className="text-white font-black text-lg">이미지 준비 중…</p>
    </div>
  );
}
