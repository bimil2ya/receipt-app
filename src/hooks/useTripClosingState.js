import { useEffect, useMemo, useRef, useState } from 'react';
import { decodeHtmlEntities, getToday } from '../utils/formatter';

function trimText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

export default function useTripClosingState({ canonicalNames, selectedTeam, tripStartDate, tripEndDate, receipts }) {
  const [kakaoDone, setKakaoDone] = useState(false);
  const [uploadDone, setUploadDone] = useState(false);
  const [lastDuplicateReport, setLastDuplicateReport] = useState(null);
  const closingStateLoadedRef = useRef(false);

  const closingPayloadSignature = useMemo(() => JSON.stringify({
    names: trimText(canonicalNames),
    tripStartDate: tripStartDate || getToday(),
    tripEndDate: tripEndDate || '',
    receipts: (receipts || [])
      .map(receipt => ({
        id: receipt.id,
        date: receipt.date || '',
        useTime: receipt.useTime || '',
        storeName: decodeHtmlEntities(receipt.storeName) || '',
        totalAmount: receipt.totalAmount || 0,
        category: receipt.category || '',
        approvalNum: receipt.approvalNum || '',
        bizNum: receipt.bizNum || '',
        cardNumber: receipt.cardNumber || '',
        note: decodeHtmlEntities(receipt.note) || '',
        imageId: receipt.imageId || '',
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
  }), [canonicalNames, tripStartDate, tripEndDate, receipts]);

  const closingStateStorageKey = useMemo(() => {
    const owner = selectedTeam?.id ? `team-${selectedTeam.id}` : trimText(canonicalNames, 'unknown');
    return `receipt-app:closing:${owner}:${tripStartDate || getToday()}:${tripEndDate || ''}`;
  }, [selectedTeam, canonicalNames, tripStartDate, tripEndDate]);

  useEffect(() => {
    closingStateLoadedRef.current = false;
    let nextKakaoDone = false;
    let nextUploadDone = false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(closingStateStorageKey) || 'null');
      if (saved?.signature === closingPayloadSignature) {
        nextKakaoDone = Boolean(saved.kakaoDone);
        nextUploadDone = Boolean(saved.uploadDone);
      }
    } catch {
      nextKakaoDone = false;
      nextUploadDone = false;
    }
    setKakaoDone(nextKakaoDone);
    setUploadDone(nextUploadDone);
    setLastDuplicateReport(null);
    const timer = window.setTimeout(() => {
      closingStateLoadedRef.current = true;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [closingStateStorageKey, closingPayloadSignature]);

  useEffect(() => {
    if (!closingStateLoadedRef.current) return;
    sessionStorage.setItem(closingStateStorageKey, JSON.stringify({
      signature: closingPayloadSignature,
      kakaoDone,
      uploadDone,
    }));
  }, [closingStateStorageKey, closingPayloadSignature, kakaoDone, uploadDone]);

  return {
    kakaoDone,
    setKakaoDone,
    uploadDone,
    setUploadDone,
    lastDuplicateReport,
    setLastDuplicateReport,
    closingPayloadSignature,
  };
}
