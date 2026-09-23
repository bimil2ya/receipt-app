import Modal from '../layout/Modal';

export default function ReceiptEditModal({ editState, categories, errors = {}, amountRef, onChange, onClose, onSubmit }) {
  if (!editState.id) return null;

  const updateDetail = (patch) => {
    onChange(prev => ({ ...prev, value: { ...prev.value, ...patch } }));
  };

  return (
    <Modal title="📝 수정" onClose={onClose}>
      <div className="p-1">
        {editState.field === 'detail' ? (
          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-300" htmlFor="edit-receipt-date">날짜</label>
            <input id="edit-receipt-date" type="date" value={editState.value.date} onChange={e => updateDetail({ date: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" />
            <label className="block text-sm font-bold text-slate-300" htmlFor="edit-receipt-time">사용시간</label>
            <input id="edit-receipt-time" value={editState.value.useTime || ''} onChange={e => updateDetail({ useTime: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" placeholder="예: 14:30" />
            <label className="block text-sm font-bold text-slate-300" htmlFor="edit-receipt-store">사용처</label>
            <input id="edit-receipt-store" value={editState.value.storeName} onChange={e => updateDetail({ storeName: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" />
            <label className="block text-sm font-bold text-slate-300" htmlFor="edit-receipt-amount">금액</label>
            <input id="edit-receipt-amount" ref={amountRef} inputMode="numeric" value={editState.value.totalAmount} onChange={e => updateDetail({ totalAmount: e.target.value })} aria-invalid={Boolean(errors.totalAmount)} aria-describedby={errors.totalAmount ? 'edit-amount-error' : undefined} className={`w-full bg-slate-900 border-2 rounded-2xl px-4 py-4 text-white font-black text-base ${errors.totalAmount ? 'border-red-400' : 'border-slate-700'}`} />
            {errors.totalAmount && <p id="edit-amount-error" className="text-sm font-bold text-red-300" role="alert">{errors.totalAmount}</p>}
            <label className="block text-sm font-bold text-slate-300" htmlFor="edit-receipt-approval">승인번호</label>
            <input id="edit-receipt-approval" value={editState.value.approvalNum || ''} onChange={e => updateDetail({ approvalNum: e.target.value })} className="w-full bg-slate-900 border-2 border-amber-700/70 rounded-2xl px-4 py-4 text-white font-black text-base" />
            <div className="grid grid-cols-2 gap-2">{categories.map(category => {
              const active = editState.value.category === category;
              const catClass = active
                ? 'bg-blue-600 border-blue-400 text-white'
                : 'bg-slate-900 border-slate-700 text-slate-100';
              return (
                <button
                  key={category}
                  onClick={() => updateDetail({ category })}
                  className={`py-3 rounded-xl font-black text-sm border-2 ${catClass}`}
                >
                  {category}
                </button>
              );
            })}</div>
            <label className="block text-sm font-bold text-slate-300" htmlFor="edit-receipt-biz">사업자번호</label>
            <input id="edit-receipt-biz" value={editState.value.bizNum || ''} onChange={e => updateDetail({ bizNum: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" />
            <label className="block text-sm font-bold text-slate-300" htmlFor="edit-receipt-card">카드번호</label>
            <input id="edit-receipt-card" value={editState.value.cardNumber || ''} onChange={e => updateDetail({ cardNumber: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" />
            <label className="block text-sm font-bold text-slate-300" htmlFor="edit-receipt-note">비고</label>
            <input id="edit-receipt-note" value={editState.value.note} onChange={e => updateDetail({ note: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" />
          </div>
        ) : editState.field === 'category' ? (
          <div className="grid grid-cols-2 gap-3 mb-8">{categories.map(category => {
            const active = editState.value === category;
            const catClass = active
              ? 'bg-blue-600 border-blue-400 text-white shadow-lg scale-105'
              : 'bg-slate-900 border-slate-700 text-slate-100';
            return (
              <button
                key={category}
                onClick={() => onChange(prev => ({ ...prev, value: category }))}
                className={`py-5 rounded-2xl font-black text-lg border-2 transition-all ${catClass}`}
              >
                {category}
              </button>
            );
          })}</div>
        ) : (
          <input autoFocus value={editState.value} onChange={e => onChange(prev => ({ ...prev, value: e.target.value }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-5 mb-8 text-2xl text-white font-black" />
        )}
        <button onClick={onSubmit} className="w-full bg-blue-600 py-5 rounded-2xl text-xl font-black mt-6">저장</button>
      </div>
    </Modal>
  );
}
