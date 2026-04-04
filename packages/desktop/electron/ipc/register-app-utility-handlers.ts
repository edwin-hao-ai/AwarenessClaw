import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { resolveDashboardUrl } from '../openclaw-dashboard';

export function registerAppUtilityHandlers(deps: {
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  homedir: string;
  getMainWindow?: () => Electron.BrowserWindow | null;
}) {
  const clampZoom = (value: number) => Math.max(0.6, Math.min(2.4, Number(value.toFixed(2))));
  const applyZoomDelta = (delta: number) => {
    const win = deps.getMainWindow?.();
    if (!win || win.isDestroyed()) return { success: false, factor: 1, error: 'Window not ready' };
    const current = win.webContents.getZoomFactor();
    const next = clampZoom(current + delta);
    win.webContents.setZoomFactor(next);
    return { success: true, factor: next };
  };

  ipcMain.handle('app:get-dashboard-url', async () => {
    const url = await resolveDashboardUrl(deps.readShellOutputAsync);
    return { url };
  });

  ipcMain.handle('app:zoom:get', () => {
    const win = deps.getMainWindow?.();
    if (!win || win.isDestroyed()) return { success: false, factor: 1, error: 'Window not ready' };
    return { success: true, factor: win.webContents.getZoomFactor() };
  });

  ipcMain.handle('app:zoom:in', () => applyZoomDelta(0.1));
  ipcMain.handle('app:zoom:out', () => applyZoomDelta(-0.1));

  ipcMain.handle('app:zoom:reset', () => {
    const win = deps.getMainWindow?.();
    if (!win || win.isDestroyed()) return { success: false, factor: 1, error: 'Window not ready' };
    win.webContents.setZoomFactor(1);
    return { success: true, factor: 1 };
  });

  ipcMain.handle('logs:recent', async () => {
    let output = await deps.readShellOutputAsync('openclaw gateway logs --lines 100 2>&1', 10000);
    if (!output || output.includes('not found')) {
      output = await deps.readShellOutputAsync('openclaw logs --lines 100 2>&1', 10000);
    }

    const appLogPath = path.join(deps.homedir, '.openclaw', 'gateway.log');
    let appLog = '';
    try {
      if (fs.existsSync(appLogPath)) {
        const content = fs.readFileSync(appLogPath, 'utf8');
        const lines = content.split('\n');
        appLog = lines.slice(-50).join('\n');
      }
    } catch {
      // Ignore app log read errors.
    }

    const combined = [output || '', appLog ? `\n--- gateway.log (last 50 lines) ---\n${appLog}` : ''].join('').trim();
    return { logs: combined || 'No logs available' };
  });
}