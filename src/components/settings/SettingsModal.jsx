import { useState, useEffect } from 'react';
import Modal from '../layout/Modal';
import { encryptData, decryptData } from '../../utils/crypto';

export default function SettingsModal({
  show,
  onClose,
  weeklyBudget,
  setWeeklyBudget,
  userRole,
  setUserRole,
  setIsAdminView,
  showToast,
}) {
  const [tempKey, setTempKey] = useState('');
  const [tempBiznoKey, setTempBiznoKey] = useState(() => localStorage.getItem('bizno_api_key') || '');
  const [tempAdminPin, setTempAdminPin] = useState('');
  const [testResult, setTestResult] = useState({ loading: false, msg: '', type: '' });

  // 설정 열릴 때마다 암호화된 키 복호화
  useEffect(() => {
    if (!show) return;
    const loadKey = async () => {
      try {
        const encrypted = localStorage.getItem('claude_api_key_v2') || '';
        if (encrypted) { const dec = await decryptData(encrypted); setTempKey(dec); }
      } catch (e) { console.error(e); }
    };
    loadKey();
    setTempBiznoKey(localStorage.getItem('bizno_api_key') || '');
  }, [show]);

  const testConnection = async () => {
    setTestResult({ loading: true, msg: '연결 확인 중...', type: 'info' });
    try {
      const res = await fetch('/api/analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: tempKey, isTest: true }),
      });
      const data = await res.json();
      if (res.ok) setTestResult({ loading: false, msg: data.message, type: 'success' });
      else setTestResult({ loading: false, msg: `${data.error}\n${data.detail || ''}`, type: 'error' });
    } catch (e) { setTestResult({ loading: false, msg: `통신 오류: ${e.message}`, type: 'error' }); }
  };

  const handleAdminUnlock = () => {
    const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN || '';
    if (ADMIN_PIN && tempAdminPin.trim() === ADMIN_PIN) {
      setUserRole('admin');
      localStorage.setItem('user_role', 'admin');
      setTempAdminPin('');
      showToast('🔑 관리자 모드 활성화');
    } else {
      showToast('❌ 코드가 올바르지 않습니다');
      setTempAdminPin('');
    }
  };

  const saveSettings = async () => {
    const enc = await encryptData(tempKey);
    localStorage.setItem('claude_api_key_v2', enc);
    localStorage.setItem('bizno_api_key', tempBiznoKey);
    localStorage.setItem('weekly_budget', String(weeklyBudget));
    onClose();
    showToast('🛡️ 저장 완료');
  };

  if (!show) return null;

  return (
    <Modal title="⚙️ 설정" onClose={onClose}>
      <div className="space-y-6 p-2">
        {/* Claude API 키 */}
        <div>
          <label className="text-base text-slate-400 font-black mb-2 block">Claude API 키</label>
          <input
            type="password"
            value={tempKey}
            onChange={e => setTempKey(e.target.value)}
            placeholder="sk-ant-api..."
            className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black"
          />
          <button onClick={testConnection} className="w-full py-3 mt-3 bg-slate-800 text-slate-300 rounded-xl font-black border border-slate-700">
            연결 테스트
          </button>
          {testResult.msg && (
            <div className={`mt-4 p-4 rounded-2xl text-xs font-bold border ${testResult.type === 'success' ? 'bg-green-900/20 text-green-400' : 'bg-red-900/20 text-red-400'}`}>
              {testResult.msg}
            </div>
          )}
        </div>

        {/* 비즈노 API 키 */}
        <div className="border-t border-slate-800 pt-6">
          <label className="text-base text-slate-400 font-black mb-2 block">비즈노(Bizno) API 키</label>
          <input
            type="password"
            value={tempBiznoKey}
            onChange={e => setTempBiznoKey(e.target.value)}
            className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black"
          />
        </div>

        {/* 역할 설정 */}
        <div className="border-t border-slate-800 pt-6">
          <label className="text-base text-slate-400 font-black mb-3 block">역할 설정</label>
          <div className="flex items-center justify-between bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 mb-3">
            <span className="text-slate-300 font-bold">현재 역할</span>
            <span className={`font-black px-3 py-1 rounded-xl text-sm ${userRole === 'admin' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
              {userRole === 'admin' ? '🔑 관리자' : '👷 작업자'}
            </span>
          </div>
          {userRole === 'admin' ? (
            <button
              onClick={() => { setUserRole('worker'); localStorage.setItem('user_role', 'worker'); setIsAdminView(false); showToast('👷 작업자 모드로 전환'); }}
              className="w-full bg-slate-800 border border-slate-600 py-3 rounded-xl text-slate-400 font-bold"
            >
              작업자 모드로 전환
            </button>
          ) : (
            <div className="flex gap-2">
              <input
                type="password"
                value={tempAdminPin}
                onChange={e => setTempAdminPin(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdminUnlock()}
                placeholder="관리자 코드"
                className="flex-1 bg-slate-900 border-2 border-slate-700 rounded-xl px-4 py-3 text-white font-black"
              />
              <button onClick={handleAdminUnlock} className="bg-blue-600 px-5 py-3 rounded-xl font-black text-sm">확인</button>
            </div>
          )}
        </div>

        <button onClick={saveSettings} className="w-full bg-blue-600 py-5 rounded-2xl text-lg font-black">
          설정 저장
        </button>
      </div>
    </Modal>
  );
}
