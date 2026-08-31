import { useCallback, useState } from 'react';
import { decodeHtmlEntities, getToday } from '../utils/formatter';
import { formatFailureDetail, formatFailureMessage } from '../utils/errorCopy';

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

  const uploadToDrive = useCallback(async () => {
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
    const sessionFailures = [];
    try {
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
      const totalSteps = images.length + 1;
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

      let xlsxRes;
      let xlsxData = {};
      try {
        xlsxRes = await fetchWithTimeout('/api/upload', {
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
          }
        } catch (err) {
          console.warn(`이미지 업로드 중 오류 (${image.filename}):`, err.message);
          // 에러 무시하고 계속 진행
        }
        currentStep += 1;
        setUploadProgress(Math.floor((currentStep / totalSteps) * 100));
      }

      const parts = [];
      const xlsxStatusLabel = xlsxData?.uploadStatus === 'updated'
        ? '갱신'
        : xlsxData?.uploadStatus === 'replaced' || xlsxData?.skipped
          ? '중복'
          : '완료';
      parts.push(`명세 ${xlsxStatusLabel}`);
      parts.push(`이미지 ${imageResult.uploaded}장${imageResult.skipped ? `, 중복 ${imageResult.skipped}장` : ''}`);
      parts.push(xlsxData?.aggregate?.success === false ? '집계 실패' : '집계 완료');
      const duplicateReport = xlsxData?.aggregate?.duplicateReport || xlsxData?.receiptDuplicateReport;
      setLastDuplicateReport(duplicateReport || null);
      if (duplicateReport?.confirmedGroupCount > 0) parts.push(`승인번호 중복 후보 ${duplicateReport.confirmedGroupCount}건`);
      if (duplicateReport?.reviewGroupCount > 0) parts.push(`승인번호 확인필요 ${duplicateReport.reviewGroupCount}건`);
      parts.push(xlsxData?.kakaoSent ? '카카오 알림 완료' : `카카오 알림 미발송${xlsxData?.kakaoError ? `(${xlsxData.kakaoError.slice(0, 34)})` : ''}`);
      if (xlsxData?.targetPath) parts.push(`대상 ${xlsxData.targetPath}`);
      if (imageResult.failed.length > 0) parts.push(`이미지 실패 ${imageResult.failed.length}장 — 자료관리에서 재전송 가능`);
      showToast(`${imageResult.failed.length ? '⚠️' : '✅'} ${parts.join(' · ')}`);
      if (!imageResult.failed.length) setUploadSendCount(prev => prev + 1);
    } catch (error) {
      showToast(`❌ ${error.message}`);
    }
    setLastUploadFailures(sessionFailures);
    setDriveUploading(false);
  }, [canonicalNames, getImageUrl, localApprovalReport, receipts, selectedTeam, setLastDuplicateReport, setUploadSendCount, showConfirm, showToast, tripEndDate, tripStartDate]);

  const retryFailedUploads = useCallback(async () => {
    if (lastUploadFailures.length === 0 || driveUploading) return;
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
    setDriveUploading(false);
    setUploadProgress(0);
    showToast(`${remaining.length === 0 ? '✅' : '⚠️'} 재전송 ${succeeded}건 성공${remaining.length > 0 ? ` / ${remaining.length}건 실패` : ''}`);
  }, [canonicalNames, driveUploading, lastUploadFailures, selectedTeam, showToast, tripEndDate, tripStartDate]);

  return {
    driveUploading,
    uploadProgress,
    lastUploadFailures,
    uploadToDrive,
    retryFailedUploads,
  };
}
