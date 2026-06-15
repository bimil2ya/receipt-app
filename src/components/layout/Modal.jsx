import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, onClose, children, initialFocusRef }) {
  const titleId = useId();
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    if (initialFocusRef?.current && typeof initialFocusRef.current.focus === 'function') {
      initialFocusRef.current.focus();
    } else {
      closeRef.current?.focus();
    }
    return () => {
      const el = returnFocusRef.current;
      if (el && typeof el.focus === 'function') {
        try {
          el.focus();
        } catch {
          // 포커스 복귀는 최선 노력만 한다.
        }
      }
    };
  }, [initialFocusRef]);

  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onClose) onClose();
      }}
    >
      <div
        className="bg-slate-800 rounded-2xl p-5 w-full max-w-md max-h-[90dvh] overflow-y-auto shadow-2xl border border-slate-700"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex justify-between items-center gap-3 mb-4">
          <h2 id={titleId} className="font-black text-xl text-slate-50">{title}</h2>
          {onClose && (
            <button
              ref={closeRef}
              onClick={onClose}
              className="w-11 h-11 rounded-xl text-slate-200 bg-slate-900/70 border border-slate-700 flex items-center justify-center"
              aria-label="닫기"
            >
              <X size={22} />
            </button>
          )}
        </div>
        <div className="text-slate-200 text-[1rem]">
          {children}
        </div>
      </div>
    </div>
  );
}
