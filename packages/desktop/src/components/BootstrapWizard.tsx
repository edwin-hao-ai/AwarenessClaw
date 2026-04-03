/**
 * Bootstrap onboarding wizard — runs once for new users.
 * Collects: user name, AI personality style, AI name.
 * Writes SOUL.md, USER.md, IDENTITY.md to workspace.
 */
import { useState } from 'react';
import { ChevronRight, ChevronLeft, Sparkles, User, Bot, Zap, Feather, Briefcase, MessageSquare, Loader2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import logoUrl from '../assets/logo.png';

type PersonalityStyle = 'friendly' | 'professional' | 'minimal' | 'creative';

interface BootstrapWizardProps {
  onComplete: () => void;
  onSkip: () => void;
}

const STYLE_ICONS: Record<PersonalityStyle, React.ReactNode> = {
  friendly: <MessageSquare size={20} />,
  professional: <Briefcase size={20} />,
  minimal: <Zap size={20} />,
  creative: <Feather size={20} />,
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

export default function BootstrapWizard({ onComplete, onSkip }: BootstrapWizardProps) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [userName, setUserName] = useState('');
  const [style, setStyle] = useState<PersonalityStyle>('friendly');
  const [agentName, setAgentName] = useState('');
  const [saving, setSaving] = useState(false);

  const styles: PersonalityStyle[] = ['friendly', 'professional', 'minimal', 'creative'];

  const handleFinish = async () => {
    setSaving(true);
    try {
      const api = window.electronAPI as any;
      if (!api) { onComplete(); return; }

      const writeBootstrapFile = async (fileName: string, content: string) => {
        if (api.agentsWriteFile) {
          return api.agentsWriteFile('main', fileName, content);
        }
        if (api.workspaceWriteFile) {
          return api.workspaceWriteFile(fileName, content);
        }
        throw new Error('No workspace writer available');
      };

      const finalAgentName = agentName.trim() || t('bootstrap.step3.default', 'Claw');
      const finalUserName = userName.trim() || 'User';

      // Write USER.md
      await writeBootstrapFile('USER.md',
        `# User Profile\n\n- **Name**: ${finalUserName}\n- **Preferred style**: ${style}\n`
      );

      // Write SOUL.md
      const soulContent = SOUL_TEMPLATES[style];
      await writeBootstrapFile('SOUL.md',
        `# ${finalAgentName}\n\n${soulContent}\n\nThe user's name is **${finalUserName}**. Address them by name when natural.\n`
      );

      // Write IDENTITY.md
      const emoji = style === 'friendly' ? '🐾' : style === 'professional' ? '💼' : style === 'minimal' ? '⚡' : '🎨';
      await writeBootstrapFile('IDENTITY.md',
        `# Identity\n\n- **name**: ${finalAgentName}\n- **emoji**: ${emoji}\n- **role**: AI Assistant\n`
      );

      // Delete BOOTSTRAP.md — OpenClaw creates this as a one-time first-run ritual file.
      // Once our wizard completes, we delete it so OpenClaw doesn't re-run its own bootstrap.
      try {
        if (api.agentsDeleteFile) {
          await api.agentsDeleteFile('main', 'BOOTSTRAP.md');
        }
      } catch { /* ignore — file may not exist */ }

      onComplete();
    } catch {
      // If writing fails, still complete — user can edit later
      onComplete();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <img src={logoUrl} alt="logo" className="w-16 h-16 mx-auto mb-4 rounded-2xl" />
          <h1 className="text-2xl font-bold text-white mb-2">{t('bootstrap.title')}</h1>
          <p className="text-slate-400 text-sm">{t('bootstrap.subtitle')}</p>
        </div>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 mb-8">
          {[0, 1, 2].map(i => (
            <div key={i} className={`w-2 h-2 rounded-full transition-colors ${i === step ? 'bg-brand-500' : i < step ? 'bg-brand-500/50' : 'bg-slate-700'}`} />
          ))}
        </div>

        {/* Step content */}
        <div className="bg-slate-900/80 rounded-2xl border border-slate-800 p-6 min-h-[280px] flex flex-col">
          {step === 0 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="w-14 h-14 rounded-full bg-brand-500/10 flex items-center justify-center">
                <User size={28} className="text-brand-400" />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-white mb-1">{t('bootstrap.step1.title')}</h2>
                <p className="text-xs text-slate-500">{t('bootstrap.step1.hint')}</p>
              </div>
              <input
                type="text"
                value={userName}
                onChange={e => setUserName(e.target.value)}
                placeholder={t('bootstrap.step1.placeholder')}
                className="w-full max-w-xs px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-brand-500 text-center"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && setStep(1)}
              />
            </div>
          )}

          {step === 1 && (
            <div className="flex-1 flex flex-col gap-4">
              <div className="text-center mb-2">
                <h2 className="text-lg font-semibold text-white">{t('bootstrap.step2.title')}</h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {styles.map(s => (
                  <button
                    key={s}
                    onClick={() => setStyle(s)}
                    className={`p-4 rounded-xl border text-left transition-all ${style === s
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={style === s ? 'text-brand-400' : 'text-slate-500'}>{STYLE_ICONS[s]}</span>
                      <span className={`text-sm font-medium ${style === s ? 'text-brand-300' : 'text-slate-300'}`}>
                        {t(`bootstrap.step2.${s}`)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 leading-snug">{t(`bootstrap.step2.${s}.desc`)}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="flex-1 flex flex-col items-center justify-center gap-6">
              <div className="w-14 h-14 rounded-full bg-brand-500/10 flex items-center justify-center">
                <Bot size={28} className="text-brand-400" />
              </div>
              <div className="text-center">
                <h2 className="text-lg font-semibold text-white mb-1">{t('bootstrap.step3.title')}</h2>
                <p className="text-xs text-slate-500">{t('bootstrap.step3.hint')}</p>
              </div>
              <input
                type="text"
                value={agentName}
                onChange={e => setAgentName(e.target.value)}
                placeholder={t('bootstrap.step3.placeholder')}
                className="w-full max-w-xs px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-slate-100 text-sm focus:outline-none focus:border-brand-500 text-center"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleFinish()}
              />
            </div>
          )}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-6">
          <div>
            {step > 0 ? (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1 text-sm text-slate-400 hover:text-white transition-colors"
              >
                <ChevronLeft size={16} />
                {t('bootstrap.back')}
              </button>
            ) : (
              <button
                onClick={onSkip}
                className="text-sm text-slate-500 hover:text-slate-300 transition-colors"
              >
                {t('bootstrap.skip')}
              </button>
            )}
          </div>
          <div>
            {step < 2 ? (
              <button
                onClick={() => setStep(step + 1)}
                className="flex items-center gap-1 px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {t('bootstrap.next')}
                <ChevronRight size={16} />
              </button>
            ) : (
              <button
                onClick={handleFinish}
                disabled={saving}
                className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
              >
                {saving ? (
                  <><Loader2 size={14} className="animate-spin" /> {t('bootstrap.generating')}</>
                ) : (
                  <><Sparkles size={14} /> {t('bootstrap.finish')}</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
