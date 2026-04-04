/**
 * Tests for register-workflow-handlers.ts IPC handlers.
 * Verifies task:create, workflow:config, workflow:check-lobster, workflow:list.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ipcMain } from 'electron';

// Mock electron
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  BrowserWindow: vi.fn(),
}));

// Mock fs
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue('{}'),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn().mockReturnValue('{}'),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  unlinkSync: vi.fn(),
}));

// Mock json-file reader
vi.mock('../../electron/json-file', () => ({
  readJsonFileWithBom: vi.fn().mockReturnValue({}),
}));

import { registerWorkflowHandlers } from '../../electron/ipc/register-workflow-handlers';

type HandlerMap = Record<string, (...args: any[]) => Promise<any>>;

function collectHandlers(): HandlerMap {
  const handlers: HandlerMap = {};
  const mockHandle = ipcMain.handle as ReturnType<typeof vi.fn>;
  for (const call of mockHandle.mock.calls) {
    handlers[call[0] as string] = call[1];
  }
  return handlers;
}

describe('register-workflow-handlers', () => {
  let handlers: HandlerMap;
  const mockGatewayWs = {
    isConnected: true,
    chatSend: vi.fn().mockResolvedValue({ runId: 'run-abc-123' }),
    chatAbort: vi.fn().mockResolvedValue(undefined),
    chatHistory: vi.fn().mockResolvedValue([]),
    on: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    registerWorkflowHandlers({
      home: '/mock/home',
      safeShellExecAsync: vi.fn().mockResolvedValue(null),
      runAsync: vi.fn().mockResolvedValue(''),
      getGatewayWs: vi.fn().mockResolvedValue(mockGatewayWs),
      getMainWindow: vi.fn().mockReturnValue(null),
    });

    handlers = collectHandlers();
  });

  it('registers all expected IPC handlers', () => {
    const expected = [
      'workflow:config',
      'workflow:enable-collaboration',
      'workflow:check-lobster',
      'workflow:install-lobster',
      'task:create',
      'task:cancel',
      'task:detail',
      'workflow:list',
      'workflow:run',
      'workflow:approve',
      'workflow:save',
      'workflow:delete',
    ];
    for (const channel of expected) {
      expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
    }
  });

  describe('workflow:config', () => {
    it('returns default config when openclaw.json is empty', async () => {
      const result = await handlers['workflow:config']({} as any);
      expect(result.maxSpawnDepth).toBe(1);
      expect(result.maxChildrenPerAgent).toBe(5);
      expect(result.agentToAgentEnabled).toBe(false);
    });
  });

  describe('workflow:check-lobster', () => {
    it('returns not installed when plugins list is empty', async () => {
      const result = await handlers['workflow:check-lobster']({} as any);
      expect(result.installed).toBe(false);
      expect(result.enabled).toBe(false);
    });
  });

  describe('task:create', () => {
    it('sends /subagents spawn command via Gateway', async () => {
      const result = await handlers['task:create']({} as any, {
        title: 'Refactor auth module',
        agentId: 'coder',
      });

      expect(result.success).toBe(true);
      expect(result.runId).toBe('run-abc-123');
      expect(mockGatewayWs.chatSend).toHaveBeenCalledWith(
        'main',
        '/subagents spawn coder "Refactor auth module"',
        { thinking: 'off' },
      );
    });

    it('escapes double quotes in task title', async () => {
      await handlers['task:create']({} as any, {
        title: 'Fix "broken" tests',
        agentId: 'tester',
      });

      const sentMessage = mockGatewayWs.chatSend.mock.calls[0][1];
      expect(sentMessage).toBe('/subagents spawn tester "Fix \\"broken\\" tests"');
    });

    it('includes --model flag when specified', async () => {
      await handlers['task:create']({} as any, {
        title: 'Quick task',
        agentId: 'coder',
        model: 'claude-haiku',
      });

      const sentMessage = mockGatewayWs.chatSend.mock.calls[0][1];
      expect(sentMessage).toContain('--model claude-haiku');
    });
  });

  describe('task:cancel', () => {
    it('aborts via Gateway', async () => {
      const result = await handlers['task:cancel']({} as any, 'session-xyz');
      expect(result.success).toBe(true);
      expect(mockGatewayWs.chatAbort).toHaveBeenCalledWith('session-xyz');
    });
  });

  describe('task:detail', () => {
    it('returns session history', async () => {
      mockGatewayWs.chatHistory.mockResolvedValueOnce([
        { role: 'assistant', content: 'Done.' },
      ]);
      const result = await handlers['task:detail']({} as any, 'session-xyz');
      expect(result.success).toBe(true);
      expect(result.messages).toHaveLength(1);
    });
  });

  describe('workflow:list', () => {
    it('returns empty list when no workflows exist', async () => {
      const result = await handlers['workflow:list']({} as any);
      expect(result.workflows).toEqual([]);
    });
  });

  describe('workflow:save', () => {
    it('saves YAML file with sanitized name', async () => {
      const fs = await import('fs');
      const result = await handlers['workflow:save']({} as any, 'my workflow!.yaml', 'name: test');
      expect(result.success).toBe(true);
      expect(fs.default.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('workflow:delete', () => {
    it('rejects deletion of non-custom workflows', async () => {
      const result = await handlers['workflow:delete']({} as any, '/other/path/builtin.yaml');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot delete builtin');
    });
  });
});
