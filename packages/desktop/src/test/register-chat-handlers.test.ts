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
  chatHistory = vi.fn(async () => []);
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

function createAwarenessInitResponse(renderedContext = 'Memory context loaded') {
  return {
    result: {
      content: [{
        text: JSON.stringify({ rendered_context: renderedContext }),
      }],
    },
  };
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

  it('skips awareness_record when autoCapture is disabled', async () => {
    const ws = new FakeGatewayClient();
    const callMcpStrict = vi.fn(async () => ({}));

    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'normal answer',
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
      callMcpStrict,
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
      readMemoryCapturePolicy: () => ({ autoCapture: false, blockedSources: [] }),
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', {});

    expect(result).toMatchObject({ success: true, text: 'normal answer', sessionId: 'test-session' });
    expect(callMcpStrict).not.toHaveBeenCalled();
  });

  it('skips awareness_record when desktop source is blocked', async () => {
    const ws = new FakeGatewayClient();
    const callMcpStrict = vi.fn(async () => ({}));

    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'normal answer',
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
      callMcpStrict,
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
      readMemoryCapturePolicy: () => ({ autoCapture: true, blockedSources: ['desktop'] }),
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', {});

    expect(result).toMatchObject({ success: true, text: 'normal answer', sessionId: 'test-session' });
    expect(callMcpStrict).not.toHaveBeenCalled();
  });

  it('records memory when autoCapture is enabled and desktop source is allowed', async () => {
    const ws = new FakeGatewayClient();
    const callMcpStrict = vi.fn(async () => ({ result: { content: [{ text: '{}' }] } }));

    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'normal answer',
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
      callMcpStrict,
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
      readMemoryCapturePolicy: () => ({ autoCapture: true, blockedSources: [] }),
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, 'hello', 'test-session', {});

    expect(result).toMatchObject({ success: true, text: 'normal answer', sessionId: 'test-session' });
    expect(callMcpStrict).toHaveBeenCalledWith('awareness_record', expect.objectContaining({
      action: 'remember',
      event_type: 'turn_brief',
      source: 'desktop',
    }));
  });

  it('flags unverified local file-write success claims when gateway returns text without completed tools', async () => {
    const ws = new FakeGatewayClient();
    const callMcpStrict = vi.fn(async (toolName: string) => (
      toolName === 'awareness_init' ? createAwarenessInitResponse('Desktop memory snapshot') : {}
    ));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'I saved the file to E:\\新建文件夹2\\我是谁.txt',
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
      callMcpStrict,
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, '在 E:\\新建文件夹2 里写一个 txt 文件', 'test-session', {});

    expect(result).toMatchObject({
      success: true,
      text: 'I saved the file to E:\\新建文件夹2\\我是谁.txt',
      sessionId: 'test-session',
      unverifiedLocalFileOperation: true,
    });
    expect(callMcpStrict).toHaveBeenCalledWith(
      'awareness_init',
      expect.objectContaining({ query: '在 E:\\新建文件夹2 里写一个 txt 文件' }),
      expect.any(Number),
    );
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('Desktop already loaded the current Awareness memory context for this turn.'),
      expect.any(Object),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Assistant claimed a local filesystem mutation succeeded without any completed tool result'),
      expect.objectContaining({ sessionId: 'test-session' }),
    );

    warnSpy.mockRestore();
  });

  it('silently retries with CLI compatibility fallback when gateway reports special-use IP web blocking', async () => {
    const ws = new FakeGatewayClient();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fallbackChild = createCliFallbackChild('Fetched via exec fallback successfully');
    const runSpawn = vi.fn(() => {
      setTimeout(() => fallbackChild.emitOutput(), 0);
      return fallbackChild as any;
    });

    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: 'The web_fetch tool is unavailable or denied because the URL resolves to a private/internal/special-use IP address.',
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
      callMcpStrict: vi.fn(async (toolName: string) => (
        toolName === 'awareness_init' ? createAwarenessInitResponse('Web memory snapshot') : {}
      )),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      runSpawn,
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, '请抓取 https://example.com 的标题', 'test-session', {});

    expect(result).toMatchObject({
      success: true,
      text: 'Fetched via exec fallback successfully',
      sessionId: 'test-session',
      preferResultText: true,
    });
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('Treat the block below as the result of awareness_init'),
      expect.any(Object),
    );
    expect(runSpawn).toHaveBeenCalledTimes(1);
    const [, retryArgs] = runSpawn.mock.calls[0] as [string, string[], Record<string, unknown>];
    const retryMessage = retryArgs[retryArgs.indexOf('-m') + 1] || '';
    expect(retryMessage).toContain('On Windows, prefer Invoke-WebRequest with -UseBasicParsing.');
    expect(retryMessage).toContain('Target public URL: https://example.com');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Web tool response indicates VPN/DNS special-use IP compatibility issue'),
      expect.objectContaining({ sessionId: 'test-session' }),
    );

    warnSpy.mockRestore();
  });

  it('retries through CLI compatibility mode when awareness_init fails inside a gateway tool result', async () => {
    const ws = new FakeGatewayClient();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fallbackChild = createCliFallbackChild('Recovered without awareness_init');
    const runSpawn = vi.fn(() => {
      setTimeout(() => fallbackChild.emitOutput(), 0);
      return fallbackChild as any;
    });

    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: [
              { type: 'tool_use', id: 'tool-awareness', name: 'awareness_init', input: {} },
              {
                type: 'tool_result',
                tool_use_id: 'tool-awareness',
                is_error: true,
                content: [{ type: 'text', text: 'schema must be object or boolean' }],
              },
              { type: 'text', text: 'BROWSER_UNAVAILABLE' },
            ],
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
      callMcpStrict: vi.fn(async (toolName: string) => (
        toolName === 'awareness_init' ? createAwarenessInitResponse('Recovered memory snapshot') : {}
      )),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      runSpawn,
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['chat:send']({}, '请浏览 https://example.com 并告诉我标题', 'test-session', {});

    expect(result).toMatchObject({
      success: true,
      text: 'Recovered without awareness_init',
      sessionId: 'test-session',
      preferResultText: true,
    });
    expect(runSpawn).toHaveBeenCalledTimes(1);
    const [, retryArgs] = runSpawn.mock.calls[0] as [string, string[], Record<string, unknown>];
    const retryMessage = retryArgs[retryArgs.indexOf('-m') + 1] || '';
    expect(retryMessage).toContain('Do not call awareness_init on this retry.');
    expect(retryMessage).toContain('[Original runtime message]');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Awareness memory bootstrap compatibility issue detected; retrying without awareness_init'),
      expect.objectContaining({ sessionId: 'test-session' }),
    );

    warnSpy.mockRestore();
  });

  it('routes non-main agents via session key format agent:<id>:webchat:<sid>', async () => {
    const ws = new FakeGatewayClient();
    // The session key for non-main agents is agent:<agentId>:webchat:<rawSid>
    const expectedSid = 'agent:researcher:webchat:test-session';
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: expectedSid,
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

    expect(result).toMatchObject({ success: true, text: 'agent specific reply', sessionId: expectedSid });
    // agentId is NOT passed as a param — routing is via the session key format
    expect(ws.chatSend).toHaveBeenCalledWith(
      expectedSid,
      expect.stringContaining('hello'),
      expect.objectContaining({ verbose: 'full' }),
    );
    // Verify agentId is NOT in chat.send params (Gateway rejects additionalProperties)
    const callArgs = (ws.chatSend as any).mock.calls[0][2];
    expect(callArgs).not.toHaveProperty('agentId');
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
      expect.stringContaining(`Common ${process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux'} folders for this user are:`),
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
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('Never claim a file or folder change succeeded unless a tool result confirms it'),
      expect.any(Object),
    );
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('run a follow-up verification step'),
      expect.any(Object),
    );
    expect(ws.chatSend).toHaveBeenCalledWith(
      'test-session',
      expect.stringContaining('[Web compatibility note]'),
      expect.any(Object),
    );
  });

  it('uses direct openclaw spawn args for CLI fallback when runSpawn is available', async () => {
    const fakeChild = createCliFallbackChild('CLI fallback reply');
    const runSpawn = vi.fn(() => fakeChild as any);
    const wrapWindowsCommand = vi.fn((command: string) => command);
    const workspaceDir = process.cwd();
    const callMcpStrict = vi.fn(async (toolName: string) => (
      toolName === 'awareness_init' ? createAwarenessInitResponse('CLI file task memory') : {}
    ));

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: false, error: 'Gateway failed to start.' })),
      getGatewayWs: vi.fn(),
      getConnectedGatewayWs: vi.fn(() => null),
      callMcpStrict,
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      runSpawn,
      wrapWindowsCommand,
      stripAnsi: vi.fn((output: string) => output),
    });

    const handlers = getRegisteredHandlers();
    const pending = handlers['chat:send']({}, 'create a file and verify it', 'test-session', { workspacePath: workspaceDir });
    await vi.waitFor(() => expect(runSpawn).toHaveBeenCalledTimes(1));

    const [cmd, args, opts] = runSpawn.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(cmd).toBe('openclaw');
    expect(args).toEqual(expect.arrayContaining(['agent', '--session-id', 'test-session', '-m', '--verbose', 'full']));
    const messageArgIndex = args.indexOf('-m');
    expect(messageArgIndex).toBeGreaterThanOrEqual(0);
    expect(args[messageArgIndex + 1]).toContain(`[Project working directory: ${workspaceDir}]`);
    expect(args[messageArgIndex + 1]).toContain('Desktop already loaded the current Awareness memory context for this turn.');
    expect(args[messageArgIndex + 1]).toContain('Never claim a file or folder change succeeded unless a tool result confirms it');
    expect(opts).toMatchObject({ cwd: workspaceDir, stdio: 'pipe' });
    expect(wrapWindowsCommand).not.toHaveBeenCalled();
    expect(callMcpStrict).toHaveBeenCalledWith(
      'awareness_init',
      expect.objectContaining({ query: 'create a file and verify it' }),
      expect.any(Number),
    );

    fakeChild.emitOutput();
    await expect(pending).resolves.toMatchObject({ success: true, text: 'CLI fallback reply', sessionId: 'test-session' });
  });

  it('flags unverified local file-write success claims in CLI fallback output', async () => {
    const fakeChild = createCliFallbackChild('Saved the file to E:\\新建文件夹2\\我是谁.txt');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spawnMock.mockReturnValue(fakeChild as any);

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: false, error: 'Gateway unavailable.' })),
      getGatewayWs: vi.fn(),
      getConnectedGatewayWs: vi.fn(() => null),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const pending = handlers['chat:send']({}, '在 E:\\新建文件夹2 里写一个 txt 文件', 'test-session', {});
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    fakeChild.emitOutput();
    const result = await pending;

    expect(result).toMatchObject({
      success: true,
      text: 'Saved the file to E:\\新建文件夹2\\我是谁.txt',
      sessionId: 'test-session',
      unverifiedLocalFileOperation: true,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CLI fallback produced an unverified local filesystem success claim'),
      expect.objectContaining({ sessionId: 'test-session' }),
    );

    warnSpy.mockRestore();
  });

  it('silently retries CLI fallback when first CLI response is blocked by special-use IP policy', async () => {
    const fakeChildBlocked = createCliFallbackChild('The web_fetch tool is unavailable or denied because this URL resolves to a private/internal/special-use IP address.');
    const fakeChildRecovered = createCliFallbackChild('Downloaded via exec after compatibility retry.');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    spawnMock
      .mockReturnValueOnce(fakeChildBlocked as any)
      .mockReturnValueOnce(fakeChildRecovered as any);

    registerChatHandlers({
      sendToRenderer: vi.fn(),
      ensureGatewayRunning: vi.fn(async () => ({ ok: false, error: 'Gateway unavailable.' })),
      getGatewayWs: vi.fn(),
      getConnectedGatewayWs: vi.fn(() => null),
      callMcpStrict: vi.fn(async () => ({})),
      getEnhancedPath: vi.fn(() => process.env.PATH || ''),
      wrapWindowsCommand: vi.fn((command: string) => command),
      stripAnsi: vi.fn((output: string) => output),
      spawnChatProcess: spawnMock as any,
    });

    const handlers = getRegisteredHandlers();
    const pending = handlers['chat:send']({}, '请抓取 https://example.com', 'test-session', {});
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    fakeChildBlocked.emitOutput();
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(2));
    fakeChildRecovered.emitOutput();
    const result = await pending;

    expect(result).toMatchObject({
      success: true,
      text: 'Downloaded via exec after compatibility retry.',
      sessionId: 'test-session',
      preferResultText: true,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('CLI fallback indicates VPN/DNS special-use IP compatibility issue'),
      expect.objectContaining({ sessionId: 'test-session' }),
    );

    warnSpy.mockRestore();
  });

  it('forwards gateway agent tool events into chat status updates with tool output detail', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:agent', {
          runId: 'run-1',
          sessionKey: 'test-session',
          stream: 'tool',
          data: {
            phase: 'start',
            name: 'exec',
            toolCallId: 'tool-1',
            args: { command: 'ls -la ~/Desktop' },
          },
        });
        ws.emit('event:agent', {
          runId: 'run-1',
          sessionKey: 'test-session',
          stream: 'tool',
          data: {
            phase: 'result',
            name: 'exec',
            toolCallId: 'tool-1',
            result: { stdout: '.DS_Store\ntest.txt' },
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

  it('preserves structured thinking and tool blocks when loading chat history', async () => {
    const ws = new FakeGatewayClient();
    ws.chatHistory = vi.fn(async () => ([
      {
        __openclaw: { id: 'gw-msg-1' },
        role: 'assistant',
        timestamp: 1700000000000,
        model: 'openai/gpt-5.4',
        content: [
          { type: 'thinking', thinking: 'inspect files first' },
          { type: 'tool_use', id: 'tool-1', name: 'read', input: { filePath: '/tmp/demo.txt' } },
          { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'file contents' }] },
          { type: 'text', text: 'Done.' },
        ],
      },
    ]));

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
    const result = await handlers['chat:load-history']({}, 'test-session');

    expect(result).toMatchObject({ success: true });
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toMatchObject({
      id: 'gw-msg-1',
      role: 'assistant',
      content: 'Done.',
      thinking: 'inspect files first',
      toolCalls: [
        expect.objectContaining({
          id: 'tool-1',
          name: 'read',
          status: 'completed',
          detail: expect.stringContaining('/tmp/demo.txt'),
          output: expect.stringContaining('file contents'),
        }),
      ],
    });
    expect(result.messages[0].contentBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'thinking' }),
      expect.objectContaining({ type: 'tool_use' }),
      expect.objectContaining({ type: 'tool_result' }),
      expect.objectContaining({ type: 'text' }),
    ]));
  });

  it('merges tool results from later non-assistant history turns back into the originating assistant trace', async () => {
    const ws = new FakeGatewayClient();
    ws.chatHistory = vi.fn(async () => ([
      {
        __openclaw: { id: 'gw-msg-1' },
        role: 'assistant',
        timestamp: 1700000000000,
        model: 'openai/gpt-5.4',
        content: [
          { type: 'thinking', thinking: 'inspect files first' },
          { type: 'tool_use', id: 'tool-1', name: 'read', input: { filePath: '/tmp/demo.txt' } },
        ],
      },
      {
        __openclaw: { id: 'gw-msg-2' },
        role: 'user',
        timestamp: 1700000001000,
        content: [
          { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: 'file contents' }] },
        ],
      },
      {
        __openclaw: { id: 'gw-msg-3' },
        role: 'assistant',
        timestamp: 1700000002000,
        model: 'openai/gpt-5.4',
        content: [{ type: 'text', text: 'Done.' }],
      },
    ]));

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
    const result = await handlers['chat:load-history']({}, 'test-session');

    expect(result).toMatchObject({ success: true });
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toMatchObject({
      id: 'gw-msg-1',
      role: 'assistant',
      thinking: 'inspect files first',
      toolCalls: [
        expect.objectContaining({
          id: 'tool-1',
          name: 'read',
          status: 'completed',
          output: expect.stringContaining('file contents'),
        }),
      ],
    });
    expect(result.messages[0].contentBlocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'tool_use' }),
      expect.objectContaining({ type: 'tool_result' }),
    ]));
    expect(result.messages[1]).toMatchObject({
      id: 'gw-msg-3',
      role: 'assistant',
      content: 'Done.',
    });
  });

  it('forwards high-fidelity chat events for tool calls and tool results', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:agent', {
          runId: 'run-2',
          sessionKey: 'test-session',
          seq: 2,
          stream: 'tool',
          data: {
            phase: 'start',
            name: 'exec',
            toolCallId: 'tool-2',
            args: { command: 'pwd' },
          },
        });
        ws.emit('event:agent', {
          runId: 'run-2',
          sessionKey: 'test-session',
          seq: 3,
          stream: 'tool',
          data: {
            phase: 'result',
            name: 'exec',
            toolCallId: 'tool-2',
            result: { stdout: '/tmp/project' },
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
      'chat:event',
      expect.objectContaining({
        stream: 'tool',
        phase: 'start',
        toolCallId: 'tool-2',
        toolName: 'exec',
        args: { command: 'pwd' },
      }),
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:event',
      expect.objectContaining({
        stream: 'tool',
        phase: 'result',
        toolCallId: 'tool-2',
        toolName: 'exec',
        result: { stdout: '/tmp/project' },
      }),
    );
  });

  it('forwards structured tool and thinking blocks from event:chat deltas as high-fidelity chat events', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'delta',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'inspect files first' },
              { type: 'tool_use', id: 'tool-3', name: 'read_file', input: { filePath: '/tmp/demo.txt' } },
              { type: 'tool_result', tool_use_id: 'tool-3', content: [{ type: 'text', text: 'hello world' }] },
              { type: 'text', text: 'done' },
            ],
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
    expect(sendToRenderer).toHaveBeenCalledWith('chat:thinking', 'inspect files first');
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:event',
      expect.objectContaining({
        stream: 'assistant',
        phase: 'thinking',
        thinking: 'inspect files first',
      }),
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:event',
      expect.objectContaining({
        stream: 'tool',
        phase: 'start',
        toolCallId: 'tool-3',
        toolName: 'read_file',
        args: { filePath: '/tmp/demo.txt' },
      }),
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:event',
      expect.objectContaining({
        stream: 'tool',
        phase: 'result',
        toolCallId: 'tool-3',
        result: expect.anything(),
      }),
    );
  });

  it('forwards structured tool and thinking blocks that only appear in the final chat event', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:chat', {
          sessionKey: 'test-session',
          state: 'final',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: 'search first, summarize after' },
              { type: 'tool_use', id: 'tool-final', name: 'tavily_search', input: { query: 'today news' } },
              { type: 'tool_result', tool_use_id: 'tool-final', content: [{ type: 'text', text: 'news result block' }] },
              { type: 'text', text: 'done' },
            ],
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
    expect(sendToRenderer).toHaveBeenCalledWith('chat:thinking', 'search first, summarize after');
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:event',
      expect.objectContaining({
        stream: 'tool',
        phase: 'start',
        toolCallId: 'tool-final',
        toolName: 'tavily_search',
      }),
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:status',
      expect.objectContaining({
        type: 'tool_update',
        toolId: 'tool-final',
        detail: expect.stringContaining('news result block'),
      }),
    );
  });

  it('normalizes real event:agent payloads with tool.call and tool.output into chat events', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:agent', {
          event: 'tool.call',
          runId: 'run-3',
          sessionKey: 'test-session',
          data: {
            toolCallId: 'tool-4',
            name: 'exec',
            args: { command: 'pwd' },
          },
        });
        ws.emit('event:agent', {
          event: 'tool.output',
          runId: 'run-3',
          sessionKey: 'test-session',
          data: {
            toolCallId: 'tool-4',
            name: 'exec',
            result: { stdout: '/tmp/project' },
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
      'chat:event',
      expect.objectContaining({
        stream: 'tool',
        phase: 'start',
        toolCallId: 'tool-4',
        toolName: 'exec',
        args: { command: 'pwd' },
      }),
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:event',
      expect.objectContaining({
        stream: 'tool',
        phase: 'result',
        toolCallId: 'tool-4',
        toolName: 'exec',
        result: { stdout: '/tmp/project' },
      }),
    );
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:status',
      expect.objectContaining({
        type: 'tool_update',
        toolId: 'tool-4',
        toolStatus: 'completed',
        detail: expect.stringContaining('/tmp/project'),
      }),
    );
  });

  it('normalizes agent:assistant reasoning payloads into visible thinking events', async () => {
    const ws = new FakeGatewayClient();
    ws.chatSend = vi.fn(async () => {
      setTimeout(() => {
        ws.emit('event:agent:assistant', {
          runId: 'run-4',
          sessionKey: 'test-session',
          data: {
            reasoning: 'inspect project structure before answering',
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
    expect(sendToRenderer).toHaveBeenCalledWith('chat:thinking', 'inspect project structure before answering');
    expect(sendToRenderer).toHaveBeenCalledWith(
      'chat:event',
      expect.objectContaining({
        stream: 'assistant',
        phase: 'thinking',
        thinking: 'inspect project structure before answering',
      }),
    );
  });
});