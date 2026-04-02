import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';

export function registerAppUtilityHandlers(deps: {
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  homedir: string;
}) {
  ipcMain.handle('app:get-dashboard-url', async () => {
    const output = await deps.readShellOutputAsync('openclaw dashboard --no-open', 10000);
    if (!output) return { url: null };

    const patterns = [
      /Dashboard URL:\s*(http[^\s]+)/i,
      /dashboard:\s*(http[^\s]+)/i,
      /url:\s*(http[^\s]+)/i,
      /(http:\/\/localhost:\d+[^\s]*)/,
    ];
    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) return { url: match[1] };
    }

    return { url: null };
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