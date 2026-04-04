import { Coins, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { SettingsRow, SettingsSection, SettingsToggle } from './SettingsPrimitives';

type TFunction = (key: string, fallback?: string) => string;

export function SettingsTokenPanel({
  t,
  thinkingLevel,
  reasoningDisplay,
  onThinkingLevelChange,
  onReasoningDisplayChange,
}: {
  t: TFunction;
  thinkingLevel: string;
  reasoningDisplay: string;
  onThinkingLevelChange: (value: string) => void;
  onReasoningDisplayChange: (value: string) => void;
}) {
  const thinkingTokens = { off: 0, minimal: 100, low: 300, medium: 800, high: 2000 }[thinkingLevel || 'low'] || 300;

  return (
    <SettingsSection title={(
      <span className="inline-flex items-center gap-2">
        <Coins size={15} className="text-amber-300" />
        {t('settings.token')}
      </span>
    )}>
      <SettingsRow label={t('settings.token.thinkingLevel')} desc={t('settings.token.thinkingLevel.desc')}>
        <select
          value={thinkingLevel || 'low'}
          onChange={(event) => onThinkingLevelChange(event.target.value)}
          className="settings-select text-sm"
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
          className="settings-select text-sm"
        >
          <option value="off">{t('settings.token.reasoningOff')}</option>
          <option value="on">{t('settings.token.reasoningOn')}</option>
          <option value="stream">{t('settings.token.reasoningStream')}</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('settings.token.estimate')} desc={t('settings.token.estimate.desc')}>
        <span className="settings-mono-badge">
          ~{((thinkingTokens + 500) / 1000).toFixed(1)}k {t('settings.token.overhead')}
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
    <SettingsSection title={(
      <span className="inline-flex items-center gap-2">
        <Palette size={15} className="text-pink-300" />
        {t('settings.appearance')}
      </span>
    )}>
      <SettingsRow label={t('settings.language')}>
        <select
          value={language}
          onChange={(event) => onLanguageChange(event.target.value)}
          className="settings-select text-sm"
        >
          <option value="zh">中文</option>
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="ko">한국어</option>
        </select>
      </SettingsRow>
      <SettingsRow label={t('settings.theme')}>
        <div className="settings-pill-group">
          {([
            { key: 'light' as const, icon: Sun, labelKey: 'settings.theme.light' },
            { key: 'dark' as const, icon: Moon, labelKey: 'settings.theme.dark' },
            { key: 'system' as const, icon: Monitor, labelKey: 'settings.theme.system' },
          ]).map(({ key, icon: Icon, labelKey }) => (
            <button
              key={key}
              onClick={() => onThemeChange(key)}
              className={`settings-pill-button flex items-center gap-1 ${theme === key ? 'is-active' : ''}`}
            >
              <Icon size={12} /> {t(labelKey)}
            </button>
          ))}
        </div>
      </SettingsRow>
    </SettingsSection>
  );
}