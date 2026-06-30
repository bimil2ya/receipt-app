import { useState } from 'react';
import { parseTeamsText, teamsToText } from './teamText';

export default function AdminTeamModal({ show, currentTeams, onSaved, onClose }) {
  const [step, setStep] = useState('pin');
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState(false);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);
  const [authChecking, setAuthChecking] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (!show) return null;

  const handleClose = () => {
    setStep('pin');
    setPin('');
    setPinError(false);
    setAuthChecking(false);
    setSaveError('');
    onClose();
  };

  const handlePinSubmit = async () => {
    if (!pin.trim()) {
      setPinError(true);
      return;
    }
    setAuthChecking(true);
    setPinError(false);
    setSaveError('');
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Pin': pin,
        },
        body: JSON.stringify({ action: 'verify' }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setEditText(teamsToText(currentTeams));
        setStep('edit');
      } else {
        setPinError(true);
        setSaveError(data.error || '관리자 인증 실패');
      }
    } catch {
      setSaveError('네트워크 오류');
    } finally {
      setAuthChecking(false);
    }
  };

  const handleSave = async () => {
    const teams = parseTeamsText(editText);
    if (teams.length === 0) { setSaveError('조명단이 비어있습니다.'); return; }
    setSaving(true);
    setSaveError('');
    try {
      const res = await fetch('/api/teams', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Pin': pin,
        },
        body: JSON.stringify({ teams }),
      });
      const data = await res.json();
      if (data.success) {
        onSaved(teams);
        handleClose();
      } else if (res.status === 401) {
        setStep('pin');
        setPin('');
        setPinError(true);
        setSaveError('');
      } else {
        setSaveError(data.error || '저장 실패');
      }
    } catch {
      setSaveError('네트워크 오류');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-slate-950/98"
      style={{ paddingTop: 'max(24px, env(safe-area-inset-top))', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-5 pb-4 border-b border-slate-700">
        <h2 className="text-lg font-black text-white">
          {step === 'pin' ? '🔐 관리자 인증' : '📋 조명단 수정'}
        </h2>
        <button
          onClick={handleClose}
          className="w-11 h-11 rounded-2xl bg-slate-800 flex items-center justify-center text-slate-400 font-black text-lg active:scale-95"
        >
          ✕
        </button>
      </div>

      {/* PIN 입력 */}
      {step === 'pin' && (
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
          <p className="text-slate-400 text-sm font-bold">관리자 비밀번호를 입력하세요</p>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={e => { setPin(e.target.value); setPinError(false); }}
            onKeyDown={e => e.key === 'Enter' && handlePinSubmit()}
            placeholder="비밀번호"
            autoFocus
            className={`w-52 h-16 text-center text-2xl font-black tracking-widest bg-slate-800 border-2 rounded-2xl text-white outline-none transition-colors ${
              pinError ? 'border-red-500' : 'border-slate-600 focus:border-blue-500'
            }`}
          />
          {pinError && (
            <div className="flex flex-col items-center gap-3 -mt-2">
              <p className="text-amber-400 text-sm font-bold">{saveError || '비밀번호를 확인해 주세요.'}</p>
              <button
                onClick={handleClose}
                className="text-slate-500 text-sm font-bold underline underline-offset-2 active:text-slate-300"
              >
                나가기
              </button>
            </div>
          )}
          <button
            onClick={handlePinSubmit}
            disabled={pin.length === 0 || authChecking}
            className="w-52 h-14 rounded-2xl bg-blue-600 text-white font-black text-base disabled:opacity-40 active:scale-95 transition-transform"
          >
            {authChecking ? '확인 중...' : '확인'}
          </button>
        </div>
      )}

      {/* 조명단 편집 */}
      {step === 'edit' && (
        <div className="flex-1 flex flex-col px-5 pt-4 gap-3 overflow-hidden">
          <div className="bg-slate-800 rounded-2xl px-4 py-3">
            <p className="text-xs text-slate-400 font-bold">한 줄에 한 조 · 이름은 쉼표로 구분</p>
            <p className="text-xs text-slate-500 font-mono mt-1">
              류준, 류수현{'\n'}이선수, 박종일
            </p>
          </div>

          <textarea
            value={editText}
            onChange={e => { setEditText(e.target.value); setSaveError(''); }}
            className="flex-1 bg-slate-800 border-2 border-slate-700 rounded-2xl px-4 py-4 text-white font-bold text-base resize-none outline-none focus:border-blue-500 font-mono leading-loose"
            placeholder={'류준, 류수현\n이선수, 박종일\n...'}
            autoFocus
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="off"
          />

          {saveError && <p className="text-red-400 text-sm font-bold">{saveError}</p>}

          <div className="flex gap-3 pb-1">
            <button
              onClick={handleClose}
              className="flex-1 h-14 rounded-2xl bg-slate-700 text-slate-300 font-black active:scale-95 transition-transform"
            >
              취소
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 h-14 rounded-2xl bg-blue-600 text-white font-black active:scale-95 disabled:opacity-60 transition-transform"
            >
              {saving ? '저장 중…' : '저장'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
