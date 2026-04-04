/**
 * KanbanCard — a single task card in the kanban board.
 * Displays agent emoji, title, status badge, elapsed time, and priority stripe.
 */

import { Loader2, RotateCw, X, Eye } from 'lucide-react';
import type { Task } from '../../lib/task-store';

const PRIORITY_COLORS: Record<string, string> = {
  high: 'border-l-red-500',
  medium: 'border-l-amber-500',
  low: 'border-l-slate-500',
};

function elapsed(startedAt?: string): string {
  if (!startedAt) return '';
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3600_000)}h ${Math.floor((ms % 3600_000) / 60_000)}m`;
}

interface KanbanCardProps {
  task: Task;
  t: (key: string, fallback?: string) => string;
  onRetry?: () => void;
  onCancel?: () => void;
  onViewDetail?: () => void;
  isDragging?: boolean;
}

export default function KanbanCard({ task, t, onRetry, onCancel, onViewDetail, isDragging }: KanbanCardProps) {
  const isActive = task.status === 'running' || task.status === 'queued';

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', task.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={`
        group relative rounded-lg border-l-4 ${PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.medium}
        bg-slate-800/60 border border-slate-700/50 p-3 cursor-grab active:cursor-grabbing
        hover:bg-slate-800 hover:border-slate-600/60 transition-all duration-150
        ${isDragging ? 'opacity-50 scale-95' : ''}
      `}
    >
      {/* Header: agent emoji + title */}
      <div className="flex items-start gap-2 mb-2">
        <span className="text-base flex-shrink-0">{task.agentEmoji || '🤖'}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-200 line-clamp-2 leading-snug">{task.title}</p>
          {task.agentName && (
            <p className="text-[11px] text-slate-500 mt-0.5">{task.agentName}</p>
          )}
        </div>
      </div>

      {/* Status + elapsed */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isActive && <Loader2 size={12} className="animate-spin text-sky-400" />}
          {task.status === 'done' && <span className="text-emerald-400 text-xs">✓</span>}
          {task.status === 'failed' && <span className="text-red-400 text-xs">✕</span>}
          <span className="text-[11px] text-slate-400">
            {isActive && task.startedAt ? elapsed(task.startedAt) : ''}
            {task.status === 'done' && task.completedAt && task.startedAt
              ? elapsed(task.startedAt)
              : ''}
          </span>
        </div>

        {/* Actions — visible on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {task.status === 'failed' && onRetry && (
            <button
              onClick={(e) => { e.stopPropagation(); onRetry(); }}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-amber-400"
              title={t('taskCard.retry')}
            >
              <RotateCw size={12} />
            </button>
          )}
          {isActive && onCancel && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-red-400"
              title={t('taskCard.cancel')}
            >
              <X size={12} />
            </button>
          )}
          {onViewDetail && (
            <button
              onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
              className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-sky-400"
              title={t('taskCard.viewDetail')}
            >
              <Eye size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Result preview for done/failed */}
      {task.status === 'done' && task.result && (
        <p className="text-[11px] text-slate-500 mt-2 line-clamp-2 leading-relaxed border-t border-slate-700/40 pt-2">
          {task.result}
        </p>
      )}
      {task.status === 'failed' && task.error && (
        <p className="text-[11px] text-red-400/70 mt-2 line-clamp-2 leading-relaxed border-t border-slate-700/40 pt-2">
          {task.error}
        </p>
      )}
    </div>
  );
}
