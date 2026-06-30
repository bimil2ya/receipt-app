import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import ErrorBoundary from './components/layout/ErrorBoundary.jsx'
import './index.css'

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
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

const initialSplash = document.getElementById('initial-splash');
const removeInitialSplash = () => {
  initialSplash?.remove();
  window.removeEventListener('receipt-app:booted', removeInitialSplash);
};
window.addEventListener('receipt-app:booted', removeInitialSplash, { once: true });
