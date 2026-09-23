import { useEffect, useRef, useState } from 'react';
import Modal from '../layout/Modal';
import { getToday } from '../../utils/formatter';

export default function ManualReceiptModal({ show, value, categories, initialFocusRef, amountRef, errors = {}, onChange, onClose, onSubmit }) {
  const [autoSaveStatus, setAutoSaveStatus] = useState('editing'); // 'editing' | 'saving' | 'saved' | 'error'
  const [autoSaveError, setAutoSaveError] = useState(null);
  const autoSaveTimerRef = useRef(null);
  const previousValueRef = useRef(null);

  // 필드 변경 감지 (storeName, totalAmount)
  const hasRequiredFields = () => {
    return value.storeName?.trim() && String(value.totalAmount).trim();
  };

  const fieldsChanged = () => {
    if (!previousValueRef.current) return true;
    return (
      previousValueRef.current.storeName !== value.storeName ||
      previousValueRef.current.totalAmount !== value.totalAmount ||
      previousValueRef.current.date !== value.date ||
      previousValueRef.current.category !== value.category ||
      previousValueRef.current.note !== value.note
    );
  };

  // 자동 저장 타이머 로직
  useEffect(() => {
    if (!show || !fieldsChanged()) {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      return;
    }

    // 기존 타이머 취소
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    setAutoSaveStatus('editing');
    setAutoSaveError(null);

    // 3초 후 자동 저장
    autoSaveTimerRef.current = setTimeout(async () => {
      if (!hasRequiredFields()) {
        setAutoSaveStatus('editing');
        previousValueRef.current = value;
        return;
      }

      try {
        setAutoSaveStatus('saving');
        const response = await fetch('/api/auto-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeName: value.storeName,
            totalAmount: value.totalAmount,
            date: value.date || null,
            category: value.category || null,
            note: value.note || null,
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || '자동 저장 실패');
        }

        setAutoSaveStatus('saved');
        setAutoSaveError(null);
        previousValueRef.current = value;

        // 3초 후 saved 상태 해제
        setTimeout(() => {
          if (show) setAutoSaveStatus('editing');
        }, 3000);
      } catch (err) {
        console.error('[ManualReceiptModal auto-save] Error:', err);
        setAutoSaveStatus('error');
        setAutoSaveError(err.message);
      }
    }, 3000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, value]);

  const autoSaveStatusText = {
    editing: '작성 중... 💭',
    saving: '저장 중...',
    saved: '저장됨 ✅',
    error: '저장 실패 ❌',
  };

  const autoSaveStatusColor = {
    editing: 'text-slate-400',
    saving: 'text-blue-400 animate-pulse',
    saved: 'text-green-400',
    error: 'text-red-400',
  };

  if (!show) return null;

  const update = (patch) => onChange({ ...value, ...patch });

  return (
    <Modal title="➕ 직접 입력" onClose={onClose} initialFocusRef={initialFocusRef}>
      <div className="space-y-3 p-2">
        {/* 자동 저장 상태 표시 */}
        <div className={`text-sm font-bold ${autoSaveStatusColor[autoSaveStatus]}`}>
          {autoSaveStatusText[autoSaveStatus]}
          {autoSaveError && <div className="text-xs text-red-300 mt-1">{autoSaveError}</div>}
          {autoSaveStatus === 'error' && (
            <button
              onClick={async () => {
                if (!hasRequiredFields()) return;
                try {
                  setAutoSaveStatus('saving');
                  const response = await fetch('/api/auto-save', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      storeName: value.storeName,
                      totalAmount: value.totalAmount,
                      date: value.date || null,
                      category: value.category || null,
                      note: value.note || null,
                    }),
                  });
                  if (!response.ok) throw new Error('재시도 실패');
                  setAutoSaveStatus('saved');
                  previousValueRef.current = value;
                } catch (err) {
                  setAutoSaveStatus('error');
                  setAutoSaveError(err.message);
                }
              }}
              className="ml-2 text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700"
            >
              [다시 시도]
            </button>
          )}
        </div>
        <label className="block text-sm font-bold text-slate-300" htmlFor="manual-receipt-store">사용처</label>
        <input
          id="manual-receipt-store"
          ref={initialFocusRef}
          placeholder="🏢 사용처"
          value={value.storeName}
          onChange={e => update({ storeName: e.target.value })}
          aria-invalid={Boolean(errors.storeName)}
          aria-describedby={errors.storeName ? 'manual-store-error' : undefined}
          className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base"
        />
        {errors.storeName && <p id="manual-store-error" className="text-sm font-bold text-red-300" role="alert">{errors.storeName}</p>}
        <div className="flex items-center gap-3">
          <label className="text-sm text-slate-400 font-black w-12 shrink-0" htmlFor="manual-receipt-date">📅 날짜</label>
          <input
            id="manual-receipt-date"
            type="date"
            value={value.date}
            onChange={e => update({ date: e.target.value || getToday() })}
            className="flex-1 bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-3 text-white font-bold text-base"
          />
        </div>
        <label className="block text-sm font-bold text-slate-300" htmlFor="manual-receipt-amount">금액</label>
        <input
          id="manual-receipt-amount"
          ref={amountRef}
          inputMode="numeric"
          placeholder="💰 금액"
          value={value.totalAmount}
          onChange={e => update({ totalAmount: e.target.value })}
          aria-invalid={Boolean(errors.totalAmount)}
          aria-describedby={errors.totalAmount ? 'manual-amount-error' : undefined}
          className={`w-full bg-slate-900 border-2 rounded-2xl px-5 py-4 text-white font-black text-base ${errors.totalAmount ? 'border-red-400' : 'border-slate-700'}`}
        />
        {errors.totalAmount && <p id="manual-amount-error" className="text-sm font-bold text-red-300" role="alert">{errors.totalAmount}</p>}
        <div className="grid grid-cols-2 gap-2">
          {categories.map(category => {
            const active = value.category === category;
            return (
              <button
                key={category}
                onClick={() => update({ category })}
                className={`py-4 rounded-xl font-black text-sm border-2 ${
                  active ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-100'
                }`}
              >
                {category}
              </button>
            );
          })}
        </div>
        <label className="block text-sm font-bold text-slate-300" htmlFor="manual-receipt-note">비고 (선택)</label>
        <input
          id="manual-receipt-note"
          placeholder="📝 비고 (선택)"
          value={value.note}
          onChange={e => update({ note: e.target.value })}
          className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base"
        />
        <button onClick={onSubmit} className="w-full bg-blue-600 py-5 rounded-2xl text-xl font-black">추가</button>
      </div>
    </Modal>
  );
}
