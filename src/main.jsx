import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import ErrorBoundary from './components/layout/ErrorBoundary.jsx'
import './index.css'

// 대시보드 코드는 별도 청크로 — 현장 입력 번들에 싣지 않는다.
const DashboardApp = React.lazy(() => import('./dashboard/DashboardApp.jsx'))

// #/dashboard — 노경호·담당자 전용 관리자 화면. 현장 입력 UI와 완전히 분리된 트리.
const isDashboard = typeof window !== 'undefined' && window.location.hash.startsWith('#/dashboard');
// 해시가 대시보드 안팎으로 바뀌면 트리를 통째로 교체하기 위해 새로고침.
if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const nowDashboard = window.location.hash.startsWith('#/dashboard');
    if (nowDashboard !== isDashboard) window.location.reload();
  });
}

// 이미 SW의 통제를 받고 있는지(=캐시된 버전으로 구동 중인지) 기록.
// 통제받지 않는 상태(=최초 방문)에서의 controllerchange는 첫 등록이라 reload 불필요.
const hadControllerAtStartup = typeof navigator !== 'undefined'
  && !!navigator.serviceWorker?.controller;

let reloadingForUpdate = false;
if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadControllerAtStartup || reloadingForUpdate) return;
    reloadingForUpdate = true;
    if (import.meta.env.DEV) console.info('[PWA] 새 버전 활성화 — 새로고침');
    window.location.reload();
  });
}

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return;
    // 1시간마다 백그라운드 확인 (폴백)
    setInterval(() => registration.update().catch(() => {}), 60 * 60 * 1000);
    // 앱으로 돌아올 때마다 즉시 확인 — 배포 후 바로 반영됨
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        registration.update().catch(() => {});
      }
    });
  },
  onNeedRefresh() {
    window.__receiptAppPendingUpdate = {
      applyUpdate: () => updateSW(true),
    };
    window.dispatchEvent(new CustomEvent('receipt-app:update-available', {
      detail: {
        applyUpdate: () => updateSW(true),
      },
    }));
  },
  onOfflineReady() {
    if (import.meta.env.DEV) console.info('[PWA] 오프라인 사용 준비 완료');
  },
})

// 런타임 에러 발생 시 하얀 화면 대신 에러 메시지 표시 (디버깅용)
// React ErrorBoundary가 잡지 못하는 최상위 예외(SW 코드, 비-React 영역)용 안전망.
// innerHTML 문자열 보간을 피하고 textContent로만 사용자 입력(에러 메시지)을 노출해 XSS 표면 제거.
window.onerror = function(message, source, lineno) {
  const root = document.getElementById('root');
  if (!root) return false;

  root.replaceChildren();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'padding:20px;color:white;background:#1e293b;font-family:monospace';

  const h = document.createElement('h2');
  h.style.color = '#ef4444';
  h.textContent = '🚨 앱 실행 오류 발생';
  wrap.appendChild(h);

  const pMsg = document.createElement('p');
  const strongMsg = document.createElement('strong');
  strongMsg.textContent = '메시지: ';
  pMsg.appendChild(strongMsg);
  pMsg.appendChild(document.createTextNode(String(message ?? '')));
  wrap.appendChild(pMsg);

  const pLoc = document.createElement('p');
  const strongLoc = document.createElement('strong');
  strongLoc.textContent = '위치: ';
  pLoc.appendChild(strongLoc);
  pLoc.appendChild(document.createTextNode(`${source ?? ''}:${lineno ?? ''}`));
  wrap.appendChild(pLoc);

  const btn = document.createElement('button');
  btn.textContent = '새로고침';
  btn.style.cssText = 'margin-top:20px;padding:10px 20px;background:#3b82f6;border:none;color:white;border-radius:8px';
  btn.addEventListener('click', () => window.location.reload());
  wrap.appendChild(btn);

  root.appendChild(wrap);
  return false;
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isDashboard ? (
        <React.Suspense fallback={<div style={{ padding: 24, color: '#64748b', font: '14px system-ui' }}>불러오는 중…</div>}>
          <DashboardApp />
        </React.Suspense>
      ) : (
        <App />
      )}
    </ErrorBoundary>
  </React.StrictMode>,
)

const initialSplash = document.getElementById('initial-splash');
let splashFallbackTimer;
const removeInitialSplash = () => {
  clearTimeout(splashFallbackTimer);
  initialSplash?.remove();
  window.removeEventListener('receipt-app:booted', removeInitialSplash);
};
window.addEventListener('receipt-app:booted', removeInitialSplash, { once: true });
// 하드 폴백 — 부팅 이벤트가 안 오는 경우(lazy 청크 로드 실패 등)에도 스플래시가 영구히 남지 않도록.
splashFallbackTimer = setTimeout(removeInitialSplash, 8000);
