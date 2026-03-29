import { useState, useEffect } from 'react';
import { X, Download, ArrowRight } from 'lucide-react';

interface UpdateInfo {
  available: boolean;
  currentVersion: string;
  latestVersion: string;
  component: 'openclaw' | 'plugin' | 'desktop';
  label: string;
}

const DISMISS_KEY = 'awareness-claw-update-dismissed';
const NEVER_KEY = 'awareness-claw-update-never';

export default function UpdateBanner() {
  const [updates, setUpdates] = useState<UpdateInfo[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    // Don't check if "never remind" is set
    const never = localStorage.getItem(NEVER_KEY);
    if (never) return;

    // Check if dismissed this session
    const sessionDismissed = sessionStorage.getItem(DISMISS_KEY);
    if (sessionDismissed) { setDismissed(true); return; }

    checkForUpdates();
  }, []);

  const checkForUpdates = async () => {
    if (!window.electronAPI) return;
    setChecking(true);

    try {
      const result = await (window.electronAPI as any).checkUpdates();
      if (result.updates && result.updates.length > 0) {
        setUpdates(result.updates.map((u: any) => ({
          available: true,
          currentVersion: u.currentVersion,
          latestVersion: u.latestVersion,
          component: u.component,
          label: u.label,
        })));
      }
    } catch { /* ignore */ }

    setChecking(false);
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(DISMISS_KEY, 'true');
  };

  const handleNeverRemind = () => {
    localStorage.setItem(NEVER_KEY, 'true');
    setDismissed(true);
    setShowModal(false);
  };

  const handleRemindLater = () => {
    setShowModal(false);
    handleDismiss();
  };

  // Don't render if no updates or dismissed
  if (updates.length === 0 || dismissed) return null;

  return (
    <>
      {/* Weak reminder: top banner */}
      <div className="bg-brand-600/10 border-b border-brand-600/20 px-4 py-1.5 flex items-center justify-between text-xs flex-shrink-0">
        <div className="flex items-center gap-2 text-brand-300">
          <Download size={12} />
          <span>
            {updates.length === 1
              ? `${updates[0].label} 有新版本可用 (${updates[0].latestVersion})`
              : `${updates.length} 个组件有更新可用`
            }
          </span>
          <button
            onClick={() => setShowModal(true)}
            className="text-brand-400 hover:text-brand-300 underline"
          >
            查看详情
          </button>
        </div>
        <button
          onClick={handleDismiss}
          className="text-slate-500 hover:text-slate-300 p-0.5"
          title="关闭提醒"
        >
          <X size={14} />
        </button>
      </div>

      {/* Strong reminder: modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-8">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md">
            <div className="p-6 space-y-4">
              <div className="text-center">
                <div className="text-3xl mb-3">🆕</div>
                <h2 className="text-lg font-bold">有新版本可用</h2>
              </div>

              <div className="space-y-2">
                {updates.map((u, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-slate-800 rounded-xl">
                    <span className="text-sm">{u.label}</span>
                    <span className="text-xs text-slate-400">
                      {u.currentVersion} <ArrowRight size={10} className="inline" /> <span className="text-brand-400">{u.latestVersion}</span>
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <button
                  onClick={() => { /* TODO: trigger upgrade */ setShowModal(false); }}
                  className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  立即升级
                </button>
                <button
                  onClick={handleRemindLater}
                  className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
                >
                  下次提醒
                </button>
                <button
                  onClick={handleNeverRemind}
                  className="w-full py-2 text-slate-600 hover:text-slate-400 text-xs transition-colors"
                >
                  永不提醒此版本
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
