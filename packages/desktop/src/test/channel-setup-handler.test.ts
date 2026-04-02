import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
}));

import { registerChannelSetupHandlers } from '../../electron/ipc/register-channel-setup-handlers';

function getRegisteredSetupHandler() {
  const match = handleMock.mock.calls.find(([channel]) => channel === 'channel:setup');
  if (!match) throw new Error('channel:setup handler not registered');
  return match[1] as (event: unknown, channelId: string) => Promise<any>;
}

describe('registerChannelSetupHandlers', () => {
  beforeEach(() => {
    handleMock.mockReset();
  });

  it('waits for the channel to appear before confirming success', async () => {
    const send = vi.fn();
    const runAsync = vi.fn(async () => 'ok');
    const safeShellExecAsync = vi.fn(async () => 'ok');
    const readShellOutputAsync = vi
      .fn()
      .mockResolvedValueOnce('[warn] loading plugins')
      .mockResolvedValueOnce('[plugins] Registered\n[{"id":"signal","status":"linked"}]');
    const channelLoginWithQR = vi.fn(async () => ({ success: true }));

    registerChannelSetupHandlers({
      getMainWindow: () => ({ isDestroyed: () => false, webContents: { send } } as any),
      getChannel: () => ({ label: 'Signal', openclawId: 'signal', pluginPackage: '@openclaw/signal', setupFlow: 'add-then-login' }),
      runAsync,
      safeShellExecAsync,
      readShellOutputAsync,
      channelLoginWithQR,
    });

    const handler = getRegisteredSetupHandler();
    const result = await handler({}, 'signal');

    expect(result).toMatchObject({ success: true });
    expect(result.pendingConfirmation).toBeUndefined();
    expect(readShellOutputAsync).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('channel:status', 'channels.status.confirming::Signal');
  });

  it('returns pending confirmation instead of failing when OpenClaw is still syncing', async () => {
    const send = vi.fn();

    registerChannelSetupHandlers({
      getMainWindow: () => ({ isDestroyed: () => false, webContents: { send } } as any),
      getChannel: () => ({ label: 'WhatsApp', openclawId: 'whatsapp', pluginPackage: '@openclaw/whatsapp', setupFlow: 'qr-login' }),
      runAsync: vi.fn(async () => 'ok'),
      safeShellExecAsync: vi.fn(async () => 'ok'),
      readShellOutputAsync: vi.fn(async () => '[warn] still loading plugins'),
      channelLoginWithQR: vi.fn(async () => ({ success: true })),
    });

    const handler = getRegisteredSetupHandler();
    const result = await handler({}, 'whatsapp');

    expect(result).toMatchObject({
      success: true,
      pendingConfirmation: true,
    });
    expect(send).toHaveBeenCalledWith('channel:status', 'channels.status.awaitingConfirmation::WhatsApp');
  });
});