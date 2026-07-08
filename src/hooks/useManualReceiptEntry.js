import { useRef, useState } from 'react';
import { getToday } from '../utils/formatter';

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

export default function useManualReceiptEntry({ saveReceipts, setPinnedNewIds, showToast, onClose }) {
  const [manualReceipt, setManualReceipt] = useState(INITIAL_MANUAL_RECEIPT);
  const manualStoreRef = useRef(null);

  const handleManualAdd = async () => {
    if (!manualReceipt.storeName.trim()) {
      showToast('사용처를 입력해 주세요');
      manualStoreRef.current?.focus();
      return;
    }
    const newId = crypto.randomUUID();
    setPinnedNewIds(prev => [...prev, newId]);
    await saveReceipts({
      id: newId,
      ...manualReceipt,
      totalAmount: parseInt(manualReceipt.totalAmount) || 0,
      createdAt: Date.now(),
    });
    setManualReceipt({ ...INITIAL_MANUAL_RECEIPT, date: getToday() });
    showToast('✅ 1건 추가 완료');
    onClose?.();
  };

  return {
    manualReceipt,
    setManualReceipt,
    manualStoreRef,
    handleManualAdd,
  };
}
