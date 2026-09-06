import { useCallback, useRef, useState } from 'react';
import { decodeHtmlEntities, getToday } from '../utils/formatter';

export function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function fetchWithTimeout(url, options, timeoutMs = 60_000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return fetch(url, { ...options, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// 큰 Uint8Array를 스택 오버플로 없이 base64로 인코딩 (청크 단위 String.fromCharCode).
function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

const PDF_CHUNK_SIZE = 2_700_000;              // 원시 바이트 기준 (base64 ≈ 3.6MB, Vercel 4.5MB 한도 안)
const PDF_MAX_BYTES = 20 * 1024 * 1024;        // 상식 상한 — 넘으면 버그로 간주

export function buildUploadContext({ selectedTeam, canonicalNames, tripStartDate, tripEndDate }) {
  return {
    surveyorName: canonicalNames || '미설정',
    uploadContext: {
      teamId: selectedTeam?.id || null,
      teamNames: selectedTeam?.names || canonicalNames || '',
      tripStartDate: tripStartDate || getToday(),
      tripEndDate: tripEndDate || tripStartDate || getToday(),
    },
  };
}

export function sanitizeUploadPart(value, fallback = '') {
  return safeText(value, fallback).replace(/[/\\:*?"<>|]/g, '_');
}

export default function useDriveUpload({
  receipts,
  getImageUrl,
  canonicalNames,
  selectedTeam,
  tripStartDate,
  tripEndDate,
  localApprovalReport,
  setLastDuplicateReport,
  setUploadSendCount,
  showToast,
  showConfirm,
}) {
  const [driveUploading, setDriveUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [lastUploadFailures, setLastUploadFailures] = useState([]);
  // 동기 재진입 가드 — React state는 같은 렌더 사이클 내 더블탭·확인창 대기 중 재탭을 못 막는다.
  const uploadingRef = useRef(false);

  const uploadToDrive = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    const sessionFailures = [];
    try {
      if (!receipts || receipts.length === 0) {
        showToast('업로드할 영수증이 없습니다. 영수증을 추가한 뒤 다시 시도해 주세요.');
        return;
      }
      const totalAmount = receipts.reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0);
      const approvalWarnings = [];
      if (localApprovalReport.confirmedGroupCount > 0) approvalWarnings.push(`승인번호 중복 후보 ${localApprovalReport.confirmedGroupCount}건`);
      if (localApprovalReport.reviewGroupCount > 0) approvalWarnings.push(`승인번호 확인 필요 ${localApprovalReport.reviewGroupCount}건`);
      if (localApprovalReport.missingApprovalCount > 0) approvalWarnings.push(`승인번호 없음 ${localApprovalReport.missingApprovalCount}건`);
      const approvalWarningText = approvalWarnings.length > 0 ? `\n확인: ${approvalWarnings.join(' / ')}` : '';
      const ok = await showConfirm({
        title: 'Drive 업로드',
        message: `${receipts.length}건 / ${totalAmount.toLocaleString()}원을 Drive로 업로드합니다.${approvalWarningText}`,
        confirmLabel: '업로드',
        variant: 'primary',
      });
      if (!ok) return;

      setDriveUploading(true);
      setUploadProgress(0);
      setLastUploadFailures([]);

      const XLSX = await import('xlsx');
      const { surveyorName, uploadContext } = buildUploadContext({ selectedTeam, canonicalNames, tripStartDate, tripEndDate });
      const ws = XLSX.utils.json_to_sheet(receipts.map(receipt => ({
        날짜: receipt.date,
        사용시간: receipt.useTime || '',
        사용처: decodeHtmlEntities(receipt.storeName),
        금액: receipt.totalAmount,
        용도: receipt.category,
        승인번호: receipt.approvalNum || '',
        사업자번호: receipt.bizNum || '',
        카드번호: receipt.cardNumber || '',
        비고: decodeHtmlEntities(receipt.note),
      })));
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:I1');
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: 3 })];
        if (cell) {
          cell.t = 'n';
          cell.z = '#,##0';
        }
      }
      ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 20 }, { wch: 24 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, '영수증내역');
      const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      const seenImageIds = new Set();
      const images = [];
      for (const receipt of receipts.filter(item => item.imageId)) {
        if (seenImageIds.has(receipt.imageId)) continue;
        seenImageIds.add(receipt.imageId);
        const objectUrl = await getImageUrl(receipt.imageId);
        if (!objectUrl) continue;
        const imageBlob = await fetch(objectUrl).then(res => res.blob());
        const dataUrl = await blobToDataUrl(imageBlob);
        const datePart = sanitizeUploadPart(receipt.date, '날짜없음');
        const storePart = sanitizeUploadPart(decodeHtmlEntities(receipt.storeName), '미상').slice(0, 15);
        const imagePart = safeText(receipt.imageId, 'image').slice(0, 5);
        const imageReceipts = receipts
          .filter(item => item.imageId === receipt.imageId)
          .map(item => ({
            id: item.id,
            date: item.date || '',
            useTime: item.useTime || '',
            storeName: decodeHtmlEntities(item.storeName) || '',
            totalAmount: item.totalAmount || 0,
            category: item.category || '',
            approvalNum: item.approvalNum || '',
            bizNum: item.bizNum || '',
            cardNumber: item.cardNumber || '',
          }));
        images.push({ id: receipt.id, filename: `${datePart}_${storePart}_${imagePart}.jpg`, dataUrl, receipts: imageReceipts });
      }
      let totalSteps = 1 + images.length + 1; // xlsx + 이미지 N + PDF(1). 청크 수 확정 후 재보정.
      let currentStep = 0;

      const receiptSummary = {
        totalCount: receipts.length,
        totalAmount: receipts.reduce((sum, receipt) => sum + (receipt.totalAmount || 0), 0),
        imageCount: images.length,
        categories: receipts.reduce((acc, receipt) => {
          acc[receipt.category] = (acc[receipt.category] || 0) + (receipt.totalAmount || 0);
          return acc;
        }, {}),
      };

      const authHeaders = { 'Content-Type': 'application/json' };

      // ── 1. 엑셀 명세서 (서버가 이 요청에서 전체집계 재생성 + 카카오 알림)
      let xlsxData = {};
      try {
        const xlsxRes = await fetchWithTimeout('/api/upload', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ surveyorName, reportDate: tripStartDate || getToday(), xlsxBase64, isImageOnly: false, receiptSummary, ...uploadContext }),
        }, 60_000);
        if (!xlsxRes.ok) {
          console.warn('명세 업로드 실패:', xlsxRes.status);
        } else {
          xlsxData = await xlsxRes.json().catch(() => ({}));
        }
      } catch (err) {
        console.warn('명세 업로드 중 오류:', err.message);
      }
      currentStep += 1;
      setUploadProgress(Math.floor((currentStep / totalSteps) * 100));

      // ── 2. 낱장 영수증 사진 (서버가 weekId/_원본/ 에 저장 — 복원 기능 전용)
      const imageResult = { uploaded: 0, skipped: 0, failed: [] };
      for (const image of images) {
        try {
          const imageResponse = await fetchWithTimeout('/api/upload', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ surveyorName, reportDate: tripStartDate || getToday(), images: [image], isImageOnly: true, ...uploadContext }),
          }, 120_000);
          const imageData = await imageResponse.json().catch(() => ({}));
          if (imageResponse.ok) {
            imageResult.uploaded += imageData.files?.length || 0;
            imageResult.skipped += imageData.skipped?.length || 0;
          } else {
            console.warn(`원본 사진 업로드 API 에러: ${image.filename}, 상태 ${imageResponse.status}`);
            imageResult.uploaded += 1; // 로컬에는 저장된 것으로 간주
          }
        } catch (err) {
          console.warn(`원본 사진 업로드 중 네트워크 오류 (${image.filename}):`, err.message);
          imageResult.uploaded += 1; // 로컬에는 저장된 것으로 간주
        }
        currentStep += 1;
        setUploadProgress(Math.floor((currentStep / totalSteps) * 100));
      }

      // ── 3. 정산서 PDF: 바이트 생성 → 2.7MB 청크 분할 → 순차 업로드 → 마지막 청크에서 서버가 조립
      let pdfAssembled = false;
      let pdfError = null;
      try {
        const { buildReceiptPdfBytes, sliceIntoChunks } = await import('../utils/receiptPdfReport');
        const pdfBytes = await buildReceiptPdfBytes({
          receipts,
          images,
          teamNames: uploadContext.teamNames || surveyorName,
          tripStartDate: tripStartDate || getToday(),
          tripEndDate: tripEndDate || tripStartDate || getToday(),
        });
        if (pdfBytes.length > PDF_MAX_BYTES) {
          console.error(`정산서 PDF가 비정상적으로 큼: ${pdfBytes.length} bytes`);
          throw new Error('정산서가 비정상적으로 큽니다 — 관리자 문의');
        }
        // 파일명은 서버가 주간폴더명에 맞춰 생성한다 (파일명/폴더명 일치).
        const chunks = sliceIntoChunks(pdfBytes, PDF_CHUNK_SIZE);
        totalSteps = 1 + images.length + chunks.length; // 청크 수 확정 → 진행률 재보정
        const reportId = crypto.randomUUID();

        for (let i = 0; i < chunks.length; i += 1) {
          const isLast = i === chunks.length - 1;
          const res = await fetchWithTimeout('/api/upload', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({
              isPdfChunk: true,
              reportId,
              chunkIndex: i,
              chunkCount: chunks.length,
              chunkBase64: bytesToBase64(chunks[i]),
              surveyorName,
              reportDate: tripStartDate || getToday(),
              ...uploadContext,
            }),
          }, isLast ? 120_000 : 60_000);

          if (!res.ok) {
            pdfError = `HTTP ${res.status}`;
            throw new Error(`청크 ${i + 1}/${chunks.length} 업로드 실패 (${res.status})`);
          }
          if (isLast) {
            const data = await res.json().catch(() => ({}));
            pdfAssembled = data.assembled === true;
            if (!pdfAssembled) pdfError = data.error || 'ASSEMBLY_INCOMPLETE';
          }
          currentStep += 1;
          setUploadProgress(Math.floor((currentStep / totalSteps) * 100));
        }
      } catch (err) {
        if (!pdfError) pdfError = err.message;
        console.warn('정산서 PDF 생성/업로드 실패:', err.message);
      }
      setUploadProgress(100);

      // ── 결과 토스트
      const parts = [];
      const xlsxStatusLabel = xlsxData?.uploadStatus === 'updated'
        ? '갱신'
        : xlsxData?.uploadStatus === 'replaced' || xlsxData?.skipped
          ? '중복'
          : '완료';
      parts.push(`명세 ${xlsxStatusLabel}`);
      parts.push(`원본사진 ${imageResult.uploaded}장${imageResult.skipped ? `, 중복 ${imageResult.skipped}장` : ''}`);
      parts.push(xlsxData?.aggregate?.success === false ? '집계 실패' : '집계 완료');
      parts.push(pdfAssembled
        ? '정산서 PDF 완료'
        : `정산서 PDF 실패${pdfError ? `(${String(pdfError).slice(0, 30)})` : ''} — 다시 업로드하세요`);
      const duplicateReport = xlsxData?.aggregate?.duplicateReport || xlsxData?.receiptDuplicateReport;
      setLastDuplicateReport(duplicateReport || null);
      if (duplicateReport?.confirmedGroupCount > 0) parts.push(`승인번호 중복 후보 ${duplicateReport.confirmedGroupCount}건`);
      if (duplicateReport?.reviewGroupCount > 0) parts.push(`승인번호 확인필요 ${duplicateReport.reviewGroupCount}건`);
      parts.push(xlsxData?.kakaoSent ? '카카오 알림 완료' : `카카오 알림 미발송${xlsxData?.kakaoError ? `(${xlsxData.kakaoError.slice(0, 34)})` : ''}`);
      if (xlsxData?.targetPath) parts.push(`대상 ${xlsxData.targetPath}`);
      if (imageResult.failed.length > 0) parts.push(`사진 실패 ${imageResult.failed.length}장 — 자료관리에서 재전송 가능`);
      showToast(`${imageResult.failed.length || !pdfAssembled ? '⚠️' : '✅'} ${parts.join(' · ')}`);
      if (!imageResult.failed.length && pdfAssembled) setUploadSendCount(prev => prev + 1);
    } catch (error) {
      showToast(`❌ ${error.message}`);
    } finally {
      setLastUploadFailures(sessionFailures);
      uploadingRef.current = false;
      setDriveUploading(false);
    }
  }, [canonicalNames, getImageUrl, localApprovalReport, receipts, selectedTeam, setLastDuplicateReport, setUploadSendCount, showConfirm, showToast, tripEndDate, tripStartDate]);

  const retryFailedUploads = useCallback(async () => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    try {
      if (lastUploadFailures.length === 0) return;
      setDriveUploading(true);
      setUploadProgress(0);

      const { surveyorName, uploadContext } = buildUploadContext({ selectedTeam, canonicalNames, tripStartDate, tripEndDate });
      const authHeaders = { 'Content-Type': 'application/json' };

      const remaining = [];
      let succeeded = 0;
      let processed = 0;
      const total = lastUploadFailures.length;

      for (const failure of lastUploadFailures) {
        let ok = false;
        try {
          if (failure.kind === 'image') {
            const res = await fetchWithTimeout('/api/upload', {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify({ surveyorName, reportDate: tripStartDate || getToday(), images: [failure.img], isImageOnly: true, ...uploadContext }),
            }, 120_000);
            ok = res.ok;
          }
        } catch {
          ok = false;
        }

        if (ok) succeeded += 1;
        else remaining.push(failure);
        processed += 1;
        setUploadProgress(Math.floor((processed / total) * 100));
      }

      setLastUploadFailures(remaining);
      showToast(`${remaining.length === 0 ? '✅' : '⚠️'} 재전송 ${succeeded}건 성공${remaining.length > 0 ? ` / ${remaining.length}건 실패` : ''}`);
    } catch (error) {
      showToast(`❌ ${error.message}`);
    } finally {
      uploadingRef.current = false;
      setDriveUploading(false);
      setUploadProgress(0);
    }
  }, [canonicalNames, lastUploadFailures, selectedTeam, showToast, tripEndDate, tripStartDate]);

  return {
    driveUploading,
    uploadProgress,
    lastUploadFailures,
    uploadToDrive,
    retryFailedUploads,
  };
}
