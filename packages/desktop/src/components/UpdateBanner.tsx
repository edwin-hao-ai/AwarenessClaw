import { useState, useEffect } from 'react';
import { X, Download, ArrowRight, Loader2, Check, AlertCircle } from 'lucide-react';
import { useI18n } from '../lib/i18n';

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
  const { t } = useI18n();
  const [updates, setUpdates] = useState<UpdateInfo[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [upgradeResults, setUpgradeResults] = useState<Record<string, { success: boolean; error?: string }>>({});

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

    try {
      const result = await (window.electronAPI as any).checkUpdates();
      if (result.updates && result.updates.length > 0) {
        const mapped = result.updates.map((u: any) => ({
          available: true,
          currentVersion: u.currentVersion,
          latestVersion: u.latestVersion,
          component: u.component,
          label: u.label,
        }));
        setUpdates(mapped);
        // Auto-show modal for first time (strong reminder)
        setShowModal(true);
      }
    } catch { /* ignore */ }
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

  const handleUpgrade = async () => {
    if (!window.electronAPI) return;

    // Only upgrade components that haven't already succeeded
    const pending = updates.filter(u => !upgradeResults[u.component]?.success);

    let allSuccess = true;
    for (const update of pending) {
      setUpgrading(update.component);
      try {
        const result = await (window.electronAPI as any).upgradeComponent(update.component);
        if (result.success) {
          setUpgradeResults(prev => ({ ...prev, [update.component]: { success: true } }));
        } else {
          setUpgradeResults(prev => ({ ...prev, [update.component]: { success: false, error: result.error } }));
          allSuccess = false;
          break; // Stop on first failure
        }
      } catch (err: any) {
        setUpgradeResults(prev => ({ ...prev, [update.component]: { success: false, error: err.message } }));
        allSuccess = false;
        break;
      }
    }
    setUpgrading(null);

    // Re-verify: check if updates are truly resolved
    // Wait a bit for daemon to finish restarting before rechecking
    if (allSuccess) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const recheck = await (window.electronAPI as any).checkUpdates();
        if (recheck.updates && recheck.updates.length > 0) {
          // Filter out components that we already successfully upgraded
          // (daemon may still be restarting when recheck runs)
          const trulyRemaining = recheck.updates.filter(
            (u: any) => !upgradeResults[u.component]?.success
          );
          if (trulyRemaining.length > 0) {
            const remaining = trulyRemaining.map((u: any) => u.label).join(', ');
            setUpgradeResults(prev => ({
              ...prev,
              verify: {
                success: false,
                error: `${t('update.verifyFailed')} ${remaining}. ${t('update.verifyRestart')}`,
              },
            }));
          }
        }
      } catch { /* ignore recheck errors */ }
    }
  };

  const allUpgraded = updates.length > 0 && updates.every(u => upgradeResults[u.component]?.success === true);

  // Don't render if no updates or dismissed
  if (updates.length === 0 || dismissed) return null;

  return (
    <>
      {/* Weak reminder: top banner (visible when modal is closed) */}
      {!showModal && (
        <div className="bg-brand-600/10 border-b border-brand-600/20 px-4 py-1.5 flex items-center justify-between text-xs flex-shrink-0">
          <div className="flex items-center gap-2 text-brand-300">
            <Download size={12} />
            <span>
              {updates.length === 1
                ? `${updates[0].label} ${t('update.singleUpdate')} (${updates[0].latestVersion})`
                : `${updates.length} ${t('update.multipleUpdates')}`
              }
            </span>
            <button
              onClick={() => setShowModal(true)}
              className="text-brand-400 hover:text-brand-300 underline"
            >
              {t('update.viewDetails')}
            </button>
          </div>
          <button
            onClick={handleDismiss}
            className="text-slate-500 hover:text-slate-300 p-0.5"
            title={t('update.dismiss', 'Dismiss')}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Strong reminder: modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100] p-8">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md">
            <div className="p-6 space-y-4">
              <div className="text-center">
                <div className="text-3xl mb-3">🆕</div>
                <h2 className="text-lg font-bold">{t('update.available')}</h2>
              </div>

              <div className="space-y-2">
                {updates.map((u, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-slate-800 rounded-xl">
                    <div className="flex items-center gap-2">
                      {upgrading === u.component ? (
                        <Loader2 size={14} className="animate-spin text-brand-400" />
                      ) : upgradeResults[u.component]?.success === true ? (
                        <Check size={14} className="text-emerald-400" />
                      ) : upgradeResults[u.component]?.success === false ? (
                        <AlertCircle size={14} className="text-red-400" />
                      ) : (
                        <span className="inline-block w-3.5 h-3.5 rounded-full bg-slate-600" />
                      )}
                      <span className="text-sm">{u.label}</span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {u.currentVersion} <ArrowRight size={10} className="inline" /> <span className="text-brand-400">{u.latestVersion}</span>
                    </span>
                  </div>
                ))}
              </div>

              {/* Error messages */}
              {Object.entries(upgradeResults).filter(([, r]) => !r.success).map(([component, r]) => (
                <div key={component} className="p-3 bg-red-600/10 border border-red-600/20 rounded-xl text-xs text-red-400">
                  {t('update.failed')}: {r.error || 'Unknown error'}
                </div>
              ))}

              {/* Success message */}
              {allUpgraded && (
                <div className="p-3 bg-emerald-600/10 border border-emerald-600/20 rounded-xl text-xs text-emerald-400 text-center">
                  {t('update.allDone')}
                </div>
              )}

              <div className="flex flex-col gap-2">
                {allUpgraded ? (
                  <button
                    onClick={() => { setShowModal(false); handleDismiss(); }}
                    className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm font-medium transition-colors"
                  >
                    {t('common.done')}
                  </button>
                ) : (
                  <button
                    onClick={handleUpgrade}
                    disabled={!!upgrading}
                    className="w-full py-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
                  >
                    {upgrading ? (
                      <><Loader2 size={14} className="animate-spin" /> {t('update.upgrading')}</>
                    ) : (
                      <><Download size={14} /> {t('update.upgradeNow')}</>
                    )}
                  </button>
                )}
                {!allUpgraded && (
                  <>
                    <button
                      onClick={handleRemindLater}
                      disabled={!!upgrading}
                      className="w-full py-2 text-slate-400 hover:text-slate-200 text-sm transition-colors"
                    >
                      {t('update.remindLater')}
                    </button>
                    <button
                      onClick={handleNeverRemind}
                      disabled={!!upgrading}
                      className="w-full py-2 text-slate-700 hover:text-slate-500 text-xs transition-colors"
                      title={t('update.neverRemindTooltip', 'You can re-enable this in Settings')}
                    >
                      {t('update.neverRemind')}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
