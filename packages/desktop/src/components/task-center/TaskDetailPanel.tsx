/**
 * TaskDetailPanel — sliding side panel showing task details + sub-agent history.
 */

import { useState, useEffect } from 'react';
import { X, Loader2, Clock, Bot, AlertTriangle, CheckCircle2, RotateCw } from 'lucide-react';
import type { Task } from '../../lib/task-store';

interface TaskDetailPanelProps {
  t: (key: string, fallback?: string) => string;
  task: Task;
  onClose: () => void;
  onRetry?: () => void;
  onCancel?: () => void;
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  backlog: { label: 'Backlog', color: 'text-slate-400', bg: 'bg-slate-800' },
  queued: { label: 'Queued', color: 'text-amber-400', bg: 'bg-amber-900/20' },
  running: { label: 'Running', color: 'text-sky-400', bg: 'bg-sky-900/20' },
  review: { label: 'Review', color: 'text-purple-400', bg: 'bg-purple-900/20' },
  done: { label: 'Done', color: 'text-emerald-400', bg: 'bg-emerald-900/20' },
  failed: { label: 'Failed', color: 'text-red-400', bg: 'bg-red-900/20' },
};

function formatTime(isoStr?: string): string {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function durationStr(startedAt?: string, completedAt?: string): string {
  if (!startedAt) return '—';
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const ms = end - new Date(startedAt).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export default function TaskDetailPanel({ t, task, onClose, onRetry, onCancel }: TaskDetailPanelProps) {
  const [history, setHistory] = useState<any[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const cfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.backlog;

  // Load sub-agent session history
  useEffect(() => {
    if (!task.sessionKey) return;
    setLoadingHistory(true);
    window.electronAPI?.taskDetail?.(task.sessionKey)
      .then((result: any) => {
        if (result?.success) setHistory(result.messages || []);
      })
      .catch(() => {})
      .finally(() => setLoadingHistory(false));
  }, [task.sessionKey]);

  return (
    <div className="fixed inset-y-0 right-0 w-96 z-40 bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col animate-in slide-in-from-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-lg">{task.agentEmoji || '🤖'}</span>
          <h3 className="text-sm font-semibold text-slate-200 truncate">{task.title}</h3>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200">
          <X size={16} />
        </button>
      </div>

      {/* Task metadata */}
      <div className="px-4 py-3 border-b border-slate-800 space-y-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.color} ${cfg.bg}`}>
            {t(`kanban.${task.status}`, cfg.label)}
          </span>
          <span className="text-[10px] text-slate-500">
            {task.agentName || task.agentId}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div>
            <span className="text-slate-500">{t('taskCard.created', 'Created')}</span>
            <p className="text-slate-300">{formatTime(task.createdAt)}</p>
          </div>
          <div>
            <span className="text-slate-500">{t('taskCard.elapsed', 'Elapsed')}</span>
            <p className="text-slate-300">{durationStr(task.startedAt, task.completedAt)}</p>
          </div>
          {task.model && (
            <div>
              <span className="text-slate-500">{t('taskCreate.model', 'Model')}</span>
              <p className="text-slate-300">{task.model}</p>
            </div>
          )}
          {task.runId && (
            <div>
              <span className="text-slate-500">Run ID</span>
              <p className="text-slate-300 truncate text-[10px]">{task.runId}</p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-1">
          {task.status === 'failed' && onRetry && (
            <button onClick={onRetry} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 text-xs font-medium border border-amber-600/30">
              <RotateCw size={11} /> {t('taskCard.retry', 'Retry')}
            </button>
          )}
          {(task.status === 'running' || task.status === 'queued') && onCancel && (
            <button onClick={onCancel} className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-600/20 hover:bg-red-600/30 text-red-300 text-xs font-medium border border-red-600/30">
              <X size={11} /> {t('taskCard.cancel', 'Cancel')}
            </button>
          )}
        </div>
      </div>

      {/* Result / Error */}
      {task.result && (
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 mb-1">
            <CheckCircle2 size={11} />
            <span>{t('taskCard.result', 'Result')}</span>
          </div>
          <pre className="text-xs text-slate-300 whitespace-pre-wrap bg-slate-950 rounded-lg px-3 py-2 max-h-40 overflow-y-auto">
            {task.result}
          </pre>
        </div>
      )}
      {task.error && (
        <div className="px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-1.5 text-[11px] text-red-400 mb-1">
            <AlertTriangle size={11} />
            <span>{t('taskCard.error', 'Error')}</span>
          </div>
          <pre className="text-xs text-red-300/80 whitespace-pre-wrap bg-red-950/20 rounded-lg px-3 py-2 max-h-40 overflow-y-auto">
            {task.error}
          </pre>
        </div>
      )}

      {/* Sub-agent conversation history */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-2">
          <Clock size={11} />
          <span>{t('taskCard.history', 'Sub-agent history')}</span>
        </div>

        {loadingHistory && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={16} className="animate-spin text-slate-500" />
          </div>
        )}

        {!loadingHistory && (!history || history.length === 0) && (
          <div className="text-center py-8 text-[11px] text-slate-600">
            {task.sessionKey ? t('taskCard.noHistory', 'No conversation history available') : t('taskCard.noSession', 'Task not yet started')}
          </div>
        )}

        {history && history.length > 0 && (
          <div className="space-y-2">
            {history.map((msg: any, i: number) => (
              <div key={i} className={`rounded-lg px-3 py-2 text-xs ${
                msg.role === 'user' ? 'bg-sky-950/20 border border-sky-900/30' : 'bg-slate-800/50 border border-slate-700/30'
              }`}>
                <div className="flex items-center gap-1.5 mb-1">
                  {msg.role === 'user' ? (
                    <span className="text-[10px] text-sky-400 font-medium">User</span>
                  ) : (
                    <Bot size={10} className="text-slate-400" />
                  )}
                  <span className="text-[10px] text-slate-500 font-medium">
                    {msg.role === 'assistant' ? 'Agent' : ''}
                  </span>
                </div>
                <p className="text-slate-300 whitespace-pre-wrap line-clamp-6">
                  {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
