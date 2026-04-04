import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import PasswordInput from './PasswordInput';
import type { DynamicConfigSection } from '../lib/openclaw-capabilities';
import { useI18n } from '../lib/i18n';

const DYNAMIC_TEXT_KEYS: Record<string, string> = {
  'Web Search': 'settings.web.dynamic.search.title',
  'Most users only need to pick a search provider and add a credential if that provider requires one.': 'settings.web.dynamic.search.desc',
  'Page Fetch': 'settings.web.dynamic.fetch.title',
  'Leave this alone unless you need to tune how OpenClaw reads webpages.': 'settings.web.dynamic.fetch.desc',
  'Enable web search': 'settings.web.dynamic.enableSearch',
  'Search provider': 'settings.web.dynamic.searchProvider',
  'Choose the provider OpenClaw uses for web search.': 'settings.web.dynamic.searchProviderDesc',
  'API key': 'settings.web.dynamic.apiKey',
  'Used for providers that require an API key, such as Brave or Perplexity.': 'settings.web.dynamic.apiKeyDesc',
  'Max results': 'settings.web.dynamic.maxResults',
  'Timeout (seconds)': 'settings.web.dynamic.timeoutSeconds',
  'Cache TTL (minutes)': 'settings.web.dynamic.cacheTtlMinutes',
  'Enable fetch tool': 'settings.web.dynamic.enableFetch',
  'Max characters': 'settings.web.dynamic.maxChars',
  'Hard cap characters': 'settings.web.dynamic.maxCharsCap',
  'Max response bytes': 'settings.web.dynamic.maxResponseBytes',
  'Max redirects': 'settings.web.dynamic.maxRedirects',
  'User agent': 'settings.web.dynamic.userAgent',
  'Enable readability cleanup': 'settings.web.dynamic.enableReadability',
  'Enable Firecrawl fallback': 'settings.web.dynamic.enableFirecrawl',
  'Firecrawl API key': 'settings.web.dynamic.firecrawlApiKey',
  'Enable OpenAI Codex mode': 'settings.web.dynamic.enableCodexMode',
  'OpenAI Codex mode': 'settings.web.dynamic.codexMode',
  'Context size': 'settings.web.dynamic.contextSize',
};

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      type="button"
      title={label}
      aria-label={label}
      className={`w-11 h-6 rounded-full transition-colors relative ${checked ? 'bg-brand-600' : 'bg-slate-700'}`}
    >
      <div
        className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform"
        style={{ transform: checked ? 'translateX(21px)' : 'translateX(1px)' }}
      />
    </button>
  );
}

export default function OpenClawConfigSectionForm({
  sections,
  values,
  onChange,
}: {
  sections: DynamicConfigSection[];
  values: Record<string, any>;
  onChange: (path: string, nextValue: any) => void;
}) {
  const { t } = useI18n();
  const inputClass = 'w-full px-3 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500 transition-colors';
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(sections.map((section) => [section.key, Boolean(section.defaultExpanded)])),
  );

  const translateDynamicText = (text?: string) => {
    if (!text) return '';
    const key = DYNAMIC_TEXT_KEYS[text];
    return key ? t(key, text) : t(text, text);
  };

  const formatSettingValue = (value: unknown) => {
    if (value === true) return t('common.on', 'on');
    if (value === false) return t('common.off', 'off');
    return translateDynamicText(String(value));
  };

  const getSummary = (section: DynamicConfigSection) => {
    if (section.key === 'search') {
      const provider = values?.['tools.web.search.provider'];
      const enabled = values?.['tools.web.search.enabled'];
      const apiKey = values?.['tools.web.search.apiKey'];
      return [
        enabled === false ? t('settings.config.summary.disabled', 'disabled') : t('settings.config.summary.enabled', 'enabled'),
        provider
          ? t('settings.config.summary.provider', 'provider: {0}').replace('{0}', provider)
          : t('settings.config.summary.providerDefault', 'provider: default'),
        apiKey
          ? t('settings.config.summary.credentialSet', 'credential set')
          : t('settings.config.summary.defaultCredentialSource', 'using default credential source'),
      ].join(' · ');
    }

    if (section.key === 'fetch') {
      const enabled = values?.['tools.web.fetch.enabled'];
      const customized = section.fields.filter((field) => values?.[field.path] !== undefined && values?.[field.path] !== '').length;
      return [
        enabled === false ? t('settings.config.summary.disabled', 'disabled') : t('settings.config.summary.enabled', 'enabled'),
        customized > 0
          ? t('settings.config.summary.customValues', '{0} custom values').replace('{0}', String(customized))
          : t('settings.config.summary.allDefaults', 'all defaults'),
        t('settings.config.summary.noActionNeeded', 'usually no action needed'),
      ].join(' · ');
    }

    return t('settings.config.summary.usesDefaults', 'Uses OpenClaw defaults unless overridden below');
  };

  return (
    <div className="space-y-4">
      {sections.map((section) => {
        let lastGroup: string | undefined;
        const primaryFields = section.fields.filter((field) => field.prominence !== 'advanced');
        const advancedFields = section.fields.filter((field) => field.prominence === 'advanced');
        const visibleFields = expandedSections[section.key] ? section.fields : primaryFields;
        const showAdvancedToggle = advancedFields.length > 0;
        const isExpanded = expandedSections[section.key];

        return (
          <div key={section.key} className="rounded-xl border border-slate-700/50 bg-slate-800/40">
            <div className="px-4 py-3 border-b border-slate-700/50 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-100">{translateDynamicText(section.title)}</div>
                  {section.description && <div className="text-xs text-slate-500 mt-1">{translateDynamicText(section.description)}</div>}
                </div>
                {showAdvancedToggle && (
                  <button
                    onClick={() => setExpandedSections((prev) => ({ ...prev, [section.key]: !prev[section.key] }))}
                    className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors whitespace-nowrap"
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {isExpanded
                      ? t('settings.config.hideAdvanced', 'Hide advanced')
                      : t('settings.config.showAdvanced', 'Show advanced ({0})').replace('{0}', String(advancedFields.length))}
                  </button>
                )}
              </div>
              <div className="text-[11px] text-slate-500">{getSummary(section)}</div>
            </div>

            <div className="divide-y divide-slate-700/50">
              {!isExpanded && visibleFields.length === 0 ? (
                <div className="px-4 py-3 text-xs text-slate-500">
                  {t('settings.config.advancedHiddenHint', 'Hidden by default to keep this page short. Open advanced only if you need to fine-tune this behavior.')}
                </div>
              ) : null}
              {visibleFields.map((field) => {
                const currentValue = values?.[field.path];
                const showGroup = field.group && field.group !== lastGroup;
                lastGroup = field.group;
                const defaultLabel = field.defaultValue !== undefined ? formatSettingValue(field.defaultValue) : t('settings.config.defaultLabel', 'OpenClaw default');

                return (
                  <div key={field.key} className="px-4 py-3 space-y-2">
                    {showGroup && <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{translateDynamicText(field.group)}</div>}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="text-sm font-medium text-slate-100">{translateDynamicText(field.label)}</div>
                        {field.description && <div className="text-xs text-slate-500 mt-1">{translateDynamicText(field.description)}</div>}
                      </div>
                      <div className="w-[220px] max-w-full">
                        {field.type === 'boolean' ? (
                          <div className="flex justify-end">
                            <Toggle checked={Boolean(currentValue)} onChange={(nextValue) => onChange(field.path, nextValue)} label={translateDynamicText(field.label)} />
                          </div>
                        ) : field.type === 'select' ? (
                          <select
                            value={typeof currentValue === 'string' ? currentValue : ''}
                            onChange={(event) => onChange(field.path, event.target.value)}
                            aria-label={translateDynamicText(field.label)}
                            className={inputClass}
                          >
                            <option value="">{t('settings.config.useDefaultOption', 'Use default ({0})').replace('{0}', defaultLabel)}</option>
                            {(field.options || []).map((option) => (
                              <option key={option.value} value={option.value}>{translateDynamicText(option.label)}</option>
                            ))}
                          </select>
                        ) : field.type === 'number' ? (
                          <input
                            type="number"
                            value={typeof currentValue === 'number' ? String(currentValue) : ''}
                            placeholder={defaultLabel}
                            min={field.min}
                            max={field.max}
                            step={field.step}
                            onChange={(event) => {
                              const nextValue = event.target.value;
                              onChange(field.path, nextValue === '' ? undefined : Number(nextValue));
                            }}
                            className={inputClass}
                          />
                        ) : field.type === 'password' ? (
                          <PasswordInput
                            value={typeof currentValue === 'string' ? currentValue : ''}
                            onChange={(event) => onChange(field.path, event.target.value)}
                            placeholder={field.defaultValue !== undefined
                              ? t('settings.config.useDefaultOption', 'Use default ({0})').replace('{0}', defaultLabel)
                              : t('settings.config.useDefaultSecretSource', 'Use default secret source')}
                            className={inputClass}
                          />
                        ) : (
                          <input
                            type="text"
                            value={typeof currentValue === 'string' ? currentValue : ''}
                            placeholder={field.defaultValue !== undefined
                              ? t('settings.config.useDefaultOption', 'Use default ({0})').replace('{0}', defaultLabel)
                              : t('settings.config.useOpenClawDefault', 'Use OpenClaw default')}
                            onChange={(event) => onChange(field.path, event.target.value)}
                            className={inputClass}
                          />
                        )}
                        {currentValue === undefined || currentValue === '' ? (
                          <div className="mt-1 text-[10px] text-slate-600">{t('settings.config.defaultInEffect', 'Default in effect: {0}').replace('{0}', defaultLabel)}</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}