import { useState, useEffect, useMemo } from 'react';
import { Download, Share2, X } from 'lucide-react';
import ZoomableImage from '../gallery/ZoomableImage';

/** 이미지 썸네일 — imageId 기반 비동기 로딩 */
function ImageThumb({ imageId, getImageUrl, className }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (imageId) getImageUrl(imageId).then(url => setSrc(url || ''));
  }, [imageId, getImageUrl]);
  return src ? <img src={src} className={className} alt="" /> : <div className={className} />;
}

/**
 * @param {object} props
 * @param {array}  props.receipts
 * @param {Function} props.getImageUrl
 * @param {Function} props.onUpdateRotation  (id, rotation) => void
 * @param {string|null} props.selectedId     — App에서 관리하는 선택된 영수증 ID
 * @param {Function}    props.onSelectChange — (id|null) => void
 */
export default function ImagesTab({ receipts, getImageUrl, onUpdateRotation, selectedId, onSelectChange }) {
  const [detailImgSrc, setDetailImgSrc] = useState('');
  const [sharing, setSharing] = useState(false);

  const imageReceipts = useMemo(() => {
    const byImageId = new Map();
    const sorted = [...(receipts || [])]
      .filter(r => r.imageId)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    for (const receipt of sorted) {
      if (!byImageId.has(receipt.imageId)) byImageId.set(receipt.imageId, receipt);
    }

    return [...byImageId.values()];
  }, [receipts]);

  const selectedReceipt = useMemo(() => {
    if (!selectedId) return null;
    const direct = imageReceipts.find(r => r.id === selectedId);
    if (direct) return direct;

    const selected = (receipts || []).find(r => r.id === selectedId);
    if (!selected?.imageId) return null;
    return imageReceipts.find(r => r.imageId === selected.imageId) || null;
  }, [imageReceipts, receipts, selectedId]);

  const makeImageFile = async (receipt, index) => {
    const url = await getImageUrl(receipt.imageId);
    if (!url) return null;
    const blob = await fetch(url).then(res => res.blob());
    const ext = blob.type?.includes('png') ? 'png' : 'jpg';
    const storeName = (receipt.storeName || '영수증').replace(/[/\\:*?"<>|]/g, '_').slice(0, 18);
    const fileName = `${receipt.date || '날짜없음'}_${storeName}_${String(index + 1).padStart(2, '0')}.${ext}`;
    return new File([blob], fileName, { type: blob.type || 'image/jpeg' });
  };

  const downloadFiles = (files) => {
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  };

  const shareAllImages = async () => {
    if (imageReceipts.length === 0 || sharing) return;
    setSharing(true);
    try {
      const files = (await Promise.all(imageReceipts.map(makeImageFile))).filter(Boolean);
      if (files.length === 0) return;

      if (!navigator.canShare?.({ files })) {
        downloadFiles(files);
        return;
      }

      try {
        await navigator.share({
          title: '영수증 이미지',
          text: `영수증 이미지 ${files.length}장`,
          files,
        });
      } catch (err) {
        if (err?.name !== 'AbortError') downloadFiles(files);
      }
    } finally {
      setSharing(false);
    }
  };

  useEffect(() => {
    if (!selectedId) { setDetailImgSrc(''); return; }
    if (selectedReceipt?.imageId) getImageUrl(selectedReceipt.imageId).then(url => setDetailImgSrc(url || ''));
    else setDetailImgSrc('');
  }, [selectedId, selectedReceipt, getImageUrl]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-base font-black text-slate-300">
          영수증 {imageReceipts.length}장
        </div>
        <button
          onClick={shareAllImages}
          disabled={imageReceipts.length === 0 || sharing}
          className="shrink-0 flex items-center gap-2 rounded-2xl bg-slate-800 border border-slate-700 px-4 py-3.5 text-sm font-black text-slate-100 active:scale-95 disabled:opacity-40"
        >
          {navigator.canShare ? <Share2 size={18} /> : <Download size={18} />}
          {sharing ? '준비 중' : '공유 / 저장'}
        </button>
      </div>

      {/* 썸네일 스트립 */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
        {imageReceipts.map(r => (
          <button
            key={r.id}
            onClick={() => onSelectChange(r.id)}
            className={`shrink-0 w-24 h-24 rounded-2xl border-4 overflow-hidden ${selectedReceipt?.imageId === r.imageId ? 'border-blue-500 scale-105' : 'border-slate-800 opacity-55'}`}
          >
            <ImageThumb imageId={r.imageId} getImageUrl={getImageUrl} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      {/* 상세 뷰 */}
      {selectedId ? (
        (() => {
          const sel = selectedReceipt;
          if (!sel) return null;
          return (
            <div className="bg-slate-800 rounded-2xl border-2 border-slate-700 overflow-hidden shadow-2xl">
              <div className="p-5 border-b border-slate-700 flex justify-between items-center gap-3 bg-slate-900/50">
                <div>
                  <p className="text-sm text-blue-300 font-black">{sel.date}</p>
                  <h3 className="text-2xl font-black truncate max-w-[220px]">{sel.storeName}</h3>
                </div>
                <button onClick={() => onSelectChange(null)} className="w-12 h-12 flex items-center justify-center bg-slate-800 rounded-full border border-slate-700">
                  <X size={26} />
                </button>
              </div>
              <div className="aspect-[3/4] bg-black">
                {detailImgSrc
                  ? <ZoomableImage src={detailImgSrc} initialRotation={sel.rotation} onRotate={(rot) => onUpdateRotation(sel.id, rot)} />
                  : <div className="h-full flex items-center justify-center text-slate-400 font-black text-lg">이미지 없음</div>
                }
              </div>
            </div>
          );
        })()
      ) : (
        <div className="py-32 text-center text-slate-400 border-2 border-dashed border-slate-800 rounded-2xl font-black text-lg">
          이미지를 선택해주세요
        </div>
      )}
    </div>
  );
}
