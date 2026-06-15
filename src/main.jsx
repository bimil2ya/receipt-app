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
    // 앱이 켜져 있는 동안에도 1시간마다 새 버전을 검사한다.
    if (registration) {
      setInterval(() => {
        registration.update().catch(() => {});
      }, 60 * 60 * 1000);
    }
  },
  onNeedRefresh() {
    // autoUpdate 모드에선 호출되지 않지만, 안전망으로 즉시 적용.
    updateSW(true);
  },
  onOfflineReady() {
    if (import.meta.env.DEV) console.info('[PWA] 오프라인 사용 준비 완료');
  },
})

// 런타임 에러 발생 시 하얀 화면 대신 에러 메시지 표시 (디버깅용)
window.onerror = function(message, source, lineno) {
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="padding: 20px; color: white; background: #1e293b; font-family: monospace;">
        <h2 style="color: #ef4444;">🚨 앱 실행 오류 발생</h2>
        <p><strong>메시지:</strong> ${message}</p>
        <p><strong>위치:</strong> ${source}:${lineno}</p>
        <button onclick="location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #3b82f6; border: none; color: white; border-radius: 8px;">새로고침</button>
      </div>
    `;
  }
  return false;
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
