import { CheckCircle2, CloudUpload, FolderOpen, Loader2, Save, Send } from 'lucide-react';
import OfficeReviewNotice from './OfficeReviewNotice';
import { progressShareLabel } from '../../hooks/useProgressShare';

// '담당자에게 보내기'(집계 이미지 공유)는 현재 쓰지 않는다. 다시 쓰려면 true로 바꾼다.
const SHOW_MANAGER_SHARE = false;

function SendCountBadge({ count }) {
  if (count === 0) {
    return (
      <span className="shrink-0 motion-safe:animate-pulse text-amber-300 text-[11px] font-black px-2 py-0.5 rounded-full bg-amber-400/25 border border-amber-400/70 shadow-[0_0_8px_rgba(251,191,36,0.4)]">
        미전송
      </span>
    );
  }
  return (
    <span className="shrink-0 text-blue-400 text-[11px] font-black px-2 py-0.5 rounded-full bg-blue-500/20 border border-blue-500/40">
      {count}회 전송
    </span>
  );
}

export default function TripClosePanel({
  kakaoSendCount,
  uploadSendCount,
  driveUploading,
  uploadProgress,
  lastUploadFailures,
  submissionNeedsResend = false,
  duplicateReportSlot,
  onKakaoShare,
  onUpload,
  onRetryFailed,
  onSaveBackup,
  onLoadBackup,
  officeReviews,
  progressSharedAt = '',
}) {
  // 담당자 공유를 숨긴 동안에는 Drive 저장이 첫 단계이므로 이미 준비된 것으로 본다.
  const kakaoDone = SHOW_MANAGER_SHARE ? kakaoSendCount > 0 : true;
  const uploadDone = uploadSendCount > 0;

  return (
    <div className="pt-1 space-y-1.5">
      {kakaoDone && uploadDone && (
        <div className="w-full bg-emerald-600/20 border border-emerald-500/50 rounded-2xl py-2 text-center">
          <p className="text-emerald-300 font-black text-sm">전송 이력이 있습니다</p>
          <p className="text-slate-200 text-xs mt-1 px-3">수정한 자료는 다시 전송해 주세요. 담당자의 수신·검수 완료 여부는 별도로 확인해야 합니다.</p>
        </div>
      )}
      {submissionNeedsResend && uploadDone && (
        <div className="rounded-2xl border border-amber-500/60 bg-amber-950/35 px-3 py-2" role="status">
          <p className="text-sm font-black text-amber-200">수정된 자료를 다시 전송해 주세요</p>
          <p className="mt-1 text-xs font-bold text-amber-100">이전 전송 이력은 남아 있지만, 현재 영수증 내용은 마지막 완전 전송본과 다릅니다.</p>
        </div>
      )}

      {SHOW_MANAGER_SHARE && (
        <>
          <button
            onClick={onKakaoShare}
            className={`w-full min-h-12 flex items-center gap-3 px-3 py-3 rounded-2xl border-2 active:scale-[0.98] transition-all ${
              kakaoDone
                ? 'bg-blue-600/15 border-blue-500/60'
                : 'bg-yellow-400/10 border-yellow-400/50'
            }`}
          >
            <span className={`shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${kakaoDone ? 'bg-blue-500 text-white' : 'bg-yellow-400 text-slate-900'}`}>
              {kakaoDone ? <CheckCircle2 size={18} strokeWidth={2.6} /> : <Send size={16} strokeWidth={2.6} />}
            </span>
            <div className="min-w-0 text-left flex-1">
              <p className={`font-black text-sm leading-tight ${kakaoDone ? 'text-blue-300' : 'text-yellow-300'}`}>담당자에게 보내기</p>
              <p className={`text-[11px] font-bold mt-0.5 ${kakaoDone ? 'text-blue-200/60' : 'text-yellow-200/60'}`}>집계내역 전송</p>
            </div>
            <SendCountBadge count={kakaoSendCount} />
          </button>

          <div className="flex justify-center text-slate-600 text-lg leading-none">↓</div>
        </>
      )}

      <button
        onClick={onUpload}
        disabled={driveUploading}
        className={`w-full min-h-12 flex items-center gap-3 px-3 py-3 rounded-2xl border-2 active:scale-[0.98] transition-all disabled:opacity-60 ${
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
        <div className="min-w-0 text-left flex-1">
          <p className={`font-black text-sm leading-tight ${uploadDone ? 'text-blue-300' : kakaoDone ? 'text-yellow-300' : 'text-slate-200'}`}>
            {driveUploading
              ? <span className="flex min-w-0 items-center gap-2"><Loader2 size={15} className="shrink-0 animate-spin" /><span className="break-words">{uploadProgress}% 업로드 중...</span></span>
              : 'Drive 저장'}
          </p>
          <p className={`text-[11px] font-bold mt-0.5 ${uploadDone ? 'text-blue-200/60' : kakaoDone ? 'text-yellow-200/60' : 'text-slate-400'}`}>영수증 저장</p>
        </div>
        {!driveUploading && <SendCountBadge count={uploadSendCount} />}
      </button>

      {duplicateReportSlot}

      <OfficeReviewNotice {...officeReviews} onRefresh={officeReviews?.reload} />

      {lastUploadFailures.length > 0 && !driveUploading && (
        <button
          type="button"
          onClick={onRetryFailed}
          className="w-full bg-amber-900/30 border border-amber-700 text-amber-100 py-2 rounded-2xl text-xs font-black active:scale-95 transition-transform"
        >
          ⚠️ 실패 {lastUploadFailures.length}건 다시 보내기
        </button>
      )}

      <div className="flex items-center justify-between gap-2 pt-0.5">
        <p className="min-w-0 text-[11px] font-bold text-slate-500" aria-label="사무실 진행 공유">
          {progressShareLabel(progressSharedAt)}
        </p>
        <div className="flex shrink-0 gap-2">
        <button
          onClick={onSaveBackup}
          className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-lg active:scale-95"
          title="백업"
          aria-label="백업"
        >
          <Save size={17} />
        </button>
        <button
          type="button"
          onClick={onLoadBackup}
          className="w-11 h-11 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-lg active:scale-95 cursor-pointer"
          title="불러오기"
          aria-label="불러오기"
        >
          <FolderOpen size={17} />
        </button>
        </div>
      </div>
    </div>
  );
}
