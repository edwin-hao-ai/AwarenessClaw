import { useState, useEffect } from 'react';
import { ExternalLink, RefreshCw, AlertCircle, Loader2 } from 'lucide-react';

type GatewayStatus = 'checking' | 'online' | 'offline';

export default function Dashboard() {
  const [status, setStatus] = useState<GatewayStatus>('checking');
  const [dashboardUrl, setDashboardUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  useEffect(() => {
    loadDashboard();
  }, []);

  // Re-check periodically if offline
  useEffect(() => {
    if (status !== 'offline') return;
    const interval = setInterval(loadDashboard, 10000);
    return () => clearInterval(interval);
  }, [status]);

  const loadDashboard = async () => {
    setStatus('checking');

    // Try to get dashboard URL with token from OpenClaw CLI
    if (window.electronAPI) {
      try {
        const { url } = await window.electronAPI.getDashboardUrl();
        if (url) {
          setDashboardUrl(url);
          setStatus('online');
          return;
        }
      } catch { /* fall through */ }
    }

    // Fallback: check if gateway responds (without token)
    try {
      await fetch('http://localhost:18789', { mode: 'no-cors', signal: AbortSignal.timeout(3000) });
      // Gateway is up but we couldn't get the token URL
      setDashboardUrl('http://localhost:18789');
      setStatus('online');
    } catch {
      setStatus('offline');
    }
  };

  const reload = () => {
    setIframeKey((k) => k + 1);
    loadDashboard();
  };

  const openInBrowser = () => {
    if (dashboardUrl) {
      window.electronAPI?.openExternal(dashboardUrl);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-3 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">💬 聊天</h1>
          <div className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs ${
            status === 'online' ? 'bg-emerald-600/20 text-emerald-400' :
            status === 'offline' ? 'bg-red-600/20 text-red-400' :
            'bg-slate-700 text-slate-400'
          }`}>
            <div className={`w-1.5 h-1.5 rounded-full ${
              status === 'online' ? 'bg-emerald-400' :
              status === 'offline' ? 'bg-red-400' :
              'bg-slate-500 animate-pulse'
            }`} />
            {status === 'online' ? 'Gateway 运行中' :
             status === 'offline' ? 'Gateway 未运行' :
             '连接中...'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={reload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
          >
            <RefreshCw size={12} />
            刷新
          </button>
          <button
            onClick={openInBrowser}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
          >
            <ExternalLink size={12} />
            浏览器打开
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 relative">
        {status === 'online' && dashboardUrl && (
          <webview
            key={iframeKey}
            src={dashboardUrl}
            className="w-full h-full"
            /* @ts-ignore */
            allowpopups="true"
          />
        )}

        {status === 'offline' && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-6 p-8">
            <AlertCircle size={48} strokeWidth={1} className="text-slate-600" />
            <div className="text-center max-w-md">
              <h2 className="text-lg font-medium text-slate-300 mb-2">OpenClaw Gateway 未运行</h2>
              <p className="text-sm mb-4">
                需要启动 OpenClaw 才能聊天。请在终端运行：
              </p>
              <code className="block px-4 py-3 bg-slate-800 rounded-xl text-sm text-brand-400 font-mono mb-4">
                openclaw up
              </code>
              <p className="text-xs text-slate-500">
                启动后会自动连接
              </p>
            </div>
            <button
              onClick={loadDashboard}
              className="flex items-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm transition-colors"
            >
              <RefreshCw size={14} />
              重新检测
            </button>
          </div>
        )}

        {status === 'checking' && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 space-y-4">
            <Loader2 size={32} className="animate-spin text-brand-500" />
            <p className="text-sm">正在连接 OpenClaw Gateway...</p>
          </div>
        )}
      </div>
    </div>
  );
}
