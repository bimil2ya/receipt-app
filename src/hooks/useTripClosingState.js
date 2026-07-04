import { useEffect, useMemo, useState } from 'react';

const STORAGE_PREFIX = 'receipt-app:send-count';

function trimText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

/**
 * 출장 단위 전송 횟수를 localStorage에 영속 저장한다.
 * - 앱을 껐다 켜도 카운트가 유지된다.
 * - tripStartDate가 바뀌면 새 출장으로 인식해 카운트가 0부터 시작한다.
 */
export default function useTripClosingState({ canonicalNames, selectedTeam, tripStartDate }) {
  const [kakaoSendCount, setKakaoSendCount] = useState(0);
  const [uploadSendCount, setUploadSendCount] = useState(0);
  const [lastDuplicateReport, setLastDuplicateReport] = useState(null);

  // 출장별 고유 키 — tripStartDate가 바뀌면 다른 키
  const storageKey = useMemo(() => {
    const owner = selectedTeam?.id
      ? `team-${selectedTeam.id}`
      : trimText(canonicalNames, 'unknown');
    return `${STORAGE_PREFIX}:${owner}:${tripStartDate || 'nodate'}`;
  }, [selectedTeam, canonicalNames, tripStartDate]);

  // 출장 키가 바뀌면 저장된 카운트 읽기 (새 출장이면 0)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const saved = raw ? JSON.parse(raw) : null;
      setKakaoSendCount(Number(saved?.kakaoCount) || 0);
      setUploadSendCount(Number(saved?.uploadCount) || 0);
    } catch {
      setKakaoSendCount(0);
      setUploadSendCount(0);
    }
    setLastDuplicateReport(null);
  }, [storageKey]);

  // 카운트 변화 시 localStorage 저장
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        kakaoCount: kakaoSendCount,
        uploadCount: uploadSendCount,
      }));
    } catch {
      // 저장 실패 시 조용히 무시 (프라이빗 모드 등)
    }
  }, [storageKey, kakaoSendCount, uploadSendCount]);

  return {
    kakaoSendCount,
    setKakaoSendCount,
    uploadSendCount,
    setUploadSendCount,
    lastDuplicateReport,
    setLastDuplicateReport,
  };
}
