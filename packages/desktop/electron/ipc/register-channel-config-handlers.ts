import fs from 'fs';
import os from 'os';
import path from 'path';
import { ipcMain } from 'electron';
import type { CatalogEntry, ChannelDef, ConfigField } from '../channel-registry';
import { migrateLegacyChannelConfig } from '../openclaw-config';

let discoveryDone = false;

function coerceTelegramCliConfig(channelDef: ChannelDef | undefined, config: Record<string, string>) {
  if (!channelDef) return config;
  if (channelDef.openclawId !== 'telegram' && channelDef.id !== 'telegram') return config;

  const tokenValue = config.botToken || config.token;
  if (!tokenValue) return config;

  const wantsToken = channelDef.configFields?.some((field) => field.key === 'token');
  const wantsBotToken = channelDef.configFields?.some((field) => field.key === 'botToken');
  const next = { ...config };
  if (wantsToken && !next.token) next.token = tokenValue;
  if (wantsBotToken && !next.botToken) next.botToken = tokenValue;
  return next;
}

function normalizeTelegramConfigInFile(config: any) {
  migrateLegacyChannelConfig(config);
  return config;
}

function getManagedRuntimeDist(home: string): string | undefined {
  return [
    path.join(home, '.awareness-claw', 'openclaw-runtime', 'node_modules', 'openclaw', 'dist'),
    path.join(home, '.awareness-claw', 'openclaw-runtime', 'lib', 'node_modules', 'openclaw', 'dist'),
  ].find((candidate) => fs.existsSync(candidate));
}

export function registerChannelConfigHandlers(deps: {
  home: string;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  runAsync: (cmd: string, timeoutMs?: number) => Promise<string>;
  discoverOpenClawChannels: () => void;
  parseCliHelp: (helpOutput: string) => {
    cliChannels: Set<string>;
    channelFields: Map<string, ConfigField[]>;
  };
  applyCliHelp: (
    cliChannels: Set<string>,
    channelFields: Map<string, ConfigField[]>,
  ) => void;
  mergeCatalog: (entries: CatalogEntry[]) => void;
  mergeChannelOptions: (channelIds: string[]) => void;
  getAllChannels: () => Array<unknown>;
  serializeRegistry: () => Array<unknown>;
  getChannel: (channelId: string) => ChannelDef | undefined;
  buildCLIFlags: (channelDef: ChannelDef, config: Record<string, string>) => string;
  toOpenclawId: (channelId: string) => string;
}) {
  ipcMain.handle('channel:get-registry', async () => {
    const stderrRedirect = process.platform === 'win32' ? '2>NUL' : '2>/dev/null';
    const dlog = (msg: string) => { try { fs.appendFileSync(path.join(os.homedir(), '.awareness-channel-debug.log'), `[${new Date().toISOString()}] ${msg}\n`); } catch { } };
    dlog(`ENTRY: channel:get-registry called. _discoveryDone=${discoveryDone}, HOME=${os.homedir()}`);
    if (!discoveryDone) {
      discoveryDone = true;
      deps.discoverOpenClawChannels();
      const debugLog = (msg: string) => { try { fs.appendFileSync(path.join(deps.home, '.awareness-channel-debug.log'), `[${new Date().toISOString()}] ${msg}\n`); } catch {} };
      if (deps.getAllChannels().length <= 2) {
        debugLog(`Sync discovery found only ${deps.getAllChannels().length} channels, trying async...`);
        try {
          const managedDist = getManagedRuntimeDist(deps.home);
          if (managedDist) {
            debugLog(`async managed distDir: ${managedDist} exists=true`);
            try {
              const helpOut = await deps.safeShellExecAsync(`openclaw channels add --help ${stderrRedirect}`, 5000);
              if (helpOut) {
                const { cliChannels, channelFields } = deps.parseCliHelp(helpOut);
                if (cliChannels.size > 0) {
                  deps.applyCliHelp(cliChannels, channelFields);
                  debugLog(`async CLI channels: ${[...cliChannels].join(', ')}`);
                }
              }
            } catch {}
            try {
              const catalog = JSON.parse(fs.readFileSync(path.join(managedDist, 'channel-catalog.json'), 'utf8'));
              if (catalog.entries) {
                deps.mergeCatalog(catalog.entries as CatalogEntry[]);
                debugLog(`catalog merged: ${catalog.entries.length} entries`);
              }
            } catch (e: any) {
              debugLog(`catalog error: ${e.message}`);
            }
            try {
              const meta = JSON.parse(fs.readFileSync(path.join(managedDist, 'cli-startup-metadata.json'), 'utf8'));
              if (meta.channelOptions) {
                deps.mergeChannelOptions(meta.channelOptions as string[]);
                debugLog(`metadata merged: ${meta.channelOptions.length} options`);
              }
            } catch (e: any) {
              debugLog(`metadata error: ${e.message}`);
            }
            debugLog(`Final channel count: ${deps.getAllChannels().length}`);
          } else {
            const globalRoot = await deps.safeShellExecAsync(`npm root -g ${stderrRedirect}`, 5000);
            debugLog(`async npm root -g: "${globalRoot?.trim()}"`);
            if (globalRoot) {
              const distDir = path.join(globalRoot.trim(), 'openclaw', 'dist');
              const exists = fs.existsSync(distDir);
              debugLog(`async distDir: ${distDir} exists=${exists}`);
              if (exists) {
              try {
                const helpOut = await deps.safeShellExecAsync(`openclaw channels add --help ${stderrRedirect}`, 5000);
                if (helpOut) {
                  const { cliChannels, channelFields } = deps.parseCliHelp(helpOut);
                  if (cliChannels.size > 0) {
                    deps.applyCliHelp(cliChannels, channelFields);
                    debugLog(`async CLI channels: ${[...cliChannels].join(', ')}`);
                  }
                }
              } catch {}
              try {
                const catalog = JSON.parse(fs.readFileSync(path.join(distDir, 'channel-catalog.json'), 'utf8'));
                if (catalog.entries) {
                  deps.mergeCatalog(catalog.entries as CatalogEntry[]);
                  debugLog(`catalog merged: ${catalog.entries.length} entries`);
                }
              } catch (e: any) {
                debugLog(`catalog error: ${e.message}`);
              }
              try {
                const meta = JSON.parse(fs.readFileSync(path.join(distDir, 'cli-startup-metadata.json'), 'utf8'));
                if (meta.channelOptions) {
                  deps.mergeChannelOptions(meta.channelOptions as string[]);
                  debugLog(`metadata merged: ${meta.channelOptions.length} options`);
                }
              } catch (e: any) {
                debugLog(`metadata error: ${e.message}`);
              }
              debugLog(`Final channel count: ${deps.getAllChannels().length}`);
            }
          }
          }
        } catch (e: any) {
          debugLog(`async fallback error: ${e.message}`);
        }
      } else {
        debugLog(`Sync discovery OK: ${deps.getAllChannels().length} channels`);
      }
    }
    return { channels: deps.serializeRegistry() };
  });

  ipcMain.handle('channel:save', async (_e, channelId: string, config: Record<string, string>) => {
    try {
      const channelDef = deps.getChannel(channelId);
      const openclawId = channelDef?.openclawId || channelId;
      const pluginPkg = channelDef?.pluginPackage || `@openclaw/${openclawId}`;
      const saveStrategy = channelDef?.saveStrategy || 'cli';
      const configForCli = openclawId === 'telegram' ? coerceTelegramCliConfig(channelDef, config) : config;

      try { await deps.runAsync(`openclaw plugins install "${pluginPkg}" 2>&1`, 60000); } catch {}

      if (saveStrategy === 'json-direct') {
        const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
        let existing: any = {};
        try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
        if (!existing.channels) existing.channels = {};
        existing.channels[openclawId] = { ...existing.channels[openclawId], ...config, enabled: true };
        migrateLegacyChannelConfig(existing);
        fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
      } else {
        const cliFlags = channelDef ? deps.buildCLIFlags(channelDef, configForCli) : '';
        const addCmd = `openclaw channels add --channel ${openclawId} ${cliFlags} 2>&1`;
        try {
          await deps.runAsync(addCmd, 15000);
        } catch (firstErr: any) {
          const msg = firstErr.message || '';
          if (msg.includes('already') || msg.includes('exists')) {
            try { await deps.runAsync(`openclaw channels remove --channel ${openclawId} 2>&1`, 10000); } catch {}
            await deps.runAsync(addCmd, 15000);
          } else {
            return { success: false, error: msg.slice(0, 300) };
          }
        }
      }

      if (openclawId === 'telegram') {
        try {
          const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
          const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          migrateLegacyChannelConfig(existing);
          fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
        } catch {}
      }

      try { await deps.runAsync('openclaw gateway restart 2>&1', 20000); } catch {}
      try { await deps.runAsync(`openclaw agents bind --agent main --bind ${openclawId} 2>&1`, 10000); } catch {}
      return { success: true };
    } catch (err: any) {
      return { success: false, error: (err.message || String(err)).slice(0, 300) };
    }
  });

  ipcMain.handle('channel:remove', async (_e, channelId: string) => {
    try {
      const channelDef = deps.getChannel(channelId);
      const openclawId = channelDef?.openclawId || channelId;

      // 1. Unbind from all agents (best-effort — ignore errors)
      try {
        const listOutput = await deps.readShellOutputAsync('openclaw agents list --json 2>&1', 15000);
        if (listOutput) {
          const agents = JSON.parse(listOutput);
          for (const agent of agents) {
            if (agent.bindings?.some((b: string) => b === openclawId || b.startsWith(openclawId + ':'))) {
              try {
                await deps.runAsync(`openclaw agents unbind --agent ${agent.id} --bind ${openclawId} 2>&1`, 30000);
              } catch { /* best-effort */ }
            }
          }
        }
      } catch { /* agent list failed — continue with removal */ }

      // 2. Remove channel via CLI (--delete = purge config, not just disable)
      try {
        await deps.runAsync(`openclaw channels remove --channel ${openclawId} --delete 2>&1`, 15000);
      } catch { /* may fail if channel was json-direct only */ }

      // 3. Also clean from openclaw.json directly (handles json-direct channels + leftovers)
      try {
        const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
        const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        let changed = false;
        if (existing.channels?.[openclawId]) {
          delete existing.channels[openclawId];
          changed = true;
        }
        if (existing.channels?.[channelId] && channelId !== openclawId) {
          delete existing.channels[channelId];
          changed = true;
        }
        if (changed) {
          fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
        }
      } catch { /* config file may not exist */ }

      // 4. Restart gateway so channel stops receiving messages
      try { await deps.runAsync('openclaw gateway restart 2>&1', 20000); } catch { /* best-effort */ }

      return { success: true };
    } catch (err: any) {
      return { success: false, error: (err.message || String(err)).slice(0, 300) };
    }
  });

  ipcMain.handle('channel:test', async (_e, channelId: string) => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const ocId = deps.toOpenclawId(channelId);
      const channelConfig = existing?.channels?.[channelId] || existing?.channels?.[ocId];
      if (!channelConfig || !channelConfig.enabled) {
        return { success: false, error: 'Channel not configured' };
      }
      const hasCredentials = Object.keys(channelConfig).some((key) => key !== 'enabled' && channelConfig[key]);
      if (!hasCredentials) {
        return { success: false, error: 'No credentials found' };
      }

      // Use readShellOutputAsync — OpenClaw emits config warnings to stderr which causes
      // non-zero exit codes on Windows; safeShellExecAsync would return null.
      // Timeout 20s — plugin loading (awareness-memory, weixin, etc.) takes 10-15s.
      const gwStatus = await deps.readShellOutputAsync('openclaw channels status 2>&1', 20000);
      const gwRunning = gwStatus && (gwStatus.includes('running') || gwStatus.includes('active'));

      const listOutput = await deps.readShellOutputAsync('openclaw channels list 2>&1', 20000);
      const isListed = listOutput && listOutput.toLowerCase().includes(channelId);

      if (isListed && gwRunning) {
        return { success: true, output: `${channelId}: configured and gateway active` };
      }
      if (isListed) {
        return { success: true, output: `${channelId}: configured. Start Gateway to activate.` };
      }
      return { success: true, output: `${channelId}: credentials saved. Start Gateway to connect.` };
    } catch {
      return { success: false, error: 'Could not read channel configuration' };
    }
  });

  ipcMain.handle('channel:read-config', async (_e, channelId: string) => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const ocId = deps.toOpenclawId(channelId);
      const channelConfig = existing?.channels?.[channelId] || existing?.channels?.[ocId];
      if (channelConfig) {
        return { success: true, config: channelConfig };
      }
      return { success: false };
    } catch {
      return { success: false };
    }
  });
}