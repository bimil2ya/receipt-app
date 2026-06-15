import React from 'react'
import ReactDOM from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.jsx'
import './index.css'

registerSW({
  immediate: true,
  onNeedRefresh() {
    // 새 버전이 대기 중. 자동 reload 하지 않는다 — 사용자가 PWA를 재시작할 때 자연스럽게 적용됨.
    if (import.meta.env.DEV) console.info('[PWA] 새 버전 대기 중');
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
    <App />
  </React.StrictMode>,
)
