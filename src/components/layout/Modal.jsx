import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

let pendingFocusTarget = null;

export default function Modal({ title, onClose, children, initialFocusRef, compactTitle = false }) {
  const titleId = useId();
  const closeRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => {
    pendingFocusTarget = null;
    returnFocusRef.current = document.activeElement;
    if (initialFocusRef?.current && typeof initialFocusRef.current.focus === 'function') {
      initialFocusRef.current.focus();
    } else {
      closeRef.current?.focus();
    }
    return () => {
      // The stack refresh below restores focus only after a nested parent is active.
      pendingFocusTarget = returnFocusRef.current;
    };
  }, [initialFocusRef]);

  const dialogRef = useRef(null);

  const refreshModalStack = () => {
    const dialogs = [...document.querySelectorAll('[data-receipt-modal="true"]')];
    const topDialog = dialogs.at(-1);
    dialogs.forEach((dialog) => {
      dialog.inert = dialog !== topDialog;
      dialog.setAttribute('aria-hidden', String(dialog !== topDialog));
    });
    const target = pendingFocusTarget;
    pendingFocusTarget = null;
    const fallbackTarget = topDialog?.querySelector('a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
    const focusTarget = topDialog && target?.closest?.('[data-receipt-modal="true"]') !== topDialog
      ? fallbackTarget
      : target;
    if (focusTarget) {
      try {
        focusTarget.focus();
      } catch {
        // 포커스 복귀는 최선 노력만 한다.
      }
    }
    return topDialog;
  };

  useEffect(() => {
    refreshModalStack();
    return () => {
      requestAnimationFrame(refreshModalStack);
    };
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const onKeyDown = (event) => {
      if (refreshModalStack() !== dialogRef.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      // Focus trap: Tab/Shift+Tab 시 모달 안에서만 순환
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !dialogRef.current.contains(active)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-black/80 flex items-start justify-center overflow-y-auto z-50 p-3 sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && onClose) onClose();
      }}
    >
      <div
        ref={dialogRef}
        data-receipt-modal="true"
        className="my-auto min-w-0 w-full max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto bg-slate-800 rounded-2xl p-4 shadow-2xl border border-slate-700 sm:max-h-[90dvh] sm:p-5"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={`flex justify-between items-center gap-3 ${compactTitle ? 'mb-1' : 'mb-4'}`}>
          <h2 id={titleId} className="min-w-0 break-words font-black text-xl text-slate-50">{title}</h2>
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
