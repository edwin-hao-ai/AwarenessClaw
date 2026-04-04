import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import KanbanCard from '../components/task-center/KanbanCard';
import type { Task } from '../lib/task-store';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
});

const i18nMap: Record<string, string> = {
  'taskCard.retry': 'Retry',
  'taskCard.cancel': 'Cancel',
  'taskCard.viewDetail': 'View Detail',
};
const t = (key: string, fallback?: string) => i18nMap[key] || fallback || key;

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Test task description',
    agentId: 'coder',
    agentEmoji: '💻',
    agentName: 'Coder',
    status: 'backlog',
    priority: 'medium',
    createdAt: '2026-04-04T10:00:00.000Z',
    ...overrides,
  };
}

describe('KanbanCard', () => {
  it('renders task title and agent emoji', () => {
    render(<KanbanCard task={makeTask()} t={t} />);
    expect(screen.getByText('Test task description')).toBeTruthy();
    expect(screen.getByText('💻')).toBeTruthy();
  });

  it('shows agent name', () => {
    render(<KanbanCard task={makeTask()} t={t} />);
    expect(screen.getByText('Coder')).toBeTruthy();
  });

  it('shows result preview for done tasks', () => {
    render(<KanbanCard task={makeTask({ status: 'done', result: 'All tests pass!' })} t={t} />);
    expect(screen.getByText('All tests pass!')).toBeTruthy();
  });

  it('shows error for failed tasks', () => {
    render(<KanbanCard task={makeTask({ status: 'failed', error: 'Timeout exceeded' })} t={t} />);
    expect(screen.getByText('Timeout exceeded')).toBeTruthy();
  });

  it('has draggable attribute', () => {
    render(<KanbanCard task={makeTask()} t={t} />);
    const card = screen.getByText('Test task description').closest('[draggable]');
    expect(card?.getAttribute('draggable')).toBe('true');
  });

  it('calls onRetry for failed tasks', () => {
    const onRetry = vi.fn();
    render(<KanbanCard task={makeTask({ status: 'failed' })} t={t} onRetry={onRetry} />);
    // Hover to show actions (they're opacity-0 by default but still in DOM)
    const retryBtn = document.querySelector('[title="Retry"]');
    if (retryBtn) fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows different priority colors', () => {
    const { container: highContainer } = render(
      <KanbanCard task={makeTask({ priority: 'high' })} t={t} />
    );
    expect(highContainer.querySelector('.border-l-red-500')).toBeTruthy();
  });
});
