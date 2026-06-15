import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Settings,
  RefreshCw, Cloud, Loader2, HardDrive
} from 'lucide-react';

// Utils & Hooks
import { TODAY, formatDateKorean, formatCurrency, parseDate, decodeHtmlEntities } from './utils/formatter';
import { formatFailureDetail, formatFailureMessage } from './utils/errorCopy';
import { readStorageItem, writeStorageItem } from './utils/storage';
import useReceipts from './hooks/useReceipts';
import useUploader from './hooks/useUploader';

// Components
import Modal from './components/layout/Modal';
import ReceiptRow from './components/receipts/ReceiptRow';
import SettingsModal from './components/settings/SettingsModal';
import SummaryTab from './components/summary/SummaryTab';
import ImagesTab from './components/images/ImagesTab';
import DateRangePicker from './components/calendar/DateRangePicker';

// Constants
const ALL_CATS = ['숙박비', '식비', '기타', '유류비'];

function safeText(value, fallback = '') {
  return String(value ?? fallback).trim();
}

// 예산 통계
function BudgetStats({ weeklyBudget, budgetTotal, budgetRatio, fuelTotal }) {
  return (
    <div className="flex flex-wrap items-baseline mt-3 text-sm font-bold gap-x-2 gap-y-1">
      <span className="text-slate-400 whitespace-nowrap">
        총예산 {Math.round(weeklyBudget / 10000)}만원 중 {(budgetTotal / 10000).toFixed(1)}만원 사용({Math.round(budgetRatio)}%)
      </span>
      <span className="text-emerald-400 whitespace-nowrap shrink-0">
        유류비 {formatCurrency(fuelTotal)}
      </span>
    </div>
  );
}

export default function App() {
  const { receipts, loading, saveReceipts, deleteReceipt, resetAll, resetDeviceData, resetActivityLogs, syncStatus, saveStatus, pendingSyncCount, syncEvents, syncDaily, retryPendingSync, getImageUrl } = useReceipts();

  // ── 탭 & 네비게이션
  const [tab, setTab] = useState('list');
  const [listPanel, setListPanel] = useState('input');
  const [detailId, setDetailId] = useState(null);   // images 탭 선택 ID

  // ── 공지·알림
  const [toastMsg, setToastMsg] = useState('');
  const showToast = useCallback((msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 4000); }, []);

  // ── 앱 설정 (localStorage 동기화)
  const [names, setNames] = useState(() => readStorageItem('receipt_names', '노경호, 김영일'));
  const [reportDate, setReportDate] = useState(() => readStorageItem('receipt_date', ''));
  const [weeklyBudget, setWeeklyBudget] = useState(() => parseInt(readStorageItem('weekly_budget', '1000000')));

  // ── 모달 토글
  const [showSettings, setShowSettings] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showBudgetCalcModal, setShowBudgetCalcModal] = useState(false);
  const [tempBudget, setTempBudget] = useState(0);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const manualStoreRef = useRef(null);
  const budgetAmountRef = useRef(null);

  // ── 수정 상태
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [tripStartDate, setTripStartDate] = useState(TODAY);
  const [tripEndDate, setTripEndDate] = useState(TODAY);
  const [mf, setMf] = useState({ date: TODAY, storeName: '', totalAmount: '', category: '식비', note: '' });
  const [editState, setEditState] = useState({ id: null, field: null, value: '' });

  // ── 방금 추가한 영수증을 정렬과 무관하게 맨 위에 유지 (사용자가 정렬 토글하면 해제)
  const [pinnedNewIds, setPinnedNewIds] = useState([]);

  // ── Drive 업로드 진행
  const [driveUploading, setDriveUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // ── 파일 OCR 업로드 훅
  const { handleFiles, processing, procMsg } = useUploader({
    onUploadSuccess: async (added) => {
      await saveReceipts(added);
      setPinnedNewIds(prev => [...prev, ...added.map(r => r.id)]);
      showToast(`${added.length}건 추가 완료`);
    },
    onUploadError: ({ failedFiles, duplicateCount }) => {
      const parts = [];
      if (failedFiles.length > 0) {
        const failedSummary = failedFiles
          .map(f => `${f.name}${f.error ? ` (${f.error})` : ''}`)
          .join(', ');
        parts.push(`❌ 실패 ${failedFiles.length}건: ${failedSummary}`);
      }
      if (duplicateCount > 0) parts.push(`⚠️ 중복 제외 ${duplicateCount}건`);
      showToast(parts.join(' / '));
    },
  });

  useEffect(() => {
    if (tab === 'list') setListPanel('input');
  }, [tab]);

  // ── 영수증 조작
  const handleEdit = useCallback((id, f, v) => {
    if (f === 'detail') {
      const r = receipts.find(item => item.id === id); if (!r) return;
      setEditState({ id, field: f, value: { date: r.date, storeName: decodeHtmlEntities(r.storeName) || '', totalAmount: r.totalAmount, category: r.category, note: decodeHtmlEntities(r.note) || '' } });
    } else { setEditState({ id, field: f, value: v }); }
  }, [receipts]);

  const handleInlineEdit = async () => {
    const { id, field, value } = editState; if (!id) return;
    const target = receipts.find(r => r.id === id);
    if (field === 'detail') {
      await saveReceipts({ ...target, ...value, totalAmount: parseInt(value.totalAmount) || 0 });
    } else {
      let fv = value;
      if (field === 'date') fv = parseDate(value);
      if (field === 'totalAmount') fv = Math.min(9999999, parseInt(value) || 0);
      await saveReceipts({ ...target, [field]: fv });
    }
    setEditState({ id: null, field: null, value: '' });
  };

  const handleUpdateRotation = useCallback(async (id, rot) => {
    const up = receipts.filter(r => r.id === id).map(r => ({ ...r, rotation: rot }));
    await saveReceipts(up);
  }, [receipts, saveReceipts]);

  const handleViewImage = useCallback((id) => { setDetailId(id); setTab('images'); }, []);

  const handleManualAdd = async () => {
    if (!mf.storeName) return;
    const newId = crypto.randomUUID();
    await saveReceipts({ id: newId, ...mf, totalAmount: parseInt(mf.totalAmount) || 0, createdAt: Date.now() });
    setPinnedNewIds(prev => [...prev, newId]);
    setMf({ date: TODAY, storeName: '', totalAmount: '', category: '식비', note: '' });
    requestAnimationFrame(() => manualStoreRef.current?.focus());
    showToast('✅ 1건 추가 완료');
  };

  const handleBudgetCalc = () => {
    const start = new Date(tripStartDate); const end = new Date(tripEndDate);
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays <= 0) { alert('날짜 오류'); return; }
    // 마지막 날 80,000원, 나머지 130,000원
    const calc = diffDays <= 1 ? 80000 : (diffDays - 1) * 130000 + 80000;
    setTempBudget(calc);  // 모달 입력란에 반영만 (저장은 saveBudget)
  };

  const saveBudget = () => {
    const val = Math.max(0, parseInt(tempBudget) || 0);
    setWeeklyBudget(val);
    writeStorageItem('weekly_budget', String(val));
    setShowBudgetCalcModal(false);
  };

  const startNewWeek = async ({ newDate, newBudget }) => {
    try {
      await resetDeviceData();
      if (newDate) {
        setReportDate(newDate);
        writeStorageItem('receipt_date', newDate);
      }
      const budgetVal = Math.max(0, parseInt(newBudget) || 0);
      setWeeklyBudget(budgetVal);
      writeStorageItem('weekly_budget', String(budgetVal));
      showToast('🔄 새 주 시작 완료');
    } catch (e) {
      if (import.meta.env.DEV) console.error('startNewWeek failed:', e);
      showToast('새 주 시작 실패 — 다시 시도해 주세요');
    }
  };

  // ── Drive 업로드
  const uploadToDrive = async () => {
    setDriveUploading(true); setUploadProgress(0);
    try {
      const XLSX = await import('xlsx');
      const surveyorName = names || '미설정';
      const ws = XLSX.utils.json_to_sheet(receipts.map(r => ({ 날짜: r.date, 사용처: decodeHtmlEntities(r.storeName), 금액: r.totalAmount, 용도: r.category, 비고: decodeHtmlEntities(r.note) })));
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:E1');
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        const cell = ws[XLSX.utils.encode_cell({ r: row, c: 2 })];
        if (cell) {
          cell.t = 'n';
          cell.z = '#,##0';
        }
      }
      ws['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 12 }, { wch: 10 }, { wch: 24 }];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '영수증내역');
      const xlsxBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      const seenImageIds = new Set();
      const imgs = [];
      for (const r of receipts.filter(r => r.imageId)) {
        if (seenImageIds.has(r.imageId)) continue;
        seenImageIds.add(r.imageId);
        const objUrl = await getImageUrl(r.imageId); if (!objUrl) continue;
        const imgBlob = await fetch(objUrl).then(res => res.blob());
        const dataUrl = await new Promise(resolve => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(imgBlob); });
        const datePart = safeText(r.date, '날짜없음').replace(/[/\\:*?"<>|]/g, '_');
        const storePart = safeText(decodeHtmlEntities(r.storeName), '미상').replace(/[/\\:*?"<>|]/g, '_').slice(0, 15);
        const imagePart = safeText(r.imageId, 'image').slice(0, 5);
        imgs.push({ id: r.id, filename: `${datePart}_${storePart}_${imagePart}.jpg`, dataUrl });
      }
      const totalSteps = imgs.length + 1; let cur = 0;

      const receiptSummary = {
        totalCount:  receipts.length,
        totalAmount: receipts.reduce((s, r) => s + (r.totalAmount || 0), 0),
        imageCount:  imgs.length,
        categories:  receipts.reduce((acc, r) => { acc[r.category] = (acc[r.category] || 0) + (r.totalAmount || 0); return acc; }, {}),
      };

      const _uploadToken = import.meta.env.VITE_UPLOAD_TOKEN || '';
      const _authHeaders = { 'Content-Type': 'application/json', ...(_uploadToken ? { 'Authorization': `Bearer ${_uploadToken}` } : {}) };

      const xlsxRes = await fetch('/api/upload', { method: 'POST', headers: _authHeaders, body: JSON.stringify({ surveyorName, reportDate: reportDate || TODAY, xlsxBase64, isImageOnly: false, receiptSummary }) });
      if (!xlsxRes.ok) { const e = await xlsxRes.json().catch(() => ({})); throw new Error(formatFailureMessage('명세 업로드 실패', e.error || `상태 ${xlsxRes.status}`)); }
      const xlsxData = await xlsxRes.json().catch(() => ({}));
      cur++; setUploadProgress(Math.floor((cur / totalSteps) * 100));

      const imageResult = { uploaded: 0, skipped: 0, failed: [] };
      for (const img of imgs) {
        const imgRes = await fetch('/api/upload', { method: 'POST', headers: _authHeaders, body: JSON.stringify({ surveyorName, reportDate: reportDate || TODAY, images: [img], isImageOnly: true }) });
        const imgData = await imgRes.json().catch(() => ({}));
        if (!imgRes.ok) {
          imageResult.failed.push(`${img.filename}: ${formatFailureDetail(imgData.error || `상태 ${imgRes.status}`)}`);
        } else {
          imageResult.uploaded += imgData.files?.length || 0;
          imageResult.skipped += imgData.skipped?.length || 0;
        }
        cur++; setUploadProgress(Math.floor((cur / totalSteps) * 100));
      }

      const parts = [];
      const xlsxStatusLabel = xlsxData?.uploadStatus === 'updated'
        ? '갱신'
        : xlsxData?.skipped
          ? '중복'
          : '완료';
      parts.push(`명세 ${xlsxStatusLabel}`);
      parts.push(`이미지 ${imageResult.uploaded}장${imageResult.skipped ? `, 중복 ${imageResult.skipped}장` : ''}`);
      parts.push(xlsxData?.aggregate?.success === false ? '집계 실패' : '집계 완료');
      parts.push(xlsxData?.kakaoSent ? '카카오 알림 완료' : `카카오 알림 미발송${xlsxData?.kakaoError ? `(${xlsxData.kakaoError.slice(0, 34)})` : ''}`);
      if (xlsxData?.targetPath) parts.push(`대상 ${xlsxData.targetPath}`);
      if (imageResult.failed.length > 0) parts.push(`이미지 실패 ${imageResult.failed.length}장`);
      showToast(`${imageResult.failed.length ? '⚠️' : '✅'} ${parts.join(' · ')}`);
    } catch (e) { showToast(`❌ ${e.message}`); }
    setDriveUploading(false);
  };

  // ── 내보내기
  const shareFile = async (blob, fileName, mimeType) => {
    try {
      const file = new File([blob], fileName, { type: mimeType });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return true; }
    } catch (e) { if (e.name !== 'AbortError') console.error(e); }
    return false;
  };

  const saveToJSON = async () => {
    const exportData = await Promise.all(receipts.map(async r => {
      const item = { ...r };
      if (r.imageId) {
        const objUrl = await getImageUrl(r.imageId);
        if (objUrl) { const imgBlob = await fetch(objUrl).then(res => res.blob()); item.imageUrl = await new Promise(resolve => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsDataURL(imgBlob); }); }
      }
      return item;
    }));
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const fn = `출장비_${TODAY.replace(/-/g, '')}.json`;
    if (await shareFile(blob, fn, 'application/json')) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click();
  };

  const loadFromFile = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try { const loaded = JSON.parse(ev.target.result); if (Array.isArray(loaded)) { await saveReceipts(loaded); showToast('📂 성공'); } } catch { alert('오류'); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  // ── 집계
  const grandTotal = useMemo(() => (receipts || []).reduce((s, r) => s + (r.totalAmount || 0), 0), [receipts]);
  const budgetTotal = useMemo(() => (receipts || []).filter(r => r.category !== '유류비').reduce((s, r) => s + (r.totalAmount || 0), 0), [receipts]);
  const fuelTotal = useMemo(() => (receipts || []).filter(r => r.category === '유류비').reduce((s, r) => s + (r.totalAmount || 0), 0), [receipts]);
  const budgetRatio = useMemo(() => (budgetTotal / weeklyBudget) * 100, [budgetTotal, weeklyBudget]);
  const remainingBudget = Math.max(0, weeklyBudget - budgetTotal);
  const [showBudgetDetails, setShowBudgetDetails] = useState(false);

  const sortedReceipts = useMemo(() => {
    const base = [...(receipts || [])].sort((a, b) => {
      const av = a[sortField] ?? '', bv = b[sortField] ?? '';
      let res = typeof av === 'string' || typeof bv === 'string' ? String(av).localeCompare(String(bv), 'ko') : av > bv ? 1 : av < bv ? -1 : 0;
      if (sortDir === 'desc') res = -res;
      return res || (b.createdAt - a.createdAt);
    });
    if (pinnedNewIds.length === 0) return base;
    // 방금 추가된 항목을 추가 순서 역순(최신 먼저)으로 맨 위에 고정
    const pinnedSet = new Set(pinnedNewIds);
    const pinned = pinnedNewIds
      .slice()
      .reverse()
      .map(id => base.find(r => r.id === id))
      .filter(Boolean);
    const rest = base.filter(r => !pinnedSet.has(r.id));
    return [...pinned, ...rest];
  }, [receipts, sortField, sortDir, pinnedNewIds]);

  if (loading) return <div className="h-screen bg-slate-900 flex items-center justify-center text-slate-400">로드 중...</div>;

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100 overflow-hidden" style={{ lineHeight: 1.5 }}>
      {toastMsg && <div className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4"><div className="bg-slate-800 border border-slate-700 rounded-2xl px-6 py-3 shadow-2xl font-bold">{toastMsg}</div></div>}

      {/* ── 헤더 */}
      <div className="shrink-0 shadow-lg">
        <header className="bg-slate-800 border-b border-slate-700 px-3 py-3 flex items-center justify-between" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h1 className="text-xl font-black truncate">{`${names} - ${formatDateKorean(reportDate || TODAY)}`}</h1>
            <div className="flex items-center gap-1">
              {saveStatus === 'saving' && <Loader2 size={18} className="text-blue-300 animate-spin shrink-0" title="로컬 저장 중" />}
              {saveStatus === 'success' && <HardDrive size={18} className="text-emerald-300 shrink-0" title="로컬 저장 완료" />}
              {saveStatus === 'error' && <HardDrive size={18} className="text-red-300 shrink-0" title="로컬 저장 실패" />}
              {syncStatus === 'syncing' && <Loader2 size={18} className="text-cyan-300 animate-spin shrink-0" title="클라우드 동기화 중" />}
              {syncStatus === 'success' && <Cloud size={18} className="text-emerald-300 shrink-0" title="클라우드 동기화 완료" />}
              {syncStatus === 'error' && <Cloud size={18} className="text-red-300 shrink-0" title="클라우드 동기화 실패" />}
              {pendingSyncCount > 0 && (
                <span className="ml-1 px-2 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-[11px] font-black text-amber-200 whitespace-nowrap">
                  보류 {pendingSyncCount}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => setShowSettings(true)} className="w-11 h-11 flex items-center justify-center rounded-xl border bg-slate-900/70 border-slate-700 text-slate-300" aria-label="설정">
              <Settings size={18}/>
            </button>
          </div>
        </header>
        {/* 탭 바 */}
        <div className="bg-slate-800 border-b border-slate-700 px-3 py-3">
          <div className="flex bg-slate-200 p-1 rounded-2xl gap-1 shadow-inner">
            {[['list', '📋 목록'], ['images', '🖼️ 영수증'], ['summary', '📊 집계']].map(([id, l]) => {
              const isActive = tab === id;
              const tabClass = isActive
                ? 'bg-blue-600 text-white shadow-md transform scale-[1.01]'
                : 'text-slate-800 hover:text-slate-950';
              return (
                <button key={id} onClick={() => setTab(id)} className={`flex-1 py-3 text-sm font-black transition-all rounded-xl ${tabClass}`}>{l}</button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── 본문 */}
      <main className="flex-1 overflow-y-auto pb-8">
        <div className="max-w-2xl mx-auto px-4 py-1.5 space-y-1.5">

          {/* 예산 패널 (이미지 탭 제외) */}
          {tab !== 'images' && (
            <div className="bg-slate-800 border border-slate-700 rounded-2xl p-3.5 shadow-md">
              <div className="flex justify-between items-end mb-1.5">
                <div className="flex flex-col">
                  <span className="text-base text-slate-200 font-black">남은 예산</span>
                  <span className="text-sm text-blue-300 font-bold">유류비 제외</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xl font-black">{formatCurrency(remainingBudget)}</span>
                  <span className="text-sm text-slate-400">/ {formatCurrency(weeklyBudget)}</span>
                  <button onClick={() => { setTempBudget(weeklyBudget); setShowBudgetCalcModal(true); }} className="ml-1 w-11 h-11 rounded-xl border border-slate-700 bg-slate-900/70 text-slate-300" aria-label="예산 설정">⚙️</button>
                </div>
              </div>
              <div className="flex items-start justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900/50 px-3 py-2.5">
                <div className="flex flex-col">
                  <span className="text-sm font-black text-slate-300">총예산</span>
                  <span className="text-base font-black text-slate-100">{formatCurrency(weeklyBudget)}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-sm font-black text-slate-300">사용액</span>
                  <span className="text-base font-black text-blue-300">{formatCurrency(budgetTotal)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowBudgetDetails(v => !v)}
                  className="ml-1 mt-0.5 rounded-full bg-slate-950/80 border border-slate-600 px-2 py-1 shadow-lg"
                  aria-label={showBudgetDetails ? '상세 예산 접기' : '상세 예산 펼치기'}
                >
                  <span className="sr-only">{showBudgetDetails ? '접기' : '펼치기'}</span>
                  <span
                    className={`block h-0 w-0 border-y-[6px] border-y-transparent border-l-[9px] border-l-slate-100 transition-transform ${
                      showBudgetDetails ? 'rotate-90' : 'rotate-0'
                    }`}
                  />
                </button>
              </div>
              {showBudgetDetails && (
                <BudgetStats
                  weeklyBudget={weeklyBudget}
                  budgetTotal={budgetTotal}
                  budgetRatio={budgetRatio}
                  fuelTotal={fuelTotal}
                />
              )}
            </div>
          )}

          {/* ── 목록 탭 */}
          {tab === 'list' && (
            <div className="space-y-3">
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-2xl p-4 space-y-3 shadow-lg">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setListPanel('input')}
                    className={`rounded-2xl px-3 py-2.5 text-sm font-black transition-all active:scale-95 min-h-[44px] ${
                      listPanel === 'input'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    영수증 입력
                  </button>
                  <button
                    onClick={() => setListPanel('management')}
                    className={`rounded-2xl px-3 py-2.5 text-sm font-black transition-all active:scale-95 min-h-[44px] ${
                      listPanel === 'management'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    자료관리
                  </button>
                </div>
                {listPanel === 'input' ? (
                  <div className="pt-1">
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={() => document.getElementById('cam-i').click()} className="bg-slate-700 hover:bg-slate-600 py-2.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-1.5 active:scale-95 min-h-0">📸 촬영</button>
                      <button onClick={() => document.getElementById('file-i').click()} className="bg-slate-700 hover:bg-slate-600 py-2.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-1.5 active:scale-95 min-h-0">🖼️ 업로드</button>
                      <button onClick={() => setShowManualModal(true)} className="bg-slate-700 hover:bg-slate-600 py-2.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-1.5 active:scale-95 min-h-0">⌨️ 직접입력</button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-1">
                    <div className="grid grid-cols-3 gap-2">
                      <button onClick={saveToJSON} className="bg-slate-800 border border-slate-700 hover:bg-slate-700 py-2.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer text-white min-h-0">💾 백업</button>
                      <label className="bg-slate-800 border border-slate-700 hover:bg-slate-700 py-2.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer text-white min-h-0">
                        📂 불러오기
                        <input type="file" accept=".json" className="hidden" onChange={loadFromFile} />
                      </label>
                      <button onClick={uploadToDrive} disabled={driveUploading} className={`py-2.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-1.5 active:scale-95 border min-h-0 ${driveUploading ? 'bg-emerald-900/50 border-emerald-700 text-emerald-50' : 'bg-slate-800 border-slate-700 hover:bg-slate-700 text-white'}`}>
                        {driveUploading ? <><Loader2 size={16} className="animate-spin shrink-0" />{uploadProgress}%</> : '📤 전송하기'}
                      </button>
                    </div>
                  </div>
                )}
                <input id="file-i" type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files), receipts)} />
                <input id="cam-i" type="file" capture="environment" className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files), receipts)} />
              </div>

              {processing && <div className="bg-blue-900/40 p-4 rounded-2xl flex gap-4 items-center border border-blue-700 min-w-0"><RefreshCw size={26} className="animate-spin text-blue-300 shrink-0" /><span className="text-lg font-black min-w-0 break-words">{procMsg}</span></div>}

              {receipts.length > 0 && (
                <div className="text-center text-sm text-slate-400 px-1 font-bold">
                  {receipts.length}건 • {formatCurrency(grandTotal)}
                </div>
              )}

              <div className="bg-slate-800 rounded-3xl border-2 border-slate-700 overflow-hidden">
                <div className="bg-slate-900/50 px-4 flex text-sm font-black text-slate-300 gap-1.5 items-stretch">
                  {[['date', '날짜', 'w-12 text-center'], ['storeName', '사용처', 'flex-1 ml-1'], ['category', '용도', 'w-12 text-center'], ['totalAmount', '금액', 'w-16 text-right']].map(([f, l, cls]) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setPinnedNewIds([]);  // 정렬 토글 시 '맨 위 고정' 해제
                        if (sortField === f) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                        else { setSortField(f); setSortDir('desc'); }
                      }}
                      className={`${cls} flex items-center justify-center gap-0.5 py-3 min-h-[44px] active:bg-slate-800 transition-colors ${sortField === f ? 'text-blue-400' : ''}`}
                    >
                      {l} {sortField === f && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  ))}
                  <div className="w-16 shrink-0 ml-1"></div>
                </div>
                {sortedReceipts.map((r, index) => <ReceiptRow key={r.id} receipt={r} rowIndex={index} isSelected={detailId === r.id} onEdit={handleEdit} onViewImage={handleViewImage} onDelete={setDeleteConfirmId} />)}
              </div>
            </div>
          )}

          {/* ── 이미지 탭 */}
          {tab === 'images' && (
            <ImagesTab
              receipts={receipts}
              getImageUrl={getImageUrl}
              onUpdateRotation={handleUpdateRotation}
              selectedId={detailId}
              onSelectChange={setDetailId}
            />
          )}

          {/* ── 집계 탭 */}
          {tab === 'summary' && (
            <SummaryTab receipts={receipts} names={names} reportDate={reportDate} />
          )}
        </div>
      </main>

      {/* ── 설정 모달 */}
        <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        showToast={showToast}
        names={names}
        onNamesChange={(v) => { setNames(v); writeStorageItem('receipt_names', v); }}
        reportDate={reportDate}
        onDateChange={(v) => { setReportDate(v); writeStorageItem('receipt_date', v); }}
        onReset={() => { resetAll(); }}
        onResetDeviceData={resetDeviceData}
        onResetActivityLogs={resetActivityLogs}
        saveStatus={saveStatus}
        syncStatus={syncStatus}
        pendingSyncCount={pendingSyncCount}
        syncEvents={syncEvents}
        syncDaily={syncDaily}
        onRetrySync={retryPendingSync}
      />

      {/* ── 인라인 수정 모달 */}
      {editState.id && (
        <Modal title="📝 수정" onClose={() => setEditState({ id: null, field: null, value: '' })}>
          <div className="p-1">
            {editState.field === 'detail' ? (
              <div className="space-y-4">
                <input type="date" value={editState.value.date} onChange={e => setEditState(prev => ({ ...prev, value: { ...prev.value, date: e.target.value } }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" />
                <input value={editState.value.storeName} onChange={e => setEditState(prev => ({ ...prev, value: { ...prev.value, storeName: e.target.value } }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" />
                <input type="number" value={editState.value.totalAmount} onChange={e => setEditState(prev => ({ ...prev, value: { ...prev.value, totalAmount: e.target.value } }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" />
                <div className="grid grid-cols-2 gap-2">{ALL_CATS.map(c => {
                  const active = editState.value.category === c;
                  const catClass = active
                    ? 'bg-blue-600 border-blue-400 text-white'
                    : 'bg-slate-900 border-slate-700 text-slate-100';
                  return (
                    <button
                      key={c}
                      onClick={() => setEditState(prev => ({ ...prev, value: { ...prev.value, category: c } }))}
                      className={`py-3 rounded-xl font-black text-sm border-2 ${catClass}`}
                    >
                      {c}
                    </button>
                  );
                })}</div>
                <input value={editState.value.note} onChange={e => setEditState(prev => ({ ...prev, value: { ...prev.value, note: e.target.value } }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-black text-base" placeholder="비고" />
              </div>
            ) : editState.field === 'category' ? (
              <div className="grid grid-cols-2 gap-3 mb-8">{ALL_CATS.map(c => {
                const active = editState.value === c;
                const catClass = active
                  ? 'bg-blue-600 border-blue-400 text-white shadow-lg scale-105'
                  : 'bg-slate-900 border-slate-700 text-slate-100';
                return (
                  <button
                    key={c}
                    onClick={() => setEditState(prev => ({ ...prev, value: c }))}
                    className={`py-5 rounded-2xl font-black text-lg border-2 transition-all ${catClass}`}
                  >
                    {c}
                  </button>
                );
              })}</div>
            ) : (
              <input autoFocus value={editState.value} onChange={e => setEditState(prev => ({ ...prev, value: e.target.value }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-5 mb-8 text-2xl text-white font-black" />
            )}
            <button onClick={handleInlineEdit} className="w-full bg-blue-600 py-5 rounded-2xl text-xl font-black mt-6">저장</button>
          </div>
        </Modal>
      )}

      {/* ── 삭제 확인 모달 */}
      {deleteConfirmId && (
        <Modal title="삭제?" onClose={() => setDeleteConfirmId(null)}>
          <div className="p-2 flex gap-4">
            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 bg-slate-700 py-5 rounded-2xl font-black text-lg">취소</button>
            <button onClick={() => { deleteReceipt(deleteConfirmId); setDeleteConfirmId(null); }} className="flex-1 bg-red-600 py-5 rounded-2xl font-black text-lg">삭제</button>
          </div>
        </Modal>
      )}

      {/* ── 직접 입력 모달 */}
      {showManualModal && (
        <Modal title="➕ 직접 입력" onClose={() => setShowManualModal(false)} initialFocusRef={manualStoreRef}>
          <div className="space-y-5 p-2">
            <input ref={manualStoreRef} placeholder="🏢 사용처" value={mf.storeName} onChange={e => setMf({ ...mf, storeName: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
            <input type="number" placeholder="💰 금액" value={mf.totalAmount} onChange={e => setMf({ ...mf, totalAmount: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
            <div className="grid grid-cols-2 gap-2">{ALL_CATS.map(c => {
              const active = mf.category === c;
              const catClass = active
                ? 'bg-blue-600 border-blue-400 text-white'
                : 'bg-slate-900 border-slate-700 text-slate-100';
              return (
                <button
                  key={c}
                  onClick={() => setMf({ ...mf, category: c })}
                  className={`py-4 rounded-xl font-black text-sm border-2 ${catClass}`}
                >
                  {c}
                </button>
              );
            })}</div>
            <input placeholder="📝 비고" value={mf.note} onChange={e => setMf({ ...mf, note: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black text-base" />
            <button onClick={handleManualAdd} className="w-full bg-blue-600 py-5 rounded-2xl text-xl font-black">추가</button>
          </div>
        </Modal>
      )}

      {/* ── 예산 설정 모달 */}
      {showBudgetCalcModal && (
        <Modal title="📅 예산 설정" onClose={() => setShowBudgetCalcModal(false)} initialFocusRef={budgetAmountRef}>
          <div className="space-y-5 p-4">
            {/* 새 출장 시작 (맨 위 — 정산 직후 진입 시 가장 먼저 보이는 액션) */}
            <div className="border border-red-900/50 rounded-2xl bg-red-900/10 p-4 space-y-3">
              <div>
                <p className="text-sm text-red-300 font-black">🔄 새 출장 시작</p>
                <p className="text-xs text-red-200/80 font-bold mt-1 leading-5">
                  아래에서 기간과 예산을 확인·수정한 뒤 시작하세요.
                  현재 시작일 <span className="text-red-100">{tripStartDate}</span>,
                  예산 <span className="text-red-100">{(parseInt(tempBudget) || 0).toLocaleString()}원</span>으로 새로 시작합니다.
                  현재 기기의 영수증·이미지·이력·보류 전송이 모두 삭제됩니다.
                </p>
              </div>
              <button
                onClick={async () => {
                  const budgetVal = Math.max(0, parseInt(tempBudget) || 0);
                  if (budgetVal <= 0) { alert('예산을 먼저 입력하거나 "이 값 적용"을 눌러 주세요.'); return; }
                  if (!window.confirm(`새 출장을 시작합니다.\n시작일: ${tripStartDate}\n예산: ${budgetVal.toLocaleString()}원\n\n현재 영수증을 모두 삭제하고 진행할까요?`)) return;
                  await startNewWeek({ newDate: tripStartDate, newBudget: budgetVal });
                  setShowBudgetCalcModal(false);
                }}
                className="w-full bg-red-900/40 border border-red-700 text-red-100 py-4 rounded-2xl text-base font-black active:scale-95 transition-transform"
              >
                🔄 새로 시작 (영수증 모두 삭제)
              </button>
            </div>

            {/* 날짜 범위 캘린더 */}
            <DateRangePicker
              startDate={tripStartDate}
              endDate={tripEndDate}
              onChange={(s, e) => { setTripStartDate(s); setTripEndDate(e); }}
            />
            {/* 자동계산 미리보기 */}
            {(() => {
              const s = new Date(tripStartDate), e = new Date(tripEndDate);
              const n = Math.ceil((e - s) / 86400000) + 1;
              if (n <= 0) return null;
              const auto = n <= 1 ? 80000 : (n - 1) * 130000 + 80000;
              const desc = n === 1
                ? '1일 출장 (마지막날만 적용)'
                : `${n}일 출장: ${n - 1}일 × 13만 + 마지막날 8만`;
              return (
                <div className="bg-slate-900/80 rounded-2xl p-4 border border-slate-700">
                  <p className="text-sm text-slate-400 font-bold mb-2">{desc}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl font-black text-blue-300">{auto.toLocaleString('ko-KR')}원</span>
                    <button onClick={handleBudgetCalc} className="bg-blue-700 hover:bg-blue-600 px-4 py-3 rounded-xl text-sm font-black">이 값 적용</button>
                  </div>
                </div>
              );
            })()}
            {/* 직접 입력 */}
            <div>
              <label className="text-sm text-slate-400 font-black mb-2 block">예산 직접 입력 (원)</label>
              <input
                ref={budgetAmountRef}
                type="number"
                value={tempBudget}
                onChange={e => setTempBudget(e.target.value)}
                className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-2xl text-white font-black text-right"
              />
            </div>
            <button onClick={saveBudget} className="w-full bg-blue-600 py-4 rounded-2xl text-xl font-black">설정 저장</button>

            {/* 새 출장 시작 */}
            <div className="border border-red-900/50 rounded-2xl bg-red-900/10 p-4 space-y-3">
              <div>
                <p className="text-sm text-red-300 font-black">🔄 새 출장 시작</p>
                <p className="text-xs text-red-200/80 font-bold mt-1 leading-5">
                  위 기간({tripStartDate})과 예산으로 새로 시작합니다.
                  현재 기기의 영수증·이미지·이력·보류 전송이 모두 삭제됩니다.
                </p>
              </div>
              <button
                onClick={async () => {
                  const budgetVal = Math.max(0, parseInt(tempBudget) || 0);
                  if (budgetVal <= 0) { alert('예산을 먼저 입력하거나 "이 값 적용"을 눌러 주세요.'); return; }
                  if (!window.confirm(`새 출장을 시작합니다.\n시작일: ${tripStartDate}\n예산: ${budgetVal.toLocaleString()}원\n\n현재 영수증을 모두 삭제하고 진행할까요?`)) return;
                  await startNewWeek({ newDate: tripStartDate, newBudget: budgetVal });
                  setShowBudgetCalcModal(false);
                }}
                className="w-full bg-red-900/40 border border-red-700 text-red-100 py-4 rounded-2xl text-base font-black active:scale-95 transition-transform"
              >
                🔄 새로 시작 (영수증 모두 삭제)
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
