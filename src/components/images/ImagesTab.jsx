import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
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

  const sortedImgReceipts = [...(receipts || [])].filter(r => r.imageId).sort((a, b) => b.createdAt - a.createdAt);

  useEffect(() => {
    if (!selectedId) { setDetailImgSrc(''); return; }
    const sel = receipts.find(r => r.id === selectedId);
    if (sel?.imageId) getImageUrl(sel.imageId).then(url => setDetailImgSrc(url || ''));
    else setDetailImgSrc('');
  }, [selectedId, receipts, getImageUrl]);

  return (
    <div className="space-y-5">
      {/* 썸네일 스트립 */}
      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
        {sortedImgReceipts.map(r => (
          <button
            key={r.id}
            onClick={() => onSelectChange(r.id)}
            className={`shrink-0 w-20 h-20 rounded-2xl border-4 overflow-hidden ${selectedId === r.id ? 'border-blue-500 scale-105' : 'border-slate-800 opacity-50'}`}
          >
            <ImageThumb imageId={r.imageId} getImageUrl={getImageUrl} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>

      {/* 상세 뷰 */}
      {selectedId ? (
        (() => {
          const sel = receipts.find(r => r.id === selectedId);
          if (!sel) return null;
          return (
            <div className="bg-slate-800 rounded-[2rem] border-2 border-slate-700 overflow-hidden shadow-2xl">
              <div className="p-5 border-b border-slate-700 flex justify-between items-center bg-slate-900/50">
                <div>
                  <p className="text-xs text-blue-400 font-black">{sel.date}</p>
                  <h3 className="text-xl font-black truncate max-w-[200px]">{sel.storeName}</h3>
                </div>
                <button onClick={() => onSelectChange(null)} className="p-3 bg-slate-800 rounded-full">
                  <X size={24} />
                </button>
              </div>
              <div className="aspect-[3/4] bg-black">
                {detailImgSrc
                  ? <ZoomableImage src={detailImgSrc} initialRotation={sel.rotation} onRotate={(rot) => onUpdateRotation(sel.id, rot)} />
                  : <div className="h-full flex items-center justify-center text-slate-500 font-bold">이미지 없음</div>
                }
              </div>
            </div>
          );
        })()
      ) : (
        <div className="py-32 text-center text-slate-500 border-2 border-dashed border-slate-800 rounded-[2rem] font-bold">
          이미지를 선택해주세요
        </div>
      )}
    </div>
  );
}
