import { RefreshCw } from 'lucide-react';

export default function ProcessingBanner({ show, message }) {
  if (!show) return null;

  return (
    <div className="bg-blue-900/40 p-4 rounded-2xl flex gap-4 items-center border border-blue-700 min-w-0">
      <RefreshCw size={26} className="animate-spin text-blue-300 shrink-0" />
      <span className="text-lg font-black min-w-0 break-words">{message}</span>
    </div>
  );
}
