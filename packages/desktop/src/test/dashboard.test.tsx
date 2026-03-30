import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Dashboard from '../pages/Dashboard';

describe('Dashboard (Chat)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Set a model so empty state shows suggestions (not "select model" prompt)
    localStorage.setItem('awareness-claw-config', JSON.stringify({
      language: 'zh', providerKey: 'qwen-portal', modelId: 'qwen-turbo-latest',
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

  it('renders AwarenessClaw in header', async () => {
    await act(async () => { render(<Dashboard />); });
    expect(screen.getByText('AwarenessClaw')).toBeInTheDocument();
  });

  it('renders input area', async () => {
    await act(async () => { render(<Dashboard />); });
    expect(screen.getByPlaceholderText(/输入消息/)).toBeInTheDocument();
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

    // Tool calls block should show "2 tools used" toggle
    expect(screen.getByText(/2 tools used/)).toBeInTheDocument();
  });
});
