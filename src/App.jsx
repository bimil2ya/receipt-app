import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Settings, Download,
  FolderOpen, RefreshCw, User, Calendar, RotateCcw, ChevronRight, Cloud, Loader2
} from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';

// Utils & Hooks
import { TODAY, formatDateKorean, formatCurrency, parseDate } from './utils/formatter';
import useReceipts from './hooks/useReceipts';
import useUploader from './hooks/useUploader';

// Components
import Modal from './components/layout/Modal';
import ReceiptRow from './components/receipts/ReceiptRow';
import SettingsModal from './components/settings/SettingsModal';
import SummaryTab from './components/summary/SummaryTab';
import ImagesTab from './components/images/ImagesTab';

// Constants
const ALL_CATS = ['숙박비', '식비', '기타', '유류비'];

export default function App() {
  const { receipts, loading, saveReceipts, deleteReceipt, resetAll, fetchAllReceipts, syncStatus, getImageUrl } = useReceipts();
  useRegisterSW();

  // ── 탭 & 네비게이션
  const [tab, setTab] = useState('list');
  const [detailId, setDetailId] = useState(null);   // images 탭 선택 ID

  // ── 공지·알림
  const [toastMsg, setToastMsg] = useState('');
  const showToast = useCallback((msg) => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 4000); }, []);

  // ── 앱 설정 (localStorage 동기화)
  const [names, setNames] = useState(() => localStorage.getItem('receipt_names') || '노경호, 김영일');
  const [reportDate, setReportDate] = useState(() => localStorage.getItem('receipt_date') || '');
  const [weeklyBudget, setWeeklyBudget] = useState(() => parseInt(localStorage.getItem('weekly_budget') || '1000000'));
  const [userRole, setUserRole] = useState(() => localStorage.getItem('user_role') || 'worker');

  // ── 관리자 뷰
  const [isAdminView, setIsAdminView] = useState(false);
  const [allTeamReceipts, setAllTeamReceipts] = useState([]);

  // ── 모달 토글
  const [showSettings, setShowSettings] = useState(false);
  const [showNamesModal, setShowNamesModal] = useState(false);
  const [showDateModal, setShowDateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showBudgetCalcModal, setShowBudgetCalcModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // ── 수정 상태
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState('desc');
  const [tempNames, setTempNames] = useState('');
  const [tempDate, setTempDate] = useState('');
  const [tripStartDate, setTripStartDate] = useState(TODAY);
  const [tripEndDate, setTripEndDate] = useState(TODAY);
  const [mf, setMf] = useState({ date: TODAY, storeName: '', totalAmount: '', category: '식비', note: '' });
  const [editState, setEditState] = useState({ id: null, field: null, value: '' });

  // ── 최근 추가 ID (세션 단위)
  const [recentlyAddedIds, setRecentlyAddedIds] = useState(() => {
    try { const saved = sessionStorage.getItem('recently_added_ids'); return saved ? JSON.parse(saved) : []; } catch { return []; }
  });
  useEffect(() => { sessionStorage.setItem('recently_added_ids', JSON.stringify(recentlyAddedIds)); }, [recentlyAddedIds]);

  // ── Drive 업로드 진행
  const [driveUploading, setDriveUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // ── 파일 OCR 업로드 훅
  const { handleFiles, processing, procMsg } = useUploader({
    onUploadSuccess: async (added) => {
      await saveReceipts(added);
      setRecentlyAddedIds(prev => [...prev, ...added.map(r => r.id)]);
      showToast(`${added.length}건 추가 완료`);
    },
    onUploadError: ({ failedFiles, duplicateCount }) => {
      const parts = [];
      if (failedFiles.length > 0) parts.push(`❌ 실패 ${failedFiles.length}건: ${failedFiles.map(f => f.name).join(', ')}`);
      if (duplicateCount > 0) parts.push(`⚠️ 중복 제외 ${duplicateCount}건`);
      showToast(parts.join(' / '));
    },
  });

  // ── 관리자 전체 데이터 로드
  const loadAdminData = useCallback(async () => {
    const data = await fetchAllReceipts(); setAllTeamReceipts(data);
  }, [fetchAllReceipts]);

  useEffect(() => {
    if (isAdminView) { const t = setTimeout(loadAdminData, 0); return () => clearTimeout(t); }
  }, [isAdminView, loadAdminData]);

  // ── 영수증 조작
  const handleEdit = useCallback((id, f, v) => {
    if (f === 'detail') {
      const r = receipts.find(item => item.id === id); if (!r) return;
      setEditState({ id, field: f, value: { date: r.date, storeName: r.storeName, totalAmount: r.totalAmount, category: r.category, note: r.note || '' } });
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
    setRecentlyAddedIds(prev => [...prev, newId]);
    setShowManualModal(false); setMf({ date: TODAY, storeName: '', totalAmount: '', category: '식비', note: '' });
  };

  const handleBudgetCalc = () => {
    const start = new Date(tripStartDate); const end = new Date(tripEndDate);
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    if (diffDays <= 0) { alert('날짜 오류'); return; }
    const calc = diffDays * 130000;
    setWeeklyBudget(calc); localStorage.setItem('weekly_budget', String(calc)); setShowBudgetCalcModal(false);
  };

  // ── Drive 업로드
  const uploadToDrive = async () => {
    setDriveUploading(true); setUploadProgress(0);
    try {
      const XLSX = await import('xlsx');
      const surveyorName = names || '미설정';
      const ws = XLSX.utils.json_to_sheet(receipts.map(r => ({ 날짜: r.date, 사용처: r.storeName, 금액: r.totalAmount, 용도: r.category, 비고: r.note })));
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
        imgs.push({ id: r.id, filename: `${r.date}_${r.storeName.replace(/[/\\:*?"<>|]/g, '_').slice(0, 15)}_${r.imageId.slice(0, 5)}.jpg`, dataUrl });
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
      if (!xlsxRes.ok) { const e = await xlsxRes.json().catch(() => ({})); throw new Error(e.error || `XLSX 업로드 실패 (${xlsxRes.status})`); }
      const xlsxData = await xlsxRes.json().catch(() => ({}));
      cur++; setUploadProgress(Math.floor((cur / totalSteps) * 100));

      for (const img of imgs) {
        const imgRes = await fetch('/api/upload', { method: 'POST', headers: _authHeaders, body: JSON.stringify({ surveyorName, reportDate: reportDate || TODAY, images: [img], isImageOnly: true }) });
        if (!imgRes.ok) { const e = await imgRes.json().catch(() => ({})); throw new Error(e.error || `이미지 업로드 실패: ${img.filename}`); }
        cur++; setUploadProgress(Math.floor((cur / totalSteps) * 100));
      }
      showToast(xlsxData?.kakaoSent ? '✅ 전송 완료 · 카카오 알림 발송됨' : '✅ 전송 완료');
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
    if (await shareFile(blob, fn, 'application/json')) { setShowSaveModal(false); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fn; a.click(); setShowSaveModal(false);
  };

  const downloadXLSX = async () => {
    const XLSX = await import('xlsx');
    const ws = XLSX.utils.json_to_sheet(receipts.map(r => ({ 날짜: r.date, 사용처: r.storeName, 금액: r.totalAmount, 용도: r.category, 비고: r.note })));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '영수증');
    XLSX.writeFile(wb, `영수증_${TODAY}.xlsx`); setShowSaveModal(false);
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

  const displayReceipts = isAdminView ? allTeamReceipts : receipts;
  const { newItems, oldItems } = useMemo(() => {
    const list = [...(displayReceipts || [])].sort((a, b) => {
      const av = a[sortField] ?? '', bv = b[sortField] ?? '';
      let res = typeof av === 'string' || typeof bv === 'string' ? String(av).localeCompare(String(bv), 'ko') : av > bv ? 1 : av < bv ? -1 : 0;
      if (sortDir === 'desc') res = -res;
      return res || (b.createdAt - a.createdAt);
    });
    return { newItems: list.filter(r => recentlyAddedIds.includes(r.id)), oldItems: list.filter(r => !recentlyAddedIds.includes(r.id)) };
  }, [displayReceipts, sortField, sortDir, recentlyAddedIds]);

  if (loading) return <div className="h-screen bg-slate-900 flex items-center justify-center text-slate-400">로드 중...</div>;

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100 overflow-hidden" style={{ fontSize: '1.1rem' }}>
      {toastMsg && <div className="fixed bottom-24 left-0 right-0 z-50 flex justify-center px-4"><div className="bg-slate-800 border border-slate-700 rounded-2xl px-6 py-3 shadow-2xl font-bold">{toastMsg}</div></div>}

      {/* ── 헤더 */}
      <div className="shrink-0 shadow-lg">
        <header className="bg-slate-800 border-b border-slate-700 px-3 py-2 flex items-center justify-between" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h1 className="text-lg font-bold truncate">{isAdminView ? '🏢 전체 관리' : `${names} - ${formatDateKorean(reportDate || TODAY)}`}</h1>
            {syncStatus === 'syncing' && <Loader2 size={14} className="text-blue-400 animate-spin shrink-0" />}
            {syncStatus === 'success' && <Cloud size={14} className="text-emerald-400 shrink-0" />}
          </div>
          <div className="flex items-center shrink-0">
            {userRole === 'admin' && <button onClick={() => setIsAdminView(!isAdminView)} className={`p-1.5 ${isAdminView ? 'text-blue-400' : 'text-slate-500'}`}><FolderOpen size={16}/></button>}
            <button onClick={() => { setTempNames(names); setShowNamesModal(true); }} className="p-1.5 text-slate-400"><User size={16}/></button>
            <button onClick={() => { setTempDate(reportDate); setShowDateModal(true); }} className="p-1.5 text-slate-400"><Calendar size={16}/></button>
            <button onClick={() => setShowResetModal(true)} className="p-1.5 text-red-400"><RotateCcw size={16}/></button>
            <button onClick={() => setShowSettings(true)} className="p-1.5 text-slate-400"><Settings size={16}/></button>
          </div>
        </header>
        {/* 탭 바 */}
        <div className="bg-slate-800 border-b border-slate-700 px-3 py-2">
          <div className="flex bg-slate-200 p-1 rounded-2xl gap-1 shadow-inner">
            {[['list', '📋 목록'], ['images', '🖼️ 이미지'], ['summary', '📊 집계']].map(([id, l]) => (
              <button key={id} onClick={() => setTab(id)} className={`flex-1 py-2 text-[13px] font-black transition-all rounded-xl ${tab === id ? 'bg-blue-600 text-white shadow-md transform scale-[1.02]' : 'text-slate-600 hover:text-slate-900'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 본문 */}
      <main className="flex-1 overflow-y-auto pb-8">
        <div className="max-w-lg mx-auto px-4 py-2 space-y-2">

          {/* 예산 패널 (이미지 탭 제외) */}
          {tab !== 'images' && (
            <div className="bg-slate-800 border border-slate-700 rounded-3xl p-5 shadow-md">
              <div className="flex justify-between items-end mb-3">
                <div className="flex flex-col">
                  <span className="text-sm text-slate-400 font-bold">주간 예산</span>
                  <span className="text-[9px] text-blue-400 font-bold">유류비 제외</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-lg font-bold">{formatCurrency(budgetTotal)}</span>
                  <span className="text-xs text-slate-500">/ {formatCurrency(weeklyBudget)}</span>
                  <button onClick={() => setShowBudgetCalcModal(true)} className="ml-1 text-slate-500">⚙️</button>
                </div>
              </div>
              <div className="w-full h-8 bg-slate-900 rounded-xl overflow-hidden border border-slate-700 flex relative">
                <div className="h-full bg-blue-600 transition-all duration-500" style={{ width: `${Math.min(100, budgetRatio)}%` }} />
                <div className="absolute inset-0 flex items-center justify-end px-5 pointer-events-none">
                  <span className="text-[11px] font-black text-white drop-shadow-md">잔액 {formatCurrency(weeklyBudget - budgetTotal)}</span>
                </div>
              </div>
              <div className="flex justify-between mt-3 items-center gap-1 text-xs font-bold text-slate-400">
                <span>총예산 {Math.round(weeklyBudget / 10000)}만원 중 {(budgetTotal / 10000).toFixed(1)}만원 사용({Math.round(budgetRatio)}%)</span>
                <span className="text-emerald-400">유류비: {formatCurrency(fuelTotal)}</span>
              </div>
            </div>
          )}

          {/* ── 목록 탭 */}
          {tab === 'list' && (
            <div className="space-y-3">
              <div className="bg-slate-800/40 border border-slate-700/50 rounded-3xl p-2 grid grid-cols-2 gap-2 shadow-lg">
                <button onClick={() => document.getElementById('cam-i').click()} className="bg-blue-600 hover:bg-blue-500 py-3.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 active:scale-95 shadow-md">📸 촬영</button>
                <button onClick={() => document.getElementById('file-i').click()} className="bg-slate-700 hover:bg-slate-600 py-3.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 active:scale-95">🖼️ 업로드</button>
                <button onClick={() => setShowManualModal(true)} className="bg-slate-700 hover:bg-slate-600 py-3.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 active:scale-95">⌨️ 직접입력</button>
                <label className="bg-slate-700 hover:bg-slate-600 py-3.5 rounded-2xl text-sm font-black transition-all flex items-center justify-center gap-2 active:scale-95 cursor-pointer">
                  📂 불러오기
                  <input type="file" accept=".json" className="hidden" onChange={loadFromFile} />
                </label>
                <input id="file-i" type="file" multiple accept="image/*" className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files), receipts)} />
                <input id="cam-i" type="file" capture="environment" className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files), receipts)} />
              </div>

              {processing && <div className="bg-blue-900/40 p-4 rounded-2xl flex gap-4 items-center border border-blue-700"><RefreshCw size={24} className="animate-spin text-blue-400" /><span className="text-base font-bold">{procMsg}</span></div>}

              {receipts.length > 0 && (
                <div className="flex items-center gap-2 px-1">
                  <button onClick={() => setShowSaveModal(true)} className="bg-slate-800 px-4 py-2 rounded-xl text-sm font-bold border border-slate-600">내보내기</button>
                  <button onClick={uploadToDrive} disabled={driveUploading} className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 transition-all ${driveUploading ? 'bg-emerald-800 text-emerald-300' : 'bg-emerald-600 text-white'}`}>
                    {driveUploading ? <><Loader2 size={14} className="animate-spin" />{uploadProgress}% 전송 중...</> : '📤 전송하기'}
                  </button>
                  <span className="ml-auto text-xs text-slate-500">{receipts.length}건 • {formatCurrency(grandTotal)}</span>
                </div>
              )}

              <div className="bg-slate-800 rounded-3xl border-2 border-slate-700 overflow-hidden divide-y divide-slate-700/50">
                <div className="bg-slate-900/50 px-4 py-3 flex text-xs font-black text-slate-400 uppercase tracking-wider gap-1.5 items-center">
                  {[['date', '날짜', 'w-12 text-center'], ['storeName', '사용처', 'flex-1 ml-1'], ['category', '용도', 'w-12 text-center'], ['totalAmount', '금액', 'w-16 text-right']].map(([f, l, cls]) => (
                    <button key={f} onClick={() => { if (sortField === f) setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); else { setSortField(f); setSortDir('desc'); } }} className={`${cls} flex items-center justify-center gap-0.5 ${sortField === f ? 'text-blue-400' : ''}`}>
                      {l} {sortField === f && (sortDir === 'asc' ? '↑' : '↓')}
                    </button>
                  ))}
                  <div className="w-16 shrink-0 ml-1"></div>
                </div>
                {newItems.map(r => <ReceiptRow key={r.id} receipt={r} isSelected={detailId === r.id} onEdit={handleEdit} onViewImage={handleViewImage} onDelete={setDeleteConfirmId} />)}
                {newItems.length > 0 && oldItems.length > 0 && (
                  <div className="bg-slate-900/60 px-4 py-3 flex items-center gap-4 border-y border-slate-700/30">
                    <div className="h-[1.5px] flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent"></div>
                    <span className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em] whitespace-nowrap shadow-sm">이전 내역</span>
                    <div className="h-[1.5px] flex-1 bg-gradient-to-r from-transparent via-slate-600 to-transparent"></div>
                  </div>
                )}
                {oldItems.map(r => <ReceiptRow key={r.id} receipt={r} isSelected={detailId === r.id} onEdit={handleEdit} onViewImage={handleViewImage} onDelete={setDeleteConfirmId} />)}
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
        weeklyBudget={weeklyBudget}
        setWeeklyBudget={setWeeklyBudget}
        userRole={userRole}
        setUserRole={setUserRole}
        setIsAdminView={setIsAdminView}
        showToast={showToast}
      />

      {/* ── 이름 모달 */}
      {showNamesModal && (
        <Modal title="👤 이름" onClose={() => setShowNamesModal(false)}>
          <div className="p-2">
            <input value={tempNames} onChange={e => setTempNames(e.target.value)} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 mb-6 text-xl text-white font-black" />
            <button onClick={() => { setNames(tempNames); localStorage.setItem('receipt_names', tempNames); setShowNamesModal(false); }} className="w-full bg-blue-600 py-5 rounded-2xl text-lg font-black">확인</button>
          </div>
        </Modal>
      )}

      {/* ── 날짜 모달 */}
      {showDateModal && (
        <Modal title="📅 날짜" onClose={() => setShowDateModal(false)}>
          <div className="p-2">
            <input type="date" value={tempDate} onChange={e => setTempDate(e.target.value)} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 mb-6 text-xl text-white font-black" />
            <button onClick={() => { setReportDate(tempDate); localStorage.setItem('receipt_date', tempDate); setShowDateModal(false); }} className="w-full bg-blue-600 py-5 rounded-2xl text-lg font-black">확인</button>
          </div>
        </Modal>
      )}

      {/* ── 초기화 모달 */}
      {showResetModal && (
        <Modal title="⚠️ 초기화" onClose={() => setShowResetModal(false)}>
          <div className="p-2 flex gap-4">
            <button onClick={() => setShowResetModal(false)} className="flex-1 bg-slate-700 py-5 rounded-2xl font-black">취소</button>
            <button onClick={() => { resetAll(); setShowResetModal(false); }} className="flex-1 bg-red-600 py-5 rounded-2xl font-black">삭제</button>
          </div>
        </Modal>
      )}

      {/* ── 인라인 수정 모달 */}
      {editState.id && (
        <Modal title="📝 수정" onClose={() => setEditState({ id: null, field: null, value: '' })}>
          <div className="p-2">
            {editState.field === 'detail' ? (
              <div className="space-y-4">
                <input type="date" value={editState.value.date} onChange={e => setEditState(prev => ({ ...prev, value: { ...prev.value, date: e.target.value } }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-3 text-white font-black" />
                <input value={editState.value.storeName} onChange={e => setEditState(prev => ({ ...prev, value: { ...prev.value, storeName: e.target.value } }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-3 text-white font-black" />
                <input type="number" value={editState.value.totalAmount} onChange={e => setEditState(prev => ({ ...prev, value: { ...prev.value, totalAmount: e.target.value } }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-3 text-white font-black" />
                <div className="grid grid-cols-2 gap-2">{ALL_CATS.map(c => (<button key={c} onClick={() => setEditState(prev => ({ ...prev, value: { ...prev.value, category: c } }))} className={`py-3 rounded-xl font-black text-sm border-2 ${editState.value.category === c ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-500'}`}>{c}</button>))}</div>
                <input value={editState.value.note} onChange={e => setEditState(prev => ({ ...prev, value: { ...prev.value, note: e.target.value } }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-4 py-3 text-white font-black" placeholder="비고" />
              </div>
            ) : editState.field === 'category' ? (
              <div className="grid grid-cols-2 gap-3 mb-8">{ALL_CATS.map(c => (<button key={c} onClick={() => setEditState(prev => ({ ...prev, value: c }))} className={`py-5 rounded-2xl font-black text-lg border-2 transition-all ${editState.value === c ? 'bg-blue-600 border-blue-400 text-white shadow-lg scale-105' : 'bg-slate-900 border-slate-700 text-slate-500'}`}>{c}</button>))}</div>
            ) : (
              <input autoFocus value={editState.value} onChange={e => setEditState(prev => ({ ...prev, value: e.target.value }))} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-5 mb-8 text-2xl text-white font-black" />
            )}
            <button onClick={handleInlineEdit} className="w-full bg-blue-600 py-5 rounded-2xl text-lg font-black mt-6">저장</button>
          </div>
        </Modal>
      )}

      {/* ── 삭제 확인 모달 */}
      {deleteConfirmId && (
        <Modal title="삭제?" onClose={() => setDeleteConfirmId(null)}>
          <div className="p-2 flex gap-4">
            <button onClick={() => setDeleteConfirmId(null)} className="flex-1 bg-slate-700 py-5 rounded-2xl font-black">취소</button>
            <button onClick={() => { deleteReceipt(deleteConfirmId); setDeleteConfirmId(null); }} className="flex-1 bg-red-600 py-5 rounded-2xl font-black">삭제</button>
          </div>
        </Modal>
      )}

      {/* ── 직접 입력 모달 */}
      {showManualModal && (
        <Modal title="➕ 직접 입력" onClose={() => setShowManualModal(false)}>
          <div className="space-y-5 p-2">
            <input placeholder="🏢 사용처" value={mf.storeName} onChange={e => setMf({ ...mf, storeName: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black" />
            <input type="number" placeholder="💰 금액" value={mf.totalAmount} onChange={e => setMf({ ...mf, totalAmount: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black" />
            <div className="grid grid-cols-2 gap-2">{ALL_CATS.map(c => <button key={c} onClick={() => setMf({ ...mf, category: c })} className={`py-4 rounded-xl font-black text-sm border-2 ${mf.category === c ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-900 border-slate-700 text-slate-500'}`}>{c}</button>)}</div>
            <input placeholder="📝 비고" value={mf.note} onChange={e => setMf({ ...mf, note: e.target.value })} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black" />
            <button onClick={handleManualAdd} className="w-full bg-blue-600 py-5 rounded-2xl text-lg font-black">추가</button>
          </div>
        </Modal>
      )}

      {/* ── 저장/내보내기 모달 */}
      {showSaveModal && (
        <Modal title="💾 저장/내보내기" onClose={() => setShowSaveModal(false)}>
          <div className="space-y-4 p-2">
            <button onClick={saveToJSON} className="w-full flex items-center justify-between bg-slate-800 border-2 border-slate-700 p-5 rounded-2xl text-white">
              <div className="flex items-center gap-4"><FolderOpen size={24} className="text-blue-400" /><span className="text-lg font-black">JSON 백업</span></div>
              <Download size={20} />
            </button>
            <button onClick={downloadXLSX} className="w-full flex items-center justify-between bg-slate-800 border-2 border-slate-700 p-5 rounded-2xl text-white">
              <div className="flex items-center gap-4"><Download size={24} className="text-green-400" /><span className="text-lg font-black">엑셀(XLSX)</span></div>
              <Download size={20} />
            </button>
          </div>
        </Modal>
      )}

      {/* ── 예산 자동 계산 모달 */}
      {showBudgetCalcModal && (
        <Modal title="📅 예산 자동 계산" onClose={() => setShowBudgetCalcModal(false)}>
          <div className="space-y-6 p-4">
            <div className="space-y-5">
              <div className="flex flex-col items-center"><label className="text-xs text-slate-500 font-black mb-1.5">출장 시작일</label><input type="date" value={tripStartDate} onChange={e => setTripStartDate(e.target.value)} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-3 py-4 text-xl text-white font-black text-center" /></div>
              <div className="flex flex-col items-center"><label className="text-xs text-slate-500 font-black mb-1.5">출장 종료일</label><input type="date" value={tripEndDate} onChange={e => setTripEndDate(e.target.value)} className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-3 py-4 text-xl text-white font-black text-center" /></div>
            </div>
            <button onClick={handleBudgetCalc} className="w-full bg-blue-600 py-4 rounded-2xl text-lg font-black">계산 설정</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
