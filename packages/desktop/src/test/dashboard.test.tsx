import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Dashboard from '../pages/Dashboard';

describe('Dashboard (Chat)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Set a model so empty state shows suggestions (not "select model" prompt)
    localStorage.setItem('awareness-claw-config', JSON.stringify({
      language: 'zh', providerKey: 'qwen-portal', modelId: 'qwen-turbo-latest',
      bootstrapCompleted: true,
    }));
  });

  it('renders chat page with empty state', async () => {
    await act(async () => { render(<Dashboard />); });
    expect(screen.getByText(/AI 助手/)).toBeInTheDocument();
  });

  it('renders suggested prompts', async () => {
    await act(async () => { render(<Dashboard />); });
    expect(screen.getByText(/学习计划/)).toBeInTheDocument();
  });

  it('renders AwarenessClaw logo in header', async () => {
    await act(async () => { render(<Dashboard />); });
    // Header uses an img with alt="AwarenessClaw" instead of visible text
    expect(screen.getByAltText('AwarenessClaw')).toBeInTheDocument();
  });

  it('renders input area', async () => {
    await act(async () => { render(<Dashboard />); });
    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument();
  });

  it('shows bootstrap wizard when onboarding is not completed and USER.md is missing', async () => {
    localStorage.setItem('awareness-claw-config', JSON.stringify({
      language: 'zh', providerKey: 'qwen-portal', modelId: 'qwen-turbo-latest',
      bootstrapCompleted: false,
    }));
    const api = window.electronAPI as any;
    api.workspaceReadFile = vi.fn().mockResolvedValue({ success: true, content: '', exists: false });

    await act(async () => { render(<Dashboard />); });

    await waitFor(() => {
      expect(screen.getByText('欢迎使用 AwarenessClaw')).toBeInTheDocument();
    });
  });

  it('skips bootstrap wizard when USER.md already exists', async () => {
    localStorage.setItem('awareness-claw-config', JSON.stringify({
      language: 'zh', providerKey: 'qwen-portal', modelId: 'qwen-turbo-latest',
      bootstrapCompleted: false,
    }));
    const api = window.electronAPI as any;
    api.workspaceReadFile = vi.fn().mockResolvedValue({ success: true, content: '# User\n\n- Name: Edwin', exists: true });

    await act(async () => { render(<Dashboard />); });

    await waitFor(() => {
      expect(api.workspaceReadFile).toHaveBeenCalledWith('USER.md');
    });
  });

  it('clicking suggested prompt fills input', async () => {
    await act(async () => { render(<Dashboard />); });
    fireEvent.click(screen.getByText(/学习计划/));
    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    expect(textarea.value).toContain('学习计划');
  });

  it('persists sessions to localStorage after send', async () => {
    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'test msg' } });
    });

    // Find and click send button (the last button with Send icon)
    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('awareness-claw-sessions') || '[]');
      expect(sessions.length).toBeGreaterThan(0);
    });
  });

  it('saves tool calls in assistant message after send', async () => {
    // Setup mock that simulates tool call status events
    let statusCallback: ((status: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatStatus = (cb: any) => { statusCallback = cb; };
    api.chatSend = async (msg: string) => {
      // Simulate tool call events during response
      if (statusCallback) {
        statusCallback({ type: 'thinking' });
        statusCallback({ type: 'tool_call', tool: 'awareness_recall', toolStatus: 'running' });
        statusCallback({ type: 'tool_call', tool: 'Awareness Memory', toolStatus: 'recalling' });
        statusCallback({ type: 'generating' });
      }
      return { success: true, text: 'Response with tools', sessionId: 'test-session' };
    };

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'search my memories' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('awareness-claw-sessions') || '[]');
      const msgs = sessions[0]?.messages || [];
      const assistantMsg = msgs.find((m: any) => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg?.toolCalls?.length).toBeGreaterThan(0);
      expect(assistantMsg?.toolCalls?.[0]?.name).toBe('awareness_recall');
    });
  });

  it('passes the selected project folder to chatSend', async () => {
    const api = window.electronAPI as any;
    api.selectDirectory = vi.fn().mockResolvedValue({ directoryPath: 'E:\\Projects\\DemoApp' });
    api.chatSend = vi.fn().mockResolvedValue({ success: true, text: 'ok', sessionId: 'test-session' });

    await act(async () => { render(<Dashboard />); });

    await act(async () => {
      fireEvent.click(screen.getAllByText(/Project folder|项目目录/)[0].closest('button') as HTMLButtonElement);
    });

    const textarea = screen.getByPlaceholderText(/输入消息|Type a message/);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'edit local files' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await waitFor(() => {
      expect(api.chatSend).toHaveBeenCalledWith('edit local files', expect.any(String), expect.objectContaining({
        workspacePath: 'E:\\Projects\\DemoApp',
      }));
    });
  });

  it('displays streaming content during response', async () => {
    let streamCallback: ((chunk: string) => void) | null = null;
    let statusCallback: ((status: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatStream = (cb: any) => { streamCallback = cb; };
    api.onChatStatus = (cb: any) => { statusCallback = cb; };

    let resolveChat: ((v: any) => void) | null = null;
    api.chatSend = () => new Promise((resolve) => { resolveChat = resolve; });

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'hello' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    // Simulate streaming chunks
    await act(async () => {
      if (streamCallback) {
        streamCallback('Hello ');
        streamCallback('World!');
      }
    });

    // Check streaming content is shown (blinking cursor indicates streaming)
    expect(screen.getByText('▊')).toBeInTheDocument();

    // Resolve the chat
    await act(async () => {
      resolveChat?.({ success: true, text: 'Hello World!', sessionId: 'test' });
    });
  });

  it('shows live thinking as a collapsible stream and auto-collapses when generation starts', async () => {
    let thinkingCallback: ((text: string) => void) | null = null;
    let statusCallback: ((status: any) => void) | null = null;
    let resolveChat: ((value: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatThinking = (cb: any) => { thinkingCallback = cb; };
    api.onChatStatus = (cb: any) => { statusCallback = cb; };
    api.chatSend = vi.fn(() => new Promise((resolve) => {
      resolveChat = resolve;
    }));

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'think first' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await act(async () => {
      statusCallback?.({ type: 'thinking' });
      thinkingCallback?.('step 1\nstep 2');
    });

    expect(screen.getAllByText(/Thinking process|思考过程/).length).toBeGreaterThan(0);
    expect(screen.getByText(/step 1\s*step 2/)).toBeInTheDocument();

    await act(async () => {
      statusCallback?.({ type: 'generating' });
    });

    expect(screen.queryByText(/step 1\s*step 2/)).not.toBeInTheDocument();

    await act(async () => {
      resolveChat?.({ success: true, text: 'done', sessionId: 'test-session' });
    });
  });

  it('clears the composer immediately after send', async () => {
    let resolveChat: ((value: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.chatSend = vi.fn(() => new Promise((resolve) => {
      resolveChat = resolve;
    }));

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'clear me' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    expect(textarea.value).toBe('');
    expect(api.chatSend).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveChat?.({ success: true, text: 'done', sessionId: 'test-session' });
    });
  });

  it('does not send duplicate messages on repeated Enter presses', async () => {
    let resolveChat: ((value: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.chatSend = vi.fn(() => new Promise((resolve) => {
      resolveChat = resolve;
    }));

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'only once' } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false } });
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false } });
    });

    expect(api.chatSend).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveChat?.({ success: true, text: 'done', sessionId: 'test-session' });
    });

    await act(async () => {
      fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false } });
    });

    expect(api.chatSend).toHaveBeenCalledTimes(1);
    expect(textarea.value).toBe('');
  });

  it('shows tool calls block in completed message', async () => {
    // Pre-populate a session with a message that has tool calls
    const session = {
      id: 'session-1',
      title: 'Test',
      messages: [
        { id: 'msg-1', role: 'user', content: 'hi', timestamp: Date.now() },
        {
          id: 'msg-2', role: 'assistant', content: 'Response',
          timestamp: Date.now(), model: 'test',
          toolCalls: [
            { id: 'tc-1', name: 'awareness_recall', status: 'completed', timestamp: Date.now() },
            { id: 'tc-2', name: 'Awareness Memory', status: 'recalling', timestamp: Date.now() },
          ],
        },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    localStorage.setItem('awareness-claw-sessions', JSON.stringify([session]));
    localStorage.setItem('awareness-claw-active-session', 'session-1');

    await act(async () => { render(<Dashboard />); });

    // Tool calls block should show tool count (i18n: "2 个工具调用" in zh, "2 tool(s) used" in en)
    expect(screen.getByText(/2.*工具调用|2 tool/)).toBeInTheDocument();
  });

  it('shows approval and failure detail in active tool status', async () => {
    let statusCallback: ((status: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatStatus = (cb: any) => { statusCallback = cb; };
    api.chatSend = async () => {
      statusCallback?.({
        type: 'tool_approval',
        tool: 'exec',
        toolStatus: 'awaiting_approval',
        toolId: 'approval-1',
        detail: 'pwd | cwd: /tmp/demo',
      });
      statusCallback?.({
        type: 'tool_call',
        tool: 'awareness_record',
        toolStatus: 'saving',
        toolId: 'memory-1',
        detail: 'Save this turn to Awareness memory',
      });
      statusCallback?.({
        type: 'tool_update',
        toolId: 'memory-1',
        toolStatus: 'failed',
        detail: 'daemon offline',
      });
      return { success: true, text: 'done', sessionId: 'test-session' };
    };

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'run pwd' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await waitFor(() => {
      expect(screen.getByText(/Awaiting approval|等待/)).toBeInTheDocument();
      expect(screen.getByText(/pwd \| cwd: \/tmp\/demo/)).toBeInTheDocument();
      expect(screen.getByText(/daemon offline/)).toBeInTheDocument();
    });
  });

  it('keeps approval requests actionable instead of showing no response', async () => {
    let statusCallback: ((status: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatStatus = (cb: any) => { statusCallback = cb; };
    api.chatSend = vi.fn()
      .mockImplementationOnce(async () => {
        statusCallback?.({
          type: 'tool_approval',
          tool: 'exec',
          toolStatus: 'awaiting_approval',
          toolId: 'approval-1',
          approvalRequestId: 'approval-1',
          approvalCommand: '/approve approval-1 allow-once',
          detail: 'pwd | cwd: /tmp/demo',
        });
        return { success: true, sessionId: 'test-session', awaitingApproval: true, approvalCommand: '/approve approval-1 allow-once' };
      })
      .mockResolvedValueOnce({ success: true, text: 'working directory is /tmp/demo', sessionId: 'test-session' });

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'run pwd' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await waitFor(() => {
      expect(screen.getByText(/Waiting for tool approval|等待你批准工具/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Approve once|批准一次/ })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Approve once|批准一次/ }));
    });

    await waitFor(() => {
      expect(api.chatSend).toHaveBeenNthCalledWith(2, '/approve approval-1 allow-once', expect.any(String), expect.any(Object));
      expect(screen.getByText(/working directory is \/tmp\/demo/)).toBeInTheDocument();
    });
  });

  it('routes unconfigured providers to Settings instead of opening a second config flow', async () => {
    const onNavigate = vi.fn();
    localStorage.setItem('awareness-claw-config', JSON.stringify({
      language: 'zh', providerKey: 'qwen-portal', modelId: 'qwen-turbo-latest',
      bootstrapCompleted: true,
      providerProfiles: {
        'qwen-portal': {
          apiKey: 'qwen-key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          models: [{ id: 'qwen-turbo-latest', label: 'Qwen Turbo' }],
        },
      },
    }));

    await act(async () => { render(<Dashboard onNavigate={onNavigate} />); });

    await act(async () => {
      fireEvent.click(screen.getByText(/qwen-turbo-latest/i));
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText(/GPT-4o/i)[0]);
    });

    expect(onNavigate).toHaveBeenCalledWith('settings');
  });

  it('restores provider-specific credentials when quick switching from chat header', async () => {
    localStorage.setItem('awareness-claw-config', JSON.stringify({
      language: 'zh', providerKey: 'qwen-portal', modelId: 'qwen-turbo-latest',
      bootstrapCompleted: true,
      providerProfiles: {
        'qwen-portal': {
          apiKey: 'qwen-key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          models: [{ id: 'qwen-turbo-latest', label: 'Qwen Turbo' }],
        },
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com/v1',
          models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
        },
      },
    }));

    await act(async () => { render(<Dashboard />); });

    await act(async () => {
      fireEvent.click(screen.getByText(/qwen-turbo-latest/i));
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText(/GPT-4o/i)[0]);
    });

    const config = JSON.parse(localStorage.getItem('awareness-claw-config') || '{}');
    expect(config.providerKey).toBe('openai');
    expect(config.modelId).toBe('gpt-4o');
    expect(config.apiKey).toBe('openai-key');
    expect(config.baseUrl).toBe('https://api.openai.com/v1');
  });
});
