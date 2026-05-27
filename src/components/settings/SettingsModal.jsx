import { useState, useEffect } from 'react';
import Modal from '../layout/Modal';
import { encryptData, decryptData } from '../../utils/crypto';

export default function SettingsModal({
  show,
  onClose,
  showToast,
  names,
  onNamesChange,
  reportDate,
  onDateChange,
  onReset,
}) {
  const [tempKey, setTempKey] = useState('');
  const [tempBiznoKey, setTempBiznoKey] = useState('');
  const [testResult, setTestResult] = useState({ loading: false, msg: '', type: '' });
  const [showApiKeys, setShowApiKeys] = useState(false);

  // 설정 열릴 때마다 암호화된 키 복호화
  useEffect(() => {
    if (!show) return;
    const loadKey = async () => {
      try {
        const encrypted = localStorage.getItem('claude_api_key_v2') || '';
        if (encrypted) { const dec = await decryptData(encrypted); setTempKey(dec); }
        else setTempKey('');
      } catch (e) { console.error(e); }
    };
    loadKey();
    setTempBiznoKey(localStorage.getItem('bizno_api_key') || '');
    setShowApiKeys(false);
    setTestResult({ loading: false, msg: '', type: '' });
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

  const saveSettings = async () => {
    const enc = await encryptData(tempKey);
    localStorage.setItem('claude_api_key_v2', enc);
    localStorage.setItem('bizno_api_key', tempBiznoKey);
    onClose();
    showToast('🛡️ 저장 완료');
  };

  if (!show) return null;

  return (
    <Modal title="⚙️ 설정" onClose={onClose}>
      <div className="space-y-6 p-2">

        {/* 기본 정보 */}
        <div className="border-b border-slate-800 pb-6">
          <label className="text-sm text-slate-400 font-black mb-2 block">이름</label>
          <input
            value={names}
            onChange={e => onNamesChange(e.target.value)}
            placeholder="홍길동, 김철수"
            className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black mb-4"
          />
          <label className="text-sm text-slate-400 font-black mb-2 block">날짜</label>
          <input
            type="date"
            value={reportDate}
            onChange={e => onDateChange(e.target.value)}
            className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black"
          />
        </div>

        {/* API 설정 (접기/펼치기) */}
        <div className="border-b border-slate-800 pb-6">
          <button
            onClick={() => setShowApiKeys(v => !v)}
            className="w-full flex items-center justify-between text-slate-400 font-black text-sm py-1"
          >
            <span>🔑 API 설정 (고급)</span>
            <span className="text-slate-500">{showApiKeys ? '▲' : '▶'}</span>
          </button>

          {showApiKeys && (
            <div className="mt-4 space-y-5">
              {/* Claude API 키 */}
              <div>
                <label className="text-sm text-slate-400 font-black mb-2 block">Claude API 키</label>
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
                  <div className={`mt-4 p-4 rounded-2xl text-xs font-bold border ${testResult.type === 'success' ? 'bg-green-900/20 text-green-400 border-green-900' : 'bg-red-900/20 text-red-400 border-red-900'}`}>
                    {testResult.msg}
                  </div>
                )}
              </div>

              {/* 비즈노 API 키 */}
              <div>
                <label className="text-sm text-slate-400 font-black mb-2 block">비즈노(Bizno) API 키</label>
                <input
                  type="password"
                  value={tempBiznoKey}
                  onChange={e => setTempBiznoKey(e.target.value)}
                  className="w-full bg-slate-900 border-2 border-slate-700 rounded-2xl px-5 py-4 text-white font-black"
                />
              </div>
            </div>
          )}
        </div>

        {/* 설정 저장 */}
        <button onClick={saveSettings} className="w-full bg-blue-600 py-5 rounded-2xl text-lg font-black">
          설정 저장
        </button>

        {/* 위험 구역 */}
        <div className="border border-red-900/40 rounded-2xl p-4 bg-red-900/10">
          <p className="text-xs text-red-400 font-black mb-3">⚠️ 위험 구역</p>
          <button
            onClick={() => {
              if (window.confirm('모든 영수증 데이터가 삭제됩니다.\n계속하시겠습니까?')) {
                onReset();
                onClose();
              }
            }}
            className="w-full bg-red-900/30 border border-red-800 text-red-400 py-4 rounded-xl font-black text-sm active:scale-95 transition-transform"
          >
            🗑️ 전체 데이터 초기화
          </button>
        </div>

      </div>
    </Modal>
  );
}
