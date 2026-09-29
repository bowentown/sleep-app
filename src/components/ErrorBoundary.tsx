import  { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in SomnaCare:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#070a12] text-white flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600/30 text-indigo-400 flex items-center justify-center text-2xl mb-4 border border-indigo-500/40">
            🌙
          </div>
          <h2 className="text-[17px] font-bold mb-2">应用界面出现小状况</h2>
          <p className="text-xs text-slate-400 mb-5 max-w-xs leading-relaxed">
            数据已安全缓存在本地，点击下方按钮即可重新加载。
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all shadow-lg"
          >
            重新加载应用
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
