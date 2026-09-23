import { memo } from 'react';
import { Pencil, Image as ImageIcon, Trash2 } from 'lucide-react';
import { formatCurrency, formatDateSlash, decodeHtmlEntities } from '../../utils/formatter';

const CAT_STYLE = {
  '숙박비': { bg: '#3b1f6e', text: '#c4b5fd', border: '#5b21b6' },
  '식비': { bg: '#14532d', text: '#86efac', border: '#166534' },
  '유류비': { bg: '#431407', text: '#fdba74', border: '#9a3412' },
  '의료비등': { bg: '#831843', text: '#f9a8d4', border: '#9d174d' },
  '기타': { bg: '#1e293b', text: '#94a3b8', border: '#334155' },
};

function isDateOutOfRange(date, tripStartDate, tripEndDate) {
  if (!date || !tripStartDate) return false;
  const d = date.slice(0, 10);
  const s = tripStartDate.slice(0, 10);
  const e = (tripEndDate || tripStartDate).slice(0, 10);
  return d < s || d > e;
}

function ReceiptRow({ receipt, officeReview, isSelected, isNew, onEdit, onViewImage, onDelete, onAddSupportingMaterial, rowIndex = 0, tripStartDate, tripEndDate }) {
  const category = receipt.category || '기타';
  const cs = CAT_STYLE[category] || CAT_STYLE['기타'];
  const zebra = rowIndex % 2 === 0 ? 'bg-white/[0.03]' : 'bg-white/[0.12]';
  const approvalNum = String(receipt.approvalNum || '').trim();
  const approvalLabel = approvalNum ? `승인 ${approvalNum.slice(-4)}` : '승인번호 없음';
  const outOfRange = isDateOutOfRange(receipt.date, tripStartDate, tripEndDate);

  return (
    <div
      id={`receipt-row-${receipt.id}`}
      className={`receipt-row active:bg-slate-700/30 select-none transition-colors px-4 py-2 ${
        isNew ? 'bg-emerald-500/10 border-l-4 border-emerald-400' :
        isSelected ? 'bg-blue-500/10' : zebra
      }`}
    >
      <div className="grid grid-cols-[3.5rem_1fr_auto] gap-x-3 gap-y-0.5 min-w-0">
        {/* 날짜 — 출장기간 벗어나면 빨간색 + 연도 2자리 포함 + "기간외" 라벨 */}
        <span className={`whitespace-nowrap shrink-0 text-center font-black leading-none pt-0.5 ${outOfRange ? 'text-red-400 text-[10px]' : 'text-slate-400 text-sm'}`}>
          {outOfRange
            ? receipt.date
                ? `${String(receipt.date).slice(2, 4)}/${String(receipt.date).slice(5, 7)}/${String(receipt.date).slice(8, 10)}`
                : ''
            : formatDateSlash(receipt.date)
          }
          {outOfRange && <span className="block text-[9px] font-bold leading-tight mt-0.5">기간외</span>}
        </span>

        {/* 사용처 (공간 확장) */}
        <div className="min-w-0">
          <span className="text-slate-50 text-[1rem] font-black truncate block leading-tight">
            {decodeHtmlEntities(receipt.storeName)}
          </span>
          {receipt.note && (
            <span className="text-sm text-slate-400 truncate block mt-0.5 leading-tight">{decodeHtmlEntities(receipt.note)}</span>
          )}
          {officeReview && (
            <div className="mt-1 rounded-lg border border-blue-500/45 bg-blue-950/30 px-2 py-1 text-[10px] font-bold text-blue-100">
              <span className="font-black text-blue-200">담당자 검토{officeReview['검토 상태'] ? ` · ${officeReview['검토 상태']}` : ''}</span>
              {officeReview['담당자 메모'] && <span className="block mt-0.5 whitespace-pre-wrap">{officeReview['담당자 메모']}</span>}
              {officeReview['추가 자료 요청'] && <span className="block mt-0.5 text-amber-200">추가 자료: {officeReview['추가 자료 요청']}</span>}
              {officeReview['추가 자료 요청'] && <button type="button" onClick={() => onAddSupportingMaterial?.(receipt.id)} className="mt-1 min-h-8 rounded-lg border border-amber-400/60 px-2 text-[10px] font-black text-amber-100">요청 자료 사진 추가</button>}
              {officeReview['추가 자료 요청'] && <button type="button" onClick={() => onAddSupportingMaterial?.(receipt.id, 'manual')} className="ml-1 mt-1 min-h-8 rounded-lg border border-slate-500/70 px-2 text-[10px] font-black text-slate-200">요청 자료 직접입력</button>}
            </div>
          )}
          {Number(receipt.revision) > 1 && <span className="mt-1 block text-[10px] font-bold text-slate-400">수정 버전 {receipt.revision}</span>}
        </div>

        {/* 용도 */}
        <div className="shrink-0 flex justify-end items-center">
          <span
            className="inline-block text-[11px] px-1.5 py-0 rounded-full whitespace-nowrap font-semibold leading-tight"
            style={{ background: cs.bg, color: cs.text, border: `1px solid ${cs.border}` }}
          >
            {category}
          </span>
        </div>

        <div className="col-start-2 col-end-4 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-green-400 text-[0.95rem] font-black whitespace-nowrap leading-none">
              {formatCurrency(receipt.totalAmount).replace('원','')}
            </div>
            <div className={`text-[10px] font-black mt-1 truncate ${approvalNum ? 'text-slate-500' : 'text-amber-300'}`}>
              {approvalLabel}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => onDelete(receipt.id)}
              className="w-11 h-11 flex items-center justify-center rounded-xl border bg-slate-800 border-slate-700 text-amber-300"
              aria-label="삭제"
            >
              <Trash2 size={12} />
            </button>
            <button
              onClick={() => onEdit(receipt.id, 'detail')}
              className="w-11 h-11 flex items-center justify-center rounded-xl border bg-slate-800 border-slate-700 text-slate-300"
              aria-label="수정"
            >
              <Pencil size={12} />
            </button>
            <button
              onClick={() => onViewImage(receipt.id)}
              className={`w-11 h-11 flex items-center justify-center rounded-xl border ${isSelected ? 'bg-blue-600/20 border-blue-500 text-blue-300' : 'bg-slate-800 border-slate-700 text-slate-300'}`}
              aria-label="이미지 보기"
            >
              <ImageIcon size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ReceiptRow);
