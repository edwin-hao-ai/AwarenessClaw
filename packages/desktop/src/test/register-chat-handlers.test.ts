import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock } = vi.hoisted(() => ({
  ipcHandleMock: vi.fn(),
}));

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

import { registerChatHandlers } from '../../electron/ipc/register-chat-handlers';

class FakeGatewayClient extends EventEmitter {
  isConnected = true;
  chatSend = vi.fn(async () => ({ status: 'started' }));
  chatAbort = vi.fn(async () => undefined);
}

function getRegisteredHandlers() {
  return Object.fromEntries(
    ipcHandleMock.mock.calls.map(([channel, handler]) => [channel, handler]),
  ) as Record<string, (...args: any[]) => Promise<any>>;
}

function createCliFallbackChild(output: string) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: ReturnType<typeof vi.fn>;
    emitOutput: () => void;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();

  child.emitOutput = () => {
    child.stdout.emit('data', Buffer.from(`${output}\n`));
    child.emit('exit', 0);
  };

  return child;
}

describe('registerChatHandlers', () => {
  beforeEach(() => {
    ipcHandleMock.mockReset();
    spawnMock.mockReset();
  });

  it('falls back to CLI when gateway preflight fails before websocket connect', async () => {
    const fakeChild = createCliFallbackChild('CLI fallback reply');
    spawnMock.mockReturnValue(fakeChild as any);

    const sendToRenderer = vi.fn();

    registerChatHandlers({
      sendToRenderer,
      ensureGatewayRunning: vi.fn(async () => ({ ok: false, error: 'Gateway failed to start.' })),
      getGatewayWs: vi.fn(),
      getConnectedGatewayWs: vi.fn(() => null),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const pending = handlers['chat:send']({}, 'hello from cli fallback', 'test-session', {});
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    fakeChild.emitOutput();
    const result = await pending;

    expect(result).toMatchObject({ success: true, text: 'CLI fallback reply', sessionId: 'test-session' });
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:status',
      expect.objectContaining({
        type: 'gateway',
        message: 'Gateway failed to start.',
      }),
    );
    expect(spawnMock).toHaveBeenCalled();
  });

  it('preserves workspace instructions when CLI fallback is used', async () => {
    const fakeChild = createCliFallbackChild('CLI workspace reply');
    spawnMock.mockReturnValue(fakeChild as any);

    const wrapWindowsCommand = vi.fn((command: string) => command);
    const workspaceDir = process.cwd();

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: false, error: 'Gateway warming up.' })),
      getGatewayWs: vi.fn(),
      getConnectedGatewayWs: vi.fn(() => null),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand,
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
  const pending = handlers['chat:send']({}, 'check project files', 'test-session', { workspacePath: workspaceDir });
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
  fakeChild.emitOutput();
  const result = await pending;
    const escapedWorkspaceDir = workspaceDir.replace(/\\/g, '\\\\');

    expect(result).toMatchObject({ success: true, text: 'CLI workspace reply', sessionId: 'test-session' });

    // On macOS/Linux the command goes through /bin/bash -c, not wrapWindowsCommand.
    // The workspace instructions are embedded in the -m message arg (escaped), inside the -c string.
    if (process.platform === 'win32') {
      expect(wrapWindowsCommand).toHaveBeenCalledWith(expect.stringContaining(`[Project working directory: ${escapedWorkspaceDir}]`));
      expect(wrapWindowsCommand).toHaveBeenCalledWith(expect.stringContaining('Do not treat this folder as the agent\'s home workspace'));
    } else {
      // spawnChatProcess('/bin/bash', ['--norc', '--noprofile', '-c', 'export PATH=...; openclaw ...'], { cwd })
      const spawnCall = spawnMock.mock.calls[0];
      const allArgs = JSON.stringify(spawnCall);
      expect(allArgs).toContain('[Project working directory:');
      expect(allArgs).toContain('Do not treat this folder as the agent');
    }
  });

  it('logs an upstream empty-response warning when Gateway finishes with no assistant payload', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
        });
      }, 0);
      return { status: 'started' };
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: true })),
      getGatewayWs: vi.fn(async () => ws as any),
      getConnectedGatewayWs: vi.fn(() => ws as any),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', {});

    expect(result).toMatchObject({ success: true, text: 'No response', sessionId: 'test-session' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('OpenClaw/Gateway completed the run with an empty assistant response'),
      expect.objectContaining({
        sessionId: 'test-session',
        sawFinalState: true,
        sawAssistantDelta: false,
      }),
    );

    warnSpy.mockRestore();
  });

  it('uses assistant text from the final event when no delta text was streamed', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'final-only text',
          },
        });
      }, 0);
      return { status: 'started' };
    });

    const sendToRenderer = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registerChatHandlers({
      sendToRenderer,
      ensureGatewayRunning: vi.fn(async () => ({ ok: true })),
      getGatewayWs: vi.fn(async () => ws as any),
      getConnectedGatewayWs: vi.fn(() => ws as any),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', {});

    expect(result).toMatchObject({ success: true, text: 'final-only text', sessionId: 'test-session' });
    expect(sendToRenderer).toHaveBeenCalledWith('chat:stream-end', {});
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Desktop received assistant text only in the final event and would misclassify it as No response'),
      expect.anything(),
    );

    warnSpy.mockRestore();
  });

  it('forwards non-main agent ids to the gateway chat.send call', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'agent specific reply',
          },
        });
      }, 0);
      return { status: 'started' };
    });

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: true })),
      getGatewayWs: vi.fn(async () => ws as any),
      getConnectedGatewayWs: vi.fn(() => ws as any),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', { agentId: 'researcher' });

    expect(result).toMatchObject({ success: true, text: 'agent specific reply', sessionId: 'test-session' });
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('hello'),
      expect.objectContaining({ agentId: 'researcher', verbose: 'full' }),
    );
  });

  it('requests verbose full so gateway tool events include real output details', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'done',
          },
        });
      }, 0);
      return { status: 'started' };
    });

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: true })),
      getGatewayWs: vi.fn(async () => ws as any),
      getConnectedGatewayWs: vi.fn(() => ws as any),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', {});

    expect(result).toMatchObject({ success: true, text: 'done', sessionId: 'test-session' });
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('hello'),
      expect.objectContaining({ verbose: 'full' }),
    );
  });

  it('treats the selected project folder as an operation root without switching agent workspace', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'workspace switched',
          },
        });
      }, 0);
      return { status: 'started' };
    });

    const workspaceDir = process.cwd();

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: true })),
      getGatewayWs: vi.fn(async () => ws as any),
      getConnectedGatewayWs: vi.fn(() => ws as any),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', { workspacePath: workspaceDir });

    expect(result).toMatchObject({ success: true, text: 'workspace switched', sessionId: 'test-session' });
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining(`[Project working directory: ${workspaceDir}]`),
      expect.any(Object),
    );
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining("Do not treat this folder as the agent's home workspace"),
      expect.any(Object),
    );
  });

  it('injects desktop path context for natural-language desktop requests', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'checked desktop',
          },
        });
      }, 0);
      return { status: 'started' };
    });

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: true })),
      getGatewayWs: vi.fn(async () => ws as any),
      getConnectedGatewayWs: vi.fn(() => ws as any),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, '你看看我电脑桌面上有什么文件', 'test-session', {});

    expect(result).toMatchObject({ success: true, text: 'checked desktop', sessionId: 'test-session' });
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('When the user asks about local files or folders on this machine, do not answer with a generic safety/privacy refusal'),
      expect.any(Object),
    );
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining(`desktop=${path.join(os.homedir(), 'Desktop')}`),
      expect.any(Object),
    );
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('If the user says "桌面", "desktop", or "我的桌面"'),
      expect.any(Object),
    );
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('[Current host exec approvals] security='),
      expect.any(Object),
    );
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('If earlier conversation turns claimed local filesystem access was blocked by allowlist/privacy rules'),
      expect.any(Object),
    );
  });

  it('forwards gateway agent tool events into chat status updates with tool output detail', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('gateway-event', {
          event: 'agent',
          payload: {
            runId: 'run-1',
            sessionKey: 'test-session',
            stream: 'tool',
            data: {
              phase: 'start',
              name: 'exec',
              toolCallId: 'tool-1',
              args: { command: 'ls -la ~/Desktop' },
            },
          },
        });
        ws.emit('gateway-event', {
          event: 'agent',
          payload: {
            runId: 'run-1',
            sessionKey: 'test-session',
            stream: 'tool',
            data: {
              phase: 'result',
              name: 'exec',
              toolCallId: 'tool-1',
              result: { stdout: '.DS_Store\ntest.txt' },
            },
          },
        });
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'done',
          },
        });
      }, 0);
      return { status: 'started' };
    });

    const sendToRenderer = vi.fn();

    registerChatHandlers({
      sendToRenderer,
      ensureGatewayRunning: vi.fn(async () => ({ ok: true })),
      getGatewayWs: vi.fn(async () => ws as any),
      getConnectedGatewayWs: vi.fn(() => ws as any),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', {});

    expect(result).toMatchObject({ success: true, text: 'done', sessionId: 'test-session' });
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:status',
      expect.objectContaining({
        type: 'tool_call',
        tool: 'exec',
        toolId: 'tool-1',
        detail: expect.stringContaining('ls -la ~/Desktop'),
      }),
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:status',
      expect.objectContaining({
        type: 'tool_update',
        toolId: 'tool-1',
        toolStatus: 'completed',
        detail: expect.stringContaining('.DS_Store'),
      }),
    );
  });
});