import { useState, useRef } from 'react';
import { TODAY, formatDateKorean, formatCurrency, decodeHtmlEntities } from '../../utils/formatter';

export default function SummaryTab({ receipts, names, reportDate }) {
  const [summaryMode, setSummaryMode] = useState('category');
  const [expandedItems, setExpandedItems] = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const summaryRef = useRef(null);

  const toggleExpand = (item) =>
    setExpandedItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);

  const captureImage = async () => {
    if (!summaryRef.current) return;
    let objectUrl = '';
    try {
      setIsCapturing(true);
      await new Promise(res => setTimeout(res, 300));
      const html2canvas = (await import('html2canvas')).default;
      const cvs = await html2canvas(summaryRef.current, { backgroundColor: '#0f172a', scale: 2, useCORS: true });
      const blob = await new Promise((resolve, reject) => {
        cvs.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('이미지 저장에 실패했습니다.'));
        }, 'image/png');
      });
      const file = new File([blob], `집계표_${TODAY}.png`, { type: 'image/png' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file] });
          return;
        }
      } catch (e) {
        if (e.name !== 'AbortError' && import.meta.env.DEV) console.error(e);
      }
      const a = document.createElement('a');
      objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = `집계표_${TODAY}.png`;
      a.click();
    } catch (e) { setIsCapturing(false); alert(e.message); }
    finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsCapturing(false);
    }
  };

  const grandTotal = (receipts || []).reduce((s, r) => s + (r.totalAmount || 0), 0);
  const safeDate = (value) => String(value || '').slice(2).replace(/-/g, '.');
  const safeCategory = (value) => String(value || '기타');
  const categoryTabClass = summaryMode === 'category'
    ? 'bg-blue-600 text-white'
    : 'text-slate-200';
  const dateTabClass = summaryMode === 'date'
    ? 'bg-blue-600 text-white'
    : 'text-slate-200';

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center gap-3 px-1">
        <div className="flex bg-slate-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setSummaryMode('category')}
            className={`px-4 py-3 rounded-lg text-sm font-black transition-all ${categoryTabClass}`}
          >용도별</button>
          <button
            onClick={() => setSummaryMode('date')}
            className={`px-4 py-3 rounded-lg text-sm font-black transition-all ${dateTabClass}`}
          >일자별</button>
        </div>
        <button onClick={captureImage} className="bg-green-600 px-4 py-3 rounded-xl text-sm font-black">📸 이미지 저장</button>
      </div>

      <div ref={summaryRef} className="bg-slate-900 rounded-2xl p-5 border-2 border-slate-800 space-y-5">
        <div className="text-center pb-4 border-b border-slate-800">
          <p className="text-slate-400 text-sm mb-1 font-black">(주)미래생태공간</p>
          <h3 className="text-2xl font-black text-slate-50">{names}</h3>
          <p className="text-slate-300 text-sm mt-1 font-medium">{reportDate ? formatDateKorean(reportDate) : formatDateKorean(TODAY)} 기준</p>
        </div>

        <div className="space-y-4">
          {summaryMode === 'category' ? (
            (() => {
              const order = ['숙박비', '식비', '기타'];
              const fuelCat = '유류비';
              const genTotal = receipts.filter(r => order.includes(r.category)).reduce((s, r) => s + (r.totalAmount || 0), 0);

              const renderGroup = (cat) => {
                const list = receipts.filter(r => r.category === cat);
                if (list.length === 0) return null;
                const isExp = isCapturing || expandedItems.includes(cat);
                return (
                  <div key={cat} className="bg-slate-800/50 border-2 border-slate-700/70 rounded-2xl overflow-hidden">
                    <div onClick={() => toggleExpand(cat)} className="flex justify-between items-center p-4 cursor-pointer">
                      <span className="font-black text-slate-100 text-lg">{cat}</span>
                      <span className="font-black text-white text-xl">{formatCurrency(list.reduce((s, r) => s + r.totalAmount, 0))}</span>
                    </div>
                    {isExp && (
                      <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3 bg-slate-900/30">
                        {list.map(r => (
                          <div key={r.id} className="flex justify-between items-start gap-3 text-sm">
                            <span className="text-slate-300 font-bold leading-6">{safeDate(r.date)} {decodeHtmlEntities(r.storeName) || '사용처 없음'}</span>
                            <span className="text-slate-100 font-black whitespace-nowrap">{formatCurrency(r.totalAmount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              };

              return (
                <>
                  {order.map(renderGroup)}
                  {genTotal > 0 && (
                    <div className="flex justify-between items-center px-4 py-3 bg-orange-500/10 border-2 border-orange-500/30 rounded-xl mx-1">
                      <span className="text-orange-300 font-black text-sm">소계</span>
                      <span className="text-orange-300 font-black text-lg">{formatCurrency(genTotal)}</span>
                    </div>
                  )}
                  {renderGroup(fuelCat)}
                </>
              );
            })()
          ) : (
            (() => {
              const dates = [...new Set(receipts.map(r => r.date))].sort();
              return dates.map(d => {
                const list = receipts.filter(r => r.date === d);
                const isExp = isCapturing || expandedItems.includes(d);
                const displayDate = d.slice(2).replace(/-/g, '.');
                return (
                  <div key={d} className="bg-slate-800/50 border-2 border-slate-700/70 rounded-2xl overflow-hidden">
                    <div onClick={() => toggleExpand(d)} className="flex justify-between items-center p-4 cursor-pointer">
                      <span className="font-black text-slate-100 text-lg">{displayDate}</span>
                      <span className="font-black text-white text-xl">{formatCurrency(list.reduce((s, r) => s + r.totalAmount, 0))}</span>
                    </div>
                    {isExp && (
                      <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3 bg-slate-900/30">
                        {list.map(r => (
                          <div key={r.id} className="flex justify-between items-start gap-3 text-sm">
                            <span className="text-slate-300 font-bold leading-6">{decodeHtmlEntities(r.storeName) || '사용처 없음'} ({safeCategory(r.category)})</span>
                            <span className="text-slate-100 font-black whitespace-nowrap">{formatCurrency(r.totalAmount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              });
            })()
          )}
        </div>

        <div className="border-t-2 border-slate-700 pt-5 pb-1 flex justify-between items-center px-1">
          <span className="text-slate-100 font-black text-lg">총 합계</span>
          <span className="text-3xl font-black text-green-400">{formatCurrency(grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}
