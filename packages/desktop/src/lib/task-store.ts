/**
 * Task Center store — data models + localStorage persistence.
 *
 * Tasks map 1:1 to OpenClaw sub-agent runs.
 * Workflows map to Lobster YAML pipelines.
 * All state is local-first (localStorage + JSON file backup).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'backlog' | 'queued' | 'running' | 'review' | 'done' | 'failed';
export type TaskPriority = 'low' | 'medium' | 'high';

export interface Task {
  readonly id: string;
  readonly title: string;
  readonly agentId: string;
  readonly agentEmoji?: string;
  readonly agentName?: string;
  readonly status: TaskStatus;
  readonly priority: TaskPriority;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly result?: string;
  readonly error?: string;
  readonly sessionKey?: string;
  readonly runId?: string;
  readonly workflowRunId?: string;
  readonly model?: string;
  readonly timeoutSeconds?: number;
}

export type WorkflowStepType = 'agent-send' | 'command' | 'approval';

export interface WorkflowStep {
  readonly id: string;
  readonly type: WorkflowStepType;
  readonly agentId?: string;
  readonly description: string;
  readonly condition?: string;
  readonly approval?: boolean;
}

export interface WorkflowArg {
  readonly name: string;
  readonly required: boolean;
  readonly default?: string;
  readonly description?: string;
}

export interface Workflow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly yamlPath: string;
  readonly isBuiltin: boolean;
  readonly args: readonly WorkflowArg[];
  readonly steps: readonly WorkflowStep[];
}

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepResult {
  readonly status: StepStatus;
  readonly output?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

export type WorkflowRunStatus = 'running' | 'needs_approval' | 'completed' | 'failed' | 'cancelled';

export interface WorkflowRun {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly status: WorkflowRunStatus;
  readonly args: Readonly<Record<string, string>>;
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly currentStepId?: string;
  readonly stepResults: Readonly<Record<string, StepResult>>;
  readonly resumeToken?: string;
}

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const TASKS_KEY = 'awareness-claw-tasks';
const WORKFLOW_RUNS_KEY = 'awareness-claw-workflow-runs';

// ---------------------------------------------------------------------------
// Immutable helpers
// ---------------------------------------------------------------------------

function uuid(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function now(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Task CRUD (immutable — every op returns a new array)
// ---------------------------------------------------------------------------

export function loadTasks(): readonly Task[] {
  try {
    const raw = localStorage.getItem(TASKS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Task[];
  } catch {
    return [];
  }
}

export function saveTasks(tasks: readonly Task[]): void {
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

export function createTask(params: {
  title: string;
  agentId: string;
  agentEmoji?: string;
  agentName?: string;
  priority?: TaskPriority;
  model?: string;
  timeoutSeconds?: number;
}): Task {
  return {
    id: uuid(),
    title: params.title,
    agentId: params.agentId,
    agentEmoji: params.agentEmoji,
    agentName: params.agentName,
    status: 'backlog',
    priority: params.priority || 'medium',
    createdAt: now(),
    model: params.model,
    timeoutSeconds: params.timeoutSeconds,
  };
}

export function addTask(tasks: readonly Task[], task: Task): readonly Task[] {
  return [...tasks, task];
}

export function updateTask(
  tasks: readonly Task[],
  taskId: string,
  patch: Partial<Omit<Task, 'id' | 'createdAt'>>,
): readonly Task[] {
  return tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
}

export function removeTask(tasks: readonly Task[], taskId: string): readonly Task[] {
  return tasks.filter((t) => t.id !== taskId);
}

/** Move task to "queued" with spawn metadata. */
export function queueTask(
  tasks: readonly Task[],
  taskId: string,
  runId: string,
  sessionKey: string,
): readonly Task[] {
  return updateTask(tasks, taskId, {
    status: 'queued',
    runId,
    sessionKey,
    startedAt: now(),
  });
}

/** Transition task based on sub-agent lifecycle event. */
export function applySubAgentEvent(
  tasks: readonly Task[],
  runId: string,
  event: 'started' | 'completed' | 'failed' | 'timeout',
  result?: string,
): readonly Task[] {
  const idx = tasks.findIndex((t) => t.runId === runId);
  if (idx < 0) return tasks;

  const statusMap: Record<string, TaskStatus> = {
    started: 'running',
    completed: 'done',
    failed: 'failed',
    timeout: 'failed',
  };

  const completedAt = (event === 'completed' || event === 'failed' || event === 'timeout') ? now() : undefined;

  return updateTask(tasks, tasks[idx].id, {
    status: statusMap[event] || 'running',
    ...(completedAt ? { completedAt } : {}),
    ...(result !== undefined && event === 'completed' ? { result } : {}),
    ...(result !== undefined && event !== 'completed' ? { error: result } : {}),
  });
}

// ---------------------------------------------------------------------------
// Workflow Run CRUD
// ---------------------------------------------------------------------------

export function loadWorkflowRuns(): readonly WorkflowRun[] {
  try {
    const raw = localStorage.getItem(WORKFLOW_RUNS_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WorkflowRun[];
  } catch {
    return [];
  }
}

export function saveWorkflowRuns(runs: readonly WorkflowRun[]): void {
  localStorage.setItem(WORKFLOW_RUNS_KEY, JSON.stringify(runs));
}

export function createWorkflowRun(params: {
  workflowId: string;
  workflowName: string;
  args: Record<string, string>;
}): WorkflowRun {
  return {
    id: `wfrun-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    workflowId: params.workflowId,
    workflowName: params.workflowName,
    status: 'running',
    args: { ...params.args },
    startedAt: now(),
    stepResults: {},
  };
}

export function updateWorkflowRun(
  runs: readonly WorkflowRun[],
  runId: string,
  patch: Partial<Omit<WorkflowRun, 'id' | 'startedAt'>>,
): readonly WorkflowRun[] {
  return runs.map((r) => (r.id === runId ? { ...r, ...patch } : r));
}

// ---------------------------------------------------------------------------
// Kanban column helpers
// ---------------------------------------------------------------------------

export const KANBAN_COLUMNS: readonly TaskStatus[] = [
  'backlog',
  'queued',
  'running',
  'review',
  'done',
  'failed',
] as const;

export function tasksByColumn(tasks: readonly Task[]): Record<TaskStatus, readonly Task[]> {
  const result: Record<TaskStatus, Task[]> = {
    backlog: [],
    queued: [],
    running: [],
    review: [],
    done: [],
    failed: [],
  };
  for (const t of tasks) {
    (result[t.status] ?? result.backlog).push(t);
  }
  return result;
}

// ---------------------------------------------------------------------------
// @agent mention parsing
// ---------------------------------------------------------------------------

/**
 * Detect `@agentId` or `@agent-name` at the start of a message.
 * Returns { agentId, task } or null if no mention found.
 */
export function parseAgentMention(
  message: string,
  knownAgentIds: readonly string[],
): { agentId: string; task: string } | null {
  const trimmed = message.trim();
  const match = trimmed.match(/^@(\S+)\s+([\s\S]+)$/);
  if (!match) return null;

  const candidate = match[1].toLowerCase();
  const agentId = knownAgentIds.find((id) => id.toLowerCase() === candidate);
  if (!agentId) return null;

  return { agentId, task: match[2].trim() };
}
