import { useEffect, useMemo, useState } from 'react';
import { Check, Database, Loader2, Plus, RefreshCw, Sparkles, X } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import { SettingsModalShell, SettingsSection } from '../components/settings/SettingsPrimitives';
import { useI18n } from '../lib/i18n';
import {
  getProviderProfile,
  useAppConfig,
  useDynamicProviders,
  type ModelProviderDef,
  type ProviderStoredModel,
} from '../lib/store';

type EditableModel = {
  id: string;
  label: string;
  source: 'catalog' | 'detected' | 'custom';
};

const DEFAULT_API_TYPE = 'openai-completions';
const CUSTOM_API_TYPE = '__custom__';
const NON_CHAT_MODEL_PATTERN = /(embed|embedding|rerank|whisper|tts|speech|transcri|moderat|omni-moderation|dall|image|vision-preview|audio)/i;

function isKnownApiType(value: string, providers: ModelProviderDef[]): boolean {
  const normalized = value.trim();
  if (!normalized) return true;
  if (normalized === DEFAULT_API_TYPE || normalized === 'anthropic') return true;
  return providers.some((provider) => provider.apiType?.trim() === normalized);
}

function mergeModels(...groups: Array<EditableModel[] | undefined>): EditableModel[] {
  const merged = new Map<string, EditableModel>();
  for (const group of groups) {
    for (const model of group || []) {
      const normalizedId = model.id.trim();
      if (!normalizedId) continue;
      if (!merged.has(normalizedId)) {
        merged.set(normalizedId, { ...model, id: normalizedId, label: model.label.trim() || normalizedId });
        continue;
      }
      const existing = merged.get(normalizedId)!;
      merged.set(normalizedId, {
        ...existing,
        label: existing.label || model.label || normalizedId,
        source: existing.source === 'custom' ? existing.source : model.source,
      });
    }
  }
  return Array.from(merged.values());
}

function tokenizeModelId(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

function buildProviderAffinityTokens(provider: ModelProviderDef, models: EditableModel[]): Set<string> {
  const tokens = new Set<string>();

  for (const token of tokenizeModelId(provider.key)) {
    tokens.add(token);
  }

  for (const model of provider.models) {
    for (const token of tokenizeModelId(model.id)) {
      tokens.add(token);
    }
  }

  for (const model of models) {
    for (const token of tokenizeModelId(model.id)) {
      tokens.add(token);
    }
  }

  return tokens;
}

function filterRelevantDiscoveredModels(provider: ModelProviderDef | undefined, currentModels: EditableModel[], discoveredModels: EditableModel[]): EditableModel[] {
  const chatLikeModels = discoveredModels.filter((model) => !NON_CHAT_MODEL_PATTERN.test(`${model.id} ${model.label}`));
  if (!provider) {
    return chatLikeModels;
  }

  const affinityTokens = buildProviderAffinityTokens(provider, currentModels);
  const affinityMatches = chatLikeModels.filter((model) => {
    const haystack = `${model.id} ${model.label}`.toLowerCase();
    for (const token of affinityTokens) {
      if (haystack.includes(token)) {
        return true;
      }
    }
    return false;
  });

  if (affinityMatches.length > 0) {
    return affinityMatches;
  }

  return chatLikeModels;
}

function toStoredModels(models: EditableModel[]): ProviderStoredModel[] {
  return models.map((model) => ({ id: model.id, label: model.label, name: model.label }));
}

function slugifyProviderKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildProviderDraft(provider: ModelProviderDef, config: ReturnType<typeof useAppConfig>['config']) {
  const profile = getProviderProfile(config, provider.key);
  const mergedModels = mergeModels(
    provider.models.map((model) => ({ id: model.id, label: model.label, source: 'catalog' as const })),
    profile.models.map((model) => ({
      id: model.id,
      label: model.label || model.name || model.id,
      source: 'custom' as const,
    })),
  );

  return {
    providerKey: provider.key,
    providerName: profile.name || provider.name,
    baseUrl: profile.baseUrl || provider.baseUrl || '',
    apiType: profile.apiType || provider.apiType || DEFAULT_API_TYPE,
    needsKey: typeof profile.needsKey === 'boolean' ? profile.needsKey : provider.needsKey,
    apiKey: profile.apiKey || '',
    models: mergedModels,
    selectedModelId: provider.key === config.providerKey
      ? config.modelId
      : profile.models[0]?.id || provider.models[0]?.id || mergedModels[0]?.id || '',
  };
}

export default function Models() {
  const { t } = useI18n();
  const { config, saveProviderConfig, syncConfig } = useAppConfig();
  const { providers: allProviders, loading } = useDynamicProviders();

  const [editingProviderKey, setEditingProviderKey] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [providerKeyInput, setProviderKeyInput] = useState('');
  const [providerName, setProviderName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiType, setApiType] = useState(DEFAULT_API_TYPE);
  const [needsKey, setNeedsKey] = useState(true);
  const [apiKey, setApiKey] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [models, setModels] = useState<EditableModel[]>([]);
  const [customModelInput, setCustomModelInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverState, setDiscoverState] = useState<'idle' | 'success' | 'error'>('idle');
  const [savedState, setSavedState] = useState<'idle' | 'done'>('idle');

  const activeProvider = allProviders.find((provider) => provider.key === config.providerKey);
  const activeModel = activeProvider?.models.find((model) => model.id === config.modelId);
  const editingProvider = allProviders.find((provider) => provider.key === editingProviderKey);
  const effectiveProviderKey = customMode ? slugifyProviderKey(providerKeyInput || providerName) : editingProviderKey || '';
  const modalOpen = customMode || !!editingProviderKey;
  const apiTypeOptions = useMemo(() => {
    const values = new Set<string>();
    values.add(DEFAULT_API_TYPE);

    for (const provider of allProviders) {
      if (provider.apiType?.trim()) {
        values.add(provider.apiType.trim());
      }
      if (provider.key === 'anthropic') {
        values.add('anthropic');
      }
    }

    if (effectiveProviderKey === 'anthropic') {
      values.add('anthropic');
    }

    return Array.from(values).map((value) => {
      if (value === DEFAULT_API_TYPE) {
        return {
          value,
          label: t('models.apiTypeOption.openai', 'OpenAI compatible'),
          hint: t('models.apiTypeOption.openaiHint', 'Best for OpenAI-style endpoints such as OpenAI, DeepSeek, Ollama, Groq, and most proxy services.'),
        };
      }

      if (value === 'anthropic') {
        return {
          value,
          label: t('models.apiTypeOption.anthropic', 'Anthropic native'),
          hint: t('models.apiTypeOption.anthropicHint', 'Uses Anthropic-style request and header conventions.'),
        };
      }

      return { value, label: value, hint: '' };
    });
  }, [allProviders, effectiveProviderKey, t]);
  const selectedApiTypeOption = isKnownApiType(apiType, allProviders)
    ? apiType.trim()
    : CUSTOM_API_TYPE;
  const selectedApiTypeMeta = apiTypeOptions.find((option) => option.value === apiType.trim()) || null;

  useEffect(() => {
    if (customMode || !editingProviderKey) return;
    const provider = allProviders.find((item) => item.key === editingProviderKey);
    if (!provider) return;
    const draft = buildProviderDraft(provider, config);
    setProviderKeyInput(draft.providerKey);
    setProviderName(draft.providerName);
    setBaseUrl(draft.baseUrl);
    setApiType(draft.apiType);
    setNeedsKey(draft.needsKey);
    setApiKey(draft.apiKey);
    setModels(draft.models);
    setSelectedModelId(draft.selectedModelId);
    setShowAdvanced(!isKnownApiType(draft.apiType, allProviders));
    setCustomModelInput('');
    setDiscoverState('idle');
  }, [allProviders, config, customMode, editingProviderKey]);

  const beginCustomProvider = () => {
    setCustomMode(true);
    setEditingProviderKey(null);
    setProviderKeyInput('');
    setProviderName('');
    setBaseUrl('');
    setApiType(DEFAULT_API_TYPE);
    setNeedsKey(true);
    setApiKey('');
    setModels([]);
    setSelectedModelId('');
    setShowAdvanced(false);
    setCustomModelInput('');
    setDiscoverState('idle');
    setSavedState('idle');
  };

  const openProviderModal = (providerKey: string) => {
    setCustomMode(false);
    setEditingProviderKey(providerKey);
    setSavedState('idle');
    setDiscoverState('idle');
  };

  const closeModal = () => {
    setCustomMode(false);
    setEditingProviderKey(null);
    setCustomModelInput('');
    setDiscoverState('idle');
  };

  const addCustomModel = () => {
    const normalizedId = customModelInput.trim();
    if (!normalizedId) return;
    const nextModels = mergeModels(models, [{ id: normalizedId, label: normalizedId, source: 'custom' }]);
    setModels(nextModels);
    setSelectedModelId((current) => current || normalizedId);
    setCustomModelInput('');
    setDiscoverState('idle');
  };

  const removeModel = (modelId: string) => {
    const nextModels = models.filter((model) => model.id !== modelId);
    setModels(nextModels);
    if (selectedModelId === modelId) {
      setSelectedModelId(nextModels[0]?.id || '');
    }
    setDiscoverState('idle');
  };

  const discoverModels = async () => {
    const api = window.electronAPI as any;
    if (!api?.modelsDiscover || !baseUrl || !effectiveProviderKey) return;

    setDiscovering(true);
    setDiscoverState('idle');
    try {
      const result = await api.modelsDiscover({
        providerKey: effectiveProviderKey,
        baseUrl,
        apiKey,
      });

      if (result?.success && Array.isArray(result.models) && result.models.length > 0) {
        const detectedModels = result.models.map((model: any) => ({
          id: String(model.id || '').trim(),
          label: String(model.name || model.id || '').trim(),
          source: 'detected' as const,
        }));
        const relevantDetectedModels = filterRelevantDiscoveredModels(editingProvider, models, detectedModels);
        const customModels = models.filter((model) => model.source === 'custom');
        const nextModels = mergeModels(relevantDetectedModels, customModels);
        setModels(nextModels);
        if (!nextModels.some((model) => model.id === selectedModelId)) {
          setSelectedModelId(nextModels[0]?.id || '');
        }
        setDiscoverState(nextModels.length > 0 ? 'success' : 'error');
      } else {
        setDiscoverState('error');
      }
    } catch {
      setDiscoverState('error');
    }
    setDiscovering(false);
  };

  const saveProvider = async () => {
    const effectiveModelId = selectedModelId || models[0]?.id || '';
    if (!effectiveProviderKey || !providerName.trim() || !baseUrl.trim() || !effectiveModelId) return;

    saveProviderConfig({
      providerKey: effectiveProviderKey,
      modelId: effectiveModelId,
      apiKey,
      baseUrl: baseUrl.trim(),
      apiType: apiType.trim() || undefined,
      name: providerName.trim(),
      needsKey,
      models: toStoredModels(models),
    }, allProviders);
    await syncConfig(allProviders);
    setSavedState('done');
    setCustomMode(false);
    setEditingProviderKey(null);
  };

  const saveDisabled = !effectiveProviderKey || !providerName.trim() || !baseUrl.trim() || !models.length || !selectedModelId || (needsKey && !apiKey.trim());
  const sourceSummary = useMemo(() => {
    if (customMode) return t('models.source.customDraft', 'This provider lives in your local profile until you save it.');
    if (!editingProvider) return t('models.source.empty', 'Choose a provider to inspect its live model catalog.');
    return t('models.source.dynamic', 'Catalog = built-in defaults + saved provider profile + OpenClaw-discovered models.');
  }, [customMode, editingProvider, t]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-slate-800">
        <h1 className="text-lg font-semibold">🤖 {t('models.title', 'Models')}</h1>
        <p className="mt-1 text-sm text-slate-400">{t('models.subtitle', 'Manage the active model, OpenClaw-supported providers, and your own custom model catalog in one place.')}</p>
      </div>

      <div className="p-6 space-y-6">
        {savedState === 'done' && (
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {t('models.saved', 'Model configuration saved. New chats will use the selected primary model.')}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-6">
            <SettingsSection title={t('models.providers', 'Providers')}>
              <div className="p-4 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium text-slate-100">{t('models.pickProvider', 'Choose a provider')}</div>
                    <div className="mt-1 text-xs text-slate-500">{t('models.pickProviderHint', 'Click any provider card to open its setup dialog. The main page should stay clean; detailed settings live in the popup.')}</div>
                  </div>
                </div>

                {loading && (
                  <div className="flex items-center gap-2 px-1 py-1 text-xs text-slate-500">
                    <Loader2 size={12} className="animate-spin" />
                    {t('common.loading', 'Loading...')}
                  </div>
                )}

                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  <button
                    onClick={beginCustomProvider}
                    className="rounded-2xl border border-dashed border-slate-600 bg-slate-900/50 p-4 text-left transition-colors hover:border-brand-500 hover:bg-brand-600/10"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600/15 text-brand-300">
                          <Plus size={18} />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-slate-100">{t('models.addProvider', 'Add Custom Provider')}</div>
                          <div className="mt-1 text-xs text-slate-500">{t('models.addProviderHint', 'Define your own provider key, base URL, and model IDs.')}</div>
                        </div>
                      </div>
                    </div>
                  </button>

                  {allProviders.map((provider) => {
                    const providerProfile = getProviderProfile(config, provider.key);
                    const mergedProviderModels = mergeModels(
                      provider.models.map((model) => ({ id: model.id, label: model.label, source: 'catalog' as const })),
                      providerProfile.models.map((model) => ({ id: model.id, label: model.label || model.name || model.id, source: 'custom' as const })),
                    );
                    const isActive = provider.key === config.providerKey;

                    return (
                      <button
                        key={provider.key}
                        onClick={() => openProviderModal(provider.key)}
                        className={`rounded-2xl border p-4 text-left transition-colors ${isActive ? 'border-brand-500 bg-brand-600/10' : 'border-slate-700 bg-slate-900/50 hover:border-slate-500'}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-base font-medium text-slate-100">{provider.emoji} {provider.name}</div>
                            <div className="mt-1 text-xs text-slate-500">{provider.tag || provider.key}</div>
                          </div>
                          {isActive && (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-1 text-[11px] font-medium text-emerald-300">
                              {t('models.active', 'Active')}
                            </span>
                          )}
                        </div>

                        <div className="mt-3 text-sm text-slate-300">{provider.desc}</div>

                        <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                          <span className="inline-flex items-center gap-2">
                            <Database size={12} />
                            {t('models.catalogCount', '{count} models').replace('{count}', String(mergedProviderModels.length))}
                          </span>
                          <span>{isActive ? t('models.configureActive', 'Edit active model') : t('models.configureProvider', 'Configure')}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </SettingsSection>
          </div>

          <div className="space-y-6">
            <SettingsSection title={t('models.current', 'Current Model')}>
              <div className="p-4 space-y-4">
                <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('models.current', 'Current Model')}</div>
                  <div className="mt-2 text-base font-medium text-slate-100">
                    {activeProvider
                      ? `${activeProvider.emoji} ${activeProvider.name}`
                      : t('models.notConfigured', 'No active model configured')}
                  </div>
                  <div className="mt-1 text-sm text-slate-300">{activeModel?.label || config.modelId || t('models.notConfigured', 'No active model configured')}</div>
                  <div className="mt-3 text-xs text-slate-500">{t('models.currentHint', 'Saving here updates both Desktop local state and OpenClaw primary model.')}</div>
                  {activeProvider && (
                    <button
                      onClick={() => openProviderModal(activeProvider.key)}
                      className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-500"
                    >
                      {t('models.configureActive', 'Edit active model')}
                    </button>
                  )}
                </div>
              </div>
            </SettingsSection>

            <SettingsSection title={t('models.dynamicFlow', 'Dynamic flow')}>
              <div className="p-4">
                <div className="rounded-2xl border border-sky-500/20 bg-sky-500/10 px-4 py-4 text-sm text-sky-100">
                  <div className="font-medium">{t('models.dialogFlowTitle', 'Cleaner flow')}</div>
                  <div className="mt-2 text-xs leading-5 text-sky-100/80">{t('models.dialogFlowHint', 'On this page you only choose the provider. All connection details, API type, model discovery, and custom model IDs are edited inside a dialog so the page stays readable.')}</div>
                  <div className="mt-3 text-xs leading-5 text-sky-100/80">{sourceSummary}</div>
                </div>
              </div>
            </SettingsSection>
          </div>
        </div>

        {modalOpen && (
          <SettingsModalShell
            title={(
              <span className="flex items-center gap-2">
                <span>{customMode ? '✨' : editingProvider?.emoji || '🤖'}</span>
                {customMode ? t('models.editor.customTitle', 'Custom Provider') : `${editingProvider?.name || t('models.editor.title', 'Provider Configuration')}`}
              </span>
            )}
            onClose={closeModal}
            maxWidthClass="max-w-5xl"
            maxHeightClass="max-h-[90vh]"
            paddingClass="p-0"
            footer={(
              <div className="flex items-center justify-between gap-3 px-6 py-4">
                <div className="flex items-start gap-2 text-xs text-amber-100">
                  <Sparkles size={14} className="mt-0.5 text-amber-300" />
                  <span>{t('models.saveHint', 'Save writes this provider profile into Desktop local config and syncs the same catalog to openclaw.json.models.providers.')}</span>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={closeModal}
                    className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700"
                  >
                    {t('common.cancel', 'Cancel')}
                  </button>
                  <button
                    onClick={() => { void saveProvider(); }}
                    disabled={saveDisabled}
                    className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
                  >
                    <Check size={12} /> {t('models.saveAndActivate', 'Save & Activate')}
                  </button>
                </div>
              </div>
            )}
          >
            <div className="p-6 space-y-6">
              <div className="rounded-2xl border border-slate-700 bg-slate-900/50 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="text-base font-medium text-slate-100">{customMode ? t('models.quickSetup', 'Quick Setup') : `${editingProvider?.emoji || '🤖'} ${editingProvider?.name || providerName}`}</div>
                    <div className="mt-1 text-xs text-slate-500">{customMode ? t('models.quickSetupHint', 'Start with the provider name, endpoint, and API type. Advanced fields stay tucked away until you need them.') : editingProvider?.desc || sourceSummary}</div>
                  </div>
                  {!customMode && editingProvider?.tag && (
                    <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{editingProvider.tag}</span>
                  )}
                </div>
              </div>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4 space-y-4">
                    <div>
                      <div className="text-sm font-medium text-slate-100">{t('models.quickSetup', 'Quick Setup')}</div>
                      <div className="mt-1 text-xs text-slate-500">{t('models.quickSetupHint', 'Start with the provider name, endpoint, and API type. Advanced fields stay tucked away until you need them.')}</div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                      <div>
                        <label htmlFor="models-provider-name" className="block text-xs font-medium text-slate-400 mb-1">{t('models.providerName', 'Provider Name')}</label>
                        <input
                          id="models-provider-name"
                          type="text"
                          value={providerName}
                          onChange={(event) => setProviderName(event.target.value)}
                          disabled={!customMode}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                          placeholder={t('models.providerNamePlaceholder', 'My Provider')}
                        />
                        <div className="mt-1 text-[11px] text-slate-500">
                          {t('models.providerKeyPreview', 'Will save as:')} {effectiveProviderKey || t('models.providerKeyAuto', 'generated automatically')}
                        </div>
                      </div>

                      <div>
                        <label htmlFor="models-api-type" className="block text-xs font-medium text-slate-400 mb-1">{t('models.apiType', 'API Type')}</label>
                        <select
                          id="models-api-type"
                          aria-label={t('models.apiType', 'API Type')}
                          value={selectedApiTypeOption}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            if (nextValue === CUSTOM_API_TYPE) {
                              setShowAdvanced(true);
                              return;
                            }
                            setApiType(nextValue);
                          }}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
                        >
                          {apiTypeOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                          <option value={CUSTOM_API_TYPE}>{t('models.apiTypeCustom', 'Custom API type')}</option>
                        </select>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {selectedApiTypeMeta?.hint || t('models.apiTypeHint', 'Use the preset that matches your provider protocol. Most hosted endpoints use OpenAI compatible.')}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="models-base-url" className="block text-xs font-medium text-slate-400 mb-1">{t('settings.model.baseUrl', 'API Base URL')}</label>
                      <input
                        id="models-base-url"
                        type="text"
                        value={baseUrl}
                        onChange={(event) => setBaseUrl(event.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
                        placeholder="https://api.example.com/v1"
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-100">{t('models.requiresKey', 'Requires API key')}</div>
                        <div className="mt-1 text-xs text-slate-500">{t('models.requiresKeyHint', 'Turn this off for local or unauthenticated endpoints such as Ollama.')}</div>
                      </div>
                      <button
                        onClick={() => setNeedsKey((value) => !value)}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${needsKey ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300'}`}
                      >
                        {needsKey ? t('common.on', 'on') : t('common.off', 'off')}
                      </button>
                    </div>

                    {needsKey && (
                      <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">{t('settings.model.apiKey', 'API Key')}</label>
                        <PasswordInput
                          value={apiKey}
                          onChange={(event) => setApiKey(event.target.value)}
                          placeholder={t('common.pasteApiKey', 'Paste your API Key...')}
                          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4 space-y-3">
                    <button
                      type="button"
                      onClick={() => setShowAdvanced((value) => !value)}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <div>
                        <div className="text-sm font-medium text-slate-100">{t('models.advanced', 'Advanced Settings')}</div>
                        <div className="mt-1 text-xs text-slate-500">{t('models.advancedHint', 'Override the generated provider key or enter a protocol name that is not in the preset list.')}</div>
                      </div>
                      <span className="text-xs text-slate-400">{showAdvanced ? t('models.hideAdvanced', 'Hide') : t('models.showAdvanced', 'Show')}</span>
                    </button>

                    {showAdvanced && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div>
                          <label htmlFor="models-provider-key" className="block text-xs font-medium text-slate-400 mb-1">{t('models.providerKey', 'Provider Key')}</label>
                          <input
                            id="models-provider-key"
                            type="text"
                            value={providerKeyInput}
                            onChange={(event) => setProviderKeyInput(event.target.value)}
                            disabled={!customMode}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-70"
                            placeholder={t('models.providerKeyPlaceholder', 'custom-openai')}
                          />
                        </div>

                        <div>
                          <label htmlFor="models-api-type-custom" className="block text-xs font-medium text-slate-400 mb-1">{t('models.apiTypeCustom', 'Custom API type')}</label>
                          <input
                            id="models-api-type-custom"
                            type="text"
                            value={apiType}
                            onChange={(event) => setApiType(event.target.value)}
                            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
                            placeholder={t('models.apiTypeCustomPlaceholder', 'Enter the exact protocol value expected by OpenClaw')}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/50 p-4 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-slate-100">{t('models.catalog', 'Model Catalog')}</div>
                        <div className="mt-1 text-xs text-slate-500">{t('models.catalogHint', 'Pick the active model, refresh from OpenClaw, and keep any manual model IDs you add.')}</div>
                      </div>
                      <button
                        onClick={() => { void discoverModels(); }}
                        disabled={discovering || !baseUrl.trim() || !effectiveProviderKey || (needsKey && !apiKey.trim())}
                        className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2 text-xs text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {discovering ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        {t('models.discover', 'Refresh from OpenClaw')}
                      </button>
                    </div>

                    {discoverState === 'success' && (
                      <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                        {t('models.discoverSuccess', 'Model list refreshed. Custom model IDs were kept.')}
                      </div>
                    )}
                    {discoverState === 'error' && (
                      <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                        {t('models.discoverFailed', 'OpenClaw could not fetch models. Check the provider key, base URL, and API key.')}
                      </div>
                    )}

                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                      {models.map((model) => (
                        <div
                          key={model.id}
                          className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-3 ${selectedModelId === model.id ? 'border-brand-500 bg-brand-600/10' : 'border-slate-700 bg-slate-900/70'}`}
                        >
                          <button onClick={() => setSelectedModelId(model.id)} className="min-w-0 flex-1 text-left">
                            <div className="text-sm font-medium text-slate-100 truncate">{model.label}</div>
                            <div className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">{model.source}</div>
                          </button>
                          <button onClick={() => removeModel(model.id)} className="text-slate-500 transition-colors hover:text-rose-300">
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>

                    {!models.length && (
                      <div className="rounded-lg border border-dashed border-slate-700 px-3 py-3 text-xs text-slate-500">
                        {t('models.catalogEmpty', 'No models yet. Add a model ID manually or use Refresh from OpenClaw.')}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customModelInput}
                        onChange={(event) => setCustomModelInput(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            addCustomModel();
                          }
                        }}
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-brand-500 focus:outline-none"
                        placeholder={t('models.customModelPlaceholder', 'Add model ID, for example gpt-4.1-mini')}
                      />
                      <button
                        onClick={addCustomModel}
                        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-500"
                      >
                        <Plus size={12} /> {t('models.addModel', 'Add Model')}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SettingsModalShell>
        )}
      </div>
    </div>
  );
}
