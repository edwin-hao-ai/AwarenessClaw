import { ipcMain } from 'electron';

export function registerChannelSetupHandlers(deps: {
  getMainWindow: () => typeof Electron.BrowserWindow.prototype | null;
  getChannel: (channelId: string) => any;
  runAsync: (cmd: string, timeoutMs?: number) => Promise<string>;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  channelLoginWithQR: (loginCmd: string, timeoutMs?: number) => Promise<{ success: boolean; output?: string; error?: string }>;
}) {
  const isChannelLinked = (output: string | null, openclawId: string) => {
    if (!output) return false;
    const needle = openclawId.toLowerCase();
    return output
      .split('\n')
      .some((line) => {
        const lower = line.toLowerCase();
        if (!lower.includes(needle)) return false;
        return /(configured|linked|active|enabled)/i.test(line);
      });
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
    const pluginPkg = channelDef?.pluginPackage || `@openclaw/${openclawId}`;
    const setupFlow = channelDef?.setupFlow || 'qr-login';

    sendStatus(`channels.status.configuring::${channelDef?.label || safeChannelId}`);
    try { await deps.runAsync(`openclaw plugins install "${pluginPkg}" 2>&1`, 30000); } catch {}

    if (setupFlow === 'add-only') {
      try {
        await deps.runAsync(`openclaw channels add --channel ${openclawId} 2>&1`, 15000);
        await bindToMainAgent(openclawId);
        return { success: true, output: `${channelDef?.label || safeChannelId} connected.` };
      } catch (err: any) {
        return { success: false, error: err.message?.slice(0, 300) };
      }
    }

    if (setupFlow === 'add-then-login') {
      try { await deps.runAsync(`openclaw channels add --channel ${openclawId} 2>&1`, 15000); } catch {}
    }

    sendStatus(`channels.status.connecting::${channelDef?.label || safeChannelId}`);
    const result = await deps.channelLoginWithQR(`openclaw channels login --channel ${openclawId} --verbose`);
    if (result.success) {
      await bindToMainAgent(openclawId);
      const listOutput = await deps.readShellOutputAsync('openclaw channels list 2>&1', 20000);
      if (!isChannelLinked(listOutput, openclawId)) {
        return { success: false, error: 'Connection not confirmed yet. Please finish linking on your phone and try again.' };
      }
    }
    return result;
  });
}