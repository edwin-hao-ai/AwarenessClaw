import { Bot, Check, KeyRound, Link2, Loader2 } from 'lucide-react';
import PasswordInput from '../PasswordInput';
import { SettingsModalShell } from './SettingsPrimitives';

type Provider = {
  key: string;
  name: string;
  emoji: string;
  tag?: string;
  baseUrl?: string;
  needsKey?: boolean;
  models: Array<{ id: string; label: string }>;
};

export function SettingsModelPickerModal({
  t,
  open,
  providers,
  tempProvider,
  tempModel,
  tempApiKey,
  tempBaseUrl,
  selectedProvider,
  tempModelOptions,
  testingConnection,
  testResult,
  onClose,
  onSave,
  onProviderSelect,
  onModelSelect,
  onApiKeyChange,
  onBaseUrlChange,
  onDiscoverModels,
}: {
  t: (key: string, fallback?: string) => string;
  open: boolean;
  providers: Provider[];
  tempProvider: string;
  tempModel: string;
  tempApiKey: string;
  tempBaseUrl: string;
  selectedProvider?: Provider;
  tempModelOptions: Array<{ id: string; label: string }>;
  testingConnection: boolean;
  testResult: 'idle' | 'success' | 'error';
  onClose: () => void;
  onSave: () => void;
  onProviderSelect: (providerKey: string) => void;
  onModelSelect: (modelId: string) => void;
  onApiKeyChange: (value: string) => void;
  onBaseUrlChange: (value: string) => void;
  onDiscoverModels: () => void;
}) {
  if (!open) return null;

  return (
    <SettingsModalShell
      title={(
        <span className="flex items-center gap-2">
          <Bot size={18} className="text-brand-400" />
          {t('settings.model.change')}
        </span>
      )}
      onClose={onClose}
      footer={(
        <div className="flex justify-end gap-3 p-5">
          <button onClick={onClose} className="settings-btn settings-btn-secondary px-4 py-2 text-sm">
            {t('common.cancel')}
          </button>
          <button
            onClick={onSave}
            disabled={!tempProvider || (selectedProvider?.needsKey && !tempApiKey)}
            className="settings-btn settings-btn-primary px-5 py-2 disabled:bg-slate-700 disabled:text-slate-500 text-sm"
          >
            <Check size={14} /> {t('common.save')}
          </button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          {providers.map((provider) => (
            <button
              key={provider.key}
              onClick={() => onProviderSelect(provider.key)}
              className={`p-3 rounded-xl text-left transition-all border text-xs ${
                tempProvider === provider.key
                  ? 'settings-glass-soft border-brand-500/60 bg-brand-600/10'
                  : 'settings-glass-soft hover:border-slate-500/50'
              }`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span>{provider.emoji}</span>
                <span className="font-medium text-sm">{provider.name}</span>
              </div>
              <span className="text-slate-500">{provider.tag}</span>
            </button>
          ))}
        </div>

        {selectedProvider && (
          <div className="space-y-3 p-4 settings-glass-soft animate-fade-in">
            {selectedProvider.needsKey && (
              <div>
                <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-400">
                  <KeyRound size={12} className="text-slate-500" />
                  {t('settings.model.apiKey', 'API Key')}
                </label>
                <PasswordInput
                  value={tempApiKey}
                  onChange={(event) => onApiKeyChange(event.target.value)}
                  placeholder={t('common.pasteApiKey', 'Paste your API Key...')}
                  className="settings-input w-full px-3 py-2 text-sm"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">{t('settings.model.selectModel')}</label>
              <div className="flex gap-2 flex-wrap">
                {tempModelOptions.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => onModelSelect(model.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                      tempModel === model.id ? 'bg-brand-600 text-white' : 'settings-glass-soft text-slate-300 hover:border-slate-500/50'
                    }`}
                  >
                    {model.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">{t('settings.model.baseUrl', 'API Base URL')}</label>
              <input
                type="text"
                value={tempBaseUrl || selectedProvider.baseUrl}
                onChange={(event) => onBaseUrlChange(event.target.value)}
                className="settings-input w-full px-3 py-2 text-xs font-mono"
              />
              <p className="text-xs text-slate-600 mt-1">{t('settings.model.baseUrlHint')}</p>
            </div>

            {selectedProvider.needsKey && tempApiKey && (
              <div className="flex items-center gap-3 pt-2 border-t border-slate-700/50">
                <button
                  onClick={onDiscoverModels}
                  disabled={testingConnection}
                  className="settings-btn settings-btn-secondary"
                >
                  {testingConnection ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />} {t('settings.model.discoverModels', 'Test & Refresh Models')}
                </button>
                {testResult === 'success' && <span className="text-xs text-emerald-400">{t('settings.model.detectSuccess', 'Model list updated')}</span>}
                {testResult === 'error' && <span className="text-xs text-red-400">{t('settings.model.detectFailed', 'Could not fetch models, please check API Key / Base URL')}</span>}
              </div>
            )}
          </div>
        )}
      </div>
    </SettingsModalShell>
  );
}