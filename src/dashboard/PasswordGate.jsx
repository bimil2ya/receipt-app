import { useState } from 'react';
import { authenticate, requestForgot, writeToken } from './api';

export default function PasswordGate({ onAuthed }) {
  const [role, setRole] = useState('owner');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const result = await authenticate(password);
    setBusy(false);
    if (result.ok) {
      writeToken(result.token);
      onAuthed();
      return;
    }
    if (result.reason === 'locked') {
      setError(`시도가 많습니다. 잠시 후 다시 시도하세요${result.retryAfter ? ` (${result.retryAfter}초)` : ''}.`);
    } else if (result.reason === 'unavailable') {
      setError('지금은 로그인할 수 없습니다. 잠시 후 다시 시도하세요.');
    } else {
      setError('비밀번호가 맞지 않습니다.');
    }
  }

  async function forgot() {
    await requestForgot(role);
    setForgotSent(true);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 text-slate-800">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-bold">출장비 집행 현황</h1>
        <p className="mt-1 text-sm text-slate-500">역할을 고르고 비밀번호를 입력하세요.</p>

        <div className="mt-4 flex gap-2">
          {[
            ['owner', '노경호'],
            ['staff', '담당자'],
          ].map(([value, label]) => (
            <label
              key={value}
              className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center text-sm font-semibold ${
                role === value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-500'
              }`}
            >
              <input
                type="radio"
                name="role"
                value={value}
                checked={role === value}
                onChange={() => setRole(value)}
                className="sr-only"
              />
              {label}
            </label>
          ))}
        </div>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="off"
          placeholder="비밀번호"
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm"
        />

        {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}

        <button
          type="submit"
          disabled={busy || !password}
          className="mt-4 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? '확인 중…' : '들어가기'}
        </button>

        <button
          type="button"
          onClick={forgot}
          className="mt-3 w-full text-center text-xs text-slate-500 underline"
        >
          비밀번호 찾기
        </button>
        {forgotSent && (
          <p className="mt-2 text-center text-xs text-slate-500">
            등록된 주소로 메일을 보냈습니다.
          </p>
        )}
      </form>
    </div>
  );
}
