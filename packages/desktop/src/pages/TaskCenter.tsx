/**
 * TaskCenter — unified kanban + workflow page.
 *
 * Board tab: 6-column drag-and-drop kanban (tasks = sub-agent runs)
 * Workflows tab: Lobster YAML templates (Phase 2)
 * History tab: completed task timeline (Phase 3)
 *
 * First-use onboarding: checks maxSpawnDepth, agent count, Lobster.
 */

import { useState, useEffect, useCallback } from 'react';
import { Target, Plus, Zap, AlertCircle, Loader2, Bot, ArrowRight } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import {
  loadTasks,
  saveTasks,
  createTask,
  addTask,
  updateTask,
  queueTask,
  removeTask,
  applySubAgentEvent,
  loadWorkflowRuns,
  saveWorkflowRuns,
  createWorkflowRun,
  updateWorkflowRun,
} from '../lib/task-store';
import type { Task, TaskStatus, WorkflowRun } from '../lib/task-store';
import KanbanBoard from '../components/task-center/KanbanBoard';
import TaskCreateModal from '../components/task-center/TaskCreateModal';
import TaskDetailPanel from '../components/task-center/TaskDetailPanel';
import WorkflowList from '../components/task-center/WorkflowList';
import WorkflowRunner from '../components/task-center/WorkflowRunner';

type Tab = 'board' | 'workflows' | 'history';

interface AgentInfo {
  id: string;
  name?: string;
  emoji?: string;
}

interface SetupStatus {
  checked: boolean;
  maxSpawnDepth: number;
  agentCount: number;
  agentToAgentEnabled: boolean;
}

export default function TaskCenter({ onNavigate }: { onNavigate?: (page: any) => void }) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<Tab>('board');
  const [tasks, setTasks] = useState<readonly Task[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [setup, setSetup] = useState<SetupStatus>({ checked: false, maxSpawnDepth: 1, agentCount: 0, agentToAgentEnabled: false });
  const [enabling, setEnabling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  // Workflow state
  const [workflows, setWorkflows] = useState<any[]>([]);
  const [workflowRuns, setWorkflowRuns] = useState<readonly WorkflowRun[]>([]);
  const [activeWorkflowRun, setActiveWorkflowRun] = useState<WorkflowRun | null>(null);
  const [lobsterStatus, setLobsterStatus] = useState<{ checked: boolean; installed: boolean; enabled: boolean }>({ checked: false, installed: false, enabled: false });
  const [lobsterInstalling, setLobsterInstalling] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  // Load tasks from localStorage on mount
  useEffect(() => {
    setTasks(loadTasks());
  }, []);

  // Persist tasks whenever they change
  useEffect(() => {
    if (tasks.length > 0 || localStorage.getItem('awareness-claw-tasks')) {
      saveTasks(tasks);
    }
  }, [tasks]);

  // Load agents
  useEffect(() => {
    window.electronAPI?.agentsList?.().then((result: any) => {
      const list = result?.agents || (Array.isArray(result) ? result : []);
      if (list.length > 0) {
        setAgents(list.map((a: any) => ({
          id: a.id || 'main',
          name: a.name || a.id,
          emoji: a.emoji,
        })));
      }
    }).catch(() => {});
  }, []);

  // Check setup status
  useEffect(() => {
    const check = async () => {
      try {
        const config = await window.electronAPI?.workflowConfig?.();
        const agentsResult = await window.electronAPI?.agentsList?.();
        const agentsList = (agentsResult as any)?.agents || (Array.isArray(agentsResult) ? agentsResult : []);
        const agentCount = agentsList.length;
        setSetup({
          checked: true,
          maxSpawnDepth: config?.maxSpawnDepth ?? 1,
          agentCount,
          agentToAgentEnabled: config?.agentToAgentEnabled ?? false,
        });
      } catch {
        setSetup((s) => ({ ...s, checked: true }));
      }
    };
    check();
  }, []);

  // Load workflow templates + Lobster status
  useEffect(() => {
    window.electronAPI?.workflowList?.().then((result: any) => {
      setWorkflows(result?.workflows || []);
    }).catch(() => {});

    window.electronAPI?.workflowCheckLobster?.().then((result: any) => {
      setLobsterStatus({ checked: true, installed: result?.installed ?? false, enabled: result?.enabled ?? false });
    }).catch(() => {
      setLobsterStatus((s) => ({ ...s, checked: true }));
    });

    setWorkflowRuns(loadWorkflowRuns());
  }, []);

  // Persist workflow runs
  useEffect(() => {
    if (workflowRuns.length > 0 || localStorage.getItem('awareness-claw-workflow-runs')) {
      saveWorkflowRuns(workflowRuns);
    }
  }, [workflowRuns]);

  // Listen for sub-agent status updates from Gateway
  useEffect(() => {
    const unsub = window.electronAPI?.onTaskStatusUpdate?.((data) => {
      if (!data?.runId) return;

      const eventMap: Record<string, 'started' | 'completed' | 'failed' | 'timeout'> = {
        'agent.started': 'started',
        'agent.step_started': 'started',
        'agent.finished': 'completed',
        'subagent.spawned': 'started',
      };

      const mapped = eventMap[data.event];
      if (!mapped) return;

      // Check if status indicates failure
      const finalEvent = data.status === 'failed' ? 'failed'
        : data.status === 'timeout' ? 'timeout'
        : mapped;

      setTasks((prev) => applySubAgentEvent(prev, data.runId, finalEvent, data.result || undefined));
    });
    return unsub;
  }, []);

  // ---- Task actions ----

  const handleCreateTask = useCallback(async (params: {
    title: string;
    agentId: string;
    priority: 'low' | 'medium' | 'high';
    model?: string;
    timeoutSeconds?: number;
  }) => {
    const agent = agents.find((a) => a.id === params.agentId);
    const newTask = createTask({
      ...params,
      agentEmoji: agent?.emoji,
      agentName: agent?.name,
    });

    // Add to backlog first
    setTasks((prev) => addTask(prev, newTask));

    // Immediately spawn via IPC
    try {
      const result = await window.electronAPI?.taskCreate?.({
        title: params.title,
        agentId: params.agentId,
        model: params.model,
        timeoutSeconds: params.timeoutSeconds,
      });

      if (result?.success) {
        setTasks((prev) => queueTask(prev, newTask.id, result.runId || `run-${Date.now()}`, result.sessionKey || ''));
      } else {
        setTasks((prev) => updateTask(prev, newTask.id, { status: 'failed', error: result?.error || 'Spawn failed' }));
      }
    } catch (err: any) {
      setTasks((prev) => updateTask(prev, newTask.id, { status: 'failed', error: err?.message || 'Unknown error' }));
    }
  }, [agents]);

  const handleMoveTask = useCallback((taskId: string, fromColumn: TaskStatus, toColumn: TaskStatus) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    // Backlog/Failed → Queued = trigger spawn
    if ((fromColumn === 'backlog' || fromColumn === 'failed') && toColumn === 'queued') {
      handleCreateTask({
        title: task.title,
        agentId: task.agentId,
        priority: task.priority,
        model: task.model,
        timeoutSeconds: task.timeoutSeconds,
      });
      // Remove old task (a new one was created by handleCreateTask)
      setTasks((prev) => removeTask(prev, taskId));
      return;
    }

    // For other moves, just update status locally
    setTasks((prev) => updateTask(prev, taskId, { status: toColumn }));
  }, [tasks, handleCreateTask]);

  const handleRetryTask = useCallback((taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    handleMoveTask(taskId, task.status, 'queued');
  }, [tasks, handleMoveTask]);

  const handleCancelTask = useCallback(async (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task?.sessionKey) return;
    await window.electronAPI?.taskCancel?.(task.sessionKey);
    setTasks((prev) => updateTask(prev, taskId, { status: 'failed', error: 'Cancelled by user' }));
  }, [tasks]);

  const handleViewDetail = useCallback((taskId: string) => {
    setDetailTaskId(taskId);
  }, []);

  const handleEnableCollaboration = useCallback(async () => {
    setEnabling(true);
    setStatusMessage(null);
    try {
      const result = await window.electronAPI?.workflowEnableCollaboration?.();
      if (result?.success && result?.config) {
        const cfg = result.config;
        setSetup((s) => ({
          ...s,
          maxSpawnDepth: cfg.maxSpawnDepth,
          agentToAgentEnabled: cfg.agentToAgentEnabled,
        }));
        const gwNote = (result as any).gatewayRestarted
          ? ''
          : ` ${t('taskCenter.setup.restartHint', 'Gateway will apply changes on next restart.')}`;
        setStatusMessage({ type: 'success', text: `${t('taskCenter.setup.enabled', 'Multi-agent collaboration enabled!')}${gwNote}` });
      } else {
        setStatusMessage({ type: 'error', text: (result as any)?.error || t('taskCenter.setup.failedGeneric', 'Failed to enable collaboration. Please try again.') });
      }
    } catch {
      setStatusMessage({ type: 'error', text: t('taskCenter.setup.failedGeneric', 'Failed to enable collaboration. Please try again.') });
    }
    setEnabling(false);
  }, [t]);

  // ---- Workflow actions ----

  const handleRunWorkflow = useCallback(async (workflow: any, args: Record<string, string>) => {
    const run = createWorkflowRun({
      workflowId: workflow.id,
      workflowName: workflow.name,
      args,
    });
    setWorkflowRuns((prev) => [...prev, run]);
    setActiveWorkflowRun(run);

    try {
      const result = await window.electronAPI?.workflowRun?.(workflow.yamlPath, args);
      if (!result) {
        setWorkflowRuns((prev) => updateWorkflowRun(prev, run.id, { status: 'failed' }));
        setActiveWorkflowRun((r) => r?.id === run.id ? { ...r, status: 'failed' } : r);
        return;
      }

      const newStatus = result.status === 'needs_approval' ? 'needs_approval' as const
        : result.success ? 'completed' as const
        : 'failed' as const;

      const patch: Partial<WorkflowRun> = {
        status: newStatus,
        ...(newStatus === 'completed' || newStatus === 'failed' ? { completedAt: new Date().toISOString() } : {}),
        ...((result as any)?.requiresApproval?.resumeToken ? { resumeToken: (result as any).requiresApproval.resumeToken } : {}),
      };

      setWorkflowRuns((prev) => updateWorkflowRun(prev, run.id, patch));
      setActiveWorkflowRun((r) => r?.id === run.id ? { ...r, ...patch } : r);
    } catch (err: any) {
      setWorkflowRuns((prev) => updateWorkflowRun(prev, run.id, { status: 'failed' }));
      setActiveWorkflowRun((r) => r?.id === run.id ? { ...r, status: 'failed' } : r);
    }
  }, []);

  const handleWorkflowApprove = useCallback(async (resumeToken: string) => {
    if (!activeWorkflowRun) return;
    try {
      await window.electronAPI?.workflowApprove?.(resumeToken, true);
      setWorkflowRuns((prev) => updateWorkflowRun(prev, activeWorkflowRun.id, { status: 'running', resumeToken: undefined }));
      setActiveWorkflowRun((r) => r ? { ...r, status: 'running', resumeToken: undefined } : r);
    } catch { /* ignore */ }
  }, [activeWorkflowRun]);

  const handleWorkflowReject = useCallback(async (resumeToken: string) => {
    if (!activeWorkflowRun) return;
    try {
      await window.electronAPI?.workflowApprove?.(resumeToken, false);
      setWorkflowRuns((prev) => updateWorkflowRun(prev, activeWorkflowRun.id, { status: 'cancelled', completedAt: new Date().toISOString() }));
      setActiveWorkflowRun((r) => r ? { ...r, status: 'cancelled' } : r);
    } catch { /* ignore */ }
  }, [activeWorkflowRun]);

  const handleInstallLobster = useCallback(async () => {
    setLobsterInstalling(true);
    setStatusMessage(null);
    try {
      const result = await window.electronAPI?.workflowInstallLobster?.();
      if (result?.success) {
        setLobsterStatus({ checked: true, installed: true, enabled: true });
        const wfResult = await window.electronAPI?.workflowList?.();
        setWorkflows(wfResult?.workflows || []);
        setStatusMessage({ type: 'success', text: t('taskCenter.lobster.installed', 'Lobster workflow engine installed successfully!') });
      } else {
        setStatusMessage({ type: 'error', text: result?.error || t('taskCenter.lobster.installFailed', 'Failed to install Lobster. Please try again.') });
      }
    } catch {
      setStatusMessage({ type: 'error', text: t('taskCenter.lobster.installFailed', 'Failed to install Lobster. Please try again.') });
    }
    setLobsterInstalling(false);
  }, [t]);

  // ---- Render ----

  const needsSetup = setup.checked && setup.maxSpawnDepth < 2;
  const needsAgents = setup.checked && setup.agentCount < 2;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Target size={24} className="text-sky-400" />
            <div>
              <h1 className="text-lg font-bold text-slate-100">{t('taskCenter.title')}</h1>
              <p className="text-xs text-slate-500">{t('taskCenter.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={needsSetup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus size={16} />
              {t('taskCenter.newTask')}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-slate-800/50 rounded-lg p-1 w-fit">
          {(['board', 'workflows', 'history'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`
                px-4 py-1.5 rounded-md text-xs font-medium transition-all
                ${activeTab === tab
                  ? 'bg-slate-700 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-300'
                }
              `}
            >
              {t(`taskCenter.tab.${tab}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        {/* Status message toast */}
        {statusMessage && (
          <div className={`mb-3 px-4 py-2.5 rounded-lg flex items-center justify-between text-sm animate-in fade-in slide-in-from-top-2 ${
            statusMessage.type === 'success' ? 'bg-emerald-900/30 border border-emerald-700/40 text-emerald-300' :
            statusMessage.type === 'error' ? 'bg-red-900/30 border border-red-700/40 text-red-300' :
            'bg-sky-900/30 border border-sky-700/40 text-sky-300'
          }`}>
            <span>{statusMessage.text}</span>
            <button
              onClick={() => setStatusMessage(null)}
              className="ml-3 text-xs opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        )}

        {/* Setup onboarding cards */}
        {needsSetup && (
          <div className="mb-4 p-4 rounded-xl bg-amber-950/20 border border-amber-700/30">
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-amber-300">{t('taskCenter.setup.title')}</h3>
                <p className="text-xs text-amber-400/70 mt-1">{t('taskCenter.setup.desc')}</p>
                <button
                  onClick={handleEnableCollaboration}
                  disabled={enabling}
                  className="mt-3 flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 text-sm font-medium transition-colors border border-amber-600/30"
                >
                  {enabling ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                  {enabling ? t('taskCenter.setup.enabling') : t('taskCenter.setup.enable')}
                </button>
              </div>
            </div>
          </div>
        )}

        {!needsSetup && needsAgents && (
          <div className="mb-4 p-4 rounded-xl bg-sky-950/20 border border-sky-700/30">
            <div className="flex items-start gap-3">
              <Bot size={20} className="text-sky-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-sky-300">{t('taskCenter.setup.needAgents')}</p>
                <button
                  onClick={() => onNavigate?.('agents')}
                  className="mt-2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 text-xs font-medium transition-colors border border-sky-600/30"
                >
                  <Bot size={12} />
                  {t('taskCenter.setup.goToAgents')}
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Board tab */}
        {activeTab === 'board' && (
          <KanbanBoard
            tasks={tasks}
            t={t}
            onMoveTask={handleMoveTask}
            onRetryTask={handleRetryTask}
            onCancelTask={handleCancelTask}
            onViewDetail={handleViewDetail}
          />
        )}

        {/* Workflows tab */}
        {activeTab === 'workflows' && (
          <div className="flex-1 min-h-0 flex flex-col gap-4">
            {/* Active workflow run */}
            {activeWorkflowRun && (
              <WorkflowRunner
                t={t}
                run={activeWorkflowRun}
                steps={workflows.find((w) => w.id === activeWorkflowRun.workflowId)?.steps || []}
                onApprove={handleWorkflowApprove}
                onReject={handleWorkflowReject}
                onClose={() => setActiveWorkflowRun(null)}
              />
            )}

            {/* Workflow templates list */}
            <WorkflowList
              t={t}
              workflows={workflows}
              onRun={handleRunWorkflow}
              lobsterInstalled={lobsterStatus.installed || lobsterStatus.enabled}
              onInstallLobster={handleInstallLobster}
              lobsterInstalling={lobsterInstalling}
            />
          </div>
        )}

        {/* History tab — completed/failed tasks timeline */}
        {activeTab === 'history' && (() => {
          const historyTasks = tasks.filter((t) => t.status === 'done' || t.status === 'failed');
          const sorted = [...historyTasks].sort((a, b) => {
            const ta = a.completedAt || a.createdAt;
            const tb = b.completedAt || b.createdAt;
            return new Date(tb).getTime() - new Date(ta).getTime();
          });

          if (sorted.length === 0) {
            return (
              <div className="flex items-center justify-center h-64 text-slate-500 text-sm">
                {t('taskCenter.empty')}
              </div>
            );
          }

          // Group by date
          const groups: Record<string, Task[]> = {};
          for (const task of sorted) {
            const date = new Date(task.completedAt || task.createdAt).toLocaleDateString(undefined, {
              month: 'short', day: 'numeric', year: 'numeric',
            });
            if (!groups[date]) groups[date] = [];
            groups[date].push(task);
          }

          return (
            <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
              {Object.entries(groups).map(([date, dateTasks]) => (
                <div key={date}>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">{date}</h3>
                  <div className="space-y-1.5">
                    {dateTasks.map((task) => (
                      <button
                        key={task.id}
                        onClick={() => setDetailTaskId(task.id)}
                        className="w-full text-left px-3 py-2.5 rounded-lg bg-slate-800/40 border border-slate-700/30 hover:bg-slate-800/70 hover:border-slate-600/40 transition-all group"
                      >
                        <div className="flex items-center gap-2">
                          <span>{task.agentEmoji || '🤖'}</span>
                          <span className="text-sm text-slate-200 truncate flex-1">{task.title}</span>
                          {task.status === 'done' ? (
                            <span className="text-[10px] text-emerald-400 bg-emerald-900/20 px-1.5 py-0.5 rounded">✓</span>
                          ) : (
                            <span className="text-[10px] text-red-400 bg-red-900/20 px-1.5 py-0.5 rounded">✕</span>
                          )}
                        </div>
                        {(task.result || task.error) && (
                          <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
                            {task.result || task.error}
                          </p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Create Task Modal */}
      {showCreateModal && (
        <TaskCreateModal
          t={t}
          agents={agents}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreateTask}
        />
      )}

      {/* Task Detail Panel */}
      {detailTaskId && (() => {
        const detailTask = tasks.find((t) => t.id === detailTaskId);
        if (!detailTask) return null;
        return (
          <TaskDetailPanel
            t={t}
            task={detailTask}
            onClose={() => setDetailTaskId(null)}
            onRetry={() => { handleRetryTask(detailTaskId); setDetailTaskId(null); }}
            onCancel={() => { handleCancelTask(detailTaskId); setDetailTaskId(null); }}
          />
        );
      })()}
    </div>
  );
}
