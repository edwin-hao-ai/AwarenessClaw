/**
 * Agent Creation Wizard — multi-step guided flow for adding new agents.
 * Mirrors OpenClaw's interactive `openclaw agents add` flow in a desktop-friendly UI.
 *
 * Steps:
 *   0. Agent name + emoji
 *   1. Personality style (SOUL.md template selection)
 *   2. Model selection (from configured providers)
 *   3. Channel binding (optional, from connected channels)
 */
import { useState, useEffect } from 'react';
import {
  ChevronRight, ChevronLeft, Sparkles, Bot, Zap, Feather, Briefcase,
  MessageSquare, Loader2, X, Link, Check,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useDynamicProviders, useAppConfig } from '../lib/store';

type PersonalityStyle = 'friendly' | 'professional' | 'minimal' | 'creative';

interface AgentWizardProps {
  onComplete: () => void;
  onCancel: () => void;
}

const STYLE_ICONS: Record<PersonalityStyle, React.ReactNode> = {
  friendly: <MessageSquare size={20} />,
  professional: <Briefcase size={20} />,
  minimal: <Zap size={20} />,
  creative: <Feather size={20} />,
};

const STYLE_EMOJIS: Record<PersonalityStyle, string> = {
  friendly: '🐾',
  professional: '💼',
  minimal: '⚡',
  creative: '🎨',
};

const SOUL_TEMPLATES: Record<PersonalityStyle, string> = {
  friendly: `You are a warm, supportive AI assistant. Use a conversational and approachable tone.
Feel free to use emojis occasionally. Be encouraging and patient.
Always explain things in a way that's easy to understand.
Match the language of the user's input — if they write in Chinese, respond in Chinese; if in English, respond in English.`,
  professional: `You are a professional AI assistant. Be concise, precise, and business-like.
Focus on clarity and accuracy. Avoid unnecessary filler words.
Structure your responses with clear headings and bullet points when appropriate.
Match the language of the user's input — if they write in Chinese, respond in Chinese; if in English, respond in English.`,
  minimal: `You are a minimalist AI assistant. Keep responses as brief as possible.
Answer directly without preamble or unnecessary context.
Only elaborate when explicitly asked.
Match the language of the user's input.`,
  creative: `You are a creative and expressive AI assistant. Use vivid language, metaphors, and analogies.
Be playful and imaginative while remaining helpful and accurate.
Feel free to explore ideas from multiple angles.
Match the language of the user's input — if they write in Chinese, respond in Chinese; if in English, respond in English.`,
};

const AGENT_EMOJIS = [
  '🤖', '🧠', '🔬', '🎯', '📊', '💡', '🛡️', '🚀',
  '📝', '🔧', '🎨', '📚', '🐾', '💼', '⚡', '🌙',
  '🔥', '🐚', '🏠', '🦞', '👨‍💻', '🧪', '📡', '🎭',
];

const TOTAL_STEPS = 4;

export default function AgentWizard({ onComplete, onCancel }: AgentWizardProps) {
  const { t } = useI18n();
  const { config } = useAppConfig();
  const { providers } = useDynamicProviders();

  // Step state
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Step 0: Name + Emoji
  const [agentName, setAgentName] = useState('');
  const [agentEmoji, setAgentEmoji] = useState('🤖');

  // Step 1: Personality
  const [style, setStyle] = useState<PersonalityStyle>('friendly');
  const [customPrompt, setCustomPrompt] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [useBootstrap, setUseBootstrap] = useState(false); // Let agent discover identity via chat

  // Step 2: Model
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [useMainModel, setUseMainModel] = useState(true);

  // Step 3: Channel binding
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);
  const [selectedBindings, setSelectedBindings] = useState<string[]>([]);

  const styles: PersonalityStyle[] = ['friendly', 'professional', 'minimal', 'creative'];

  // Load available channels on mount
  useEffect(() => {
    const loadChannels = async () => {
      if (!window.electronAPI) return;
      try {
        const result = await (window.electronAPI as any).channelListConfigured();
        const supported = await (window.electronAPI as any).channelListSupported?.();
        const all = new Set<string>([
          ...(result?.configured || []),
          ...(supported?.channels || []),
        ]);
        all.delete('local');
        setAvailableChannels(Array.from(all).sort());
      } catch { /* ignore */ }
    };
    loadChannels();
  }, []);

  // Auto-set emoji when style changes
  useEffect(() => {
    if (!useCustom) {
      setAgentEmoji(STYLE_EMOJIS[style]);
    }
  }, [style, useCustom]);

  // Build the model ID string like "provider/model"
  const getModelId = (): string | undefined => {
    if (useMainModel) return undefined; // Use default from openclaw.json
    if (selectedProvider && selectedModel) {
      return `${selectedProvider}/${selectedModel}`;
    }
    return undefined;
  };

  const handleFinish = async () => {
    if (!agentName.trim()) {
      setError(t('agentWizard.error.nameRequired', 'Please enter a name for the agent'));
      setStep(0);
      return;
    }

    setSaving(true);
    setSavingStatus(t('agentWizard.status.starting', 'Starting Gateway...'));
    setError(null);

    try {
      const api = window.electronAPI as any;
      if (!api) { onComplete(); return; }

      const finalName = agentName.trim();
      const modelId = getModelId();

      // Build SOUL.md content — only when NOT using bootstrap mode
      const soulContent = useBootstrap
        ? undefined
        : (useCustom && customPrompt.trim() ? customPrompt.trim() : SOUL_TEMPLATES[style]);

      // 1. Create agent via IPC (calls openclaw agents add — loads all plugins, can take 15-30s)
      setSavingStatus(t('agentWizard.status.creating', 'Creating agent (loading plugins)...'));
      const result = await api.agentsAdd(finalName, modelId, soulContent);
      if (!result.success) {
        const errMsg = result.error || '';
        if (/already exists|duplicate/i.test(errMsg)) {
          setError(t('agentWizard.error.duplicate', 'Agent "{name}" already exists.').replace('{name}', finalName));
        } else if (/permission|access|denied/i.test(errMsg)) {
          setError(t('agentWizard.error.permission', 'Permission denied. Check system permissions.'));
        } else if (/timed? ?out/i.test(errMsg)) {
          setError(t('agentWizard.error.timeout', 'OpenClaw is loading plugins — this can take up to 30s. Please try again.'));
        } else {
          setError(errMsg || t('agentWizard.error.createFailed', 'Failed to create agent.'));
        }
        setSaving(false);
        setSavingStatus('');
        return;
      }

      // 2. Set identity (name + emoji)
      setSavingStatus(t('agentWizard.status.identity', 'Setting identity...'));
      const slug = result.agentId || finalName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `agent-${Date.now()}`;
      if (api.agentsSetIdentity) {
        await api.agentsSetIdentity(slug, finalName, agentEmoji);
      }

      // 3. Write workspace files based on mode
      setSavingStatus(t('agentWizard.status.workspace', 'Writing workspace files...'));
      if (useBootstrap) {
        // Bootstrap mode: keep BOOTSTRAP.md, DON'T write SOUL.md — agent will discover
        // its identity through conversation on first chat (OpenClaw native bootstrap flow).
        // Only write minimal IDENTITY.md with name + emoji so the agent selector works.
        if (api.agentsWriteFile) {
          await api.agentsWriteFile(slug, 'IDENTITY.md',
            `# Identity\n\n- **name**: ${finalName}\n- **emoji**: ${agentEmoji}\n- **role**: AI Assistant\n`
          );
        }
      } else {
        // Template mode: write SOUL.md + IDENTITY.md, delete BOOTSTRAP.md
        if (api.agentsWriteFile) {
          await api.agentsWriteFile(slug, 'IDENTITY.md',
            `# Identity\n\n- **name**: ${finalName}\n- **emoji**: ${agentEmoji}\n- **role**: AI Assistant\n`
          );
        }
        // Delete BOOTSTRAP.md — our wizard already set the personality via SOUL.md template
        try {
          if (api.agentsDeleteFile) {
            await api.agentsDeleteFile(slug, 'BOOTSTRAP.md');
          }
        } catch { /* ignore — file may not exist */ }
      }

      // 4. Bind selected channels
      if (api.agentsBind && selectedBindings.length > 0) {
        setSavingStatus(t('agentWizard.status.binding', 'Binding channels...'));
        for (const channel of selectedBindings) {
          try {
            await api.agentsBind(slug, channel);
          } catch { /* ignore individual bind failures */ }
        }
      }

      onComplete();
    } catch (err: any) {
      setError(err?.message || t('agentWizard.error.unexpected', 'Unexpected error.'));
    } finally {
      setSaving(false);
      setSavingStatus('');
    }
  };

  const canProceed = () => {
    if (step === 0) return agentName.trim().length > 0;
    return true;
  };

  const handleNext = () => {
    if (step < TOTAL_STEPS - 1) {
      setError(null);
      setStep(step + 1);
    } else {
      handleFinish();
    }
  };

  const toggleBinding = (channel: string) => {
    setSelectedBindings(prev =>
      prev.includes(channel)
        ? prev.filter(c => c !== channel)
        : [...prev, channel]
    );
  };

  // Get providers that have API keys configured
  const configuredProviders = providers.filter(p => {
    const profile = config.providerProfiles?.[p.key];
    return profile?.apiKey || !p.needsKey;
  });

  const currentProvider = providers.find(p => p.key === selectedProvider);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex items-center justify-center p-6">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-brand-500/10 flex items-center justify-center mx-auto mb-3">
            <Bot size={28} className="text-brand-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-1">{t('agentWizard.title', 'Create New Agent')}</h1>
          <p className="text-slate-400 text-sm">{t('agentWizard.subtitle', 'Set up an isolated agent with its own workspace')}</p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-6">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <div key={i} className={`w-2 h-2 rounded-full transition-colors ${
              i === step ? 'bg-brand-500' : i < step ? 'bg-brand-500/50' : 'bg-slate-700'
            }`} />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-red-600/10 border border-red-600/20 rounded-xl text-xs text-red-400">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X size={12} /></button>
          </div>
        )}

        {/* Step content */}
        <div className="bg-slate-900/80 rounded-2xl border border-slate-800 p-6 min-h-[300px] flex flex-col">

          {/* Step 0: Name + Emoji */}
          {step === 0 && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="text-center">
                <h2 className="text-lg font-semibold text-white mb-1">{t('agentWizard.step1.title', 'Name your agent')}</h2>
                <p className="text-xs text-slate-500">{t('agentWizard.step1.hint', 'Give it a unique name and emoji')}</p>
              </div>

              <div className="flex items-center gap-3 mx-auto w-full max-w-xs">
                <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-2xl shrink-0">
                  {agentEmoji}
                </div>
                <input
                  type="text"
                  value={agentName}
                  onChange={e => setAgentName(e.target.value)}
                  placeholder={t('agentWizard.step1.placeholder', 'e.g. Research, Coding, Writer...')}
                  className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-brand-500"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && canProceed() && handleNext()}
                />
              </div>

              <div>
                <p className="text-[11px] text-slate-500 mb-2">{t('agentWizard.step1.pickEmoji', 'Pick an icon:')}</p>
                <div className="grid grid-cols-8 gap-1.5">
                  {AGENT_EMOJIS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setAgentEmoji(emoji)}
                      className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-all ${
                        agentEmoji === emoji
                          ? 'bg-brand-500/20 ring-2 ring-brand-500 scale-110'
                          : 'bg-slate-800/50 hover:bg-slate-700/70'
                      }`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-slate-600 text-center">{t('agentWizard.step1.naming', 'Any language supported - Chinese, English, etc.')}</p>
            </div>
          )}

          {/* Step 1: Personality Style */}
          {step === 1 && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="text-center mb-1">
                <h2 className="text-lg font-semibold text-white">{t('agentWizard.step2.title', 'Choose a personality')}</h2>
                <p className="text-xs text-slate-500">{t('agentWizard.step2.hint', 'This defines the SOUL.md for your agent')}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {styles.map(s => (
                  <button
                    key={s}
                    onClick={() => { setStyle(s); setUseCustom(false); }}
                    className={`p-3.5 rounded-xl border text-left transition-all ${
                      !useCustom && style === s
                        ? 'border-brand-500 bg-brand-500/10'
                        : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={!useCustom && style === s ? 'text-brand-400' : 'text-slate-500'}>{STYLE_ICONS[s]}</span>
                      <span className={`text-sm font-medium ${!useCustom && style === s ? 'text-brand-300' : 'text-slate-300'}`}>
                        {t(`bootstrap.step2.${s}`)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-snug">{t(`bootstrap.step2.${s}.desc`)}</p>
                  </button>
                ))}
              </div>

              {/* Bootstrap: let agent discover itself through conversation */}
              <button
                onClick={() => { setUseBootstrap(!useBootstrap); setUseCustom(false); }}
                className={`px-3 py-2 rounded-lg border text-xs text-left transition-all ${
                  useBootstrap ? 'border-amber-500 bg-amber-500/10 text-amber-300' : 'border-slate-700 text-slate-500 hover:border-slate-600'
                }`}
              >
                💬 {t('agentWizard.step2.bootstrap', 'Discover through conversation')}
                <span className="block text-[10px] mt-0.5 opacity-70">
                  {t('agentWizard.step2.bootstrapHint', 'Agent will ask you questions on first chat to define itself')}
                </span>
              </button>

              {/* Custom prompt toggle */}
              {!useBootstrap && (
                <button
                  onClick={() => setUseCustom(!useCustom)}
                  className={`px-3 py-2 rounded-lg border text-xs text-left transition-all ${
                    useCustom ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'border-slate-700 text-slate-500 hover:border-slate-600'
                  }`}
                >
                  ✏️ {t('agentWizard.step2.custom', 'Write custom system prompt')}
                </button>
              )}

              {useCustom && !useBootstrap && (
                <textarea
                  value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)}
                  placeholder={t('agents.systemPromptPlaceholder')}
                  rows={4}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-300 font-mono focus:outline-none focus:border-brand-500 resize-y"
                />
              )}
            </div>
          )}

          {/* Step 2: Model Selection */}
          {step === 2 && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="text-center mb-1">
                <h2 className="text-lg font-semibold text-white">{t('agentWizard.step3.title', 'Select a model')}</h2>
                <p className="text-xs text-slate-500">{t('agentWizard.step3.hint', 'Choose which AI model this agent uses')}</p>
              </div>

              {/* Use main model toggle */}
              <button
                onClick={() => setUseMainModel(true)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  useMainModel ? 'border-brand-500 bg-brand-500/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    useMainModel ? 'border-brand-500' : 'border-slate-600'
                  }`}>
                    {useMainModel && <div className="w-2 h-2 rounded-full bg-brand-500" />}
                  </div>
                  <span className={`text-sm ${useMainModel ? 'text-brand-300' : 'text-slate-400'}`}>
                    {t('agentWizard.step3.useDefault', 'Use default model')}
                  </span>
                  <span className="text-[10px] text-slate-500 ml-auto">
                    {config.providerKey && config.modelId ? `${config.providerKey}/${config.modelId}` : ''}
                  </span>
                </div>
              </button>

              <button
                onClick={() => setUseMainModel(false)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  !useMainModel ? 'border-brand-500 bg-brand-500/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    !useMainModel ? 'border-brand-500' : 'border-slate-600'
                  }`}>
                    {!useMainModel && <div className="w-2 h-2 rounded-full bg-brand-500" />}
                  </div>
                  <span className={`text-sm ${!useMainModel ? 'text-brand-300' : 'text-slate-400'}`}>
                    {t('agentWizard.step3.chooseModel', 'Choose a different model')}
                  </span>
                </div>
              </button>

              {/* Model picker */}
              {!useMainModel && (
                <div className="space-y-2 max-h-[180px] overflow-y-auto">
                  {/* Provider select */}
                  <select
                    value={selectedProvider}
                    onChange={e => { setSelectedProvider(e.target.value); setSelectedModel(''); }}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-brand-500"
                  >
                    <option value="">{t('agentWizard.step3.selectProvider', '-- Select provider --')}</option>
                    {configuredProviders.map(p => (
                      <option key={p.key} value={p.key}>{p.emoji} {p.name}</option>
                    ))}
                  </select>

                  {/* Model select */}
                  {currentProvider && (
                    <select
                      value={selectedModel}
                      onChange={e => setSelectedModel(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-brand-500"
                    >
                      <option value="">{t('agentWizard.step3.selectModel', '-- Select model --')}</option>
                      {currentProvider.models.map((m: { id: string; label: string }) => (
                        <option key={m.id} value={m.id}>{m.label || m.id}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Step 3: Channel Binding */}
          {step === 3 && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="text-center mb-1">
                <h2 className="text-lg font-semibold text-white">{t('agentWizard.step4.title', 'Route channels')}</h2>
                <p className="text-xs text-slate-500">{t('agentWizard.step4.hint', 'Optionally bind messaging channels to this agent')}</p>
              </div>

              {availableChannels.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3">
                  <Link size={24} className="text-slate-600" />
                  <p className="text-sm text-slate-500 text-center">
                    {t('agentWizard.step4.noChannels', 'No channels connected yet. You can bind channels later from the Agents page.')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                  <p className="text-[11px] text-slate-500">
                    {t('agentWizard.step4.selectChannels', 'Select channels to route to this agent:')}
                  </p>
                  {availableChannels.map(channel => (
                    <button
                      key={channel}
                      onClick={() => toggleBinding(channel)}
                      className={`w-full p-3 rounded-xl border text-left transition-all flex items-center gap-3 ${
                        selectedBindings.includes(channel)
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                      }`}
                    >
                      <div className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
                        selectedBindings.includes(channel) ? 'border-emerald-500 bg-emerald-500' : 'border-slate-600'
                      }`}>
                        {selectedBindings.includes(channel) && <Check size={12} className="text-white" />}
                      </div>
                      <Link size={14} className={selectedBindings.includes(channel) ? 'text-emerald-400' : 'text-slate-500'} />
                      <span className={`text-sm ${selectedBindings.includes(channel) ? 'text-emerald-300' : 'text-slate-300'}`}>
                        {channel}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Status message during creation */}
        {saving && savingStatus && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin" />
            <span>{savingStatus}</span>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-4">
          <div>
            {saving ? (
              <span />
            ) : step > 0 ? (
              <button
                onClick={() => { setStep(step - 1); setError(null); }}
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors"
              >
                <ChevronLeft size={16} />
                {t('bootstrap.back')}
              </button>
            ) : (
              <button
                onClick={onCancel}
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                {t('common.cancel', 'Cancel')}
              </button>
            )}
          </div>
          <div>
            {step < TOTAL_STEPS - 1 ? (
              <button
                onClick={handleNext}
                disabled={!canProceed()}
                className="flex items-center gap-1 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
              >
                {t('bootstrap.next')}
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={saving || !canProceed()}
                className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {saving ? (
                  <><Loader2 size={14} className="animate-spin" /> {t('agentWizard.creating', 'Creating...')}</>
                ) : (
                  <><Sparkles size={14} /> {t('agentWizard.finish', 'Create Agent')}</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
