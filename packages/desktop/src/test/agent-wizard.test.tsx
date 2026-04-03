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
      providerProfiles: {
        'qwen-portal': {
          apiKey: 'test-key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          models: [{ id: 'qwen-plus', label: 'Qwen Plus' }],
        },
      },
    }));
    vi.restoreAllMocks();
  });

  it('renders step 1 with name input and emoji picker', async () => {
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    expect(screen.getByText('Name your agent')).toBeTruthy();
    expect(screen.getByPlaceholderText(/Research/i)).toBeTruthy();
    expect(screen.getByText('Pick an icon:')).toBeTruthy();
  });

  it('disables Next when name is empty', async () => {
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toHaveProperty('disabled', true);
  });

  it('navigates through all 4 steps', async () => {
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    // Step 1: Enter name
    const nameInput = screen.getByPlaceholderText(/Research/i);

    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'TestAgent' } });
    });

    // Next → Step 2
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    expect(screen.getByText('Choose a personality')).toBeTruthy();

    // Next → Step 3
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    expect(screen.getByText('Select a model')).toBeTruthy();

    // Next → Step 4
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    expect(screen.getByText('Route channels')).toBeTruthy();
  });

  it('can go back to previous steps', async () => {
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    // Enter name and go to step 2
    const nameInput = screen.getByPlaceholderText(/Research/i);
    await act(async () => {
      fireEvent.change(nameInput, { target: { value: 'TestAgent' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    expect(screen.getByText('Choose a personality')).toBeTruthy();

    // Go back
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /back/i }));
    });
    expect(screen.getByText('Name your agent')).toBeTruthy();
  });

  it('calls onCancel when Cancel is clicked on step 1', async () => {
    const onCancel = vi.fn();
    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={onCancel} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    });

    expect(onCancel).toHaveBeenCalled();
  });

  it('creates agent with all data on finish', async () => {
    const api = window.electronAPI as any;
    api.agentsAdd = vi.fn().mockResolvedValue({ success: true });
    api.agentsSetIdentity = vi.fn().mockResolvedValue({ success: true });
    api.agentsWriteFile = vi.fn().mockResolvedValue({ success: true });

    const onComplete = vi.fn();
    await act(async () => {
      render(<AgentWizard onComplete={onComplete} onCancel={vi.fn()} />);
    });

    // Step 1: Enter name
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(input => (input as HTMLInputElement).placeholder?.includes('Research'));
    await act(async () => {
      fireEvent.change(nameInput!, { target: { value: 'Researcher' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // Step 2: Keep default style (friendly), next
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // Step 3: Keep default model, next
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // Step 4: Skip bindings, finish
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create agent/i }));
    });

    await waitFor(() => {
      // Should call agentsAdd with name, no custom model, and friendly SOUL template
      expect(api.agentsAdd).toHaveBeenCalledWith(
        'Researcher',
        undefined, // default model
        expect.stringContaining('warm, supportive'), // friendly template
      );
      // Should set identity with emoji
      expect(api.agentsSetIdentity).toHaveBeenCalledWith(
        'researcher', // slug
        'Researcher',
        '🐾', // friendly emoji
      );
      // Should write IDENTITY.md
      expect(api.agentsWriteFile).toHaveBeenCalledWith(
        'researcher',
        'IDENTITY.md',
        expect.stringContaining('**name**: Researcher'),
      );
      expect(onComplete).toHaveBeenCalled();
    });
  });

  it('shows error when agent creation fails', async () => {
    const api = window.electronAPI as any;
    api.agentsAdd = vi.fn().mockResolvedValue({ success: false, error: 'Agent "test" already exists' });

    await act(async () => {
      render(<AgentWizard onComplete={vi.fn()} onCancel={vi.fn()} />);
    });

    // Enter name and go through all steps
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(input => (input as HTMLInputElement).placeholder?.includes('Research'));
    await act(async () => {
      fireEvent.change(nameInput!, { target: { value: 'test' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create agent/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/already exists/i)).toBeTruthy();
    });
  });

  it('allows custom system prompt', async () => {
    const api = window.electronAPI as any;
    api.agentsAdd = vi.fn().mockResolvedValue({ success: true });
    api.agentsSetIdentity = vi.fn().mockResolvedValue({ success: true });
    api.agentsWriteFile = vi.fn().mockResolvedValue({ success: true });

    const onComplete = vi.fn();
    await act(async () => {
      render(<AgentWizard onComplete={onComplete} onCancel={vi.fn()} />);
    });

    // Step 1
    const inputs = screen.getAllByRole('textbox');
    const nameInput = inputs.find(input => (input as HTMLInputElement).placeholder?.includes('Research'));
    await act(async () => {
      fireEvent.change(nameInput!, { target: { value: 'Custom' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // Step 2: Click custom prompt
    await act(async () => {
      fireEvent.click(screen.getByText(/write custom system prompt/i));
    });

    const textarea = screen.getByRole('textbox');
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'You are a code reviewer.' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // Step 3 + 4
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /create agent/i }));
    });

    await waitFor(() => {
      expect(api.agentsAdd).toHaveBeenCalledWith(
        'Custom',
        undefined,
        'You are a code reviewer.',
      );
      expect(onComplete).toHaveBeenCalled();
    });
  });
});
