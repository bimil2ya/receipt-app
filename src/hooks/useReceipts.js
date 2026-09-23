import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { clearReceiptImageUrlCache, getReceiptImageUrl, openReceiptDb } from '../utils/receiptDb';
import useReceiptSync from './useReceiptSync';
import useReceiptBootstrap from './useReceiptBootstrap';
import useReceiptCrud from './useReceiptCrud';
import useDraftBackupWorker from './useDraftBackupWorker';

export default function useReceipts() {
  const [receipts,   setReceipts]   = useState([]);
  const [cards,      setCards]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [syncStatus, setSyncStatus] = useState(supabase ? 'idle' : 'offline');
  const [saveStatus, setSaveStatus] = useState('idle');

  const {
    pendingSyncCount,
    syncEvents,
    syncDaily,
    appendSyncOp,
    recordSyncEvent,
    retryPendingSync,
    resetActivityLogs,
    resetSyncQueue,
  } = useReceiptSync({ dbOpen: openReceiptDb, loading, onSyncStatusChange: setSyncStatus });

  useReceiptBootstrap({
    dbOpen: openReceiptDb,
    onReceiptsLoaded: setReceipts,
    onCardsLoaded: setCards,
    onLoadingChange: setLoading,
    onSyncStatusChange: setSyncStatus,
    recordSyncEvent,
  });

  const {
    saveReceipts,
    deleteReceipt,
    resetDeviceData,
    saveCard,
    getHistory,
  } = useReceiptCrud({
    dbOpen: openReceiptDb,
    onReceiptsLoaded: setReceipts,
    onCardsLoaded: setCards,
    onSaveStatusChange: setSaveStatus,
    onSyncStatusChange: setSyncStatus,
    appendSyncOp,
    retryPendingSync,
    recordSyncEvent,
    resetSyncQueue,
  });

  // 초안 백업 worker - 자동 저장 기능 활용
  const draftBackupWorker = useDraftBackupWorker({
    enabled: true,
    transport: async (operation) => {
      try {
        const response = await fetch('/api/auto-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(operation),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.message || 'Auto-save failed');
        }
        return response.json();
      } catch (err) {
        console.error('[auto-save transport] Error:', err);
        throw err;
      }
    },
  });

  // saveReceipts/deleteReceipt 완료 후 자동으로 draft backup drain
  const saveReceiptsWithDrain = useCallback(async (...args) => {
    const result = await saveReceipts(...args);
    draftBackupWorker.drainAfterMutation();
    return result;
  }, [saveReceipts, draftBackupWorker.drainAfterMutation]);

  const deleteReceiptWithDrain = useCallback(async (...args) => {
    const result = await deleteReceipt(...args);
    draftBackupWorker.drainAfterMutation();
    return result;
  }, [deleteReceipt, draftBackupWorker.drainAfterMutation]);

  const resetAll = useCallback(async () => {
    await resetDeviceData();
    await resetActivityLogs();
  }, [resetActivityLogs, resetDeviceData]);

  const getImageUrl = useCallback(async (imageId) => {
    return getReceiptImageUrl(imageId);
  }, []);

  useEffect(() => {
    return () => clearReceiptImageUrlCache();
  }, []);

  return {
    receipts, cards, loading, syncStatus,
    saveStatus, pendingSyncCount,
    syncEvents,
    syncDaily,
    saveReceipts: saveReceiptsWithDrain,
    deleteReceipt: deleteReceiptWithDrain,
    resetAll, resetDeviceData, resetActivityLogs, saveCard, getHistory,
    retryPendingSync,
    getImageUrl,
  };
}
