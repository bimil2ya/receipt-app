import Modal from '../layout/Modal';
import { formatCurrency } from '../../utils/formatter';

export default function DuplicateReportModal({ show, report, onClose }) {
  if (!show || !report) return null;

  const sections = [
    ['중복 후보', report.confirmedGroups || []],
    ['확인 필요', report.reviewGroups || []],
  ];

  return (
    <Modal title="승인번호 확인" onClose={onClose}>
      <div className="space-y-4 p-1">
        <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4">
          <p className="text-sm font-black text-slate-100">요약</p>
          <p className="text-xs font-bold text-slate-400 mt-1 leading-5">
            중복 후보 {report.confirmedGroupCount || 0}건 · 확인 필요 {report.reviewGroupCount || 0}건 · 승인번호 없음 {report.missingApprovalCount || 0}건
          </p>
        </div>
        {sections.map(([title, groups]) => (
          groups.length > 0 && (
            <div key={title} className="space-y-2">
              <p className="text-sm font-black text-amber-200">{title}</p>
              {groups.map((group, groupIndex) => (
                <div key={`${title}-${group.approvalKey}-${groupIndex}`} className="rounded-2xl bg-slate-900/80 border border-slate-700 p-3">
                  <p className="text-xs font-black text-slate-300">승인번호 {group.approvalKey} · {group.count}건</p>
                  <div className="mt-2 space-y-1.5">
                    {(group.receipts || []).map((receipt, receiptIndex) => (
                      <div key={`${group.approvalKey}-${receiptIndex}`} className="text-xs font-bold text-slate-400 leading-5 border-t border-slate-800 pt-1.5">
                        <span className="text-slate-200">{receipt.date || '날짜없음'}</span>
                        {' '}{receipt.storeName || '사용처 없음'} · {formatCurrency(receipt.amount || 0)}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ))}
        <p className="text-xs font-bold text-slate-500 leading-5">
          이 화면은 확인용입니다. 파일 삭제나 이동은 하지 않습니다.
        </p>
      </div>
    </Modal>
  );
}
