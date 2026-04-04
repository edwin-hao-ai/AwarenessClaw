import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import TaskDetailPanel from '../components/task-center/TaskDetailPanel';
import type { Task } from '../lib/task-store';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));

  (window as any).electronAPI = {
    taskDetail: vi.fn().mockResolvedValue({
      success: true,
      messages: [
        { role: 'user', content: '/subagents spawn coder "Write tests"' },
        { role: 'assistant', content: 'I have written 5 unit tests covering the auth module.' },
      ],
    }),
  };
});

const t = (key: string, fallback?: string) => {
  const map: Record<string, string> = {
    'kanban.done': 'Done',
    'kanban.failed': 'Failed',
    'kanban.running': 'Running',
    'taskCard.retry': 'Retry',
    'taskCard.cancel': 'Cancel',
    'taskCard.elapsed': 'Elapsed',
    'taskCard.created': 'Created',
    'taskCard.result': 'Result',
    'taskCard.error': 'Error',
    'taskCard.history': 'Sub-agent history',
    'taskCard.noHistory': 'No conversation history available',
    'taskCard.noSession': 'Task not yet started',
    'taskCreate.model': 'Model',
  };
  return map[key] || fallback || key;
};

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Write unit tests',
    agentId: 'coder',
    agentEmoji: '💻',
    agentName: 'Coder',
    status: 'done',
    priority: 'medium',
    createdAt: '2026-04-04T10:00:00.000Z',
    startedAt: '2026-04-04T10:00:01.000Z',
    completedAt: '2026-04-04T10:00:45.000Z',
    result: 'All 5 tests pass.',
    sessionKey: 'agent:coder:subagent:abc-123',
    runId: 'run-abc-123',
    ...overrides,
  };
}

describe('TaskDetailPanel', () => {
  it('renders task title and agent info', () => {
    render(<TaskDetailPanel t={t} task={makeTask()} onClose={() => {}} />);
    expect(screen.getByText('Write unit tests')).toBeTruthy();
    expect(screen.getByText('💻')).toBeTruthy();
  });

  it('shows result for done tasks', () => {
    render(<TaskDetailPanel t={t} task={makeTask()} onClose={() => {}} />);
    expect(screen.getByText('All 5 tests pass.')).toBeTruthy();
  });

  it('shows error for failed tasks', () => {
    render(
      <TaskDetailPanel
        t={t}
        task={makeTask({ status: 'failed', error: 'Timeout', result: undefined })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('Timeout')).toBeTruthy();
  });

  it('loads and displays sub-agent conversation history', async () => {
    render(<TaskDetailPanel t={t} task={makeTask()} onClose={() => {}} />);
    await waitFor(() => {
      expect(screen.getByText(/I have written 5 unit tests/)).toBeTruthy();
    });
  });

  it('shows Retry button for failed tasks', () => {
    const onRetry = vi.fn();
    render(
      <TaskDetailPanel
        t={t}
        task={makeTask({ status: 'failed', error: 'Timeout' })}
        onClose={() => {}}
        onRetry={onRetry}
      />,
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows Cancel button for running tasks', () => {
    const onCancel = vi.fn();
    render(
      <TaskDetailPanel
        t={t}
        task={makeTask({ status: 'running', result: undefined, completedAt: undefined })}
        onClose={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when X button clicked', () => {
    const onClose = vi.fn();
    render(<TaskDetailPanel t={t} task={makeTask()} onClose={onClose} />);
    // Find X button (first button in header)
    const buttons = document.querySelectorAll('button');
    fireEvent.click(buttons[0]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows "not yet started" for tasks without sessionKey', async () => {
    render(
      <TaskDetailPanel
        t={t}
        task={makeTask({ sessionKey: undefined, status: 'backlog', result: undefined, startedAt: undefined, completedAt: undefined })}
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Task not yet started')).toBeTruthy();
    });
  });
});
