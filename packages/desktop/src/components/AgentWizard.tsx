/**
 * Agent Creation Wizard — streamlined flow: name + emoji → create → jump to chat.
 *
 * The agent's personality, user preferences, and identity are defined through
 * conversation (BOOTSTRAP.md Q&A ritual) rather than static templates.
 * This gives users a much richer, conversational setup experience.
 *
 * Flow:
 *   1. Enter name + pick emoji
 *   2. Create agent (preserving BOOTSTRAP.md for first-chat Q&A)
 *   3. Auto-navigate to chat with the new agent → Bootstrap ritual starts
 */
import { useState } from 'react';
import {
  Sparkles, Bot, Loader2, X, MessageSquare,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface AgentWizardProps {
  onComplete: (agentId?: string) => void;
  onCancel: () => void;
}

const AGENT_EMOJIS = [
  '🤖', '🧠', '🔬', '🎯', '📊', '💡', '🛡️', '🚀',
  '📝', '🔧', '🎨', '📚', '🐾', '💼', '⚡', '🌙',
  '🔥', '🐚', '🏠', '🦞', '👨‍💻', '🧪', '📡', '🎭',
];

export default function AgentWizard({ onComplete, onCancel }: AgentWizardProps) {
  const { t } = useI18n();

  const [agentName, setAgentName] = useState('');
  const [agentEmoji, setAgentEmoji] = useState('🤖');
  const [saving, setSaving] = useState(false);
  const [savingStatus, setSavingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    const finalName = agentName.trim();
    if (!finalName) {
      setError(t('agentWizard.error.nameRequired', 'Please enter a name for the agent'));
      return;
    }

    setSaving(true);
    setSavingStatus(t('agentWizard.status.creating', 'Creating agent (loading plugins)...'));
    setError(null);

    try {
      const api = window.electronAPI as any;
      if (!api) { onComplete(); return; }

      // 1. Create agent — NO systemPrompt so BOOTSTRAP.md is preserved for first-chat Q&A
      const result = await api.agentsAdd(finalName, undefined, undefined);
      const alreadyExists = !result.success && /already exists|duplicate/i.test(result.error || '');
      if (!result.success && !alreadyExists) {
        const errMsg = result.error || '';
        if (/permission|access|denied/i.test(errMsg)) {
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

      // 2. Set identity (display name + emoji)
      setSavingStatus(t('agentWizard.status.identity', 'Setting identity...'));
      const slug = result.agentId || finalName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `oc-${Date.now()}`;
      if (api.agentsSetIdentity) {
        await api.agentsSetIdentity(slug, finalName, agentEmoji);
      }

      // 3. Write IDENTITY.md with name + emoji (for agent selector display)
      setSavingStatus(t('agentWizard.status.workspace', 'Setting up workspace...'));
      if (api.agentsWriteFile) {
        await api.agentsWriteFile(slug, 'IDENTITY.md',
          `# Identity\n\n- **name**: ${finalName}\n- **emoji**: ${agentEmoji}\n- **role**: AI Assistant\n`
        );
      }

      // BOOTSTRAP.md is preserved — the first chat message will inject its content
      // and the agent will run the Q&A ritual to set up SOUL.md, USER.md, etc.

      // Return agentId so Dashboard can auto-switch to this agent and start chatting
      onComplete(slug);
    } catch (err: any) {
      setError(err?.message || t('agentWizard.error.unexpected', 'Unexpected error.'));
    } finally {
      setSaving(false);
      setSavingStatus('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/95 flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-full bg-brand-500/10 flex items-center justify-center mx-auto mb-3">
            <Bot size={28} className="text-brand-400" />
          </div>
          <h1 className="text-xl font-bold text-white mb-1">{t('agentWizard.title', 'Create New Agent')}</h1>
          <p className="text-slate-400 text-sm">{t('agentWizard.subtitle', 'Set up an isolated agent with its own workspace')}</p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 flex items-center gap-2 p-3 bg-red-600/10 border border-red-600/20 rounded-xl text-xs text-red-400">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)}><X size={12} /></button>
          </div>
        )}

        {/* Content */}
        <div className="bg-slate-900/80 rounded-2xl border border-slate-800 p-6 flex flex-col gap-5">

          {/* Name input */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-1">{t('agentWizard.step1.title', 'Name your agent')}</h2>
            <p className="text-xs text-slate-500 mb-3">{t('agentWizard.step1.hint', 'Give it a unique name and emoji')}</p>
            <div className="flex items-center gap-3">
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
                onKeyDown={e => e.key === 'Enter' && agentName.trim() && !saving && handleCreate()}
              />
            </div>
          </div>

          {/* Emoji picker */}
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

          {/* How it works hint */}
          <div className="flex items-start gap-2 p-3 bg-amber-600/5 border border-amber-600/15 rounded-xl">
            <MessageSquare size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-[11px] text-slate-400 leading-relaxed">
              {t('agentWizard.bootstrapHint',
                'After creating, you\'ll start a conversation with your new agent. It will ask you questions to understand your needs, personality preferences, and setup — all through natural chat.'
              )}
            </div>
          </div>

          <p className="text-[10px] text-slate-600 text-center">{t('agentWizard.step1.naming', 'Any language supported - Chinese, English, etc.')}</p>
        </div>

        {/* Status message during creation */}
        {saving && savingStatus && (
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin" />
            <span>{savingStatus}</span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between mt-4">
          <button
            onClick={onCancel}
            disabled={saving}
            className="text-sm text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !agentName.trim()}
            data-testid="agent-create-btn"
            className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {saving ? (
              <><Loader2 size={14} className="animate-spin" /> {t('agentWizard.creating', 'Creating...')}</>
            ) : (
              <><Sparkles size={14} /> {t('agentWizard.finish', 'Create & Start Chat')}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
