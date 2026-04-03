import { Cloud, ExternalLink, Monitor, Moon, Sun, Trash2 } from 'lucide-react';
import { SettingsRow, SettingsSection, SettingsToggle } from './SettingsPrimitives';

type TFunction = (key: string, fallback?: string) => string;

export function SettingsMemoryPanel({
  t,
  config,
  cloudMode,
  onToggle,
  onRecallLimitChange,
  onSelectMode,
  onCloudDisconnect,
  onCloudConnect,
}: {
  t: TFunction;
  config: Record<string, any>;
  cloudMode: string;
  onToggle: (key: 'autoCapture' | 'autoRecall', value: boolean) => void;
  onRecallLimitChange: (value: number) => void;
  onSelectMode: (mode: 'local' | 'cloud') => void;
  onCloudDisconnect: () => void;
  onCloudConnect: () => void;
}) {
  return (
    <SettingsSection title={`🧠 ${t('settings.memory')}`}>
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
            onChange={(event) => onRecallLimitChange(parseInt(event.target.value))}
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
      {config.memoryMode === 'cloud' && (
        <SettingsRow label="" desc="">
          <div className="w-full">
            {cloudMode === 'hybrid' || cloudMode === 'cloud' ? (
              <div className="flex items-center justify-between">
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
          </div>
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

export function SettingsMemoryPrivacyPanel({
  t,
  blockedSources,
  onToggleSource,
  onClearAll,
}: {
  t: TFunction;
  blockedSources: string[];
  onToggleSource: (id: string, nextAllowed: boolean) => void;
  onClearAll: () => void;
}) {
  return (
    <SettingsSection title={`🔒 ${t('settings.privacy', 'Memory Privacy')}`}>
      <div className="p-4 space-y-3">
        <p className="text-xs text-slate-500">{t('settings.privacy.desc', 'Choose which sources are allowed to save conversations to memory.')}</p>
        {[
          { id: 'desktop', label: t('settings.privacy.desktop', 'Desktop Chat'), emoji: '💬' },
          { id: 'openclaw-telegram', label: 'Telegram', emoji: '✈️' },
          { id: 'openclaw-whatsapp', label: 'WhatsApp', emoji: '📱' },
          { id: 'openclaw-discord', label: 'Discord', emoji: '🎮' },
          { id: 'openclaw-slack', label: 'Slack', emoji: '💼' },
          { id: 'openclaw-wechat', label: 'WeChat', emoji: '💚' },
          { id: 'mcp', label: t('settings.privacy.devTools', 'Dev Tools (Claude Code / IDE)'), emoji: '🛠️' },
        ].map(({ id, label, emoji }) => {
          const isAllowed = !blockedSources.includes(id);
          return (
            <div key={id} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-2 text-sm">
                <span>{emoji}</span>
                <span className="text-slate-300">{label}</span>
              </div>
              <SettingsToggle checked={isAllowed} onChange={(value) => onToggleSource(id, value)} />
            </div>
          );
        })}
      </div>
      <div className="px-4 pb-4">
        <button onClick={onClearAll} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-600/10 rounded-lg transition-colors">
          <Trash2 size={12} />
          {t('settings.privacy.clearAll', 'Delete All Knowledge Cards')}
        </button>
      </div>
    </SettingsSection>
  );
}

export function SettingsTokenPanel({
  t,
  thinkingLevel,
  reasoningDisplay,
  recallLimit,
  autoRecall,
  onThinkingLevelChange,
  onReasoningDisplayChange,
  onRecallLimitChange,
}: {
  t: TFunction;
  thinkingLevel: string;
  reasoningDisplay: string;
  recallLimit: number;
  autoRecall: boolean;
  onThinkingLevelChange: (value: string) => void;
  onReasoningDisplayChange: (value: string) => void;
  onRecallLimitChange: (value: number) => void;
}) {
  const thinkingTokens = { off: 0, minimal: 100, low: 300, medium: 800, high: 2000 }[thinkingLevel || 'low'] || 300;
  const recallTokens = autoRecall ? recallLimit * 200 : 0;

  return (
    <SettingsSection title={`💰 ${t('settings.token')}`}>
      <SettingsRow label={t('settings.token.thinkingLevel')} desc={t('settings.token.thinkingLevel.desc')}>
        <select
          value={thinkingLevel || 'low'}
          onChange={(event) => onThinkingLevelChange(event.target.value)}
          className="px-3 py-1.5 bg-slate-700 rounded-lg text-sm border-none focus:outline-none focus:ring-2 focus:ring-brand-500/50"
        >
          <option value="off">{t('settings.token.thinkingOff')}</option>
          <option value="minimal">{t('settings.token.thinkingMinimal')}</option>
          <option value="low">{t('settings.token.thinkingLow')}</option>
          <option value="medium">{t('settings.token.thinkingMedium')}</option>
          <option value="high">{t('settings.token.thinkingHigh')}</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('settings.token.reasoningDisplay')} desc={t('settings.token.reasoningDisplay.desc')}>
        <select
          value={reasoningDisplay || 'on'}
          onChange={(event) => onReasoningDisplayChange(event.target.value)}
          className="px-3 py-1.5 bg-slate-700 rounded-lg text-sm border-none focus:outline-none focus:ring-2 focus:ring-brand-500/50"
        >
          <option value="off">{t('settings.token.reasoningOff')}</option>
          <option value="on">{t('settings.token.reasoningOn')}</option>
          <option value="stream">{t('settings.token.reasoningStream')}</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('settings.token.recallLimit')} desc={t('settings.token.recallLimit.desc')}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={20}
            value={recallLimit}
            onChange={(event) => onRecallLimitChange(parseInt(event.target.value))}
            className="w-24 accent-brand-500"
          />
          <span className="text-sm text-slate-300 w-6 text-right">{recallLimit}</span>
        </div>
      </SettingsRow>
      <SettingsRow label={t('settings.token.estimate')} desc={t('settings.token.estimate.desc')}>
        <span className="text-xs text-slate-400 font-mono">
          ~{((recallTokens + thinkingTokens + 500) / 1000).toFixed(1)}k {t('settings.token.overhead')}
        </span>
      </SettingsRow>
    </SettingsSection>
  );
}

export function SettingsAppearancePanel({
  t,
  language,
  theme,
  onLanguageChange,
  onThemeChange,
}: {
  t: TFunction;
  language: string;
  theme: 'light' | 'dark' | 'system';
  onLanguageChange: (value: string) => void;
  onThemeChange: (value: 'light' | 'dark' | 'system') => void;
}) {
  return (
    <SettingsSection title={`🎨 ${t('settings.appearance')}`}>
      <SettingsRow label={t('settings.language')}>
        <select
          value={language}
          onChange={(event) => onLanguageChange(event.target.value)}
          className="px-3 py-1.5 bg-slate-700 rounded-lg text-sm border-none focus:outline-none focus:ring-2 focus:ring-brand-500/50"
        >
          <option value="zh">🇨🇳 中文</option>
          <option value="en">🇺🇸 English</option>
          <option value="ja">🇯🇵 日本語</option>
          <option value="ko">🇰🇷 한국어</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('settings.theme')}>
        <div className="flex bg-slate-700 rounded-lg overflow-hidden">
          {([
            { key: 'light' as const, icon: Sun, labelKey: 'settings.theme.light' },
            { key: 'dark' as const, icon: Moon, labelKey: 'settings.theme.dark' },
            { key: 'system' as const, icon: Monitor, labelKey: 'settings.theme.system' },
          ]).map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              onClick={() => onThemeChange(key)}
              className={`px-3 py-1.5 text-xs flex items-center gap-1 ${theme === key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              <Icon size={12} /> {t(labelKey)}
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}