/**
 * TaskCreateModal — create a new task and assign it to an agent.
 * Super beginner-friendly: just describe what you want done + pick an agent.
 */

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';

interface AgentOption {
  id: string;
  name?: string;
  emoji?: string;
}

interface TaskCreateModalProps {
  t: (key: string, fallback?: string) => string;
  agents: readonly AgentOption[];
  onClose: () => void;
  onCreate: (params: {
    title: string;
    agentId: string;
    priority: 'low' | 'medium' | 'high';
    model?: string;
    timeoutSeconds?: number;
  }) => Promise<void>;
}

const TIMEOUT_OPTIONS = [
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
  { label: '10 min', value: 600 },
  { label: '30 min', value: 1800 },
];

export default function TaskCreateModal({ t, agents, onClose, onCreate }: TaskCreateModalProps) {
  const [title, setTitle] = useState('');
  const [agentId, setAgentId] = useState(agents[0]?.id || 'main');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [timeout, setTimeout] = useState(300);
  const [creating, setCreating] = useState(false);

  async function handleSubmit() {
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate({
        title: title.trim(),
        agentId,
        priority,
        timeoutSeconds: timeout,
      });
      onClose();
    } catch {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md mx-4 shadow-2xl animate-in zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-base font-semibold text-slate-100">{t('taskCreate.title')}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Task description */}
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">
              {t('taskCreate.description')}
            </label>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('taskCreate.descPlaceholder')}
              rows={3}
              autoFocus
              className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/40 focus:border-sky-500/60 resize-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit();
              }}
            />
          </div>

          {/* Agent + Priority row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Agent selector */}
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                {t('taskCreate.assignTo')}
              </label>
              <select
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.emoji || '🤖'} {a.name || a.id}
                  </option>
                ))}
              </select>
            </div>

            {/* Priority */}
            <div>
              <label className="text-xs font-medium text-slate-400 mb-1.5 block">
                {t('taskCreate.priority')}
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                <option value="low">{t('taskCreate.priorityLow')}</option>
                <option value="medium">{t('taskCreate.priorityMedium')}</option>
                <option value="high">{t('taskCreate.priorityHigh')}</option>
              </select>
            </div>
          </div>

          {/* Timeout */}
          <div>
            <label className="text-xs font-medium text-slate-400 mb-1.5 block">
              {t('taskCreate.timeout')}
            </label>
            <div className="flex gap-2">
              {TIMEOUT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setTimeout(opt.value)}
                  className={`
                    flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${timeout === opt.value
                      ? 'bg-sky-600/20 text-sky-400 border border-sky-500/40'
                      : 'bg-slate-800 text-slate-400 border border-slate-700 hover:bg-slate-700'
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            {t('taskCreate.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || creating}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {creating && <Loader2 size={14} className="animate-spin" />}
            {creating ? t('taskCreate.creating') : t('taskCreate.createAndRun')}
          </button>
        </div>
      </div>
    </div>
  );
}
