import { useState } from 'react';
import { ChevronRight, ChevronLeft, Loader2, Check, Globe } from 'lucide-react';
import { useAppConfig, MODEL_PROVIDERS, type ModelProviderDef } from '../lib/store';
import logoUrl from '../assets/logo.png';

interface SetupProps {
  onComplete: () => void;
}

type Step = 'welcome' | 'installing' | 'model' | 'memory' | 'done';

type ModelProvider = ModelProviderDef;
const PROVIDERS = MODEL_PROVIDERS;


export default function SetupWizard({ onComplete }: SetupProps) {
  const { updateConfig, syncConfig } = useAppConfig();
  const [step, setStep] = useState<Step>('welcome');
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [existingConfig, setExistingConfig] = useState<{ hasProviders: boolean; primaryModel: string } | null>(null);

  // Install progress
  const [installSteps, setInstallSteps] = useState([
    { key: 'detect', label: lang === 'zh' ? '检测环境' : 'Detecting environment', status: 'pending' as 'pending' | 'running' | 'done' | 'error', detail: '' },
    { key: 'nodejs', label: lang === 'zh' ? '准备运行环境' : 'Preparing runtime', status: 'pending' as const, detail: '' },
    { key: 'openclaw', label: lang === 'zh' ? '安装 AI 引擎' : 'Installing AI engine', status: 'pending' as const, detail: '' },
    { key: 'plugin', label: lang === 'zh' ? '安装记忆模块' : 'Installing memory module', status: 'pending' as const, detail: '' },
    { key: 'daemon', label: lang === 'zh' ? '启动本地服务' : 'Starting local service', status: 'pending' as const, detail: '' },
  ]);

  // Model config
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Memory config
  const [memoryMode, setMemoryMode] = useState<'local' | 'cloud'>('local');

  const t = (zh: string, en: string) => lang === 'zh' ? zh : en;

  const updateInstallStep = (key: string, status: 'running' | 'done' | 'error', detail?: string) => {
    setInstallSteps((prev) => prev.map((s) => s.key === key ? { ...s, status, ...(detail !== undefined ? { detail } : {}) } : s));
  };

  const runInstallation = async () => {
    setStep('installing');
    const api = window.electronAPI;

    // In browser dev mode (no Electron), simulate
    const simulate = !api;

    // Step 1: Detect environment
    updateInstallStep('detect', 'running');
    let env: any = {};
    if (simulate) {
      await new Promise((r) => setTimeout(r, 800));
      env = { systemNodeInstalled: true, openclawInstalled: false };
    } else {
      env = await api!.detectEnvironment();
    }
    updateInstallStep('detect', 'done');

    // Step 2: Ensure Node.js is available
    updateInstallStep('nodejs', 'running');
    if (env.systemNodeInstalled) {
      updateInstallStep('nodejs', 'done', t('已安装', 'Already installed'));
    } else {
      updateInstallStep('nodejs', 'running', t('正在安装 Node.js（首次需要，约 1-2 分钟）...', 'Installing Node.js (first time only, ~1-2 min)...'));
      if (simulate) {
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        const res = await api!.installNodeJs();
        if (!res.success) {
          updateInstallStep('nodejs', 'error', t('安装失败，请手动安装 Node.js', 'Failed, please install Node.js manually'));
          return;
        }
      }
      updateInstallStep('nodejs', 'done');
    }

    // Step 3: Install OpenClaw
    updateInstallStep('openclaw', 'running');
    if (env.openclawInstalled) {
      updateInstallStep('openclaw', 'done', t('已安装', 'Already installed'));
    } else {
      if (simulate) {
        await new Promise((r) => setTimeout(r, 2000));
      } else {
        const res = await api!.installOpenClaw();
        if (!res.success) {
          updateInstallStep('openclaw', 'error', t('安装失败，请检查网络', 'Failed, check network'));
          return;
        }
      }
      updateInstallStep('openclaw', 'done');

      // Run bootstrap for newly installed OpenClaw
      if (!simulate && api) {
        await (api as any).bootstrap();
      }
    }

    // Step 4: Install plugin
    updateInstallStep('plugin', 'running');
    if (simulate) await new Promise((r) => setTimeout(r, 1500));
    else await api!.installPlugin();
    updateInstallStep('plugin', 'done');

    // Step 5: Start daemon
    updateInstallStep('daemon', 'running');
    if (simulate) await new Promise((r) => setTimeout(r, 1000));
    else await api!.startDaemon();
    updateInstallStep('daemon', 'done');

    // Check if user already has OpenClaw configured with models
    await new Promise((r) => setTimeout(r, 500));
    if (!simulate && api) {
      const existing = await (api as any).readExistingConfig();
      if (existing?.hasProviders) {
        setExistingConfig(existing);
        // User already has models configured — skip model selection
        setStep('memory');
        return;
      }
    }
    setStep('model');
  };

  const handleModelNext = async () => {
    // Save to shared store (persists to localStorage)
    updateConfig({
      providerKey: selectedProvider || '',
      modelId: selectedModel,
      apiKey,
      baseUrl: customBaseUrl,
    });
    // Sync to openclaw.json
    syncConfig(PROVIDERS);
    setStep('memory');
  };

  const handleFinish = () => {
    onComplete();
  };

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* macOS title bar */}
      <div className="titlebar-drag h-8 flex-shrink-0" />

      {/* Language toggle */}
      <div className="absolute top-10 right-4 titlebar-no-drag">
        <button
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
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
                  {t('欢迎使用 AwarenessClaw', 'Welcome to AwarenessClaw')}
                </h1>
                <p className="text-lg text-slate-400">
                  {t('你的 AI 助手，记住你说过的每一件事', 'Your AI assistant that remembers everything')}
                </p>
              </div>
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={runInstallation}
                  className="px-8 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-lg font-medium transition-colors flex items-center gap-2"
                >
                  {t('开始安装', 'Start Setup')}
                  <ChevronRight size={20} />
                </button>
                <p className="text-sm text-slate-500">
                  {t('约需 2 分钟，全程自动', 'Takes ~2 minutes, fully automatic')}
                </p>
              </div>
            </div>
          )}

          {/* ===== INSTALLING ===== */}
          {step === 'installing' && (
            <div className="space-y-8">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">
                  {t('正在准备你的 AI 助手...', 'Preparing your AI assistant...')}
                </h2>
                <p className="text-slate-400">
                  {t('请稍候，全程自动完成', 'Please wait, fully automatic')}
                </p>
              </div>

              <div className="space-y-4">
                {installSteps.map((s) => (
                  <div
                    key={s.key}
                    className={`flex items-center gap-4 p-4 rounded-xl transition-all ${
                      s.status === 'running' ? 'bg-brand-600/10 border border-brand-600/30' :
                      s.status === 'done' ? 'bg-emerald-600/10' :
                      s.status === 'error' ? 'bg-red-600/10' :
                      'bg-slate-800/50'
                    }`}
                  >
                    <div className="w-8 h-8 flex items-center justify-center">
                      {s.status === 'running' && <Loader2 size={20} className="animate-spin text-brand-400" />}
                      {s.status === 'done' && <Check size={20} className="text-emerald-400" />}
                      {s.status === 'error' && <span className="text-red-400">✕</span>}
                      {s.status === 'pending' && <div className="w-3 h-3 rounded-full bg-slate-600" />}
                    </div>
                    <div className="flex-1">
                      <span className={s.status === 'done' ? 'text-emerald-300' : s.status === 'running' ? 'text-brand-300' : 'text-slate-400'}>
                        {s.label}
                      </span>
                      {s.detail && <p className="text-xs text-slate-500 mt-0.5">{s.detail}</p>}
                    </div>
                    {s.status === 'done' && <span className="ml-auto text-sm text-emerald-500">{s.detail || t('完成', 'Done')}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ===== MODEL SELECTION ===== */}
          {step === 'model' && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">
                  {t('选择你的 AI 大脑', 'Choose your AI brain')}
                </h2>
                <p className="text-slate-400">
                  {t('选择一个 AI 模型提供商', 'Pick an AI model provider')}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-[340px] overflow-y-auto pr-1">
                {PROVIDERS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setSelectedProvider(p.key);
                      setSelectedModel(p.models[0]?.id || '');
                      setApiKey('');
                      setCustomBaseUrl('');
                      setShowAdvanced(false);
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
                          🔑 {t('请输入访问码', 'Enter your API key')}
                        </label>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={t('粘贴你的 API Key...', 'Paste your API key...')}
                          className="w-full px-4 py-2.5 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500 transition-colors"
                        />
                        <p className="text-xs text-slate-500">
                          💡 {t('不知道怎么获取？', "Don't know how to get one?")}{' '}
                          <button className="text-brand-400 hover:underline">
                            {t('查看教程', 'View tutorial')}
                          </button>
                        </p>
                      </>
                    )}

                    {/* No key needed hint */}
                    {!provider.needsKey && (
                      <p className="text-sm text-slate-300">
                        🏠 {t(
                          '本地运行，不需要访问码。请确保已安装 Ollama。',
                          'Runs locally, no API key needed. Make sure Ollama is installed.'
                        )}
                      </p>
                    )}

                    {/* Model selector */}
                    {provider.models.length > 1 && (
                      <div>
                        <label className="block text-sm font-medium text-slate-300 mb-2">
                          {t('选择模型', 'Select model')}
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
                        {showAdvanced ? '▼' : '▶'} {t('高级设置', 'Advanced')}
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
                            {t('默认地址已填好，如使用代理或自定义网关可修改', 'Default URL pre-filled. Change if using a proxy or custom gateway.')}
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
                  {t('返回', 'Back')}
                </button>
                <button
                  onClick={handleModelNext}
                  disabled={!selectedProvider || (PROVIDERS.find((p) => p.key === selectedProvider)?.needsKey === true && !apiKey)}
                  className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
                >
                  {t('下一步', 'Next')}
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ===== MEMORY MODE ===== */}
          {step === 'memory' && (
            <div className="space-y-8">
              <div className="text-center">
                <h2 className="text-2xl font-bold mb-2">
                  {t('要不要让 AI 跨设备记住你？', 'Enable cross-device memory?')}
                </h2>
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
                      <div className="font-medium text-lg">{t('仅本机使用', 'Local only')}</div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-600/20 text-emerald-400">
                        {t('推荐新手', 'Recommended')}
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400 ml-11">
                    {t('AI 记忆保存在这台电脑，完全离线，隐私安全', 'Memory stays on this computer, fully offline and private')}
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
                      <div className="font-medium text-lg">{t('连接云端', 'Connect to cloud')}</div>
                    </div>
                  </div>
                  <p className="text-sm text-slate-400 ml-11">
                    {t('AI 记忆在所有设备间同步，点击后会打开浏览器登录', 'Sync memory across all devices, opens browser to sign in')}
                  </p>
                </button>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => setStep('model')}
                  className="px-4 py-2 text-slate-400 hover:text-slate-200 flex items-center gap-1"
                >
                  <ChevronLeft size={16} />
                  {t('返回', 'Back')}
                </button>
                <button
                  onClick={() => setStep('done')}
                  className="px-6 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
                >
                  {t('下一步', 'Next')}
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
                  {t('你的 AI 助手准备好了！', 'Your AI assistant is ready!')}
                </h2>
                <p className="text-lg text-slate-400">
                  {t('AI 会记住你们的每一次对话', 'Your AI will remember every conversation')}
                </p>
              </div>

              <div className="space-y-3 text-sm text-slate-400 max-w-sm mx-auto text-left">
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
                  <span>💬</span>
                  <span>{t('在"聊天"页面开始对话', 'Start chatting in the Chat tab')}</span>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
                  <span>📱</span>
                  <span>{t('在"通道"页面连接 Telegram / WhatsApp', 'Connect Telegram / WhatsApp in Channels')}</span>
                </div>
                <div className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/50">
                  <span>🧠</span>
                  <span>{t('在"记忆"页面查看 AI 记住了什么', 'View what AI remembers in Memory')}</span>
                </div>
              </div>

              <button
                onClick={handleFinish}
                className="px-8 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-lg font-medium transition-colors"
              >
                🚀 {t('开始使用', 'Get Started')}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
