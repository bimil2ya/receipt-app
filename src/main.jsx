import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

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
