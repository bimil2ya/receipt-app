import { useState, useCallback } from 'react';
import { compressToBase64 } from '../utils/compressor';
import { TODAY, mergeCardNumbers } from '../utils/formatter';
import { decryptData } from '../utils/crypto';
import { readStorageItem } from '../utils/storage';

export default function useUploader({ onUploadSuccess, onUploadError }) {
  const [processing, setProcessing] = useState(false);
  const [procMsg, setProcMsg] = useState('');

  const handleFiles = useCallback(async (files, existingReceipts = []) => {
    const encryptedKey = readStorageItem('claude_api_key_v2');
    const apiKey = await decryptData(encryptedKey);
    const biznoKey = readStorageItem('bizno_api_key');
    
    setProcessing(true);
    const added = [];
    const failedFiles = [];   // 실패 목록 수집 (alert 대신)
    let notReceiptCount = 0;
    let failCount = 0;
    let duplicateCount = 0;
    const totalImages = files.length;

    for (const file of files) {
      setProcMsg(`분석 중 (${added.length + notReceiptCount + failCount + duplicateCount + 1}/${totalImages}): ${file.name}`);
      
      try {
        const { b64, mimeType } = await compressToBase64(file);
        const res = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base64: b64, mediaType: mimeType, apiKey: apiKey })
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || err.error || `서버 오류 (${res.status})`);
        }

        const result = await res.json();
        if (result.isReceipt === false) { notReceiptCount++; continue; }

        const sharedImageId = crypto.randomUUID();
        const b64full = `data:${mimeType};base64,${b64}`;

        // 각 영수증 항목별로 비즈노 조회 및 데이터 생성
        for (let r of result.receipts) {
          // --- [비즈노 공식 상호명 조회 - 최우선 순위] ---
          // 사업자번호가 존재할 경우 OCR 노이즈를 클라이언트측에서도 한 번 더 정제하여 요청
          const initialBizNum = r.bizNum ? r.bizNum.toString().replace(/[^0-9]/g, '') : '';
          
          if (initialBizNum.length >= 8 && biznoKey) {
            try {
              const lookupRes = await fetch('/api/lookup-biz', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ bizNum: initialBizNum, apiKey: biznoKey })
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

          // --- 중복 체크 ---
          const isDuplicate = [...existingReceipts, ...added].some(ex => {
            const sameApproval = (ex.approvalNum && r.approvalNum) ? ex.approvalNum.toString().trim() === r.approvalNum.toString().trim() : false;
            const sameDate = ex.date === r.date;
            const sameAmount = Math.abs((ex.totalAmount || 0) - (r.totalAmount || 0)) < 10;
            if (sameApproval) return true;
            if (sameDate && sameAmount && ex.bizNum?.trim() && r.bizNum?.trim() && ex.bizNum.trim() === r.bizNum.trim()) return true;
            if (sameDate && sameAmount && ex.storeName?.trim() && r.storeName?.trim() && ex.storeName.trim() === r.storeName.trim()) return true;
            return false;
          });

          if (isDuplicate) {
            duplicateCount++;
            continue;
          }

          // --- 카드번호 병합 ---
          let bestCardNum = r.cardNumber || '';
          [...existingReceipts, ...added].forEach(ex => {
             if (ex.cardNumber && bestCardNum) {
               const num1 = ex.cardNumber.replace(/[^0-9*]/g, '');
               const num2 = bestCardNum.replace(/[^0-9*]/g, '');
               if (num1.slice(0,4) === num2.slice(0,4) || num1.slice(-4) === num2.slice(-4)) {
                 bestCardNum = mergeCardNumbers(bestCardNum, ex.cardNumber);
               }
             }
          });

          added.push({
            id: crypto.randomUUID(),
            imageId: sharedImageId,
            imageUrl: b64full,
            date: r.date || TODAY,
            storeName: r.storeName || '미상',
            totalAmount: r.totalAmount || 0,
            category: r.suggestedCategory || '기타',
            bizNum: r.bizNum || '', 
            approvalNum: r.approvalNum || '',
            cardNumber: bestCardNum, 
            note: r.note || '',
            rotation: 0,
            createdAt: Date.now()
          });
        }

      } catch (e) {
        if (import.meta.env.DEV) console.error('Process error:', e);
        failCount++;
        failedFiles.push({ name: file.name, error: e.message });
      }
    }

    if (added.length > 0) await onUploadSuccess(added);
    setProcessing(false); setProcMsg('');

    // 오류/중복 요약을 콜백으로 한 번에 전달
    if ((failedFiles.length > 0 || duplicateCount > 0) && onUploadError) {
      onUploadError({ failedFiles, duplicateCount });
    }
    return { totalImages, successCount: added.length, duplicateCount };
  }, [onUploadSuccess, onUploadError]);

  return { handleFiles, processing, procMsg };
}
