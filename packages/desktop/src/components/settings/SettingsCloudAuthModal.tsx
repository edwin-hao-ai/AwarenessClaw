import { Brain, CheckCircle, Cloud, CloudOff, ExternalLink, Loader2 } from 'lucide-react';
import { SettingsModalShell } from './SettingsPrimitives';

type CloudMemory = { id: string; name: string };

export function SettingsCloudAuthModal({
  t,
  open,
  step,
  userCode,
  verifyUrl,
  memories,
  onClose,
  onOpenBrowser,
  browserOpening,
  onRefreshCode,
  onSelectMemory,
  onRetry,
}: {
  t: (key: string, fallback?: string) => string;
  open: boolean;
  step: 'init' | 'loading' | 'waiting' | 'select' | 'done' | 'error';
  userCode: string;
  verifyUrl: string;
  memories: CloudMemory[];
  onClose: () => void;
  onOpenBrowser: () => void;
  browserOpening: boolean;
  onRefreshCode: () => void;
  onSelectMemory: (memoryId: string) => void;
  onRetry: () => void;
}) {
  if (!open) return null;

  return (
    <SettingsModalShell
      title={(
        <span className="flex items-center gap-2">
          <Cloud size={20} className="text-brand-400" />
          {t('settings.memory.cloud.authTitle')}
        </span>
      )}
      onClose={onClose}
      maxWidthClass="max-w-md"
      zIndexClass="z-[60]"
      paddingClass="p-6"
    >
      {(step === 'init' || step === 'loading') && (
        <div className="space-y-4 text-center py-4">
          <Loader2 size={28} className="animate-spin text-brand-400 mx-auto" />
          <p className="text-sm text-slate-400">{t('settings.memory.cloud.connecting')}</p>
        </div>
      )}

      {step === 'waiting' && (
        <div className="space-y-4 text-center">
          <p className="text-sm text-slate-400">{t('settings.memory.cloud.authDesc')}</p>
          <div className="settings-glass-soft p-4">
            <p className="text-xs text-slate-500 mb-1">{t('settings.memory.cloud.code')}</p>
            <p className="text-2xl font-mono font-bold text-brand-400 tracking-widest">{userCode}</p>
          </div>
          <button
            onClick={onOpenBrowser}
            disabled={browserOpening}
            className="settings-btn settings-btn-primary w-full py-2 disabled:bg-slate-700 disabled:text-slate-400 text-sm"
          >
            {browserOpening ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />} {t('settings.memory.cloud.openBrowser')}
          </button>
          <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
            <Loader2 size={12} className="animate-spin" /> {t('settings.memory.cloud.waiting')}
          </div>
          <button onClick={onRefreshCode} className="settings-btn settings-btn-secondary text-xs px-2.5 py-1.5">
            {t('settings.memory.cloud.refreshCode', 'Code expired? Get a new one')}
          </button>
        </div>
      )}

      {step === 'select' && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">{t('settings.memory.cloud.selectMemory')}</p>
          {memories.map((memory) => (
            <button
              key={memory.id}
              onClick={() => onSelectMemory(memory.id)}
              className="w-full flex items-center gap-3 p-3 settings-glass-soft text-left transition-colors hover:border-slate-500/50"
            >
              <Brain size={16} className="text-brand-400" />
              <div>
                <p className="text-sm text-slate-200">{memory.name || memory.id}</p>
                <p className="text-[10px] text-slate-500 font-mono">{memory.id.slice(0, 8)}...</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {step === 'done' && (
        <div className="text-center space-y-3 py-4">
          <CheckCircle size={40} className="mx-auto text-emerald-400" />
          <p className="text-sm text-emerald-400">{t('settings.memory.cloud.success')}</p>
          <button onClick={onClose} className="settings-btn settings-btn-primary px-6 py-2 text-sm">
            OK
          </button>
        </div>
      )}

      {step === 'error' && (
        <div className="text-center space-y-3 py-4">
          <CloudOff size={40} className="mx-auto text-red-400" />
          <p className="text-sm text-red-400">{t('settings.memory.cloud.failed')}</p>
          <button onClick={onRetry} className="settings-btn settings-btn-secondary px-6 py-2 text-sm">
            {t('common.retry', 'Retry')}
          </button>
        </div>
      )}
    </SettingsModalShell>
  );
}