import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { getToday, formatDateKorean, formatCurrency, decodeHtmlEntities } from '../../utils/formatter';

const SummaryTab = forwardRef(function SummaryTab({ receipts, names, reportDate }, ref) {
  const [summaryMode, setSummaryMode] = useState('category');
  const [expandedItems, setExpandedItems] = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showKakaoGuide, setShowKakaoGuide] = useState(false);
  const [kakaoBlob, setKakaoBlob] = useState(null);
  const summaryRef = useRef(null);

  useImperativeHandle(ref, () => ({ triggerKakaoShare: prepareKakaoShare }));

  const toggleExpand = (item) =>
    setExpandedItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);

  // 단일 뷰 캡처 (html2canvas)
  const captureCurrentView = async (html2canvas) => {
    return html2canvas(summaryRef.current, { backgroundColor: '#0f172a', scale: 2, useCORS: true });
  };

  // 이미지 저장 (기존 기능)
  const captureImage = async () => {
    if (!summaryRef.current) return;
    let objectUrl = '';
    try {
      setIsCapturing(true);
      await new Promise(res => setTimeout(res, 300));
      const html2canvas = (await import('html2canvas')).default;
      const cvs = await captureCurrentView(html2canvas);
      const blob = await new Promise((resolve, reject) => {
        cvs.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('이미지 저장에 실패했습니다.'));
        }, 'image/png');
      });
      const file = new File([blob], `집계표_${getToday()}.png`, { type: 'image/png' });
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
      a.download = `집계표_${getToday()}.png`;
      a.click();
    } catch (e) { setIsCapturing(false); alert(e.message); }
    finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsCapturing(false);
    }
  };

  // 카톡 공유용 — 용도별 + 일자별 합친 이미지 생성
  const prepareKakaoShare = async () => {
    if (!summaryRef.current) return;
    setIsCapturing(true);
    const origMode = summaryMode;
    try {
      const html2canvas = (await import('html2canvas')).default;

      // 용도별 캡처
      setSummaryMode('category');
      await new Promise(res => setTimeout(res, 400));
      const cvs1 = await captureCurrentView(html2canvas);

      // 일자별 캡처
      setSummaryMode('date');
      await new Promise(res => setTimeout(res, 400));
      const cvs2 = await captureCurrentView(html2canvas);

      // 원래 탭 복원
      setSummaryMode(origMode);

      // 두 캔버스를 세로로 합치기 (구분선 40px)
      const gap = 40;
      const combined = document.createElement('canvas');
      combined.width = cvs1.width;
      combined.height = cvs1.height + gap + cvs2.height;
      const ctx = combined.getContext('2d');
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, combined.width, combined.height);
      ctx.drawImage(cvs1, 0, 0);
      // 구분선
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(40, cvs1.height + gap / 2);
      ctx.lineTo(combined.width - 40, cvs1.height + gap / 2);
      ctx.stroke();
      ctx.drawImage(cvs2, 0, cvs1.height + gap);

      const blob = await new Promise((resolve, reject) => {
        combined.toBlob(result => result ? resolve(result) : reject(new Error('캡처 실패')), 'image/png');
      });

      setKakaoBlob(blob);
      setShowKakaoGuide(true);
    } catch (e) {
      setSummaryMode(origMode);
      alert(e.message);
    } finally {
      setIsCapturing(false);
    }
  };

  // 실제 공유 실행
  const doShare = async () => {
    if (!kakaoBlob) return;
    const file = new File([kakaoBlob], `집계표_${getToday()}.png`, { type: 'image/png' });
    setShowKakaoGuide(false);
    setKakaoBlob(null);
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file] });
      } else {
        const url = URL.createObjectURL(kakaoBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `집계표_${getToday()}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (e.name !== 'AbortError') alert(e.message);
    }
  };

  const grandTotal = (receipts || []).reduce((s, r) => s + (r.totalAmount || 0), 0);
  const safeDate = (value) => String(value || '').slice(2).replace(/-/g, '.');
  const safeCategory = (value) => String(value || '기타');
  const categoryTabClass = summaryMode === 'category' ? 'bg-blue-600 text-white' : 'text-slate-200';
  const dateTabClass = summaryMode === 'date' ? 'bg-blue-600 text-white' : 'text-slate-200';

  return (
    <div className="space-y-3">
      {/* 탭 + 버튼 행 */}
      <div className="flex justify-between items-center gap-2 px-1">
        <div className="flex bg-slate-800 rounded-xl p-1 gap-1 shrink-0">
          <button onClick={() => setSummaryMode('category')} className={`px-4 py-3 rounded-lg text-sm font-black transition-all ${categoryTabClass}`}>용도별</button>
          <button onClick={() => setSummaryMode('date')} className={`px-4 py-3 rounded-lg text-sm font-black transition-all ${dateTabClass}`}>일자별</button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={captureImage}
            disabled={isCapturing}
            className="bg-green-600 px-3 py-3 rounded-xl text-sm font-black disabled:opacity-50 whitespace-nowrap"
          >
            📸 저장
          </button>
          <button
            onClick={prepareKakaoShare}
            disabled={isCapturing}
            className="bg-yellow-500 px-3 py-3 rounded-xl text-sm font-black text-slate-900 disabled:opacity-50 whitespace-nowrap"
          >
            {isCapturing ? '준비중…' : '💬 카톡'}
          </button>
        </div>
      </div>

      {/* 집계 카드 */}
      <div ref={summaryRef} className="bg-slate-900 rounded-2xl p-5 border-2 border-slate-800 space-y-5">
        <div className="text-center pb-4 border-b border-slate-800">
          <p className="text-slate-400 text-sm mb-1 font-black">(주)미래생태공간</p>
          <h3 className="text-2xl font-black text-slate-50">{names}</h3>
          <p className="text-slate-300 text-sm mt-1 font-medium">{reportDate ? formatDateKorean(reportDate) : formatDateKorean(getToday())} 기준</p>
        </div>

        <div className="space-y-4">
          {summaryMode === 'category' ? (
            (() => {
              const order = ['숙박비', '식비', '기타'];
              const nonBudgetCats = ['유류비', '의료비등'];
              const genTotal = receipts.filter(r => order.includes(r.category)).reduce((s, r) => s + (r.totalAmount || 0), 0);

              const renderGroup = (cat) => {
                const list = receipts
                  .filter(r => r.category === cat)
                  .sort((a, b) => {
                    const byDate = (b.date || '').localeCompare(a.date || '');
                    if (byDate !== 0) return byDate;
                    return (b.useTime || '').localeCompare(a.useTime || '');
                  });
                if (list.length === 0) return null;
                const isExp = isCapturing || expandedItems.includes(cat);
                return (
                  <div key={cat} className="bg-slate-800/50 border-2 border-slate-700/70 rounded-2xl overflow-hidden">
                    <button type="button" onClick={() => toggleExpand(cat)} aria-expanded={isExp} className="flex w-full justify-between items-center p-4 text-left min-h-[44px]">
                      <span className="font-black text-slate-100 text-lg">{cat}</span>
                      <span className="font-black text-white text-xl">{formatCurrency(list.reduce((s, r) => s + r.totalAmount, 0))}</span>
                    </button>
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
                  {nonBudgetCats.map(cat => renderGroup(cat))}
                </>
              );
            })()
          ) : (
            (() => {
              const dates = [...new Set(receipts.map(r => r.date))].sort((a, b) => (b || '').localeCompare(a || ''));
              return dates.map(d => {
                const list = receipts.filter(r => r.date === d).sort((a, b) => (b.useTime || '').localeCompare(a.useTime || ''));
                const isExp = isCapturing || expandedItems.includes(d);
                const displayDate = d.slice(2).replace(/-/g, '.');
                return (
                  <div key={d} className="bg-slate-800/50 border-2 border-slate-700/70 rounded-2xl overflow-hidden">
                    <button type="button" onClick={() => toggleExpand(d)} aria-expanded={isExp} className="flex w-full justify-between items-center p-4 text-left min-h-[44px]">
                      <span className="font-black text-slate-100 text-lg">{displayDate}</span>
                      <span className="font-black text-white text-xl">{formatCurrency(list.reduce((s, r) => s + r.totalAmount, 0))}</span>
                    </button>
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

      {/* 카톡 가이드 오버레이 */}
      {showKakaoGuide && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-5">
          <div className="w-full bg-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl">
            <p className="text-white font-black text-lg text-center">💬 카카오톡으로 전송</p>
            <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-2xl p-4">
              <p className="text-yellow-200 font-bold text-sm text-center leading-7">
                공유 화면에서 <span className="text-white font-black">카카오톡</span>을 선택한 후<br />
                <span className="text-white font-black">단체톡방(2026년 산림물지도 제작)</span>에서<br />
                <span className="text-yellow-300 font-black">유수림씨</span>를 선택하세요
              </p>
            </div>
            <p className="text-slate-500 text-xs text-center">용도별 + 일자별 집계가 한 장 이미지로 전송됩니다</p>
            <div className="flex gap-3">
              <button
                onClick={() => { setShowKakaoGuide(false); setKakaoBlob(null); }}
                className="flex-1 h-14 rounded-2xl bg-slate-700 text-slate-300 font-black active:scale-95"
              >
                취소
              </button>
              <button
                onClick={doShare}
                className="flex-1 h-14 rounded-2xl bg-yellow-500 text-slate-900 font-black active:scale-95"
              >
                공유하기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default SummaryTab;
