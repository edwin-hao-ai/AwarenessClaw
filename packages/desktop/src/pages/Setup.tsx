import { useEffect, useState } from 'react';
import { ChevronRight, ChevronLeft, Loader2, Check, Globe, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAppConfig, MODEL_PROVIDERS, type ModelProviderDef, getProviderProfile } from '../lib/store';
import { useI18n } from '../lib/i18n';
import { DEFAULT_ONBOARDING_PERMISSION_PRESET, PERMISSION_PRESET_VALUES } from '../lib/permission-presets';
import PasswordInput from '../components/PasswordInput';
import logoUrl from '../assets/logo.png';

interface SetupProps {
  onComplete: () => void;
}

type Step = 'welcome' | 'installing' | 'model' | 'memory' | 'done';

type ModelProvider = ModelProviderDef;
const PROVIDERS = MODEL_PROVIDERS;


export default function SetupWizard({ onComplete }: SetupProps) {
  const { config, updateConfig, syncConfig, saveProviderConfig } = useAppConfig();
  const { t, locale } = useI18n();
  const [step, setStep] = useState<Step>('welcome');
  const [lang, setLang] = useState<'zh' | 'en'>(locale === 'zh' ? 'zh' : 'en');
  const [existingConfig, setExistingConfig] = useState<{ hasProviders: boolean; primaryModel: string } | null>(null);

  // Install progress
  const [installSteps, setInstallSteps] = useState([
    { key: 'detect', labelKey: 'setup.install.detect', status: 'pending' as 'pending' | 'running' | 'done' | 'error', detail: '' },
    { key: 'nodejs', labelKey: 'setup.install.nodejs', status: 'pending' as const, detail: '' },
    { key: 'openclaw', labelKey: 'setup.install.openclaw', status: 'pending' as const, detail: '' },
    { key: 'plugin', labelKey: 'setup.install.plugin', status: 'pending' as const, detail: '' },
    { key: 'daemon', labelKey: 'setup.install.daemon', status: 'pending' as const, detail: '' },
  ]);

  // Track which step failed so user can retry from there
  const [installError, setInstallError] = useState<{ key: string; message: string } | null>(null);
  // Track skipped model step so back button in memory goes to right place
  const [skippedModelStep, setSkippedModelStep] = useState(false);
  const [shouldApplyFirstRunDefaults, setShouldApplyFirstRunDefaults] = useState(false);

  // Model config
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // API Key validation
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState('');

  // Memory config
  const [memoryMode, setMemoryMode] = useState<'local' | 'cloud'>('local');

  // Language toggle syncs with global i18n via updateConfig

  useEffect(() => {
    const api = window.electronAPI;
    const disposers: Array<() => void> = [];

    if (api?.onSetupStatus) {
      const dispose = api.onSetupStatus((status) => {
        setInstallSteps((prev) => prev.map((step) => step.key === status.stepKey
          ? { ...step, detail: status.detail ? `${t(status.key, status.key)} (${status.detail})` : t(status.key, status.key) }
          : step));
      });
      if (dispose) disposers.push(dispose);
    }

    if (api?.onSetupDaemonStatus) {
      const dispose = api.onSetupDaemonStatus((status) => {
        setInstallSteps((prev) => prev.map((step) => step.key === 'daemon'
          ? { ...step, detail: status.detail ? `${t(status.key)} (${status.detail})` : t(status.key) }
          : step));
      });
      if (dispose) disposers.push(dispose);
    }

    if (disposers.length === 0) return;
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [t]);

  const updateInstallStep = (key: string, status: 'running' | 'done' | 'error', detail?: string) => {
    setInstallSteps((prev) => prev.map((s) => s.key === key ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s));
  };

  const failInstallStep = (key: string, message: string) => {
    updateInstallStep(key, 'error', message);
  };

  const runInstallation = async (retryFromKey?: string) => {
    setStep('installing');
    setInstallError(null);
    const api = window.electronAPI;

    // In browser dev mode (no Electron), simulate
    const simulate = !api;

    // Reset steps that need to re-run (from retry point onwards)
    const stepKeys = ['detect', 'nodejs', 'openclaw', 'plugin', 'daemon'];
    const startIdx = retryFromKey ? stepKeys.indexOf(retryFromKey) : 0;
    if (startIdx > 0) {
      // Only reset from retry point; keep earlier successes
      setInstallSteps((prev) => prev.map((s) => {
        const idx = stepKeys.indexOf(s.key);
        return idx >= startIdx ? { ...s, status: 'pending', detail: '' } : s;
      }));
    }

    // Shared environment detection result — available to all steps
    let env: any = {};

    // Step 1: Detect environment
    if (startIdx <= 0) {
      updateInstallStep('detect', 'running');
      if (simulate) {
        await new Promise((r) => setTimeout(r, 800));
        env = { systemNodeInstalled: true, openclawInstalled: false };
      } else {
        env = await api!.detectEnvironment();
      }
      setShouldApplyFirstRunDefaults(!env.hasExistingConfig);
      updateInstallStep('detect', 'done');

      // Step 2: Ensure Node.js is available
      updateInstallStep('nodejs', 'running');
      if (env.systemNodeInstalled) {
        updateInstallStep('nodejs', 'done', t('setup.install.alreadyInstalled'));
      } else {
        updateInstallStep('nodejs', 'running', t('setup.install.installingNode'));
        if (simulate) {
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          const res = await api!.installNodeJs();
          if (!res.success) {
            updateInstallStep('nodejs', 'error', res.error || t('setup.install.nodeFailed'));
            setInstallError({ key: 'nodejs', message: res.error || t('setup.install.nodeFailed') });
            return;
          }
        }
        updateInstallStep('nodejs', 'done');
      }
    }

    // Step 3: Install OpenClaw
    if (startIdx <= stepKeys.indexOf('openclaw')) {
      updateInstallStep('openclaw', 'running');
      // Re-detect if retrying from a later step (env not populated by step 1)
      if (!simulate && startIdx > 0) {
        env = await api!.detectEnvironment();
      } else if (simulate && !env.systemNodeInstalled) {
        env = { openclawInstalled: false };
      }

      if (env.openclawInstalled) {
        updateInstallStep('openclaw', 'done', t('setup.install.alreadyInstalled'));
      } else {
        if (simulate) {
          await new Promise((r) => setTimeout(r, 2000));
        } else {
          const res = await api!.installOpenClaw();
          if (!res.success) {
            updateInstallStep('openclaw', 'error', res.error || t('setup.install.networkFailed'));
            setInstallError({ key: 'openclaw', message: res.error || t('setup.install.networkFailed') });
            return;
          }
          if (res.alreadyInstalled) {
            updateInstallStep('openclaw', 'running', t('setup.install.alreadyInstalled'));
          } else if (res.version) {
            updateInstallStep('openclaw', 'running', res.version);
          }
        }
        updateInstallStep('openclaw', 'done');

        // Run bootstrap for newly installed OpenClaw
        if (!simulate && api) {
          await (api as any).bootstrap();
        }
      }
    }

    // Step 4: Install plugin
    if (startIdx <= stepKeys.indexOf('plugin')) {
      updateInstallStep('plugin', 'running');
      if (simulate) {
        await new Promise((r) => setTimeout(r, 1500));
      } else {
        const res = await api!.installPlugin();
        if (!res?.success) {
          const message = res?.error || t('setup.install.pluginFailed', 'Plugin install failed');
          failInstallStep('plugin', message);
          setInstallError({ key: 'plugin', message });
          return;
        }
      }
      updateInstallStep('plugin', 'done');
    }

    // Step 5: Start daemon
    if (startIdx <= stepKeys.indexOf('daemon')) {
      updateInstallStep('daemon', 'running');
      if (simulate) {
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        const res = await api!.startDaemon();
        if (!res?.success) {
          const message = res?.error || t('setup.install.daemonFailed', 'Daemon start failed');
          failInstallStep('daemon', message);
          setInstallError({ key: 'daemon', message });
          return;
        }
      }
      updateInstallStep('daemon', 'done');
    }

    // Check if user already has OpenClaw configured with models
    await new Promise((r) => setTimeout(r, 500));
    if (!simulate && api) {
      const existing = await (api as any).readExistingConfig();
      if (existing?.hasProviders) {
        setExistingConfig(existing);
        setSkippedModelStep(true);
        // User already has models configured — skip model selection
        setStep('memory');
        return;
      }
    }
    setSkippedModelStep(false);
    setStep('model');
  };

  const handleModelNext = async () => {
    if (!selectedProvider) return;

    const provider = PROVIDERS.find((item) => item.key === selectedProvider);
    const api = window.electronAPI;

    // Validate API key for providers that require one
    if (provider?.needsKey && apiKey && api?.modelsDiscover) {
      setValidating(true);
      setValidationError('');
      try {
        const baseUrl = customBaseUrl || provider.baseUrl;
        const result = await api.modelsDiscover({ providerKey: selectedProvider, baseUrl, apiKey });
        if (!result.success) {
          setValidating(false);
          setValidationError(result.error || t('setup.model.validationFailed', 'Could not connect. Please check your API key.'));
          return;
        }
      } catch {
        setValidating(false);
        setValidationError(t('setup.model.validationFailed', 'Could not connect. Please check your API key.'));
        return;
      }
      setValidating(false);
      setValidationError('');
    }

    saveProviderConfig({
      providerKey: selectedProvider,
      modelId: selectedModel,
      apiKey,
      baseUrl: customBaseUrl,
      apiType: provider?.apiType,
      name: provider?.name,
      needsKey: provider?.needsKey,
      models: (provider?.models || []).map((model) => ({
        id: model.id,
        label: model.label,
        name: model.label,
      })),
    }, PROVIDERS);
    await syncConfig(PROVIDERS);
    setStep('memory');
  };

  const handleFinish = async () => {
    // Persist the memory mode selection before completing setup
    updateConfig({ memoryMode });
    await syncConfig(PROVIDERS);
    if (shouldApplyFirstRunDefaults && window.electronAPI?.permissionsUpdate) {
      await window.electronAPI.permissionsUpdate({
        ...PERMISSION_PRESET_VALUES[DEFAULT_ONBOARDING_PERMISSION_PRESET],
      });
    }
    onComplete();
  };

  // Which step failed label for display
  const failedStepLabel = installError
    ? installSteps.find(s => s.key === installError.key)?.labelKey
    : null;

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* macOS title bar */}
      <div className="titlebar-drag h-8 flex-shrink-0" />

      {/* Language toggle */}
      <div className="absolute top-10 right-4 titlebar-no-drag">
        <button
          onClick={() => {
            const next = lang === 'zh' ? 'en' : 'zh';
            setLang(next);
            updateConfig({ language: next });
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <Globe size={14} />
          {lang === 'zh' ? 'EN' : '中文'}
        </button>
      </div>

      {/* Progress bar */}
      <div className="px-8 pt-2">
        <div className="flex gap-2">
          {['welcome', 'installing', 'model', 'memory', 'done'].map((s, i) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-colors duration-500 ${
                ['welcome', 'installing', 'model', 'memory', 'done'].indexOf(step) >= i
                  ? 'bg-brand-500'
                  : 'bg-slate-700'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-2xl animate-fade-in">

          {/* ===== WELCOME ===== */}
          {step === 'welcome' && (
            <div className="text-center space-y-8">
              <img src={logoUrl} alt="AwarenessClaw" className="w-20 h-20 mx-auto animate-pulse-soft" />
              <div>
                <h1 className="text-3xl font-bold mb-3">
                  {t('setup.welcome.title')}
                </h1>
                <p className="text-lg text-slate-400">
                  {t('setup.welcome.subtitle')}
                </p>
              </div>
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={() => runInstallation()}
                  className="px-8 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-lg font-medium transition-colors flex items-center gap-2"
                >
                  {t('setup.welcome.start')}
                  <ChevronRight size={20} />
                </button>
                <p className="text-sm text-slate-500">
                  {t('setup.welcome.time')}
                </p>
              </div>
            </div>
          )}

          {/* ===== INSTALLING ===== */}
          {step === 'installing' && (
            <div className="space-y-8">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">
                  {t('setup.installing.title')}
                </h2>
                <p className="text-slate-400">
                  {t('setup.installing.subtitle')}
                </p>
              </div>

              <div className="space-y-4">
                {installSteps.map((s) => (
                  <div
                    key={s.key}
                    className={`flex items-center gap-4 p-4 rounded-xl transition-all ${
                      s.status === 'running' ? 'bg-brand-600/10 border border-brand-600/30' :
                      s.status === 'done' ? 'bg-emerald-600/10' :
                      s.status === 'error' ? 'bg-red-600/10 border border-red-600/20' :
                      'bg-slate-800/50'
                    }`}
                  >
                    <div className="w-8 h-8 flex items-center justify-center">
                      {s.status === 'running' && <Loader2 size={20} className="animate-spin text-brand-400" />}
                      {s.status === 'done' && <Check size={20} className="text-emerald-400" />}
                      {s.status === 'error' && <AlertTriangle size={20} className="text-red-400" />}
                      {s.status === 'pending' && <div className="w-3 h-3 rounded-full bg-slate-600" />}
                    </div>
                    <div className="flex-1">
                      <span className={s.status === 'done' ? 'text-emerald-300' : s.status === 'running' ? 'text-brand-300' : s.status === 'error' ? 'text-red-300' : 'text-slate-400'}>
                        {t(s.labelKey)}
                      </span>
                      {s.detail && <p className="text-xs text-slate-500 mt-0.5">{s.detail}</p>}
                    </div>
                    {s.status === 'done' && <span className="ml-auto text-sm text-emerald-500">{s.detail || t('setup.install.done')}</span>}
                  </div>
                ))}
              </div>

              {/* Error recovery panel */}
              {installError && (
                <div className="p-4 bg-red-900/20 border border-red-600/30 rounded-xl space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm text-red-300 font-medium">
                        {t('setup.install.stepFailed', 'A step failed')}
                        {failedStepLabel ? `: ${t(failedStepLabel)}` : ''}
                      </p>
                      <p className="text-xs text-red-400/70 mt-1">{installError.message}</p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => runInstallation(installError.key)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-600/30 text-red-300 rounded-lg text-sm transition-colors"
                    >
                      <RefreshCw size={14} />
                      {t('setup.install.retry', 'Retry')}
                    </button>
                    <button
                      onClick={() => setStep('welcome')}
                      className="px-4 py-2 text-slate-400 hover:text-slate-200 text-sm"
                    >
                      {t('setup.back')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ===== MODEL SELECTION ===== */}
          {step === 'model' && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">
                  {t('setup.model.title')}
                </h2>
                <p className="text-slate-400">
                  {t('setup.model.subtitle')}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-[340px] overflow-y-auto pr-1">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      const profile = getProviderProfile(config, p.key);
                      setSelectedProvider(p.key);
                      setSelectedModel(profile.models[0]?.id || p.models[0]?.id || '');
                      setApiKey(profile.apiKey);
                      setCustomBaseUrl(profile.baseUrl);
                      setShowAdvanced(false);
                      setValidationError('');
                    }}
                    className={`p-4 rounded-xl text-left transition-all border ${
                      selectedProvider === p.key
                        ? 'border-brand-500 bg-brand-600/10'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-xl">{p.emoji}</span>
                      <span className="font-medium">{p.name}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">{p.tag}</span>
                    </div>
                    <p className="text-sm text-slate-400">{p.desc}</p>
                  </button>
                ))}
              </div>

              {/* Config panel (API key + model selector) */}
              {selectedProvider && (() => {
                const provider = PROVIDERS.find((p) => p.key === selectedProvider)!;
                return (
                  <div className="animate-slide-up space-y-3 p-4 bg-slate-800/50 rounded-xl">
                    {/* API Key */}
                    {provider.needsKey && (
                      <>
                        <label className="block text-sm font-medium text-slate-300">
                          🔑 {t('setup.apiKey')}
                        </label>
                        <PasswordInput
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={t('setup.apiKey.placeholder')}
                          className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500 transition-colors"
                        />
                        <p className="text-xs text-slate-500">
                          💡 {t('setup.apiKey.hint')}{' '}
                          <button className="text-brand-400 hover:underline">
                            {t('setup.apiKey.tutorial')}
                          </button>
                        </p>
                        {validationError && (
                          <div className="flex items-start gap-2 p-2.5 bg-red-900/20 border border-red-600/30 rounded-lg">
                            <AlertTriangle size={14} className="text-red-400 mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <p className="text-xs text-red-300">{validationError}</p>
                              <button
                                onClick={() => {
                                  setValidationError('');
                                  const prov = PROVIDERS.find((p) => p.key === selectedProvider);
                                  saveProviderConfig({
                                    providerKey: selectedProvider!,
                                    modelId: selectedModel,
                                    apiKey,
                                    baseUrl: customBaseUrl,
                                    apiType: prov?.apiType,
                                    name: prov?.name,
                                    needsKey: prov?.needsKey,
                                    models: (prov?.models || []).map((model) => ({
                                      id: model.id,
                                      label: model.label,
                                      name: model.label,
                                    })),
                                  }, PROVIDERS);
                                  syncConfig(PROVIDERS);
                                  setStep('memory');
                                }}
                                className="text-xs text-slate-400 hover:text-slate-200 underline mt-1"
                              >
                                {t('setup.model.skipValidation', 'Continue anyway')}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* No key needed hint */}
                    {!provider.needsKey && (
                      <p className="text-sm text-slate-300">
                        🏠 {t('setup.model.localHint')}
                      </p>
                    )}

                    {/* Model selector */}
                    {provider.models.length > 1 && (
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          {t('setup.model.selectModel')}
                        </label>
                        <div className="flex gap-2 flex-wrap">
                          {provider.models.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => setSelectedModel(m.id)}
                              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                                selectedModel === m.id
                                  ? 'bg-brand-600 text-white'
                                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                              }`}
                            >
                              {m.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Advanced: Custom Base URL */}
                    <div className="border-t border-slate-700 pt-3 mt-1">
                      <button
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                      >
                        {showAdvanced ? '▼' : '▶'} {t('setup.model.advanced')}
                      </button>
                      {showAdvanced && (
                        <div className="mt-2 space-y-2 animate-slide-up">
                          <label className="block text-xs text-slate-400">
                            API Base URL
                          </label>
                          <input
                            type="text"
                            value={customBaseUrl || provider.baseUrl}
                            onChange={(e) => setCustomBaseUrl(e.target.value)}
                            placeholder={provider.baseUrl}
                            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-500 transition-colors"
                          />
                          <p className="text-xs text-slate-600">
                            {t('setup.model.baseUrlHint')}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="flex justify-between">
                <button
                  onClick={() => setStep('installing')}
                  className="px-4 py-2 text-slate-400 hover:text-slate-200 flex items-center gap-1"
                >
                  <ChevronLeft size={16} />
                  {t('setup.back')}
                </button>
                <button
                  onClick={handleModelNext}
                  disabled={validating || !selectedProvider || (PROVIDERS.find((p) => p.key === selectedProvider)?.needsKey === true && !apiKey)}
                  className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
                >
                  {validating ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {t('setup.model.validating', 'Verifying...')}
                    </>
                  ) : (
                    <>
                      {t('setup.next')}
                      <ChevronRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* ===== MEMORY MODE ===== */}
          {step === 'memory' && (
            <div className="space-y-8">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">
                  {t('setup.memory.title')}
                </h2>
                {/* Show skipped step notice */}
                {skippedModelStep && existingConfig && (
                  <div className="mt-2 px-4 py-2 bg-emerald-600/10 border border-emerald-600/20 rounded-lg text-xs text-emerald-400 inline-flex items-center gap-1.5">
                    <Check size={12} />
                    {t('setup.model.alreadyConfigured', 'Model already configured')}
                    {existingConfig.primaryModel ? `: ${existingConfig.primaryModel}` : ''}
                    {' — '}
                    <button
                      onClick={() => setStep('model')}
                      className="underline hover:no-underline"
                    >
                      {t('setup.model.change', 'Change')}
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-4">
                <button
                  onClick={() => setMemoryMode('local')}
                  className={`w-full p-5 rounded-xl text-left transition-all border ${
                    memoryMode === 'local'
                      ? 'border-brand-500 bg-brand-600/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">🏠</span>
                    <div>
                      <div className="font-medium text-lg">{t('setup.memory.local')}</div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400">
                        {t('setup.memory.local.recommended')}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400 ml-11">
                    {t('setup.memory.local.desc')}
                  </p>
                </button>

                <button
                  onClick={() => setMemoryMode('cloud')}
                  className={`w-full p-5 rounded-xl text-left transition-all border ${
                    memoryMode === 'cloud'
                      ? 'border-brand-500 bg-brand-600/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">☁️</span>
                    <div>
                      <div className="font-medium text-lg">{t('setup.memory.cloud')}</div>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400 ml-11">
                    {t('setup.memory.cloud.desc')}
                  </p>
                </button>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => skippedModelStep ? setStep('installing') : setStep('model')}
                  className="px-4 py-2 text-slate-400 hover:text-slate-200 flex items-center gap-1"
                >
                  <ChevronLeft size={16} />
                  {t('setup.back')}
                </button>
                <button
                  onClick={() => setStep('done')}
                  className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
                >
                  {t('setup.next')}
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ===== DONE ===== */}
          {step === 'done' && (
            <div className="text-center space-y-8">
              <div className="text-6xl">🎉</div>
              <div>
                <h2 className="text-3xl font-bold mb-3">
                  {t('setup.done.title')}
                </h2>
                <p className="text-lg text-slate-400">
                  {t('setup.done.subtitle')}
                </p>
              </div>

              <div className="space-y-3 text-sm text-slate-400 max-w-sm mx-auto text-left">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
                  <span>💬</span>
                  <span>{t('setup.done.tip.chat')}</span>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
                  <span>📱</span>
                  <span>{t('setup.done.tip.channels')}</span>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
                  <span>🧠</span>
                  <span>{t('setup.done.tip.memory')}</span>
                </div>
              </div>

              <button
                onClick={handleFinish}
                className="px-8 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-lg font-medium transition-colors"
              >
                🚀 {t('setup.done.start')}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
