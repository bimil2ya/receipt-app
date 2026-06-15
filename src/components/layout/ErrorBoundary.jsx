import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary]', error, info?.componentStack);
    }
  }

  handleReload = () => {
    try { window.location.reload(); } catch { /* noop */ }
  };

  handleReset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-dvh bg-slate-900 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-slate-800 border border-slate-700 rounded-2xl p-6 space-y-4">
          <h1 className="text-xl font-black text-red-300">🚨 화면을 표시할 수 없습니다</h1>
          <p className="text-sm text-slate-300 font-bold leading-6">
            예기치 못한 오류가 발생했습니다. 새로고침으로 대부분 해결되며, 영수증 데이터는 안전합니다.
          </p>
          <pre className="text-xs bg-slate-900/70 border border-slate-700 rounded-lg p-3 overflow-auto max-h-40 text-red-200/90">
            {String(error?.message || error)}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={this.handleReload}
              className="flex-1 bg-blue-600 py-3 rounded-xl font-black text-base"
            >
              새로고침
            </button>
            <button
              onClick={this.handleReset}
              className="flex-1 bg-slate-700 border border-slate-600 py-3 rounded-xl font-black text-base"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }
}
