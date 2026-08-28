import { useState, useCallback } from 'react';
import { compressToBase64 } from '../utils/compressor';
import { getToday, mergeCardNumbers, decodeHtmlEntities } from '../utils/formatter';

import { normalizeApprovalNum } from '../../shared/approvalReportCore.js';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseKoreanReceiptDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{2}|\d{4})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (!match) return null;

  const rawYear = Number(match[1]);
  const year = match[1].length === 2 ? 2000 + rawYear : rawYear;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function buildDateContext(options = {}) {
  const report = parseKoreanReceiptDate(options.reportDate);
  const start = parseKoreanReceiptDate(options.tripStartDate) || report || parseKoreanReceiptDate(getToday());
  return { start };
}

// 연도만 교정. 월/일이 출장 기간 밖이어도 수정하지 않음 (예전 영수증 나중에 올리는 경우 있음)
function normalizeReceiptDate(value, context) {
  const parsed = parseKoreanReceiptDate(value);
  if (!parsed) return formatDate(context.start); // 날짜 파싱 불가 → 출장 시작일 사용

  const tripYear = context.start.getFullYear();
  if (parsed.getFullYear() !== tripYear) {
    // 연도만 출장 연도로 교체, 월/일은 그대로
    return formatDate(new Date(tripYear, parsed.getMonth(), parsed.getDate()));
  }

  return formatDate(parsed); // 연도가 맞으면 그대로
}

export default function useUploader({ onUploadSuccess, onUploadError }) {
  const [processing, setProcessing] = useState(false);
  const [procMsg, setProcMsg] = useState('');
  const isAndroid = /Android/i.test(navigator.userAgent);

  const handleFiles = useCallback(async (files, existingReceipts = [], dateOptions = {}) => {
    // API 키는 모두 서버(Vercel env)에서 처리. 사용자(노인)는 키 입력 안 함.
    setProcessing(true);
    const added = [];
    const failedFiles = [];
    let duplicateCount = 0;
    let completedCount = 0;
    const totalImages = files.length;
    const dateContext = buildDateContext(dateOptions);

    setProcMsg(`분석 중 0/${totalImages}`);

    // 단일 파일 분석 + 비즈노 조회까지 끝낸 결과를 반환
    const analyzeFile = async (file) => {
      const TIMEOUT_MS = 60_000; // 60초
      try {
        const { b64, mimeType } = await compressToBase64(file);

        // Analyze API 호출 (60초 timeout)
        const analyzeController = new AbortController();
        const analyzeTimeoutId = setTimeout(() => analyzeController.abort(), TIMEOUT_MS);

        try {
          const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              base64: b64,
              mediaType: mimeType,
              reportDate: dateOptions.reportDate || dateOptions.tripStartDate || getToday(),
              tripStartDate: dateOptions.tripStartDate || dateOptions.reportDate || getToday(),
              tripEndDate: dateOptions.tripEndDate || dateOptions.tripStartDate || dateOptions.reportDate || getToday(),
            }),
            signal: analyzeController.signal,
          });

          clearTimeout(analyzeTimeoutId);

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || err.error || `서버 오류 (${res.status})`);
          }

          const result = await res.json();
          if (result.isReceipt === false) return { fileName: file.name, notReceipt: true };

          // 영수증 항목별 비즈노 조회 — 한 파일 안의 영수증은 병렬 (각 요청 30초 timeout)
          const enriched = await Promise.all((result.receipts || []).map(async (r) => {
            const initialBizNum = r.bizNum ? r.bizNum.toString().replace(/[^0-9]/g, '') : '';
            if (initialBizNum.length >= 8) {
              try {
                const lookupController = new AbortController();
                const lookupTimeoutId = setTimeout(() => lookupController.abort(), 30_000);

                const lookupRes = await fetch('/api/lookup-biz', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ bizNum: initialBizNum }),
                  signal: lookupController.signal,
                });

                clearTimeout(lookupTimeoutId);

                if (lookupRes.ok) {
                  const lookupData = await lookupRes.json();
                  if (lookupData.company) {
                    r.storeName = lookupData.company;
                    if (lookupData.busiResNum) r.bizNum = lookupData.busiResNum;
                  }
                }
              } catch (e) {
                if (e.name === 'AbortError') {
                  if (import.meta.env.DEV) console.warn('Bizno lookup timeout:', initialBizNum);
                } else if (import.meta.env.DEV) {
                  console.error('Bizno lookup failed:', e);
                }
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
          clearTimeout(analyzeTimeoutId);
          if (e.name === 'AbortError') {
            throw new Error('분석 요청 시간 초과 (60초). 네트워크를 확인하세요.');
          }
          throw e;
        }
      } catch (e) {
        if (import.meta.env.DEV) console.error('Process error:', e);
        return { fileName: file.name, error: e.message };
      }
    };

    // 동시성 3 배치로 처리 — 분석 API의 무거운 호출은 병렬, 결과 누적/dedup은 순차
    const CONCURRENCY = isAndroid ? 1 : 3;
    const processedApprovals = new Set(); // 이 배치에서 처리된 승인번호들

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
          // 중복 판단은 승인번호가 양쪽에 있고 정규화 값이 완전히 같을 때만 자동 처리한다.
          // 날짜/시간/금액/상호명만 같은 경우는 실제 다른 결제일 수 있으므로 자동 중복으로 보지 않는다.
          const approvalB = normalizeApprovalNum(r.approvalNum);

          // 기존 + 현재 배치에서 처리된 것 모두 확인
          const isDuplicate = [...existingReceipts, ...added].some(ex => {
            const approvalA = normalizeApprovalNum(ex.approvalNum);
            return Boolean(approvalA && approvalB && approvalA === approvalB);
          }) || (approvalB && processedApprovals.has(approvalB)); // 같은 배치 내 중복도 감지

          if (isDuplicate) { duplicateCount += 1; continue; }

          // 이 배치에서 처리한 승인번호 기록
          if (approvalB) processedApprovals.add(approvalB);

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
            date: normalizeReceiptDate(r.date, dateContext),
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

        if (isAndroid) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
      }
    }

    if (added.length > 0) await onUploadSuccess(added);
    setProcessing(false); setProcMsg('');

    if ((failedFiles.length > 0 || duplicateCount > 0) && onUploadError) {
      onUploadError({ failedFiles, duplicateCount });
    }
    return { totalImages, successCount: added.length, duplicateCount };
  }, [onUploadSuccess, onUploadError, isAndroid]);

  return { handleFiles, processing, procMsg };
}
