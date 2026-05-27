import { memo } from 'react';
import { Pencil, Image as ImageIcon, Trash2 } from 'lucide-react';
import { formatCurrency, formatDateSlash } from '../../utils/formatter';

const CAT_STYLE = {
  '숙박비': { bg: '#3b1f6e', text: '#c4b5fd', border: '#5b21b6' },
  '식비': { bg: '#14532d', text: '#86efac', border: '#166534' },
  '유류비': { bg: '#431407', text: '#fdba74', border: '#9a3412' },
  '기타': { bg: '#1e293b', text: '#94a3b8', border: '#334155' },
};

function ReceiptRow({ receipt, isSelected, onEdit, onViewImage, onDelete }) {
  const cs = CAT_STYLE[receipt.category] || CAT_STYLE['기타'];

  return (
    <div
      id={`receipt-row-${receipt.id}`}
      className={`border-t border-slate-700/40 active:bg-slate-700/30 select-none transition-colors ${isSelected ? 'bg-slate-700/20' : ''}`}
      style={{ padding: '12px 14px' }}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {/* 날짜 (MM/DD 형식) */}
        <span
          onClick={() => onEdit(receipt.id, 'date', receipt.date)}
          className="w-12 text-slate-500 text-xs whitespace-nowrap cursor-pointer shrink-0 text-center font-bold"
        >
          {formatDateSlash(receipt.date)}
        </span>

        {/* 사용처 (공간 확장) */}
        <div className="flex-1 min-w-0 ml-1">
          <span
            onClick={() => onEdit(receipt.id, 'storeName', receipt.storeName)}
            className="text-slate-100 text-base font-bold truncate block cursor-pointer"
          >
            {receipt.storeName}
          </span>
          {receipt.note && (
            <span className="text-[10px] text-slate-500 truncate block">{receipt.note}</span>
          )}
        </div>

        {/* 용도 */}
        <div className="w-12 shrink-0 flex justify-center">
          <span
            onClick={() => onEdit(receipt.id, 'category', receipt.category)}
            className="text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap cursor-pointer font-black"
            style={{ background: cs.bg, color: cs.text, border: `1px solid ${cs.border}` }}
          >
            {receipt.category.slice(0, 2)}
          </span>
        </div>

        {/* 금액 */}
        <div className="w-16 shrink-0 text-right">
          <span
            onClick={() => onEdit(receipt.id, 'totalAmount', String(receipt.totalAmount))}
            className="text-green-400 text-sm font-black whitespace-nowrap cursor-pointer"
          >
            {formatCurrency(receipt.totalAmount).replace('원','')}
          </span>
        </div>

        {/* 액션 버튼들: 삭제 -> 수정 -> 이미지 (밀착 배치) */}
        <div className="flex items-center shrink-0 ml-1">
          <button 
            onClick={() => onDelete(receipt.id)} 
            className="p-1 text-amber-500/70 active:bg-amber-500/20 rounded"
          >
            <Trash2 size={15} />
          </button>
          <button 
            onClick={() => onEdit(receipt.id, 'detail')} 
            className="p-1 text-slate-500 active:bg-slate-700 rounded"
          >
            <Pencil size={15} />
          </button>
          <button 
            onClick={() => onViewImage(receipt.id)} 
            className={`p-1 rounded ${isSelected ? 'text-blue-400' : 'text-slate-500 active:bg-slate-700'}`}
          >
            <ImageIcon size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default memo(ReceiptRow);
