/**
 * KanbanBoard — 6-column drag-and-drop task board.
 * Uses HTML5 DnD API — zero new dependencies.
 *
 * Columns: Backlog → Queued → Running → Review → Done → Failed
 * Drag rules:
 *   Backlog → Queued: triggers sub-agent spawn
 *   Failed → Queued: triggers retry
 *   Other moves are local reorder only
 */

import { useState } from 'react';
import KanbanCard from './KanbanCard';
import { KANBAN_COLUMNS, tasksByColumn } from '../../lib/task-store';
import type { Task, TaskStatus } from '../../lib/task-store';

const COLUMN_I18N: Record<TaskStatus, string> = {
  backlog: 'kanban.backlog',
  queued: 'kanban.queued',
  running: 'kanban.running',
  review: 'kanban.review',
  done: 'kanban.done',
  failed: 'kanban.failed',
};

const COLUMN_COLORS: Record<TaskStatus, string> = {
  backlog: 'bg-slate-500',
  queued: 'bg-amber-500',
  running: 'bg-sky-500',
  review: 'bg-purple-500',
  done: 'bg-emerald-500',
  failed: 'bg-red-500',
};

interface KanbanBoardProps {
  tasks: readonly Task[];
  t: (key: string, fallback?: string) => string;
  onMoveTask: (taskId: string, fromColumn: TaskStatus, toColumn: TaskStatus) => void;
  onRetryTask: (taskId: string) => void;
  onCancelTask: (taskId: string) => void;
  onViewDetail: (taskId: string) => void;
}

export default function KanbanBoard({
  tasks,
  t,
  onMoveTask,
  onRetryTask,
  onCancelTask,
  onViewDetail,
}: KanbanBoardProps) {
  const columns = tasksByColumn(tasks);
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null);

  function handleDragOver(e: React.DragEvent, column: TaskStatus) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverColumn(column);
  }

  function handleDragLeave() {
    setDragOverColumn(null);
  }

  function handleDrop(e: React.DragEvent, toColumn: TaskStatus) {
    e.preventDefault();
    setDragOverColumn(null);

    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === toColumn) return;

    onMoveTask(taskId, task.status, toColumn);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4 min-h-0 flex-1">
      {KANBAN_COLUMNS.map((column) => {
        const items = columns[column];
        const isOver = dragOverColumn === column;

        return (
          <div
            key={column}
            className={`
              flex-shrink-0 w-64 flex flex-col rounded-xl
              bg-slate-900/50 border transition-colors duration-150
              ${isOver ? 'border-sky-500/50 bg-sky-950/20' : 'border-slate-800/60'}
            `}
            onDragOver={(e) => handleDragOver(e, column)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, column)}
          >
            {/* Column header */}
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-800/60">
              <div className={`w-2 h-2 rounded-full ${COLUMN_COLORS[column]}`} />
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                {t(COLUMN_I18N[column])}
              </span>
              {items.length > 0 && (
                <span className="ml-auto text-[10px] text-slate-500 bg-slate-800 rounded-full px-1.5 py-0.5">
                  {items.length}
                </span>
              )}
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
              {items.length === 0 && (
                <div className="text-center py-6 text-[11px] text-slate-600">
                  {column === 'backlog' ? t('kanban.dragHint') : ''}
                </div>
              )}
              {items.map((task) => (
                <KanbanCard
                  key={task.id}
                  task={task}
                  t={t}
                  onRetry={() => onRetryTask(task.id)}
                  onCancel={() => onCancelTask(task.id)}
                  onViewDetail={() => onViewDetail(task.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
