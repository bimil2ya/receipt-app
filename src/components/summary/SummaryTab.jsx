import { flushSync } from 'react-dom';
import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import { getToday, formatDateKorean, formatCurrency, decodeHtmlEntities } from '../../utils/formatter';
import {
  buildCategorySummary,
  buildDateSummary,
  getReceiptGrandTotal,
  safeCategory,
  safeDateLabel,
  summaryCategories,
} from './summaryUtils';
import { ReceiptAmountOverflowError } from '../../utils/receiptAmount';

const SummaryTab = forwardRef(function SummaryTab({ receipts, names, reportDate, visible = true, onShareComplete, onCaptureStart, onCaptureEnd, onError, shareRecipientGuidance = '공유 화면에서 업무에 사용하는 대화방이나 담당자를 선택해 주세요.' }, ref) {
  const [summaryMode, setSummaryMode] = useState('category');
  const [expandedItems, setExpandedItems] = useState([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showKakaoGuide, setShowKakaoGuide] = useState(false);
  const [kakaoBlob, setKakaoBlob] = useState(null);
  const summaryRef = useRef(null);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const shareImageType = isAndroid ? 'image/jpeg' : 'image/png';
  const shareImageExt = isAndroid ? 'jpg' : 'png';
  const captureScale = isAndroid ? 1.25 : 2;
  const shouldRenderFull = visible || isCapturing || showKakaoGuide;

  useImperativeHandle(ref, () => ({ triggerKakaoShare: prepareKakaoShare }));

  const toggleExpand = (item) =>
    setExpandedItems(prev => prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]);

  // 단일 뷰 캡처 (html2canvas)
  const captureCurrentView = async (html2canvas) => {
    return html2canvas(summaryRef.current, { backgroundColor: '#0f172a', scale: captureScale, useCORS: true });
  };

  const waitForPaint = async () => {
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
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
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) { setIsCapturing(false); onError?.(e.message || '이미지 저장에 실패했습니다.'); }
    finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setIsCapturing(false);
    }
  };

  // 카톡 공유용 — 용도별 + 일자별 합친 이미지 생성
  const prepareKakaoShare = async () => {
    if (!summaryRef.current) return;
    const origMode = summaryMode;
    try {
      await onCaptureStart?.();
      setIsCapturing(true);
      const html2canvas = (await import('html2canvas')).default;

      // 용도별 캡처
      flushSync(() => setSummaryMode('category'));
      await waitForPaint();
      const cvs1 = await captureCurrentView(html2canvas);

      // 일자별 캡처
      flushSync(() => setSummaryMode('date'));
      await waitForPaint();
      const cvs2 = await captureCurrentView(html2canvas);

      // 원래 탭 복원
      flushSync(() => setSummaryMode(origMode));

      // 두 캔버스를 세로로 합치기 (구분선 40px)
      const gap = isAndroid ? 28 : 40;
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
        combined.toBlob(result => result ? resolve(result) : reject(new Error('캡처 실패')), shareImageType, 0.88);
      });

      setKakaoBlob(blob);
      setShowKakaoGuide(true);
    } catch (e) {
      flushSync(() => setSummaryMode(origMode));
      onError?.(e.message || '캡처에 실패했습니다.');
    } finally {
      setIsCapturing(false);
      onCaptureEnd?.();
    }
  };

  // 실제 공유 실행
  const doShare = async () => {
    if (!kakaoBlob) return;
    const file = new File([kakaoBlob], `집계표_${getToday()}.${shareImageExt}`, { type: shareImageType });
    const downloadShareFile = () => {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    try {
      if (navigator.canShare?.({ files: [file] })) {
        setShowKakaoGuide(false);
        await navigator.share({
          title: '출장비 집계표',
          text: '출장비 집계표입니다.',
          files: [file],
        });
        setKakaoBlob(null);
        onShareComplete?.();
      } else {
        downloadShareFile();
        onError?.('공유창을 열 수 없어 이미지 파일만 저장했습니다. 저장한 이미지를 카카오톡으로 직접 보내주세요.');
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        downloadShareFile();
        onError?.(`공유창 오류로 이미지 파일만 저장했습니다. 저장한 이미지를 카카오톡으로 직접 보내주세요. (${e.message})`);
      } else {
        setShowKakaoGuide(true);
      }
    }
  };

  let grandTotal;
  let categorySummary;
  let dateSummary;
  let summaryError = null;
  try {
    grandTotal = getReceiptGrandTotal(receipts);
    categorySummary = buildCategorySummary(receipts);
    dateSummary = buildDateSummary(receipts);
  } catch (error) {
    if (!(error instanceof ReceiptAmountOverflowError)) throw error;
    summaryError = error;
  }
  const categoryTabClass = summaryMode === 'category' ? 'bg-blue-600 text-white' : 'text-slate-200';
  const dateTabClass = summaryMode === 'date' ? 'bg-blue-600 text-white' : 'text-slate-200';

  if (!shouldRenderFull) {
    return <div ref={summaryRef} className="fixed left-[-200vw] top-0 w-screen pointer-events-none" aria-hidden="true" />;
  }

  if (summaryError) {
    return (
      <div className="receipt-summary rounded-2xl border border-red-500/60 bg-red-950/40 p-4" role="alert">
        <p className="font-black text-red-100">집계 금액을 정확하게 표시할 수 없습니다.</p>
        <p className="mt-2 text-sm font-bold text-red-200">합계가 이 기기에서 안전하게 계산할 수 있는 범위를 넘었습니다. 금액을 나누어 확인한 뒤 다시 집계해 주세요.</p>
      </div>
    );
  }

  return (
    <div className="receipt-summary space-y-3">
      {/* 탭 + 버튼 행 */}
      <div className="flex flex-col gap-2 px-1 min-[390px]:flex-row min-[390px]:items-center min-[390px]:justify-between">
        <div className="grid grid-cols-2 bg-slate-800 rounded-xl p-1 gap-1 min-[390px]:flex min-[390px]:shrink-0">
          <button aria-pressed={summaryMode === 'category'} onClick={() => setSummaryMode('category')} className={`min-h-11 px-3 py-2.5 rounded-lg text-sm font-black transition-all ${categoryTabClass}`}>용도별</button>
          <button aria-pressed={summaryMode === 'date'} onClick={() => setSummaryMode('date')} className={`min-h-11 px-3 py-2.5 rounded-lg text-sm font-black transition-all ${dateTabClass}`}>일자별</button>
        </div>
        <button
          onClick={captureImage}
          disabled={isCapturing}
          className="min-h-11 bg-green-600 px-3 py-2.5 rounded-xl text-sm font-black disabled:opacity-50 whitespace-nowrap"
        >
          {isCapturing ? '준비중…' : '📸 이미지 저장'}
        </button>
      </div>

      {/* 집계 카드 */}
      <div ref={summaryRef} className="bg-slate-900 rounded-2xl p-5 border-2 border-slate-800 space-y-5">
        <div className="text-center pb-4 border-b border-slate-800">
          <p className="text-slate-400 text-sm mb-1 font-black">(주)미래생태공간</p>
          <h3 className="break-words text-2xl font-black text-slate-50">{names}</h3>
          <p className="text-slate-300 text-sm mt-1 font-medium">{reportDate ? formatDateKorean(reportDate) : formatDateKorean(getToday())} 기준</p>
        </div>

        <div className="space-y-4">
          {summaryMode === 'category' ? (
            <>
              {categorySummary.sections
                .filter(({ category }) => summaryCategories.includes(category))
                .map(({ key, category, total, items }) => {
                  const isExp = isCapturing || expandedItems.includes(key);
                  return (
                    <div key={key} className="bg-slate-800/50 border-2 border-slate-700/70 rounded-2xl overflow-hidden">
                      <button type="button" onClick={() => toggleExpand(key)} aria-expanded={isExp} className="flex w-full min-w-0 justify-between items-center gap-3 p-4 text-left min-h-[44px]">
                        <span className="min-w-0 break-words font-black text-slate-100 text-lg">{category}</span>
                        <span className="shrink-0 font-black text-white text-xl">{formatCurrency(total)}</span>
                      </button>
                      {isExp && (
                        <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3 bg-slate-900/30">
                          {items.map(r => (
                            <div key={r.id} className="flex min-w-0 justify-between items-start gap-3 text-sm">
                              <span className="min-w-0 break-words text-slate-300 font-bold leading-6">{safeDateLabel(r.date)} {decodeHtmlEntities(r.storeName) || '사용처 없음'}</span>
                              <span className="text-slate-100 font-black whitespace-nowrap">{formatCurrency(r.totalAmount)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              {categorySummary.subtotal > 0 && (
                <div className="flex justify-between items-center px-4 py-3 bg-orange-500/10 border-2 border-orange-500/30 rounded-xl mx-1">
                  <span className="text-orange-300 font-black text-sm">소계</span>
                  <span className="text-orange-300 font-black text-lg">{formatCurrency(categorySummary.subtotal)}</span>
                </div>
              )}
              {categorySummary.sections
                .filter(({ category }) => !summaryCategories.includes(category))
                .map(({ key, category, total, items }) => {
                const isExp = isCapturing || expandedItems.includes(key);
                return (
                  <div key={key} className="bg-slate-800/50 border-2 border-slate-700/70 rounded-2xl overflow-hidden">
                    <button type="button" onClick={() => toggleExpand(key)} aria-expanded={isExp} className="flex w-full min-w-0 justify-between items-center gap-3 p-4 text-left min-h-[44px]">
                      <span className="min-w-0 break-words font-black text-slate-100 text-lg">{category}</span>
                      <span className="shrink-0 font-black text-white text-xl">{formatCurrency(total)}</span>
                    </button>
                    {isExp && (
                      <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3 bg-slate-900/30">
                        {items.map(r => (
                          <div key={r.id} className="flex min-w-0 justify-between items-start gap-3 text-sm">
                            <span className="min-w-0 break-words text-slate-300 font-bold leading-6">{safeDateLabel(r.date)} {decodeHtmlEntities(r.storeName) || '사용처 없음'}</span>
                            <span className="text-slate-100 font-black whitespace-nowrap">{formatCurrency(r.totalAmount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {dateSummary.map(({ key, date, displayDate, total, items }) => {
                const isExp = isCapturing || expandedItems.includes(key);
                return (
                  <div key={key} className="bg-slate-800/50 border-2 border-slate-700/70 rounded-2xl overflow-hidden">
                  <button type="button" onClick={() => toggleExpand(key)} aria-expanded={isExp} className="flex w-full min-w-0 justify-between items-center gap-3 p-4 text-left min-h-[44px]">
                    <span className="min-w-0 break-words font-black text-slate-100 text-lg">{displayDate || safeDateLabel(date)}</span>
                    <span className="shrink-0 font-black text-white text-xl">{formatCurrency(total)}</span>
                    </button>
                    {isExp && (
                      <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3 bg-slate-900/30">
                        {items.map(r => (
                        <div key={r.id} className="flex min-w-0 justify-between items-start gap-3 text-sm">
                          <span className="min-w-0 break-words text-slate-300 font-bold leading-6">{decodeHtmlEntities(r.storeName) || '사용처 없음'} ({safeCategory(r.category)})</span>
                            <span className="text-slate-100 font-black whitespace-nowrap">{formatCurrency(r.totalAmount)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="border-t-2 border-slate-700 pt-5 pb-1 flex min-w-0 justify-between items-end gap-3 px-1">
          <span className="text-slate-100 font-black text-lg">총 합계</span>
          <span className="shrink-0 text-right text-2xl font-black text-green-400 min-[390px]:text-3xl">{formatCurrency(grandTotal)}</span>
        </div>
      </div>

      {/* 카톡 가이드 오버레이 */}
      {showKakaoGuide && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-5 pointer-events-auto">
          <div className="w-full bg-slate-800 rounded-3xl p-6 space-y-4 shadow-2xl">
            <p className="text-white font-black text-lg text-center">💬 카카오톡으로 전송</p>
            <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-2xl p-4">
              <p className="text-yellow-200 font-bold text-sm text-center leading-7">
                {shareRecipientGuidance}
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
