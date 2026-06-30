import { useCallback } from 'react';
import { getToday } from '../utils/formatter';

async function blobToDataUrl(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function shareFile(blob, fileName, mimeType) {
  try {
    const file = new File([blob], fileName, { type: mimeType });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return true;
    }
  } catch (error) {
    if (error.name !== 'AbortError' && import.meta.env.DEV) console.error(error);
  }
  return false;
}

export default function useReceiptBackup({ receipts, getImageUrl, saveReceipts, showToast }) {
  const saveToJSON = useCallback(async () => {
    const exportData = await Promise.all(receipts.map(async receipt => {
      const item = { ...receipt };
      if (receipt.imageId) {
        const objectUrl = await getImageUrl(receipt.imageId);
        if (objectUrl) {
          const imageBlob = await fetch(objectUrl).then(res => res.blob());
          item.imageUrl = await blobToDataUrl(imageBlob);
        }
      }
      return item;
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const fileName = `출장비_${getToday().replace(/-/g, '')}.json`;
    if (await shareFile(blob, fileName, 'application/json')) return;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [getImageUrl, receipts]);

  const loadFromFile = useCallback(async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (readerEvent) => {
      let loaded;
      try {
        loaded = JSON.parse(readerEvent.target.result);
      } catch {
        showToast('❌ 파일 형식 오류 — JSON 파싱 실패');
        return;
      }
      if (!Array.isArray(loaded)) {
        showToast('❌ 백업 형식 오류 — 영수증 배열이 아닙니다');
        return;
      }

      const existingIds = new Set((receipts || []).map(receipt => receipt.id));
      const valid = [];
      let skippedInvalid = 0;
      let skippedDuplicate = 0;
      for (const item of loaded) {
        if (!item || typeof item !== 'object' || !item.id) { skippedInvalid += 1; continue; }
        if (typeof item.totalAmount !== 'number') { skippedInvalid += 1; continue; }
        if (existingIds.has(item.id)) { skippedDuplicate += 1; continue; }
        existingIds.add(item.id);
        valid.push(item);
      }

      if (valid.length === 0) {
        const reason = skippedDuplicate > 0
          ? `이미 존재하는 ${skippedDuplicate}건은 건너뛰었습니다`
          : '유효한 영수증을 찾지 못했습니다';
        showToast(`⚠️ 가져올 영수증 없음 — ${reason}`);
        return;
      }

      try {
        await saveReceipts(valid);
        const parts = [`${valid.length}건 추가`];
        if (skippedDuplicate > 0) parts.push(`중복 ${skippedDuplicate}건 건너뜀`);
        if (skippedInvalid > 0) parts.push(`형식 오류 ${skippedInvalid}건 건너뜀`);
        showToast(`📂 ${parts.join(' · ')}`);
      } catch (error) {
        if (import.meta.env.DEV) console.error('Backup load save failed:', error);
        showToast('❌ 저장 실패 — 잠시 후 다시 시도');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, [receipts, saveReceipts, showToast]);

  return { saveToJSON, loadFromFile };
}
