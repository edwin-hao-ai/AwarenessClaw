import { useState } from 'react';
import { Moon, Sun, Monitor, ChevronRight, X, Check, ChevronDown } from 'lucide-react';
import { useAppConfig, MODEL_PROVIDERS } from '../lib/store';

export default function Settings() {
  const { config, updateConfig, syncConfig } = useAppConfig();
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [tempProvider, setTempProvider] = useState('');
  const [tempModel, setTempModel] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [tempBaseUrl, setTempBaseUrl] = useState('');

  const currentProvider = MODEL_PROVIDERS.find((p) => p.key === config.providerKey);
  const currentModel = currentProvider?.models.find((m) => m.id === config.modelId);

  const openModelPicker = () => {
    setTempProvider(config.providerKey);
    setTempModel(config.modelId);
    setTempApiKey(config.apiKey);
    setTempBaseUrl(config.baseUrl);
    setShowModelPicker(true);
  };

  const saveModelChange = () => {
    updateConfig({
      providerKey: tempProvider,
      modelId: tempModel,
      apiKey: tempApiKey,
      baseUrl: tempBaseUrl,
    });
    syncConfig(MODEL_PROVIDERS);
    setShowModelPicker(false);
  };

  const handleToggle = (key: keyof typeof config, value: boolean) => {
    updateConfig({ [key]: value } as any);
    syncConfig(MODEL_PROVIDERS);
  };

  const handleRecallLimit = (value: number) => {
    updateConfig({ recallLimit: value });
    syncConfig(MODEL_PROVIDERS);
  };

  const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => (
    <button
      onClick={() => onChange(!checked)}
      className={`w-11 h-6 rounded-full transition-colors relative ${checked ? 'bg-brand-600' : 'bg-slate-700'}`}
    >
      <div
        className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform"
        style={{ transform: checked ? 'translateX(21px)' : 'translateX(1px)' }}
      />
    </button>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-3">
      <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">{title}</h3>
      <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 divide-y divide-slate-700/50">
        {children}
      </div>
    </div>
  );

  const Row = ({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between p-4">
      <div className="flex-1 mr-4">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-xs text-slate-500 mt-0.5">{desc}</div>}
      </div>
      {children}
    </div>
  );

  const selectedTempProvider = MODEL_PROVIDERS.find((p) => p.key === tempProvider);

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-slate-800">
        <h1 className="text-lg font-semibold">⚙️ 设置</h1>
      </div>

      <div className="p-6 space-y-6 max-w-2xl">
        {/* Model */}
        <Section title="🤖 AI 模型">
          <Row
            label="当前模型"
            desc={currentProvider
              ? `${currentProvider.emoji} ${currentProvider.name} / ${currentModel?.label || config.modelId}`
              : '未配置'
            }
          >
            <button
              onClick={openModelPicker}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 rounded-lg text-white transition-colors"
            >
              切换模型 <ChevronRight size={12} />
            </button>
          </Row>
          {config.baseUrl && config.baseUrl !== currentProvider?.baseUrl && (
            <Row label="自定义 API 地址" desc={config.baseUrl}>
              <button
                onClick={() => { updateConfig({ baseUrl: '' }); syncConfig(MODEL_PROVIDERS); }}
                className="text-xs text-slate-500 hover:text-red-400"
              >
                重置为默认
              </button>
            </Row>
          )}
        </Section>

        {/* Memory */}
        <Section title="🧠 记忆">
          <Row label="自动记忆" desc="AI 自动记住每次对话内容">
            <Toggle checked={config.autoCapture} onChange={(v) => handleToggle('autoCapture', v)} />
          </Row>
          <Row label="自动回忆" desc="对话开始时自动加载相关记忆">
            <Toggle checked={config.autoRecall} onChange={(v) => handleToggle('autoRecall', v)} />
          </Row>
          <Row label="回忆条数" desc="每次对话加载的记忆数量">
            <div className="flex items-center gap-3">
              <input
                type="range" min={1} max={20}
                value={config.recallLimit}
                onChange={(e) => handleRecallLimit(parseInt(e.target.value))}
                className="w-24 accent-brand-500"
              />
              <span className="text-sm text-slate-300 w-6 text-right">{config.recallLimit}</span>
            </div>
          </Row>
          <Row label="存储模式" desc="记忆保存位置">
            <div className="flex bg-slate-700 rounded-lg overflow-hidden">
              {(['local', 'cloud'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => { updateConfig({ memoryMode: mode }); }}
                  className={`px-3 py-1.5 text-xs transition-colors ${config.memoryMode === mode ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {mode === 'local' ? '🏠 本地' : '☁️ 云端'}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* Appearance */}
        <Section title="🎨 外观">
          <Row label="语言">
            <select
              value={config.language}
              onChange={(e) => updateConfig({ language: e.target.value })}
              className="px-3 py-1.5 bg-slate-700 rounded-lg text-sm border-none focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            >
              <option value="zh">🇨🇳 中文</option>
              <option value="en">🇺🇸 English</option>
              <option value="ja">🇯🇵 日本語</option>
              <option value="ko">🇰🇷 한국어</option>
            </select>
          </Row>
          <Row label="主题">
            <div className="flex bg-slate-700 rounded-lg overflow-hidden">
              {([
                { key: 'light' as const, icon: Sun, label: '亮色' },
                { key: 'dark' as const, icon: Moon, label: '暗色' },
                { key: 'system' as const, icon: Monitor, label: '系统' },
              ]).map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  onClick={() => updateConfig({ theme: key })}
                  className={`px-3 py-1.5 text-xs flex items-center gap-1 ${config.theme === key ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  <Icon size={12} /> {label}
                </button>
              ))}
            </div>
          </Row>
        </Section>

        {/* System */}
        <Section title="🔧 系统">
          <Row label="自动更新" desc="有新版本时自动下载安装">
            <Toggle checked={config.autoUpdate} onChange={(v) => updateConfig({ autoUpdate: v })} />
          </Row>
          <Row label="开机自启" desc="电脑开机时自动启动">
            <Toggle checked={config.autoStart} onChange={(v) => updateConfig({ autoStart: v })} />
          </Row>
          <Row label="重置安装向导" desc="重新运行首次安装流程">
            <button
              onClick={() => { localStorage.removeItem('awareness-claw-setup-done'); window.location.reload(); }}
              className="px-3 py-1.5 text-xs bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg transition-colors"
            >
              重置
            </button>
          </Row>
        </Section>

        <div className="text-center text-xs text-slate-600 space-y-1 pb-6">
          <p>AwarenessClaw v0.1.0</p>
          <p>Built on OpenClaw + Awareness Memory</p>
          <button
            onClick={() => window.electronAPI?.openExternal('https://github.com/edwin-hao-ai/AwarenessClaw')}
            className="text-brand-500 hover:text-brand-400"
          >
            GitHub
          </button>
        </div>
      </div>

      {/* === Model Picker Modal === */}
      {showModelPicker && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <h2 className="text-lg font-semibold">🤖 切换模型</h2>
              <button onClick={() => setShowModelPicker(false)} className="text-slate-500 hover:text-slate-300">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Provider grid */}
              <div className="grid grid-cols-3 gap-2">
                {MODEL_PROVIDERS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setTempProvider(p.key);
                      setTempModel(p.models[0]?.id || '');
                      if (p.key !== config.providerKey) {
                        setTempApiKey('');
                        setTempBaseUrl('');
                      }
                    }}
                    className={`p-3 rounded-xl text-left transition-all border text-xs ${
                      tempProvider === p.key
                        ? 'border-brand-500 bg-brand-600/10'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span>{p.emoji}</span>
                      <span className="font-medium text-sm">{p.name}</span>
                    </div>
                    <span className="text-slate-500">{p.tag}</span>
                  </button>
                ))}
              </div>

              {/* Selected provider config */}
              {selectedTempProvider && (
                <div className="space-y-3 p-4 bg-slate-800/50 rounded-xl animate-fade-in">
                  {/* API Key */}
                  {selectedTempProvider.needsKey && (
                    <div>
                      <label className="block text-xs font-medium text-slate-400 mb-1">🔑 API Key</label>
                      <input
                        type="password"
                        value={tempApiKey}
                        onChange={(e) => setTempApiKey(e.target.value)}
                        placeholder="粘贴你的 API Key..."
                        className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                      />
                    </div>
                  )}

                  {/* Model selector */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">选择模型</label>
                    <div className="flex gap-2 flex-wrap">
                      {selectedTempProvider.models.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setTempModel(m.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                            tempModel === m.id ? 'bg-brand-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Base URL */}
                  <div>
                    <label className="block text-xs font-medium text-slate-400 mb-1">API Base URL</label>
                    <input
                      type="text"
                      value={tempBaseUrl || selectedTempProvider.baseUrl}
                      onChange={(e) => setTempBaseUrl(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs font-mono focus:outline-none focus:border-brand-500"
                    />
                    <p className="text-xs text-slate-600 mt-1">默认已填好，使用代理或自定义网关时可修改</p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 p-5 border-t border-slate-800">
              <button
                onClick={() => setShowModelPicker(false)}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200"
              >
                取消
              </button>
              <button
                onClick={saveModelChange}
                disabled={!tempProvider || (selectedTempProvider?.needsKey && !tempApiKey)}
                className="px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-1"
              >
                <Check size={14} /> 保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
