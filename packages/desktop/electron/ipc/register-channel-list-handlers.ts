import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { parseJsonShellOutput } from '../openclaw-shell-output';

const channelStatusCache: { configured: string[]; ts: number } = { configured: [], ts: 0 };

function readConfiguredFromFile(home: string, toFrontendId: (openclawId: string) => string): string[] {
  try {
    const configPath = path.join(home, '.openclaw', 'openclaw.json');
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const channels = existing?.channels || {};
    const configured: string[] = [];
    for (const [id, cfg] of Object.entries(channels)) {
      if ((cfg as any)?.enabled) configured.push(toFrontendId(id));
    }
    return configured;
  } catch {
    return [];
  }
}

export function registerChannelListHandlers(deps: {
  home: string;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  toFrontendId: (openclawId: string) => string;
}) {
  ipcMain.handle('channel:list-configured', async () => {
    const fromFile = readConfiguredFromFile(deps.home, deps.toFrontendId);

    if (Date.now() - channelStatusCache.ts < 60000 && channelStatusCache.configured.length > 0) {
      return { success: true, configured: channelStatusCache.configured };
    }

    deps.readShellOutputAsync('openclaw channels list 2>&1', 20000).then((output) => {
      if (!output) return;
      try {
        const jsonParsed = parseJsonShellOutput<any>(output);
        if (!jsonParsed) {
          throw new Error('Could not parse configured channels JSON');
        }
        const arr = Array.isArray(jsonParsed) ? jsonParsed : (jsonParsed.channels || jsonParsed.items || []);
        const jsonConfigured: string[] = arr
          .filter((ch: any) => {
            const status = (ch.status || ch.state || '').toLowerCase();
            return status.includes('configured') || status.includes('linked') || status.includes('active') || status.includes('enabled');
          })
          .map((ch: any) => {
            const id = (ch.id || ch.name || '').toLowerCase();
            return deps.toFrontendId(id);
          })
          .filter(Boolean);
        if (jsonConfigured.length > 0) {
          channelStatusCache.configured = jsonConfigured;
          channelStatusCache.ts = Date.now();
          return;
        }
      } catch {}

      const configured: string[] = [];
      for (const line of output.split('\n')) {
        const match1 = line.match(/^-\s+(\S+)\s+.*?:\s*(configured|linked|active)/i);
        if (match1) {
          configured.push(deps.toFrontendId(match1[1].toLowerCase()));
          continue;
        }
        const match2 = line.match(/^\s*(\w[\w-]*)\s*:\s*(configured|linked|active|enabled)/i);
        if (match2 && match2[1] !== 'Channels') {
          configured.push(deps.toFrontendId(match2[1].toLowerCase()));
          continue;
        }
        const match3 = line.match(/^\s*(\w[\w-]*)\s+\[(configured|linked|active)\]/i);
        if (match3) {
          configured.push(deps.toFrontendId(match3[1].toLowerCase()));
        }
      }
      if (configured.length > 0) {
        channelStatusCache.configured = configured;
        channelStatusCache.ts = Date.now();
      }
    }).catch(() => {});

    return { success: true, configured: fromFile };
  });

  ipcMain.handle('channel:list-supported', async () => {
    try {
      const output = await deps.readShellOutputAsync('openclaw channels list 2>&1', 15000);
      if (output) {
        try {
          const parsed = parseJsonShellOutput<any>(output);
          if (!parsed) {
            throw new Error('Could not parse supported channels JSON');
          }
          const arr = Array.isArray(parsed) ? parsed : (parsed.channels || parsed.items || []);
          const channels = arr.map((ch: any) => (ch.id || ch.name || '').toLowerCase()).filter(Boolean);
          if (channels.length > 0) return { success: true, channels };
        } catch {}

        const skipWords = new Set(['channels', 'no', 'available', 'configured', 'status', 'list']);
        const channels: string[] = [];
        for (const line of output.split('\n')) {
          const match = line.match(/^[-*\s]*(\w[\w-]+)/);
          if (match) {
            const name = match[1].toLowerCase();
            if (!skipWords.has(name) && name.length > 1) channels.push(name);
          }
        }
        if (channels.length > 0) return { success: true, channels };
      }
      return { success: false, channels: [] };
    } catch {
      return { success: false, channels: [] };
    }
  });
}