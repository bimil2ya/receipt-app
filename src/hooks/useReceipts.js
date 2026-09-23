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

  // Draft backup transport: operation을 서버로 전송
  // operation은 이미 클라이언트/서버가 합의한 구조 (opId, receiptId, backupRevision 등)
  const draftBackupTransport = useCallback(async (operation) => {
    try {
      const response = await fetch('/api/upload?isDraftBackup=sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isDraftBackup: 'sync',
          operation,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(`Draft backup sync failed: ${error.error || response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      if (import.meta.env.DEV) console.error('[useReceipts] Draft backup transport failed:', err);
      throw err;
    }
  }, []);

  // 초안 백업 worker - enabled: false (추후 전환 가능)
  // transport는 준비됨 (operation 전송 함수)
  const draftBackupWorker = useDraftBackupWorker({
    enabled: false,
    transport: draftBackupTransport,
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
