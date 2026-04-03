import { Cloud, ExternalLink, Shield, SlidersHorizontal, Trash2 } from 'lucide-react';
import { SettingsRow, SettingsSection, SettingsToggle } from '../settings/SettingsPrimitives';

type TFunction = (key: string, fallback?: string) => string;

export function MemorySettingsPanel({
  t,
  config,
  cloudMode,
  onToggle,
  onRecallLimitChange,
  onSelectMode,
  onCloudConnect,
  onCloudDisconnect,
  onToggleSource,
  onClearAll,
}: {
  t: TFunction;
  config: Record<string, any>;
  cloudMode: string;
  onToggle: (key: 'autoCapture' | 'autoRecall', value: boolean) => void;
  onRecallLimitChange: (value: number) => void;
  onSelectMode: (mode: 'local' | 'cloud') => void;
  onCloudConnect: () => void;
  onCloudDisconnect: () => void;
  onToggleSource: (id: string, nextAllowed: boolean) => void;
  onClearAll: () => void;
}) {
  const sourceItems = [
    { id: 'desktop', label: t('settings.privacy.desktop', 'Desktop Chat'), emoji: '💬' },
    { id: 'openclaw-telegram', label: 'Telegram', emoji: '✈️' },
    { id: 'openclaw-whatsapp', label: 'WhatsApp', emoji: '📱' },
    { id: 'openclaw-discord', label: 'Discord', emoji: '🎮' },
    { id: 'openclaw-slack', label: 'Slack', emoji: '💼' },
    { id: 'openclaw-wechat', label: 'WeChat', emoji: '💚' },
    { id: 'mcp', label: t('settings.privacy.devTools', 'Dev Tools (Claude Code / IDE)'), emoji: '🛠️' },
  ];

  return (
    <div className="space-y-3 mb-4">
      <SettingsSection title={`${t('memory.settings.title', 'Memory Settings')}`}>

        <SettingsRow label={t('settings.memory.autoCapture')} desc={t('settings.memory.autoCapture.desc')}>
          <SettingsToggle checked={config.autoCapture} onChange={(value) => onToggle('autoCapture', value)} />
        </SettingsRow>

        <SettingsRow label={t('settings.memory.autoRecall')} desc={t('settings.memory.autoRecall.desc')}>
          <SettingsToggle checked={config.autoRecall} onChange={(value) => onToggle('autoRecall', value)} />
        </SettingsRow>

        <SettingsRow label={t('settings.memory.recallCount')} desc={t('settings.memory.recallCount.desc')}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={20}
              value={config.recallLimit}
              onChange={(event) => onRecallLimitChange(parseInt(event.target.value, 10))}
              className="w-24 accent-brand-500"
            />
            <span className="text-sm text-slate-300 w-6 text-right">{config.recallLimit}</span>
          </div>
        </SettingsRow>

        <SettingsRow label={t('settings.memory.storage')} desc={t('settings.memory.storage.desc')}>
          <div className="flex bg-slate-700 rounded-lg overflow-hidden">
            {(['local', 'cloud'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => onSelectMode(mode)}
                className={`px-3 py-1.5 text-xs transition-colors ${config.memoryMode === mode ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {t(`settings.memory.${mode}`)}
              </button>
            ))}
          </div>
        </SettingsRow>

        <SettingsRow
          label={t('memory.settings.cloudStatus', 'Cloud Sync')}
          desc={t('memory.settings.cloudStatus.desc', 'Connect Awareness Cloud without leaving the Memory page.')}
        >
          {cloudMode === 'hybrid' || cloudMode === 'cloud' ? (
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                <Cloud size={14} /> {t('settings.memory.cloud.connected')}
              </span>
              <button
                onClick={onCloudDisconnect}
                className="text-xs text-red-400/70 hover:text-red-400 px-2 py-1 rounded hover:bg-red-600/10 transition-colors"
              >
                {t('settings.memory.cloud.disconnect')}
              </button>
            </div>
          ) : (
            <button
              onClick={onCloudConnect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors"
            >
              <ExternalLink size={12} /> {t('settings.memory.cloud.connect')}
            </button>
          )}
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title={`${t('settings.privacy', 'Memory Privacy')}`}>
        <div className="px-4 pb-3 text-xs text-slate-500">
          {t('settings.privacy.desc', 'Choose which sources are allowed to save conversations to memory.')}
        </div>

        {sourceItems.map(({ id, label, emoji }) => {
          const isAllowed = !(config.memoryBlockedSources || []).includes(id);
          return (
            <SettingsRow key={id} label={`${emoji} ${label}`}>
              <SettingsToggle checked={isAllowed} onChange={(value) => onToggleSource(id, value)} />
            </SettingsRow>
          );
        })}

        <div className="p-4">
          <button
            onClick={onClearAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-600/10 rounded-lg transition-colors"
          >
            <Trash2 size={12} />
            {t('settings.privacy.clearAll', 'Delete All Knowledge Cards')}
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}