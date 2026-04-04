import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AgentWizard from '../components/AgentWizard';

describe('AgentWizard', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({
      language: 'en',
      providerKey: 'qwen-portal',
      modelId: 'qwen-plus',
    }));
    vi.restoreAllMocks();
  });

  it('renders with name input and emoji picker', async () => {
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    expect(screen.getByText('Name your agent')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Research/i)).toBeTruthy();
    expect(screen.getByText('Pick an icon:')).toBeTruthy();
  });

  it('disables Create when name is empty', async () => {
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    const createBtn = screen.getByTestId('agent-create-btn');
    expect(createBtn).toHaveProperty('disabled', true);
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={onCancel} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    expect(onCancel).toHaveBeenCalled();
  });

  it('creates agent and returns agentId for chat navigation', async () => {
    const api = window.electronAPI as any;
    api.agentsAdd = vi.fn().mockResolvedValue({ success: true, agentId: 'researcher' });
    api.agentsSetIdentity = vi.fn().mockResolvedValue({ success: true });
    api.agentsWriteFile = vi.fn().mockResolvedValue({ success: true });

    const onComplete = vi.fn();
    await act(async () => {
      render(<AgentWizard onComplete={onComplete} onCancel={vi.fn()} />);
    });

    const nameInput = screen.getByPlaceholderText(/Research/i);
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'Researcher' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-create-btn'));
    });

    await waitFor(() => {
      // agentsAdd called WITHOUT systemPrompt (BOOTSTRAP.md preserved for chat Q&A)
      expect(api.agentsAdd).toHaveBeenCalledWith('Researcher', undefined, undefined);
      expect(api.agentsSetIdentity).toHaveBeenCalled();
      expect(api.agentsWriteFile).toHaveBeenCalledWith(
        'researcher', 'IDENTITY.md', expect.stringContaining('**name**: Researcher'),
      );
      // Returns agentId so parent can navigate to chat
      expect(onComplete).toHaveBeenCalledWith('researcher');
    });
  });

  it('shows error when agent creation fails', async () => {
    const api = window.electronAPI as any;
    api.agentsAdd = vi.fn().mockResolvedValue({ success: false, error: 'Permission denied' });

    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    const nameInput = screen.getByPlaceholderText(/Research/i);
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'test' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-create-btn'));
    });

    await waitFor(() => {
      expect(screen.getByText(/permission denied/i)).toBeTruthy();
    });
  });

  it('continues setup when agent already exists from previous attempt', async () => {
    const onComplete = vi.fn();
    const api = window.electronAPI as any;
    api.agentsAdd = vi.fn().mockResolvedValue({ success: false, error: 'Agent "test" already exists' });
    api.agentsSetIdentity = vi.fn().mockResolvedValue({ success: true });
    api.agentsWriteFile = vi.fn().mockResolvedValue({ success: true });

    await act(async () => {
      render(<AgentWizard onComplete={onComplete} onCancel={vi.fn()} />);
    });

    const nameInput = screen.getByPlaceholderText(/Research/i);
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'test' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-create-btn'));
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('shows bootstrap hint explaining conversational setup', async () => {
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    expect(screen.getByText(/start a conversation/i)).toBeTruthy();
  });
});
