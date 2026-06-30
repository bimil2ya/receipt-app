import { CheckCircle2, CloudUpload, FolderOpen, Loader2, Save, Send } from 'lucide-react';

export default function TripClosePanel({
  kakaoDone,
  uploadDone,
  driveUploading,
  uploadProgress,
  lastUploadFailures,
  duplicateReportSlot,
  onKakaoShare,
  onUpload,
  onRetryFailed,
  onSaveBackup,
  onLoadBackup,
}) {
  return (
    <div className="pt-1 space-y-1.5">
      {kakaoDone && uploadDone && (
        <div className="w-full bg-emerald-600/20 border border-emerald-500/50 rounded-2xl py-2 text-center">
          <p className="text-emerald-300 font-black text-sm">출장 마감 완료</p>
        </div>
      )}

      <button
        onClick={onKakaoShare}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl border-2 active:scale-[0.98] transition-all ${
          kakaoDone
            ? 'bg-blue-600/15 border-blue-500/60'
            : 'bg-yellow-400/10 border-yellow-400/50'
        }`}
      >
        <span className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${kakaoDone ? 'bg-blue-500 text-white' : 'bg-yellow-400 text-slate-900'}`}>
          {kakaoDone ? <CheckCircle2 size={18} strokeWidth={2.6} /> : <Send size={16} strokeWidth={2.6} />}
        </span>
        <div className="text-left flex-1">
          <p className={`font-black text-sm leading-tight ${kakaoDone ? 'text-blue-300' : 'text-yellow-300'}`}>담당자에게 보내기</p>
          <p className={`text-[11px] font-bold mt-0.5 ${kakaoDone ? 'text-blue-200/60' : 'text-yellow-200/60'}`}>집계내역 전송</p>
        </div>
        {kakaoDone
          ? <span className="text-blue-400 text-[11px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40">완료</span>
          : <span className="motion-safe:animate-pulse text-amber-300 text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-400/25 border border-amber-400/70 shadow-[0_0_8px_rgba(251,191,36,0.4)]">미완료</span>
        }
      </button>

      <div className="flex justify-center text-slate-600 text-lg leading-none">↓</div>

      <button
        onClick={onUpload}
        disabled={driveUploading}
        className={`w-full flex items-center gap-3 px-3 py-3 rounded-2xl border-2 active:scale-[0.98] transition-all disabled:opacity-60 ${
          uploadDone
            ? 'bg-blue-600/15 border-blue-500/60'
            : kakaoDone
              ? 'bg-yellow-400/10 border-yellow-400/50'
              : 'bg-slate-800/60 border-slate-600/50'
        }`}
      >
        <span className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${uploadDone ? 'bg-blue-500 text-white' : kakaoDone ? 'bg-yellow-400 text-slate-900' : 'bg-slate-600 text-white'}`}>
          {uploadDone ? <CheckCircle2 size={18} strokeWidth={2.6} /> : <CloudUpload size={16} strokeWidth={2.6} />}
        </span>
        <div className="text-left flex-1">
          <p className={`font-black text-sm leading-tight ${uploadDone ? 'text-blue-300' : kakaoDone ? 'text-yellow-300' : 'text-slate-200'}`}>
            {driveUploading
              ? <span className="flex items-center gap-2"><Loader2 size={15} className="animate-spin" />{uploadProgress}% 업로드 중...</span>
              : 'Drive 저장'}
          </p>
          <p className={`text-[11px] font-bold mt-0.5 ${uploadDone ? 'text-blue-200/60' : kakaoDone ? 'text-yellow-200/60' : 'text-slate-400'}`}>영수증 저장</p>
        </div>
        {!driveUploading && (uploadDone
          ? <span className="text-blue-400 text-[11px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40">완료</span>
          : <span className="motion-safe:animate-pulse text-amber-300 text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-400/25 border border-amber-400/70 shadow-[0_0_8px_rgba(251,191,36,0.4)]">미완료</span>
        )}
      </button>

      {duplicateReportSlot}

      {lastUploadFailures.length > 0 && !driveUploading && (
        <button
          type="button"
          onClick={onRetryFailed}
          className="w-full bg-amber-900/30 border border-amber-700 text-amber-100 py-2 rounded-2xl text-xs font-black active:scale-95 transition-transform"
        >
          ⚠️ 실패 {lastUploadFailures.length}건 다시 보내기
        </button>
      )}

      <div className="flex justify-end gap-2 pt-0.5">
        <button
          onClick={onSaveBackup}
          className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-lg active:scale-95"
          title="백업"
          aria-label="백업"
        >
          <Save size={17} />
        </button>
        <button
          type="button"
          onClick={onLoadBackup}
          className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-lg active:scale-95 cursor-pointer"
          title="불러오기"
          aria-label="불러오기"
        >
          <FolderOpen size={17} />
        </button>
      </div>
    </div>
  );
}
