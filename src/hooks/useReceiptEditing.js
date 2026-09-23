import { useCallback, useRef, useState } from 'react';
import { decodeHtmlEntities, parseDate } from '../utils/formatter';
import { parseReceiptAmount } from '../utils/receiptAmount';
import { buildReceiptAudit } from '../utils/deviceIdentity';

function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export default function useReceiptEditing({ receipts, saveReceipts, setDetailId, setTab, assignment = {} }) {
  const [editState, setEditState] = useState({ id: null, field: null, value: '' });
  const [editErrors, setEditErrors] = useState({});
  const amountRef = useRef(null);
  const savingRef = useRef(false);

  const updateEditState = useCallback((next) => {
    setEditErrors({});
    setEditState(next);
  }, []);

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
    if (savingRef.current) return;
    const { id, field, value } = editState;
    if (!id) return;
    const target = receipts.find(receipt => receipt.id === id);
    if (!target) return;
    const amount = field === 'detail' ? parseReceiptAmount(value.totalAmount) : field === 'totalAmount' ? parseReceiptAmount(value) : null;
    if (amount && !amount.ok) {
      setEditErrors({ totalAmount: amount.error });
      amountRef.current?.focus();
      return;
    }
    savingRef.current = true;
    try {
    if (field === 'detail') {
      await saveReceipts({
        ...target,
        ...value,
        revision: Math.max(1, Number(target.revision) || 1) + 1,
        totalAmount: amount.value,
        useTime: safeText(value.useTime),
        approvalNum: safeText(value.approvalNum),
        bizNum: safeText(value.bizNum),
        cardNumber: safeText(value.cardNumber),
        assignmentTeamId: assignment.id || target.assignmentTeamId || null,
        assignmentTeamName: assignment.name || target.assignmentTeamName || '',
        updatedBy: buildReceiptAudit({ action: 'updated', before: { totalAmount: target.totalAmount, date: target.date, category: target.category } }),
      });
    } else {
      let fieldValue = value;
      if (field === 'date') fieldValue = parseDate(value);
      if (field === 'totalAmount') fieldValue = amount.value;
      await saveReceipts({ ...target, [field]: fieldValue, revision: Math.max(1, Number(target.revision) || 1) + 1, updatedBy: buildReceiptAudit({ action: 'updated', before: { [field]: target[field] } }) });
    }
    setEditState({ id: null, field: null, value: '' });
    setEditErrors({});
    } finally {
      savingRef.current = false;
    }
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
    editErrors,
    amountRef,
    setEditState: updateEditState,
    handleEdit,
    handleInlineEdit,
    handleUpdateRotation,
    handleViewImage,
  };
}
