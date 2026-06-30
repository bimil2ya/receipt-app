import Modal from '../layout/Modal';
import { getToday } from '../../utils/formatter';

export default function ManualReceiptModal({ show, value, categories, initialFocusRef, onChange, onClose, onSubmit }) {
  if (!show) return null;

  const update = (patch) => onChange({ ...value, ...patch });

  return (
    <Modal title="➕ 직접 입력" onClose={onClose} initialFocusRef={initialFocusRef}>
      <div className="space-y-5 p-2">
        <input ref={initialFocusRef} placeholder="🏢 사용처" value={value.storeName} onChange={e => update({ storeName: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400 font-black w-12 shrink-0">📅 날짜</span>
          <input type="date" value={value.date} onChange={e => update({ date: e.target.value || getToday() })} className="flex-1 bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-3 text-white font-bold text-base" />
        </div>
        <input placeholder="⏱️ 사용시간 예: 14:30" value={value.useTime} onChange={e => update({ useTime: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
        <input type="number" placeholder="💰 금액" value={value.totalAmount} onChange={e => update({ totalAmount: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
        <input placeholder="🔢 승인번호" value={value.approvalNum} onChange={e => update({ approvalNum: e.target.value })} className="w-full bg-slate-900 border-2 border-amber-700/70 rounded-2xl px-5 py-4 text-white font-black text-base" />
        <div className="grid grid-cols-2 gap-2">{categories.map(category => {
          const active = value.category === category;
          const catClass = active
            ? 'bg-blue-600 border-blue-400 text-white'
            : 'bg-slate-900 border-slate-700 text-slate-100';
          return (
            <button
              key={category}
              onClick={() => update({ category })}
              className={`py-4 rounded-xl font-black text-sm border-2 ${catClass}`}
            >
              {category}
            </button>
          );
        })}</div>
        <input placeholder="🏷️ 사업자번호" value={value.bizNum} onChange={e => update({ bizNum: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
        <input placeholder="💳 카드번호" value={value.cardNumber} onChange={e => update({ cardNumber: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
        <input placeholder="📝 비고" value={value.note} onChange={e => update({ note: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
        <button onClick={onSubmit} className="w-full bg-blue-600 py-5 rounded-2xl text-xl font-black">추가</button>
      </div>
    </Modal>
  );
}
