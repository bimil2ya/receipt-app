import { useState, useCallback, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { clearReceiptImageUrlCache, getReceiptImageUrl, openReceiptDb } from '../utils/receiptDb';
import useReceiptSync from './useReceiptSync';
import useReceiptBootstrap from './useReceiptBootstrap';
import useReceiptCrud from './useReceiptCrud';

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
    saveReceipts,
    deleteReceipt,
    resetAll, resetDeviceData, resetActivityLogs, saveCard, getHistory,
    retryPendingSync,
    getImageUrl,
  };
}
