export default function LaunchSplash({ show }) {
  if (!show) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950"
      aria-hidden="true"
    >
      <img
        src="/icon-192x192.png"
        alt=""
        className="h-20 w-20 select-none"
        draggable="false"
      />
    </div>
  );
}
