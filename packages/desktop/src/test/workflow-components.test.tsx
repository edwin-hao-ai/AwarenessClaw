import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import WorkflowRunner from '../components/task-center/WorkflowRunner';
import type { WorkflowRun } from '../lib/task-store';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
});

const i18nMap: Record<string, string> = {
  'workflow.status.running': 'Running',
  'workflow.status.needsApproval': 'Needs Approval',
  'workflow.status.completed': 'Completed',
  'workflow.status.failed': 'Failed',
  'workflow.status.cancelled': 'Cancelled',
  'workflow.approve': 'Approve',
  'workflow.reject': 'Reject',
};
const t = (key: string, fallback?: string) => i18nMap[key] || fallback || key;

const sampleSteps = [
  { id: 'analyze', type: 'command' },
  { id: 'review', type: 'command' },
  { id: 'approve', type: 'approval', approval: true },
  { id: 'summarize', type: 'command' },
];

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'wfrun-1',
    workflowId: 'builtin-code-review',
    workflowName: 'code-review',
    status: 'running',
    args: { description: 'Fix auth' },
    startedAt: '2026-04-04T10:00:00.000Z',
    stepResults: {},
    ...overrides,
  };
}

describe('WorkflowRunner', () => {
  it('renders workflow name and running status', () => {
    render(<WorkflowRunner t={t} run={makeRun()} steps={sampleSteps} />);
    expect(screen.getByText('code-review')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
  });

  it('renders all step nodes in pipeline', () => {
    render(<WorkflowRunner t={t} run={makeRun()} steps={sampleSteps} />);
    expect(screen.getByText('analyze')).toBeTruthy();
    expect(screen.getByText('review')).toBeTruthy();
    expect(screen.getByText('approve')).toBeTruthy();
    expect(screen.getByText('summarize')).toBeTruthy();
  });

  it('shows approval buttons when status is needs_approval', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(
      <WorkflowRunner
        t={t}
        run={makeRun({ status: 'needs_approval', resumeToken: 'token-abc' })}
        steps={sampleSteps}
        onApprove={onApprove}
        onReject={onReject}
      />,
    );
    expect(screen.getByText('Needs Approval')).toBeTruthy();
    expect(screen.getByText('Approve')).toBeTruthy();
    expect(screen.getByText('Reject')).toBeTruthy();
  });

  it('calls onApprove with resumeToken', () => {
    const onApprove = vi.fn();
    render(
      <WorkflowRunner
        t={t}
        run={makeRun({ status: 'needs_approval', resumeToken: 'token-abc' })}
        steps={sampleSteps}
        onApprove={onApprove}
      />,
    );
    fireEvent.click(screen.getByText('Approve'));
    expect(onApprove).toHaveBeenCalledWith('token-abc');
  });

  it('calls onReject with resumeToken', () => {
    const onReject = vi.fn();
    render(
      <WorkflowRunner
        t={t}
        run={makeRun({ status: 'needs_approval', resumeToken: 'token-abc' })}
        steps={sampleSteps}
        onReject={onReject}
      />,
    );
    fireEvent.click(screen.getByText('Reject'));
    expect(onReject).toHaveBeenCalledWith('token-abc');
  });

  it('shows completed status with green badge', () => {
    render(
      <WorkflowRunner
        t={t}
        run={makeRun({ status: 'completed', completedAt: '2026-04-04T10:05:00.000Z' })}
        steps={sampleSteps}
      />,
    );
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('shows close button and calls onClose', () => {
    const onClose = vi.fn();
    render(
      <WorkflowRunner t={t} run={makeRun()} steps={sampleSteps} onClose={onClose} />,
    );
    const closeBtn = document.querySelector('button');
    // Find the X button (last button in header)
    const buttons = document.querySelectorAll('button');
    const lastBtn = buttons[buttons.length - 1];
    if (lastBtn) fireEvent.click(lastBtn);
    // onClose should fire (the close button is the only one in completed/running mode without approval)
    expect(onClose).toHaveBeenCalled();
  });

  it('does not show approval buttons when not needs_approval', () => {
    render(<WorkflowRunner t={t} run={makeRun({ status: 'running' })} steps={sampleSteps} />);
    expect(screen.queryByText('Approve')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
  });
});
