import { useState, useCallback, useEffect } from 'react';
import { clearReceiptImageUrlCache, getReceiptImageUrl, openReceiptDb } from '../utils/receiptDb';
import useReceiptBootstrap from './useReceiptBootstrap';
import useReceiptCrud from './useReceiptCrud';

export default function useReceipts() {
  const [receipts,   setReceipts]   = useState([]);
  const [cards,      setCards]      = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');

  useReceiptBootstrap({
    dbOpen: openReceiptDb,
    onReceiptsLoaded: setReceipts,
    onCardsLoaded: setCards,
    onLoadingChange: setLoading,
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
  });

  const getImageUrl = useCallback(async (imageId) => {
    return getReceiptImageUrl(imageId);
  }, []);

  useEffect(() => {
    return () => clearReceiptImageUrlCache();
  }, []);

  return {
    receipts, cards, loading, saveStatus,
    saveReceipts,
    deleteReceipt,
    resetDeviceData, saveCard, getHistory,
    getImageUrl,
  };
}
