import { ipcMain } from 'electron';
import { parseJsonShellOutput } from '../openclaw-shell-output';

export function registerChannelSetupHandlers(deps: {
  getMainWindow: () => typeof Electron.BrowserWindow.prototype | null;
  getChannel: (channelId: string) => any;
  runAsync: (cmd: string, timeoutMs?: number) => Promise<string>;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  channelLoginWithQR: (loginCmd: string, timeoutMs?: number) => Promise<{ success: boolean; output?: string; error?: string }>;
}) {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const isLinkedStatus = (value: string | null | undefined) => /configured|linked|active|enabled/i.test(value || '');

  const isChannelLinked = (output: string | null, openclawId: string) => {
    if (!output) return false;

    const parsed = parseJsonShellOutput<any>(output);
    if (parsed) {
      const channels = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.channels)
          ? parsed.channels
          : Array.isArray(parsed.items)
            ? parsed.items
            : [];

      if (channels.some((channel: any) => {
        const id = String(channel?.id || channel?.name || '').toLowerCase();
        const status = String(channel?.status || channel?.state || channel?.mode || '');
        return id === openclawId.toLowerCase() && isLinkedStatus(status);
      })) {
        return true;
      }
    }

    const needle = openclawId.toLowerCase();
    return output
      .split('\n')
      .some((line) => {
        const lower = line.toLowerCase();
        if (!lower.includes(needle)) return false;
        return /(configured|linked|active|enabled)/i.test(line);
      });
  };

  const waitForChannelConfirmation = async (openclawId: string, label: string, sendStatus: (msg: string) => void) => {
    const attempts = [12000, 8000, 8000];

    for (let index = 0; index < attempts.length; index += 1) {
      sendStatus(`channels.status.confirming::${label}`);
      const output = await deps.readShellOutputAsync('openclaw channels list 2>&1', attempts[index]);
      if (isChannelLinked(output, openclawId)) {
        return true;
      }

      if (index < attempts.length - 1) {
        await sleep(1500);
      }
    }

    return false;
  };

  ipcMain.handle('channel:setup', async (_e: any, channelId: string) => {
    const safeChannelId = channelId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeChannelId || safeChannelId !== channelId) {
      return { success: false, error: `Invalid channel ID: ${channelId}` };
    }

    const sendStatus = (msg: string) => {
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('channel:status', msg);
    };

    const bindToMainAgent = async (bindId: string) => {
      sendStatus('channels.status.binding');
      try { await deps.safeShellExecAsync(`openclaw agents bind --agent main --bind ${bindId} 2>&1`, 10000); } catch {}
    };

    const channelDef = deps.getChannel(safeChannelId);
    const openclawId = channelDef?.openclawId || safeChannelId;
    const channelLabel = channelDef?.label || safeChannelId;
    const pluginPkg = channelDef?.pluginPackage || `@openclaw/${openclawId}`;
    const setupFlow = channelDef?.setupFlow || 'qr-login';

    sendStatus(`channels.status.configuring::${channelLabel}`);
    try { await deps.runAsync(`openclaw plugins install "${pluginPkg}" 2>&1`, 30000); } catch {}

    if (setupFlow === 'add-only') {
      try {
        await deps.runAsync(`openclaw channels add --channel ${openclawId} 2>&1`, 15000);
        await bindToMainAgent(openclawId);
        return { success: true, output: `${channelLabel} connected.` };
      } catch (err: any) {
        return { success: false, error: err.message?.slice(0, 300) };
      }
    }

    if (setupFlow === 'add-then-login') {
      try { await deps.runAsync(`openclaw channels add --channel ${openclawId} 2>&1`, 15000); } catch {}
    }

    sendStatus(`channels.status.connecting::${channelLabel}`);
    const result = await deps.channelLoginWithQR(`openclaw channels login --channel ${openclawId} --verbose`);
    if (result.success) {
      await bindToMainAgent(openclawId);
      const confirmed = await waitForChannelConfirmation(openclawId, channelLabel, sendStatus);
      if (!confirmed) {
        sendStatus(`channels.status.awaitingConfirmation::${channelLabel}`);
        return {
          success: true,
          pendingConfirmation: true,
          output: 'Login completed. OpenClaw is still confirming the channel.',
        };
      }
    }
    return result;
  });
}