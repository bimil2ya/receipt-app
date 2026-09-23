import { useRef, useState } from 'react';
import { getToday } from '../utils/formatter';
import { parseReceiptAmount } from '../utils/receiptAmount';
import { buildReceiptAudit } from '../utils/deviceIdentity';

const INITIAL_MANUAL_RECEIPT = {
  date: getToday(),
  useTime: '',
  storeName: '',
  totalAmount: '',
  category: '식비',
  approvalNum: '',
  bizNum: '',
  cardNumber: '',
  note: '',
};

export default function useManualReceiptEntry({ saveReceipts, setPinnedNewIds, showToast, onClose, assignment = {}, relatedReviewReceiptId = '', onAdded }) {
  const [manualReceipt, setManualReceipt] = useState(INITIAL_MANUAL_RECEIPT);
  const [manualErrors, setManualErrors] = useState({});
  const manualStoreRef = useRef(null);
  const manualAmountRef = useRef(null);
  const savingRef = useRef(false);

  const updateManualReceipt = (nextValue) => {
    setManualErrors({});
    setManualReceipt(nextValue);
  };

  const handleManualAdd = async () => {
    if (savingRef.current) return;
    if (!manualReceipt.storeName.trim()) {
      setManualErrors({ storeName: '사용처를 입력해 주세요.' });
      manualStoreRef.current?.focus();
      return;
    }
    const amount = parseReceiptAmount(manualReceipt.totalAmount);
    if (!amount.ok) {
      setManualErrors({ totalAmount: amount.error });
      manualAmountRef.current?.focus();
      return;
    }
    savingRef.current = true;
    const newId = crypto.randomUUID();
    setPinnedNewIds(prev => [...prev, newId]);
    try {
      await saveReceipts({
        id: newId,
        revision: 1,
        ...manualReceipt,
        totalAmount: amount.value,
        createdAt: Date.now(),
        assignmentTeamId: assignment.id || null,
        assignmentTeamName: assignment.name || '',
        relatedReviewReceiptId,
        createdBy: buildReceiptAudit({ action: 'created' }),
      });
      setManualReceipt({ ...INITIAL_MANUAL_RECEIPT, date: getToday() });
      setManualErrors({});
      showToast('✅ 1건 추가 완료');
      onAdded?.();
      onClose?.();
    } finally {
      savingRef.current = false;
    }
  };

  return {
    manualReceipt,
    setManualReceipt: updateManualReceipt,
    manualErrors,
    manualStoreRef,
    manualAmountRef,
    handleManualAdd,
  };
}
