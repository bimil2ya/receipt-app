import { useCallback, useState } from 'react';
import { getToday } from '../utils/formatter';

export function buildRestoreYearMonth(baseDate) {
  const d = new Date(baseDate + 'T00:00:00');
  return `${d.getFullYear()}년 ${String(d.getMonth() + 1).padStart(2, '0')}월`;
}

export default function useDriveRestore({
  canonicalNames,
  tripStartDate,
  driveUploading,
  saveReceipts,
  showToast,
}) {
  const [restoreProgress, setRestoreProgress] = useState(null);
  const restoring = restoreProgress !== null;

  const restoreFromDrive = useCallback(async () => {
    if (restoring || driveUploading) return;
    const surveyorName = (canonicalNames || '').trim();
    if (!surveyorName) {
      showToast('이름을 먼저 설정해 주세요.');
      return;
    }
    const baseDate = tripStartDate || getToday();
    const yearMonth = buildRestoreYearMonth(baseDate);

    if (!window.confirm(
      `Drive의 "${yearMonth} / ${surveyorName}" 폴더에서 영수증 이미지를 가져와 OCR로 재분석합니다.\n\n` +
      `· 영수증 1장당 약 5초가 걸리고 OCR 비용이 발생합니다.\n` +
      `· 기존 영수증은 유지되며, 복원된 영수증이 추가됩니다.\n\n계속할까요?`
    )) return;

    setRestoreProgress({ stage: 'list', current: 0, total: 0 });
    const authHeaders = { 'Content-Type': 'application/json' };

    try {
      const listRes = await fetch('/api/restore', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ action: 'list', surveyorName, yearMonth }),
      });
      const listData = await listRes.json().catch(() => ({}));
      if (!listRes.ok || !listData.success) {
        throw new Error(listData.error || `목록 조회 실패 (${listRes.status})`);
      }
      const files = listData.files || [];
      if (files.length === 0) {
        showToast(`Drive의 "${yearMonth} / ${surveyorName}" 폴더에 영수증 이미지가 없습니다.`);
        setRestoreProgress(null);
        return;
      }

      setRestoreProgress({ stage: 'process', current: 0, total: files.length });

      let restoredReceipts = 0;
      let failedFiles = 0;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          const dlRes = await fetch('/api/restore', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ action: 'download', fileId: file.id }),
          });
          const dlData = await dlRes.json().catch(() => ({}));
          if (!dlRes.ok || !dlData.success) {
            failedFiles++;
            continue;
          }

          const ocrRes = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base64: dlData.base64, mediaType: dlData.mediaType }),
          });
          const ocrData = await ocrRes.json().catch(() => ({}));
          if (!ocrRes.ok || !ocrData.success || !Array.isArray(ocrData.receipts)) {
            failedFiles++;
            continue;
          }

          const imageId = crypto.randomUUID();
          const dataUrl = `data:${dlData.mediaType};base64,${dlData.base64}`;
          for (const receipt of ocrData.receipts) {
            const newId = crypto.randomUUID();
            await saveReceipts({
              id: newId,
              date: receipt.date || '',
              useTime: (receipt.useTime || '').toString().trim(),
              storeName: receipt.storeName || '',
              totalAmount: parseInt(receipt.totalAmount) || 0,
              category: receipt.suggestedCategory || '식비',
              bizNum: receipt.bizNum || '',
              approvalNum: receipt.approvalNum || '',
              cardNumber: receipt.cardNumber || '',
              note: `Drive 복원: ${file.name}`,
              imageId,
              imageUrl: dataUrl,
              createdAt: Date.now(),
            });
            restoredReceipts++;
          }
        } catch (error) {
          if (import.meta.env.DEV) console.warn('복원 실패:', file.name, error);
          failedFiles++;
        }
        setRestoreProgress({ stage: 'process', current: i + 1, total: files.length });
      }

      const failTail = failedFiles > 0 ? ` / 실패 ${failedFiles}장` : '';
      showToast(`✅ ${restoredReceipts}건 복원 완료 (${files.length - failedFiles}장 처리${failTail})`);
    } catch (error) {
      showToast(`❌ 복원 실패: ${error.message}`);
    } finally {
      setRestoreProgress(null);
    }
  }, [canonicalNames, driveUploading, restoring, saveReceipts, showToast, tripStartDate]);

  return {
    restoreProgress,
    restoreFromDrive,
  };
}
