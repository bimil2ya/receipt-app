import { useState, useCallback } from 'react';
import { compressToBase64 } from '../utils/compressor';
import { getToday, mergeCardNumbers, decodeHtmlEntities } from '../utils/formatter';

export default function useUploader({ onUploadSuccess, onUploadError }) {
  const [processing, setProcessing] = useState(false);
  const [procMsg, setProcMsg] = useState('');

  const handleFiles = useCallback(async (files, existingReceipts = []) => {
    // API 키는 모두 서버(Vercel env)에서 처리. 사용자(노인)는 키 입력 안 함.
    setProcessing(true);
    const added = [];
    const failedFiles = [];
    let duplicateCount = 0;
    let completedCount = 0;
    const totalImages = files.length;

    setProcMsg(`분석 중 0/${totalImages}`);

    // 단일 파일 분석 + 비즈노 조회까지 끝낸 결과를 반환
    const analyzeFile = async (file) => {
      try {
        const { b64, mimeType } = await compressToBase64(file);
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: b64, mediaType: mimeType })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || err.error || `서버 오류 (${res.status})`);
        }
        const result = await res.json();
        if (result.isReceipt === false) return { fileName: file.name, notReceipt: true };

        // 영수증 항목별 비즈노 조회 — 한 파일 안의 영수증은 병렬
        const enriched = await Promise.all((result.receipts || []).map(async (r) => {
          const initialBizNum = r.bizNum ? r.bizNum.toString().replace(/[^0-9]/g, '') : '';
          if (initialBizNum.length >= 8) {
            try {
              const lookupRes = await fetch('/api/lookup-biz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bizNum: initialBizNum })
              });
              if (lookupRes.ok) {
                const lookupData = await lookupRes.json();
                if (lookupData.company) {
                  r.storeName = lookupData.company;
                  if (lookupData.busiResNum) r.bizNum = lookupData.busiResNum;
                }
              }
            } catch (e) {
              if (import.meta.env.DEV) console.error('Bizno lookup failed:', e);
            }
          }
          return r;
        }));

        return {
          fileName: file.name,
          imageId: crypto.randomUUID(),
          imageBase64: `data:${mimeType};base64,${b64}`,
          receipts: enriched,
        };
      } catch (e) {
        if (import.meta.env.DEV) console.error('Process error:', e);
        return { fileName: file.name, error: e.message };
      }
    };

    // 동시성 3 배치로 처리 — 분석 API의 무거운 호출은 병렬, 결과 누적/dedup은 순차
    const CONCURRENCY = 3;
    for (let i = 0; i < files.length; i += CONCURRENCY) {
      const batch = files.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(analyzeFile));

      for (const fileResult of results) {
        completedCount += 1;
        setProcMsg(`분석 중 ${completedCount}/${totalImages}`);

        if (fileResult.error) {
          failedFiles.push({ name: fileResult.fileName, error: fileResult.error });
          continue;
        }
        if (fileResult.notReceipt) {
          continue;
        }

        for (const r of fileResult.receipts) {
          // 중복 판단: 승인번호가 같거나(승인번호 OR), 같은 날짜의 사용시간이 같으면(시간 OR) 같은 건.
          // 날짜+금액+상호명/사업자번호만 같은 경우는 이제 다른 건으로 본다 (같은 가게에서 다른 시각 결제 누락 방지).
          const isDuplicate = [...existingReceipts, ...added].some(ex => {
            const approvalA = (ex.approvalNum || '').toString().trim();
            const approvalB = (r.approvalNum || '').toString().trim();
            const sameApproval = approvalA && approvalB && approvalA === approvalB;
            if (sameApproval) return true;

            const timeA = (ex.useTime || '').toString().trim();
            const timeB = (r.useTime || '').toString().trim();
            const sameTime = timeA && timeB && timeA === timeB && ex.date === r.date;
            if (sameTime) return true;

            return false;
          });
          if (isDuplicate) { duplicateCount += 1; continue; }

          let bestCardNum = r.cardNumber || '';
          [...existingReceipts, ...added].forEach(ex => {
            if (ex.cardNumber && bestCardNum) {
              const num1 = ex.cardNumber.replace(/[^0-9*]/g, '');
              const num2 = bestCardNum.replace(/[^0-9*]/g, '');
              if (num1.slice(0, 4) === num2.slice(0, 4) || num1.slice(-4) === num2.slice(-4)) {
                bestCardNum = mergeCardNumbers(bestCardNum, ex.cardNumber);
              }
            }
          });

          added.push({
            id: crypto.randomUUID(),
            imageId: fileResult.imageId,
            imageUrl: fileResult.imageBase64,
            date: r.date || getToday(),
            useTime: (r.useTime || '').toString().trim(),
            storeName: decodeHtmlEntities(r.storeName) || '미상',
            totalAmount: r.totalAmount || 0,
            category: r.suggestedCategory || '기타',
            bizNum: r.bizNum || '',
            approvalNum: r.approvalNum || '',
            cardNumber: bestCardNum,
            note: decodeHtmlEntities(r.note) || '',
            rotation: 0,
            createdAt: Date.now(),
          });
        }
      }
    }

    if (added.length > 0) await onUploadSuccess(added);
    setProcessing(false); setProcMsg('');

    if ((failedFiles.length > 0 || duplicateCount > 0) && onUploadError) {
      onUploadError({ failedFiles, duplicateCount });
    }
    return { totalImages, successCount: added.length, duplicateCount };
  }, [onUploadSuccess, onUploadError]);

  return { handleFiles, processing, procMsg };
}
