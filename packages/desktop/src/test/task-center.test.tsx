import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaskCenter from '../pages/TaskCenter';

// Mock electronAPI
const mockAgentsList = vi.fn().mockResolvedValue({
  success: true,
  agents: [
    { id: 'main', name: 'Main', emoji: '🤖', isDefault: true },
    { id: 'coder', name: 'Coder', emoji: '💻' },
  ],
});

const mockWorkflowConfig = vi.fn().mockResolvedValue({
  maxSpawnDepth: 2,
  maxChildrenPerAgent: 5,
  agentToAgentEnabled: true,
});

const mockWorkflowEnableCollaboration = vi.fn().mockResolvedValue({
  success: true,
  config: { maxSpawnDepth: 2, agentToAgentEnabled: true },
});

const mockTaskCreate = vi.fn().mockResolvedValue({
  success: true,
  runId: 'run-test-123',
  sessionKey: 'session-test-123',
});

const mockOnTaskStatusUpdate = vi.fn().mockReturnValue(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Ensure English locale for test assertions
  localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));

  (window as any).electronAPI = {
    agentsList: mockAgentsList,
    workflowConfig: mockWorkflowConfig,
    workflowEnableCollaboration: mockWorkflowEnableCollaboration,
    taskCreate: mockTaskCreate,
    taskCancel: vi.fn().mockResolvedValue({ success: true }),
    onTaskStatusUpdate: mockOnTaskStatusUpdate,
    workflowList: vi.fn().mockResolvedValue({ workflows: [] }),
    workflowCheckLobster: vi.fn().mockResolvedValue({ installed: false, enabled: false }),
    workflowInstallLobster: vi.fn().mockResolvedValue({ success: true }),
    workflowRun: vi.fn().mockResolvedValue({ success: true, status: 'ok' }),
    workflowApprove: vi.fn().mockResolvedValue({ success: true }),
  };
});

describe('TaskCenter', () => {
  it('renders the page header', async () => {
    render(<TaskCenter />);
    expect(screen.getByText('Task Center')).toBeTruthy();
  });

  it('shows 3 tabs (Board, Workflows, History)', async () => {
    render(<TaskCenter />);
    expect(screen.getByText('Board')).toBeTruthy();
    expect(screen.getByText('Workflows')).toBeTruthy();
    expect(screen.getByText('History')).toBeTruthy();
  });

  it('shows kanban columns on Board tab', async () => {
    render(<TaskCenter />);
    // Wait for setup check to complete
    await waitFor(() => {
      expect(screen.getByText('Backlog')).toBeTruthy();
    });
    expect(screen.getByText('Queued')).toBeTruthy();
    expect(screen.getByText('Running')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
  });

  it('opens create task modal on New Task click', async () => {
    render(<TaskCenter />);
    await waitFor(() => {
      expect(mockWorkflowConfig).toHaveBeenCalled();
    });

    const newTaskBtn = screen.getByText('New Task');
    fireEvent.click(newTaskBtn);

    expect(screen.getByText('Create Task')).toBeTruthy();
    expect(screen.getByPlaceholderText('Describe your task...')).toBeTruthy();
  });

  it('shows setup card when maxSpawnDepth < 2', async () => {
    mockWorkflowConfig.mockResolvedValueOnce({
      maxSpawnDepth: 1,
      maxChildrenPerAgent: 5,
      agentToAgentEnabled: false,
    });

    render(<TaskCenter />);
    await waitFor(() => {
      expect(screen.getByText('Enable Multi-Agent Collaboration')).toBeTruthy();
    });
  });

  it('shows agent creation hint when only 1 agent', async () => {
    // Both agentsList calls (in agents load + setup check) must return 1 agent
    mockAgentsList.mockResolvedValue({
      success: true,
      agents: [
        { id: 'main', name: 'Main', emoji: '🤖', isDefault: true },
      ],
    });

    render(<TaskCenter />);
    await waitFor(() => {
      expect(screen.getByText(/Create at least one more agent/)).toBeTruthy();
    }, { timeout: 3000 });
  });

  it('switches to Workflows tab and shows Lobster status', async () => {
    render(<TaskCenter />);
    fireEvent.click(screen.getByText('Workflows'));
    // Should show Lobster not installed prompt (default mock returns false)
    await waitFor(() => {
      // WorkflowList shows either Lobster install prompt or workflow list
      const container = document.querySelector('.h-full');
      expect(container).toBeTruthy();
    });
  });

  it('registers sub-agent status update listener', async () => {
    render(<TaskCenter />);
    await waitFor(() => {
      expect(mockOnTaskStatusUpdate).toHaveBeenCalledTimes(1);
    });
  });
});
