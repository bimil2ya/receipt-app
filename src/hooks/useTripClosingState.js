import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  beginTripOperation,
  commitKakaoOperation,
  commitSubmissionCompletion,
  readTripCompletionRecord,
  resetTripCompletionRecord,
  tripCompletionStorageKey,
} from '../utils/tripCompletionStore';

/**
 * 출장 단위 전송 횟수를 localStorage에 영속 저장한다.
 * - 앱을 껐다 켜도 카운트가 유지된다.
 * - tripStartDate가 바뀌면 새 출장으로 인식해 카운트가 0부터 시작한다.
 */
export default function useTripClosingState({ canonicalNames, selectedTeam, tripStartDate }) {
  const [kakaoSendCount, setKakaoSendCount] = useState(0);
  const [uploadSendCount, setUploadSendCount] = useState(0);
  const [lastDuplicateReport, setLastDuplicateReport] = useState(null);
  const [generation, setGeneration] = useState(0);
  const [completedFingerprintKeys, setCompletedFingerprintKeys] = useState([]);
  const generationRef = useRef(0);

  // 출장별 고유 키 — tripStartDate가 바뀌면 다른 키
  const storageKey = useMemo(() => tripCompletionStorageKey({ canonicalNames, selectedTeam, tripStartDate }), [selectedTeam, canonicalNames, tripStartDate]);

  const applyRecord = useCallback(record => {
    generationRef.current = record.generation;
    setGeneration(record.generation);
    setKakaoSendCount(record.kakaoCount);
    setUploadSendCount(record.uploadCount);
    setCompletedFingerprintKeys(Object.values(record.completedSubmissions || {})
      .filter(item => item.generation === record.generation)
      .map(item => item.fingerprintKey));
  }, []);

  // 출장 키가 바뀌면 저장된 카운트 읽기 (새 출장이면 0)
  useEffect(() => {
    try {
      applyRecord(readTripCompletionRecord(storageKey));
    } catch {
      generationRef.current = 0;
      setGeneration(0);
      setKakaoSendCount(0);
      setUploadSendCount(0);
    }
    setLastDuplicateReport(null);
  }, [applyRecord, storageKey]);

  useEffect(() => {
    const refresh = event => {
      if (event.storageArea !== localStorage || event.key !== storageKey) return;
      try { applyRecord(readTripCompletionRecord(storageKey)); } catch { /* 손상된 외부 쓰기는 성공으로 반영하지 않는다. */ }
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, [applyRecord, storageKey]);

  const resetTripClosingState = useCallback(async () => {
    const record = await resetTripCompletionRecord(storageKey);
    applyRecord(record);
    setLastDuplicateReport(null);
    return record;
  }, [applyRecord, storageKey]);

  const startKakaoOperation = useCallback(() => beginTripOperation(storageKey), [storageKey]);
  const finishKakaoOperation = useCallback(async operation => {
    const record = await commitKakaoOperation(operation);
    if (operation.storageKey === storageKey && operation.generation === generationRef.current) applyRecord(record);
    return record;
  }, [applyRecord, storageKey]);

  const commitUploadCompletion = useCallback(async completion => {
    const targetKey = completion.storageKey || storageKey;
    const result = await commitSubmissionCompletion({ ...completion, storageKey: targetKey });
    if (targetKey === storageKey && completion.generation === generationRef.current) applyRecord(result.record);
    return result;
  }, [applyRecord, storageKey]);

  return {
    kakaoSendCount,
    uploadSendCount,
    lastDuplicateReport,
    setLastDuplicateReport,
    storageKey,
    generation,
    completedFingerprintKeys,
    resetTripClosingState,
    startKakaoOperation,
    finishKakaoOperation,
    commitUploadCompletion,
  };
}
