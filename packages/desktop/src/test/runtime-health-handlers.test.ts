import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcHandleMock } = vi.hoisted(() => ({
  ipcHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: ipcHandleMock,
  },
}));

import { registerRuntimeHealthHandlers } from '../../electron/ipc/register-runtime-health-handlers';

function getRegisteredHandlers() {
  return Object.fromEntries(
    ipcHandleMock.mock.calls.map(([channel, handler]) => [channel, handler]),
  ) as Record<string, (...args: any[]) => Promise<any>>;
}

describe('registerRuntimeHealthHandlers', () => {
  beforeEach(() => {
    ipcHandleMock.mockReset();
  });

  it('repairs the local daemon before repairing the gateway during startup', async () => {
    const runChecks = vi.fn()
      .mockResolvedValueOnce({
        checks: [
          { id: 'gateway-running', label: 'Gateway', status: 'fail', fixable: 'auto', message: 'Gateway is not running' },
          { id: 'daemon-running', label: 'Local Daemon', status: 'fail', fixable: 'auto', message: 'Local Daemon is not running' },
          { id: 'plugin-installed', label: 'Awareness plugin', status: 'pass', fixable: 'none', message: 'Installed' },
        ],
      })
      .mockResolvedValueOnce({
        checks: [
          { id: 'daemon-running', label: 'Local Daemon', status: 'pass', fixable: 'none', message: 'Running' },
          { id: 'gateway-running', label: 'Gateway', status: 'pass', fixable: 'none', message: 'Running' },
          { id: 'plugin-installed', label: 'Awareness plugin', status: 'pass', fixable: 'none', message: 'Installed' },
        ],
      });
    const runFix = vi.fn(async (checkId: string) => ({ id: checkId, success: true, message: `${checkId} fixed` }));
    const send = vi.fn();

    registerRuntimeHealthHandlers({
      home: 'C:/Users/test',
      app: {},
      dirname: 'C:/test',
      safeShellExec: vi.fn(() => null),
      safeShellExecAsync: vi.fn(async () => null),
      doctor: { runChecks, runFix },
      computeSha256: vi.fn(() => 'hash'),
      checkDaemonHealth: vi.fn(async () => false),
      waitForLocalDaemonReady: vi.fn(async () => true),
      sendSetupDaemonStatus: vi.fn(),
      sleep: vi.fn(async () => undefined),
      recentDaemonStartup: () => false,
      getMainWindow: () => ({ isDestroyed: () => false, webContents: { send } }),
    });

    const handlers = getRegisteredHandlers();
    const result = await handlers['app:startup-ensure-runtime']();

    expect(result).toMatchObject({ ok: true, needsSetup: false });
    expect(runFix.mock.calls.map(([checkId]) => checkId)).toEqual(['daemon-running', 'gateway-running']);
  });
});