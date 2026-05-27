import { X } from 'lucide-react';

export default function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-5 w-full max-w-sm shadow-xl border border-slate-700">
        <div className="flex justify-between items-center mb-4">
          <h2 className="font-bold text-lg text-slate-100">{title}</h2>
          {onClose && (
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
              <X size={20} />
            </button>
          )}
        </div>
        <div className="text-slate-200">
          {children}
        </div>
      </div>
    </div>
  );
}
