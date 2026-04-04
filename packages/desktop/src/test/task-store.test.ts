import { describe, it, expect, beforeEach } from 'vitest';
import {
  createTask,
  addTask,
  updateTask,
  removeTask,
  queueTask,
  applySubAgentEvent,
  tasksByColumn,
  parseAgentMention,
  KANBAN_COLUMNS,
} from '../lib/task-store';
import type { Task } from '../lib/task-store';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task',
    agentId: 'coder',
    status: 'backlog',
    priority: 'medium',
    createdAt: '2026-04-04T00:00:00.000Z',
    ...overrides,
  };
}

describe('task-store', () => {
  describe('createTask', () => {
    it('creates a task with defaults', () => {
      const task = createTask({ title: 'Do something', agentId: 'coder' });
      expect(task.id).toMatch(/^task-/);
      expect(task.title).toBe('Do something');
      expect(task.agentId).toBe('coder');
      expect(task.status).toBe('backlog');
      expect(task.priority).toBe('medium');
      expect(task.createdAt).toBeTruthy();
    });

    it('respects custom priority', () => {
      const task = createTask({ title: 'Urgent', agentId: 'main', priority: 'high' });
      expect(task.priority).toBe('high');
    });
  });

  describe('addTask', () => {
    it('appends task immutably', () => {
      const original: readonly Task[] = [makeTask({ id: 'task-1' })];
      const newTask = makeTask({ id: 'task-2' });
      const result = addTask(original, newTask);
      expect(result).toHaveLength(2);
      expect(result[1].id).toBe('task-2');
      // Original unchanged
      expect(original).toHaveLength(1);
    });
  });

  describe('updateTask', () => {
    it('updates a task immutably', () => {
      const tasks: readonly Task[] = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })];
      const result = updateTask(tasks, 'task-1', { status: 'running' });
      expect(result[0].status).toBe('running');
      expect(result[1].status).toBe('backlog');
      // Original unchanged
      expect(tasks[0].status).toBe('backlog');
    });

    it('does nothing for unknown id', () => {
      const tasks: readonly Task[] = [makeTask({ id: 'task-1' })];
      const result = updateTask(tasks, 'nonexistent', { status: 'done' });
      expect(result).toEqual(tasks);
    });
  });

  describe('removeTask', () => {
    it('removes task immutably', () => {
      const tasks: readonly Task[] = [makeTask({ id: 'task-1' }), makeTask({ id: 'task-2' })];
      const result = removeTask(tasks, 'task-1');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('task-2');
      expect(tasks).toHaveLength(2);
    });
  });

  describe('queueTask', () => {
    it('sets status to queued with spawn metadata', () => {
      const tasks: readonly Task[] = [makeTask({ id: 'task-1' })];
      const result = queueTask(tasks, 'task-1', 'run-abc', 'session-xyz');
      expect(result[0].status).toBe('queued');
      expect(result[0].runId).toBe('run-abc');
      expect(result[0].sessionKey).toBe('session-xyz');
      expect(result[0].startedAt).toBeTruthy();
    });
  });

  describe('applySubAgentEvent', () => {
    it('transitions to running on started', () => {
      const tasks: readonly Task[] = [makeTask({ id: 'task-1', runId: 'run-1', status: 'queued' })];
      const result = applySubAgentEvent(tasks, 'run-1', 'started');
      expect(result[0].status).toBe('running');
    });

    it('transitions to done on completed', () => {
      const tasks: readonly Task[] = [makeTask({ id: 'task-1', runId: 'run-1', status: 'running' })];
      const result = applySubAgentEvent(tasks, 'run-1', 'completed', 'All done!');
      expect(result[0].status).toBe('done');
      expect(result[0].result).toBe('All done!');
      expect(result[0].completedAt).toBeTruthy();
    });

    it('transitions to failed on failure', () => {
      const tasks: readonly Task[] = [makeTask({ id: 'task-1', runId: 'run-1', status: 'running' })];
      const result = applySubAgentEvent(tasks, 'run-1', 'failed', 'Out of memory');
      expect(result[0].status).toBe('failed');
      expect(result[0].error).toBe('Out of memory');
    });

    it('does nothing for unknown runId', () => {
      const tasks: readonly Task[] = [makeTask({ id: 'task-1', runId: 'run-1' })];
      const result = applySubAgentEvent(tasks, 'run-unknown', 'completed');
      expect(result).toBe(tasks); // Same reference = no change
    });
  });

  describe('tasksByColumn', () => {
    it('groups tasks by status', () => {
      const tasks: readonly Task[] = [
        makeTask({ id: '1', status: 'backlog' }),
        makeTask({ id: '2', status: 'running' }),
        makeTask({ id: '3', status: 'done' }),
        makeTask({ id: '4', status: 'backlog' }),
        makeTask({ id: '5', status: 'failed' }),
      ];
      const cols = tasksByColumn(tasks);
      expect(cols.backlog).toHaveLength(2);
      expect(cols.running).toHaveLength(1);
      expect(cols.done).toHaveLength(1);
      expect(cols.failed).toHaveLength(1);
      expect(cols.queued).toHaveLength(0);
      expect(cols.review).toHaveLength(0);
    });
  });

  describe('KANBAN_COLUMNS', () => {
    it('has 6 columns in correct order', () => {
      expect(KANBAN_COLUMNS).toEqual(['backlog', 'queued', 'running', 'review', 'done', 'failed']);
    });
  });

  describe('parseAgentMention', () => {
    const knownAgents = ['main', 'coder', 'researcher', 'tester'];

    it('parses @agent at start of message', () => {
      const result = parseAgentMention('@coder refactor this function', knownAgents);
      expect(result).toEqual({ agentId: 'coder', task: 'refactor this function' });
    });

    it('is case-insensitive for agent id', () => {
      const result = parseAgentMention('@Coder do something', knownAgents);
      expect(result).toEqual({ agentId: 'coder', task: 'do something' });
    });

    it('returns null for unknown agent', () => {
      const result = parseAgentMention('@unknown do something', knownAgents);
      expect(result).toBeNull();
    });

    it('returns null for no mention', () => {
      const result = parseAgentMention('just a regular message', knownAgents);
      expect(result).toBeNull();
    });

    it('returns null for @ without space after agent', () => {
      const result = parseAgentMention('@coder', knownAgents);
      expect(result).toBeNull();
    });

    it('handles multiline task description', () => {
      const result = parseAgentMention('@researcher find info about\nthis topic\nand summarize', knownAgents);
      expect(result?.agentId).toBe('researcher');
      expect(result?.task).toContain('this topic');
    });
  });
});
