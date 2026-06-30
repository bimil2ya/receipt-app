import { useCallback, useState } from 'react';
import { decodeHtmlEntities, parseDate } from '../utils/formatter';

function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export default function useReceiptEditing({ receipts, saveReceipts, setDetailId, setTab }) {
  const [editState, setEditState] = useState({ id: null, field: null, value: '' });

  const handleEdit = useCallback((id, field, value) => {
    if (field === 'detail') {
      const receipt = receipts.find(item => item.id === id);
      if (!receipt) return;
      setEditState({
        id,
        field,
        value: {
          date: receipt.date,
          useTime: receipt.useTime || '',
          storeName: decodeHtmlEntities(receipt.storeName) || '',
          totalAmount: receipt.totalAmount,
          category: receipt.category,
          approvalNum: receipt.approvalNum || '',
          bizNum: receipt.bizNum || '',
          cardNumber: receipt.cardNumber || '',
          note: decodeHtmlEntities(receipt.note) || '',
        },
      });
    } else {
      setEditState({ id, field, value });
    }
  }, [receipts]);

  const handleInlineEdit = async () => {
    const { id, field, value } = editState;
    if (!id) return;
    const target = receipts.find(receipt => receipt.id === id);
    if (field === 'detail') {
      await saveReceipts({
        ...target,
        ...value,
        totalAmount: parseInt(value.totalAmount) || 0,
        useTime: safeText(value.useTime),
        approvalNum: safeText(value.approvalNum),
        bizNum: safeText(value.bizNum),
        cardNumber: safeText(value.cardNumber),
      });
    } else {
      let fieldValue = value;
      if (field === 'date') fieldValue = parseDate(value);
      if (field === 'totalAmount') fieldValue = Math.min(9999999, parseInt(value) || 0);
      await saveReceipts({ ...target, [field]: fieldValue });
    }
    setEditState({ id: null, field: null, value: '' });
  };

  const handleUpdateRotation = useCallback(async (id, rotation) => {
    const updates = receipts.filter(receipt => receipt.id === id).map(receipt => ({ ...receipt, rotation }));
    await saveReceipts(updates);
  }, [receipts, saveReceipts]);

  const handleViewImage = useCallback((id) => {
    setDetailId(id);
    setTab('images');
  }, [setDetailId, setTab]);

  return {
    editState,
    setEditState,
    handleEdit,
    handleInlineEdit,
    handleUpdateRotation,
    handleViewImage,
  };
}
