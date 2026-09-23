import Modal from '../layout/Modal';
import { getToday } from '../../utils/formatter';

export default function ManualReceiptModal({ show, value, categories, initialFocusRef, amountRef, errors = {}, onChange, onClose, onSubmit }) {
  if (!show) return null;

  const update = (patch) => onChange({ ...value, ...patch });

  return (
    <Modal title="➕ 직접 입력" onClose={onClose} initialFocusRef={initialFocusRef}>
      <div className="space-y-3 p-2">
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
