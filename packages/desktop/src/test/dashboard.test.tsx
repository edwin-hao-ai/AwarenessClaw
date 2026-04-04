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

  it('opens session sidebar from header toggle', async () => {
    await act(async () => { render(<Dashboard />); });

    expect(screen.queryByTitle(/新对话|New Session/)).not.toBeInTheDocument();

    const sessionListButton = screen.getByTitle(/会话列表|Session list/);
    await act(async () => {
      fireEvent.click(sessionListButton);
    });

    expect(screen.getByTitle(/新对话|New Session/)).toBeInTheDocument();
  });

  it('shows bootstrap wizard when onboarding is not completed and USER.md is missing', async () => {
    localStorage.setItem('awareness-claw-config', JSON.stringify({
      language: 'zh', providerKey: 'qwen-portal', modelId: 'qwen-turbo-latest',
      bootstrapCompleted: false,
    }));
    const api = window.electronAPI as any;
    api.agentsReadFile = vi.fn().mockResolvedValue({ success: true, content: '', path: '/Users/test/.openclaw/workspace/USER.md' });

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
    api.agentsReadFile = vi.fn().mockResolvedValue({ success: true, content: '# User\n\n- Name: Edwin', path: '/Users/test/.openclaw/workspace/USER.md' });

    await act(async () => { render(<Dashboard />); });

    await waitFor(() => {
      expect(api.agentsReadFile).toHaveBeenCalledWith('main', 'USER.md');
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

    expect(screen.getAllByText(/DemoApp/).length).toBeGreaterThan(0);

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

  it('updates the project folder label immediately after selection', async () => {
    const api = window.electronAPI as any;
    api.selectDirectory = vi.fn().mockResolvedValue({ directoryPath: 'E:\\Projects\\StuckRestart' });

    await act(async () => { render(<Dashboard />); });

    await act(async () => {
      fireEvent.click(screen.getAllByText(/Project folder|项目目录/)[0].closest('button') as HTMLButtonElement);
    });

    expect(screen.getAllByText(/StuckRestart/).length).toBeGreaterThan(0);
  });

  it('renders a permissions selector aligned with Settings presets and can switch to Developer', async () => {
    const api = window.electronAPI as any;
    api.permissionsGet = vi.fn().mockResolvedValue({
      success: true,
      profile: 'coding',
      alsoAllow: ['awareness_init', 'awareness_get_agent_prompt'],
      denied: ['exec', 'bash', 'shell', 'camera.snap', 'screen.record', 'contacts.add', 'calendar.add', 'sms.send'],
      execSecurity: 'deny',
      execAsk: 'on-miss',
      execAskFallback: 'deny',
      execAutoAllowSkills: false,
      execAllowlist: [],
    });
    api.permissionsUpdate = vi.fn().mockResolvedValue({ success: true });

    await act(async () => { render(<Dashboard />); });

    await act(async () => {
      fireEvent.click(screen.getByTitle(/Permissions/));
    });

    expect(screen.getAllByText(/^(Safe|安全模式)$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^(Standard|标准模式)$/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^(Developer|开发者模式)$/).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getAllByText(/^(Developer|开发者模式)$/)[0]);
    });

    await waitFor(() => {
      expect(api.permissionsUpdate).toHaveBeenCalledWith(expect.objectContaining({
        alsoAllow: ['awareness_init', 'awareness_get_agent_prompt', 'exec', 'awareness_recall', 'awareness_record', 'awareness_lookup', 'awareness_perception'],
        denied: [],
        execSecurity: 'full',
        execAsk: 'off',
        execAskFallback: 'full',
        execAutoAllowSkills: true,
      }));
    });
  });

  it('starts a fresh chat session after changing permissions when the current session already has history', async () => {
    const existingSession = {
      id: 'session-existing',
      title: 'Old chat',
      messages: [
        { id: 'msg-1', role: 'user', content: '旧权限上下文', timestamp: Date.now() },
      ],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    localStorage.setItem('awareness-claw-sessions', JSON.stringify([existingSession]));
    localStorage.setItem('awareness-claw-active-session', 'session-existing');

    const api = window.electronAPI as any;
    api.permissionsGet = vi.fn().mockResolvedValue({
      success: true,
      profile: 'coding',
      alsoAllow: ['awareness_init', 'awareness_get_agent_prompt'],
      denied: ['exec', 'bash', 'shell'],
      execSecurity: 'deny',
      execAsk: 'on-miss',
      execAskFallback: 'deny',
      execAutoAllowSkills: false,
      execAllowlist: [],
    });
    api.permissionsUpdate = vi.fn().mockResolvedValue({ success: true });

    await act(async () => { render(<Dashboard />); });

    await act(async () => {
      fireEvent.click(screen.getByTitle(/Permissions/));
    });

    await waitFor(() => {
      expect(screen.getAllByText(/^(Developer|开发者模式)$/).length).toBeGreaterThan(0);
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText(/^(Developer|开发者模式)$/)[0]);
    });

    await waitFor(() => {
      const sessions = JSON.parse(localStorage.getItem('awareness-claw-sessions') || '[]');
      expect(sessions).toHaveLength(2);
      expect(sessions[0].id).not.toBe('session-existing');
      expect(localStorage.getItem('awareness-claw-active-session')).not.toBe('session-existing');
    });
  });

  it('opens OpenClaw dashboard via resolved dashboard url', async () => {
    const api = window.electronAPI as any;
    api.getDashboardUrl = vi.fn().mockResolvedValue({ url: 'http://127.0.0.1:18789/chat' });
    api.openExternal = vi.fn().mockResolvedValue(undefined);

    await act(async () => { render(<Dashboard />); });

    await act(async () => {
      fireEvent.click(screen.getByTitle(/OpenClaw Dashboard|OpenClaw 控制台/));
    });

    await waitFor(() => {
      expect(api.getDashboardUrl).toHaveBeenCalled();
      expect(api.openExternal).toHaveBeenCalledWith('http://127.0.0.1:18789/chat');
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

  it('shows live thinking and keeps it visible in the run trace after generation starts', async () => {
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
    expect(screen.getAllByText(/step 1\s*step 2/).length).toBeGreaterThan(0);

    await act(async () => {
      statusCallback?.({ type: 'generating' });
    });

    expect(screen.getAllByText(/step 1\s*step 2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Run trace|运行链路/).length).toBeGreaterThan(0);

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

    expect(screen.getByText(/Run trace|运行链路/)).toBeInTheDocument();
  });

  it('hides raw gateway debug noise and finalizes active tool calls on successful completion', async () => {
    let statusCallback: ((status: any) => void) | null = null;
    let thinkingCallback: ((text: string) => void) | null = null;
    let debugCallback: ((text: string) => void) | null = null;
    let resolveChat: ((value: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatStatus = (cb: any) => { statusCallback = cb; };
    api.onChatThinking = (cb: any) => { thinkingCallback = cb; };
    api.onChatDebug = (cb: any) => { debugCallback = cb; };
    api.chatSend = vi.fn(() => new Promise((resolve) => {
      resolveChat = resolve;
    }));

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'trace this request' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await act(async () => {
      statusCallback?.({ type: 'gateway', message: 'Gateway started in app session' });
      statusCallback?.({ type: 'tool_call', tool: 'exec', toolStatus: 'running', toolId: 'tool-1', detail: 'open https://google.com' });
      thinkingCallback?.('先检查是否可以调用浏览器工具');
      debugCallback?.('[gw:tool.exec.started] {"tool":"exec"}');
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Run trace|运行链路/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Gateway started in app session/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/open https:\/\/google.com/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/先检查是否可以调用浏览器工具/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/\[gw:tool\.exec\.started\]/)).not.toBeInTheDocument();
    });

    await act(async () => {
      resolveChat?.({ success: true, text: 'done', sessionId: 'test-session' });
    });

    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument();
      expect(screen.getAllByText(/Run trace|运行链路/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/Gateway started in app session/).length).toBeGreaterThan(0);
    });

    const sessions = JSON.parse(localStorage.getItem('awareness-claw-sessions') || '[]');
    const msgs = sessions[0]?.messages || [];
    const assistantMsg = msgs.find((m: any) => m.role === 'assistant');
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.traceEvents?.some((event: any) => String(event?.detail || '').includes('[gw:tool.exec.started]'))).toBe(false);
    expect(assistantMsg?.toolCalls?.[0]?.status).toBe('completed');
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
      expect(screen.getAllByText(/pwd \| cwd: \/tmp\/demo/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/daemon offline/).length).toBeGreaterThan(0);
    });
  });

  it('hydrates structured thinking and tool output from gateway chat history', async () => {
    const session = {
      id: 'session-history',
      title: 'History',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    localStorage.setItem('awareness-claw-sessions', JSON.stringify([session]));
    localStorage.setItem('awareness-claw-active-session', 'session-history');

    const api = window.electronAPI as any;
    api.chatLoadHistory = vi.fn().mockResolvedValue({
      success: true,
      messages: [
        {
          id: 'gw-msg-1',
          role: 'assistant',
          content: 'Done.',
          timestamp: Date.now(),
          model: 'openai/gpt-5.4',
          thinking: 'inspect files first',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'read',
              status: 'completed',
              timestamp: Date.now(),
              detail: 'filePath: /tmp/demo.txt',
              output: 'file contents',
            },
          ],
          contentBlocks: [
            { type: 'thinking', thinking: 'inspect files first' },
            { type: 'tool_use', id: 'tool-1', name: 'read', input: { filePath: '/tmp/demo.txt' } },
            { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'file contents' }] },
            { type: 'text', text: 'Done.' },
          ],
        },
      ],
    });

    await act(async () => { render(<Dashboard />); });

    await waitFor(() => {
      expect(screen.getByText('Done.')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText(/Run trace|运行链路/));
    });

    await waitFor(() => {
      expect(screen.getAllByText(/inspect files first/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/filePath: \/tmp\/demo\.txt/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/file contents/).length).toBeGreaterThan(0);
    });
  });

  it('renders high-fidelity live tool events with args and output in run trace', async () => {
    let eventCallback: ((event: any) => void) | null = null;
    let resolveChat: ((value: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatEvent = (cb: any) => { eventCallback = cb; };
    api.chatSend = vi.fn(() => new Promise((resolve) => {
      resolveChat = resolve;
    }));

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'show me tool trace' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await act(async () => {
      eventCallback?.({
        stream: 'tool',
        phase: 'start',
        toolCallId: 'tool-2',
        toolName: 'exec',
        args: { command: 'pwd' },
      });
      eventCallback?.({
        stream: 'tool',
        phase: 'result',
        toolCallId: 'tool-2',
        toolName: 'exec',
        result: { stdout: '/tmp/project' },
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/Run trace|运行链路/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/pwd/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/\/tmp\/project/).length).toBeGreaterThan(0);
    });

    await act(async () => {
      resolveChat?.({ success: true, text: 'done', sessionId: 'test-session' });
    });
  });

  it('renders thinking streamed through chat events even when onChatThinking is not used', async () => {
    let eventCallback: ((event: any) => void) | null = null;
    let resolveChat: ((value: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatEvent = (cb: any) => { eventCallback = cb; };
    api.chatSend = vi.fn(() => new Promise((resolve) => {
      resolveChat = resolve;
    }));

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'show reasoning' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await act(async () => {
      eventCallback?.({
        stream: 'assistant',
        phase: 'thinking',
        thinking: 'inspect files before editing',
      });
    });

    await waitFor(() => {
      expect(screen.getAllByText(/inspect files before editing/).length).toBeGreaterThan(0);
    });

    await act(async () => {
      resolveChat?.({ success: true, text: 'done', sessionId: 'test-session' });
    });
  });

  it('collapses repeated generating status updates into a single trace entry', async () => {
    let statusCallback: ((status: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatStatus = (cb: any) => { statusCallback = cb; };
    api.chatSend = vi.fn(async () => {
      statusCallback?.({ type: 'generating' });
      statusCallback?.({ type: 'generating' });
      statusCallback?.({ type: 'generating' });
      return { success: true, text: 'done', sessionId: 'test-session' };
    });

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'finish once' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getAllByText(/Run trace|运行链路/)[0]);
    });

    expect(screen.getAllByText(/Agent status|代理状态/).length).toBe(1);
  });

  it('ignores trailing status events after the assistant response has already completed', async () => {
    let statusCallback: ((status: any) => void) | null = null;
    let resolveChat: ((value: any) => void) | null = null;
    const api = window.electronAPI as any;
    api.onChatStatus = (cb: any) => { statusCallback = cb; };
    api.chatSend = vi.fn(() => new Promise((resolve) => {
      resolveChat = resolve;
    }));

    await act(async () => { render(<Dashboard />); });

    const textarea = screen.getByPlaceholderText(/输入消息/) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'finish cleanly' } });
    });

    const buttons = screen.getAllByRole('button');
    const sendBtn = buttons[buttons.length - 1];
    await act(async () => { fireEvent.click(sendBtn); });

    await act(async () => {
      statusCallback?.({ type: 'tool_call', tool: 'exec', toolStatus: 'running', toolId: 'tool-1', detail: 'pwd' });
      resolveChat?.({ success: true, text: 'done', sessionId: 'test-session' });
    });

    await waitFor(() => {
      expect(screen.getByText('done')).toBeInTheDocument();
    });

    await act(async () => {
      statusCallback?.({ type: 'tool_update', toolId: 'tool-1', toolStatus: 'failed', detail: 'late failure should be ignored' });
    });

    expect(screen.queryByText(/出错了|Response timed out or failed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/late failure should be ignored/)).not.toBeInTheDocument();
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

  it('routes unconfigured providers to Models instead of opening a second config flow', async () => {
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

    expect(onNavigate).toHaveBeenCalledWith('models');
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
