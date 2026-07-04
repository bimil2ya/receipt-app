export default function Toast({ message, bottomClass = 'bottom-24', variant = 'default' }) {
  if (!message) return null;

  const bg = variant === 'warning'
    ? 'bg-amber-900/90 border-amber-600 text-amber-100'
    : 'bg-slate-800 border-slate-700';

  return (
    <div className={`fixed ${bottomClass} left-0 right-0 z-50 flex justify-center px-4`}>
      <div className={`${bg} border rounded-2xl px-6 py-3 shadow-2xl font-bold text-center leading-snug`}>{message}</div>
    </div>
  );
}
