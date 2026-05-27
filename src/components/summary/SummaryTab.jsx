import { useState, useRef } from 'react';
import { TODAY, formatDateKorean, formatCurrency } from '../../utils/formatter';

export default function SummaryTab({ receipts, names, reportDate }) {
  const [summaryMode, setSummaryMode] = useState('category');
  const [expandedItems, setExpandedItems] = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const summaryRef = useRef(null);

  const toggleExpand = (item) =>
    setExpandedItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);

  const captureImage = async () => {
    if (!summaryRef.current) return;
    try {
      setIsCapturing(true);
      await new Promise(res => setTimeout(res, 300));
      const html2canvas = (await import('html2canvas')).default;
      const cvs = await html2canvas(summaryRef.current, { backgroundColor: '#0f172a', scale: 2, useCORS: true });
      setIsCapturing(false);
      cvs.toBlob(async b => {
        const file = new File([b], `집계표_${TODAY}.png`, { type: 'image/png' });
        try {
          if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file] }); return;
          }
        } catch (e) { if (e.name !== 'AbortError') console.error(e); }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = `집계표_${TODAY}.png`; a.click();
      }, 'image/png');
    } catch (e) { setIsCapturing(false); alert(e.message); }
  };

  const grandTotal = (receipts || []).reduce((s, r) => s + (r.totalAmount || 0), 0);

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center px-1">
        <div className="flex bg-slate-800 rounded-xl p-1 gap-1">
          <button
            onClick={() => setSummaryMode('category')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${summaryMode === 'category' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
          >용도별</button>
          <button
            onClick={() => setSummaryMode('date')}
            className={`px-4 py-2 rounded-lg text-xs font-black transition-all ${summaryMode === 'date' ? 'bg-blue-600 text-white' : 'text-slate-400'}`}
          >일자별</button>
        </div>
        <button onClick={captureImage} className="bg-green-600 px-4 py-2 rounded-xl text-xs font-black">📸 이미지 저장</button>
      </div>

      <div ref={summaryRef} className="bg-slate-900 rounded-[1.5rem] p-5 border-2 border-slate-800 space-y-4">
        <div className="text-center pb-4 border-b border-slate-800">
          <p className="text-slate-500 text-[9px] mb-0.5">(주)미래생태공간</p>
          <h3 className="text-xl font-black text-slate-100">{names}</h3>
          <p className="text-slate-400 text-[11px] mt-1 font-medium">{reportDate ? formatDateKorean(reportDate) : formatDateKorean(TODAY)} 기준</p>
        </div>

        <div className="space-y-4">
          {summaryMode === 'category' ? (
            (() => {
              const order = ['숙박비', '식비', '기타'], fuelCat = '유류비';
              const genTotal = receipts.filter(r => order.includes(r.category)).reduce((s, r) => s + (r.totalAmount || 0), 0);
              const renderGroup = (cat) => {
                const list = receipts.filter(r => r.category === cat); if (list.length === 0) return null;
                const isExp = isCapturing || expandedItems.includes(cat);
                return (
                  <div key={cat} className="bg-slate-800/50 border-2 border-slate-700/70 rounded-2xl overflow-hidden">
                    <div onClick={() => toggleExpand(cat)} className="flex justify-between items-center p-4 cursor-pointer">
                      <span className="font-black text-slate-200 text-base">{cat}</span>
                      <span className="font-black text-white text-lg">{formatCurrency(list.reduce((s, r) => s + r.totalAmount, 0))}</span>
                    </div>
                    {isExp && (
                      <div className="px-4 pb-4 space-y-2 border-t border-slate-700/50 pt-3 bg-slate-900/30">
                        {list.map(r => (
                          <div key={r.id} className="flex justify-between items-start text-[11px]">
                            <span className="text-slate-500 font-bold">{r.date.slice(2).replace(/-/g, '.')} {r.storeName}</span>
                            <span className="text-slate-300 font-black">{formatCurrency(r.totalAmount)}</span>
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
                      <span className="text-orange-400 font-black text-sm">소계</span>
                      <span className="text-orange-400 font-black text-lg">{formatCurrency(genTotal)}</span>
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
                      <span className="font-black text-slate-200 text-base">{displayDate}</span>
                      <span className="font-black text-white text-lg">{formatCurrency(list.reduce((s, r) => s + r.totalAmount, 0))}</span>
                    </div>
                    {isExp && (
                      <div className="px-4 pb-4 space-y-2 border-t border-slate-700/50 pt-3 bg-slate-900/30">
                        {list.map(r => (
                          <div key={r.id} className="flex justify-between items-start text-[11px]">
                            <span className="text-slate-500 font-bold">{r.storeName} ({r.category})</span>
                            <span className="text-slate-300 font-black">{formatCurrency(r.totalAmount)}</span>
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
          <span className="text-slate-100 font-black text-base">총 합계</span>
          <span className="text-2xl font-black text-green-400">{formatCurrency(grandTotal)}</span>
        </div>
      </div>
    </div>
  );
}
