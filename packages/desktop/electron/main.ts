const electron = require('electron');
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog } = electron;
import path from 'path';
import fs from 'fs';
import os from 'os';
import https from 'https';
import crypto from 'crypto';
import { createDaemonWatchdog } from './daemon-watchdog';
import { createDoctor } from './doctor';
import { callMcpStrict } from './memory-client';
import {
  checkDaemonHealth,
  clearAwarenessLocalNpxCache,
  forceStopLocalDaemon,
  formatDaemonSetupError,
  getLocalDaemonHealth,
  shutdownLocalDaemon,
  startLocalDaemonDetached,
  waitForLocalDaemonReady,
} from './local-daemon';
import { GatewayClient } from './gateway-ws';
import { createChannelLoginWithQR } from './ipc/channel-login-flow';
import { registerAgentHandlers } from './ipc/register-agent-handlers';
import { registerAppUtilityHandlers } from './ipc/register-app-utility-handlers';
import { registerAppRuntimeHandlers } from './ipc/register-app-runtime-handlers';
import { registerChannelConfigHandlers } from './ipc/register-channel-config-handlers';
import { registerChannelListHandlers } from './ipc/register-channel-list-handlers';
import { registerChannelSessionHandlers } from './ipc/register-channel-session-handlers';
import { registerChannelSetupHandlers } from './ipc/register-channel-setup-handlers';
import { registerChatHandlers } from './ipc/register-chat-handlers';
import { registerCloudWorkspaceHandlers } from './ipc/register-cloud-workspace-handlers';
import { registerConfigIoHandlers } from './ipc/register-config-io-handlers';
import { registerCronHandlers } from './ipc/register-cron-handlers';
import { registerFileDialogHandlers } from './ipc/register-file-dialog-handlers';
import { registerGatewayHandlers } from './ipc/register-gateway-handlers';
import { registerMemoryHandlers } from './ipc/register-memory-handlers';
import { registerOpenClawConfigHandlers } from './ipc/register-openclaw-config-handlers';
import { registerRuntimeHealthHandlers } from './ipc/register-runtime-health-handlers';
import { registerSetupHandlers } from './ipc/register-setup-handlers';
import { registerSkillHandlers } from './ipc/register-skill-handlers';
import { ensureInternalHook } from './internal-hook';
import { readRuntimePreferences, writeRuntimePreferences } from './runtime-preferences';
import { createShellUtils } from './shell-utils';
import { isGatewayRunningOutput } from './openclaw-config';
import { getAgentWorkspaceDir } from './openclaw-config';
import { resolveDashboardUrl } from './openclaw-dashboard';
import {
  applyDesktopAwarenessPluginConfig,
  mergeDesktopOpenClawConfig,
  persistDesktopAwarenessPluginConfig,
  redactSensitiveValues,
  sanitizeDesktopAwarenessPluginConfig,
  stripRedactedValues,
} from './desktop-openclaw-config';

let mainWindow: typeof BrowserWindow.prototype | null = null;
let tray: typeof Tray.prototype | null = null;
let isQuitting = false;
let daemonStartupPromise: Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }> | null = null;
let daemonStartupLastKickoff = 0;
let gatewayWsClient: GatewayClient | null = null;
let gatewayRepairPromise: Promise<{ ok: boolean; error?: string }> | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

const isDev = !app.isPackaged;
const HOME = os.homedir();

const shellUtils = createShellUtils({ home: HOME, app });
const {
  getBundledNpmBin,
  getEnhancedPath,
  getGatewayPort,
  getNodeVersion,
  readShellOutputAsync,
  resolveBundledCache,
  run,
  runAsync,
  runSpawn,
  safeShellExec,
  safeShellExecAsync,
  stripAnsi,
  wrapWindowsCommand,
} = shellUtils;

const channelLoginWithQR = createChannelLoginWithQR({
  getEnhancedPath,
  wrapWindowsCommand,
  stripAnsi,
  sendToRenderer: (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  },
});

function sendSetupDaemonStatus(key: string, detail?: string) {
  mainWindow?.webContents.send('setup:daemon-status', { key, detail });
}

function sendSetupStatus(stepKey: string, key: string, detail?: string) {
  mainWindow?.webContents.send('setup:status', { stepKey, key, detail });
}

function createWindow() {
  const builtIndexPath = path.join(__dirname, '../dist/index.html');

  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173').then(() => {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }).catch(async (err: any) => {
      console.warn('[desktop] Dev server unavailable, falling back to built frontend:', err?.message || err);
      if (fs.existsSync(builtIndexPath) && mainWindow && !mainWindow.isDestroyed()) {
        await mainWindow.loadFile(builtIndexPath);
      }
    });
  } else {
    mainWindow.loadFile(builtIndexPath);
  }

  mainWindow.on('close', (e: Event) => {
    if (process.platform === 'darwin' && !isQuitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Helpers ---

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

const applyAwarenessPluginConfig = (config: Record<string, any>, options?: { enableSlot?: boolean }) => {
  applyDesktopAwarenessPluginConfig(config, options);
};

const sanitizeAwarenessPluginConfig = (config: Record<string, any>) => {
  sanitizeDesktopAwarenessPluginConfig(config, HOME);
};

const persistAwarenessPluginConfig = (options?: { enableSlot?: boolean }) => {
  persistDesktopAwarenessPluginConfig(HOME, options);
};

const mergeOpenClawConfig = (existing: Record<string, any>, incoming: Record<string, any>) => {
  return mergeDesktopOpenClawConfig(existing, incoming, HOME);
};

function computeSha256(filePath: string) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(dest);
          downloadFile(redirectUrl, dest).then(resolve).catch(reject);
          return;
        }
      }
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlinkSync(dest);
      reject(err);
    });
  });
}

// --- PTY Management (for embedded openclaw chat) ---

function repairOpenClawConfigFile() {
  const configDir = path.join(HOME, '.openclaw');
  const configPath = path.join(configDir, 'openclaw.json');

  try {
    if (!fs.existsSync(configPath)) return;
    const current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    sanitizeAwarenessPluginConfig(current);
    fs.writeFileSync(configPath, JSON.stringify(current, null, 2));
  } catch {
    // Best-effort config repair only.
  }
}

function isWindowsGatewayServiceMissing(output: string | null) {
  if (!output || process.platform !== 'win32') return false;
  return output.includes('Scheduled Task (missing)') || output.includes('schtasks run failed');
}

function isGatewayPermissionError(output: string | null) {
  if (!output) return false;
  return /EACCES|Access is denied|permission denied|拒绝访问|schtasks create failed/i.test(output);
}

async function ensureLocalDaemonReadyForRuntime(send?: (ch: string, data: any) => void): Promise<boolean> {
  if (await checkDaemonHealth()) return true;

  const emit = (message: string) => send?.('chat:status', { type: 'gateway', message });

  if (!daemonStartupPromise) {
    daemonStartupLastKickoff = Date.now();
    daemonStartupPromise = (async () => {
      if (await checkDaemonHealth()) return { success: true, alreadyRunning: true };

      emit('Preparing local memory service...');

      try {
        await startLocalDaemonDetached({
          homedir: HOME,
          resolveBundledCache,
          getBundledNpmBin,
          runSpawn,
          getEnhancedPath,
        });
      } catch (err) {
        console.warn('[gateway] Failed to launch local daemon before Gateway start:', err);
      }

      const ready = await waitForLocalDaemonReady(45000, 'setup.install.daemonStatus.waiting', {
        sendStatus: sendSetupDaemonStatus,
        sleep,
      });

      if (ready) {
        emit('Local memory service ready');
        return { success: true };
      }

      return { success: false, error: formatDaemonSetupError() };
    })();
  }

  try {
    const result = await daemonStartupPromise;
    return !!(result.success || result.alreadyRunning || await checkDaemonHealth());
  } finally {
    daemonStartupPromise = null;
  }
}

function startGatewayRepairInBackground(send?: (ch: string, data: any) => void) {
  if (gatewayRepairPromise) return gatewayRepairPromise;

  gatewayRepairPromise = startGatewayWithRepair(send)
    .catch((err) => {
      console.warn('[gateway] Background repair failed:', err?.message || err);
      return { ok: false, error: err?.message || String(err) };
    })
    .finally(() => {
      gatewayRepairPromise = null;
    });

  return gatewayRepairPromise;
}

async function startGatewayInUserSession(send?: (ch: string, data: any) => void): Promise<{ ok: boolean; error?: string }> {
  send?.('chat:status', { type: 'gateway', message: 'Starting temporary Gateway...' });

  try {
    if (process.platform === 'win32') {
      const child = runSpawn('cmd.exe', ['/d', '/c', 'start', '', '/b', 'openclaw', 'gateway', 'run', '--force'], {
        cwd: HOME,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stderr?.on('data', (d: Buffer) => console.error('[gateway-session]', d.toString().trim()));
      child.on('exit', (code: number | null) => { if (code && code !== 0) console.error(`[gateway-session] exited with code ${code}`); });
      child.unref();
    } else {
      const child = runSpawn('openclaw', ['gateway', 'run', '--force'], {
        cwd: HOME,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stderr?.on('data', (d: Buffer) => console.error('[gateway-session]', d.toString().trim()));
      child.on('exit', (code: number | null) => { if (code && code !== 0) console.error(`[gateway-session] exited with code ${code}`); });
      child.unref();
    }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Could not launch the temporary Gateway process.' };
  }

  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const check = await readShellOutputAsync('openclaw gateway status 2>&1', 15000);
    if (isGatewayRunningOutput(check)) {
      if (process.platform === 'win32') {
        writeRuntimePreferences({ ...readRuntimePreferences(), preferUserSessionGateway: true });
      }
      send?.('chat:status', { type: 'gateway', message: 'Gateway started in app session' });
      return { ok: true };
    }
  }

  return {
    ok: false,
    error: 'AwarenessClaw could not start the local Gateway automatically. Please check Settings → Gateway and try again.',
  };
}

async function startGatewayWithRepair(send?: (ch: string, data: any) => void): Promise<{ ok: boolean; error?: string }> {
  repairOpenClawConfigFile();
  const statusOutput = await readShellOutputAsync('openclaw gateway status 2>&1', 15000);
  if (isGatewayRunningOutput(statusOutput)) return { ok: true };

  const emit = (message: string) => send?.('chat:status', { type: 'gateway', message });
  const prefs = readRuntimePreferences();

  if (process.platform === 'win32') {
    await ensureLocalDaemonReadyForRuntime(send);
  }

  if (process.platform === 'win32' && prefs.preferUserSessionGateway) {
    emit('Starting Gateway in your Windows session...');
    const fallback = await startGatewayInUserSession(send);
    if (fallback.ok) return fallback;
  }

  let shouldInstallService = isWindowsGatewayServiceMissing(statusOutput);

  if (shouldInstallService) {
    emit('Installing local Gateway service...');
    try {
      await runAsync('openclaw gateway install 2>&1', 30000);
    } catch (err: any) {
      const message = err?.message || '';
      if (process.platform === 'win32') {
        const fallback = await startGatewayInUserSession(send);
        if (fallback.ok) return fallback;
        return {
          ok: false,
          error: isGatewayPermissionError(message)
            ? 'AwarenessClaw could not install the Windows Gateway service because administrator permission was denied, and the temporary Gateway fallback also failed. Please reopen the app as administrator once, then try again.'
            : 'AwarenessClaw could not install the Windows Gateway service automatically, and the temporary Gateway fallback also failed. Please reopen the app once and try again, or use Settings → Gateway for manual repair.',
        };
      }
      return {
        ok: false,
        error: 'The local Gateway service could not be installed automatically. Please check Settings → Gateway and try again.',
      };
    }
  }

  emit('Starting Gateway...');
  try {
    await runAsync('openclaw gateway start 2>&1', 20000);
    if (process.platform === 'win32' && prefs.preferUserSessionGateway) {
      writeRuntimePreferences({ ...prefs, preferUserSessionGateway: false });
    }
  } catch (err: any) {
    const message = err?.message || '';

    if (process.platform === 'win32' && !shouldInstallService && message.includes('schtasks run failed')) {
      shouldInstallService = true;
      emit('Repairing local Gateway service...');
      try {
        await runAsync('openclaw gateway install 2>&1', 30000);
        await runAsync('openclaw gateway start 2>&1', 20000);
      } catch (repairErr: any) {
        const repairMessage = repairErr?.message || '';
        if (process.platform === 'win32') {
          const fallback = await startGatewayInUserSession(send);
          if (fallback.ok) return fallback;
          return {
            ok: false,
            error: isGatewayPermissionError(repairMessage)
              ? 'AwarenessClaw could not repair the Windows Gateway service because administrator permission was denied, and the temporary Gateway fallback also failed. Please reopen the app as administrator once, then try again.'
              : 'AwarenessClaw could not repair the Windows Gateway service automatically, and the temporary Gateway fallback also failed. Please reopen the app once and try again, or use Settings → Gateway for manual repair.',
          };
        }
        return {
          ok: false,
          error: 'AwarenessClaw could not repair the local Gateway service automatically. Please check Settings → Gateway and try again.',
        };
      }
    } else if (/not recognized|not found|ENOENT/i.test(message)) {
      return {
        ok: false,
        error: 'OpenClaw could not be found on this computer. Please finish Setup first, or reinstall OpenClaw in Settings before chatting.',
      };
    } else {
      return {
        ok: false,
        error: 'Gateway failed to start. Please check Settings → Gateway and try again.',
      };
    }
  }

  // Poll with backoff: 1s×3, 2s×3 = ~12s max (down from 10×1s + 15s timeout each)
  for (let i = 0; i < 6; i++) {
    const delay = i < 3 ? 1000 : 2000;
    await sleep(delay);
    const check = await readShellOutputAsync('openclaw gateway status 2>&1', 8000);
    if (isGatewayRunningOutput(check)) {
      emit('Gateway started');
      return { ok: true };
    }
  }

  if (process.platform === 'win32') {
    emit('Gateway service did not stay up, switching to app session mode...');
    const fallback = await startGatewayInUserSession(send);
    if (fallback.ok) return fallback;
  }

  return {
    ok: false,
    error: 'Gateway failed to start in time. Please check Settings → Gateway and try again.',
  };
}

/**
 * Ensure Gateway is running before sending chat messages.
 * Auto-starts if stopped. Returns a user-facing error instead of crashing if
 * OpenClaw is missing or the gateway cannot be started.
 */
async function ensureGatewayRunning(): Promise<{ ok: boolean; error?: string }> {
  const send = (ch: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
  };

  try {
    const openclawVersion = await safeShellExecAsync('openclaw --version', 5000);
    if (!openclawVersion) {
      send('chat:status', { type: 'error', message: 'OpenClaw is not installed' });
      return {
        ok: false,
        error: 'OpenClaw is not installed yet. Please finish Setup first, or reinstall OpenClaw in Settings before chatting.',
      };
    }

    const started = await startGatewayWithRepair(send);
    if (!started.ok) {
      send('chat:status', { type: 'error', message: 'Gateway failed to start' });
      return started;
    }
    return started;
  } catch {
    send('chat:status', { type: 'error', message: 'Gateway check failed' });
    return {
      ok: false,
      error: 'Could not verify the OpenClaw environment. Please finish Setup first, then try again.',
    };
  }
}

async function prepareGatewayForChat(): Promise<{ ok: boolean; error?: string }> {
  const send = (ch: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
  };

  try {
    const openclawVersion = await safeShellExecAsync('openclaw --version', 5000);
    if (!openclawVersion) {
      return {
        ok: false,
        error: 'OpenClaw is not installed yet. Please finish Setup first, or reinstall OpenClaw in Settings before chatting.',
      };
    }

    if (gatewayWsClient?.isConnected) {
      return { ok: true };
    }

    const statusOutput = await readShellOutputAsync('openclaw gateway status 2>&1', 4000);
    if (isGatewayRunningOutput(statusOutput)) {
      return { ok: true };
    }

    startGatewayRepairInBackground(send);

    return {
      ok: false,
      error: 'Local Gateway is still warming up. Answering directly while background services recover.',
    };
  } catch {
    startGatewayRepairInBackground(send);
    return {
      ok: false,
      error: 'OpenClaw background services are still warming up. Answering directly for now.',
    };
  }
}

async function prepareCliFallback(): Promise<void> {
  const send = (ch: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
  };

  if (process.platform !== 'win32') return;

  const ready = await ensureLocalDaemonReadyForRuntime(send);
  if (!ready) {
    console.warn('[chat] Local daemon was not ready before CLI fallback; continuing anyway');
  }
}

// --- Channel Configuration (registry-driven) ---
// Import channel registry for dynamic channel metadata
import {
  getChannel, getChannelByOpenclawId, toOpenclawId, toFrontendId,
  buildCLIFlags, getAllChannels, serializeRegistry,
  mergeCatalog, mergeChannelOptions, parseCliHelp, applyCliHelp,
  type CatalogEntry,
} from './channel-registry';

// Discover channels from OpenClaw installation at startup
function discoverOpenClawChannels(): void {
  try {
    const stderrRedirect = process.platform === 'win32' ? '2>NUL' : '2>/dev/null';
    let distDir = '';

    // Strategy 0: managed runtime dist (AwarenessClaw bundled install)
    const managedCandidates = [
      path.join(HOME, '.awareness-claw', 'openclaw-runtime', 'node_modules', 'openclaw', 'dist'),
      path.join(HOME, '.awareness-claw', 'openclaw-runtime', 'lib', 'node_modules', 'openclaw', 'dist'),
    ];
    for (const candidate of managedCandidates) {
      if (fs.existsSync(candidate)) { distDir = candidate; break; }
    }

    // Strategy 1: `npm root -g` → <prefix>/lib/node_modules → append openclaw/dist
    // This is the most reliable cross-platform approach (works with nvm, custom prefix, Windows)
    try {
      const globalRoot = safeShellExec(`npm root -g ${stderrRedirect}`)?.trim();
      if (globalRoot) {
        const candidate = path.join(globalRoot, 'openclaw', 'dist');
        if (fs.existsSync(candidate)) distDir = candidate;
      }
    } catch { /* npm not in PATH */ }

    // Strategy 2: resolve `which openclaw` symlink
    if (!distDir) {
      try {
        const lookupCommand = process.platform === 'win32'
          ? `where openclaw ${stderrRedirect}`
          : `which openclaw ${stderrRedirect}`;
        const ocPath = safeShellExec(lookupCommand)?.trim();
        if (ocPath) {
          const realPath = fs.realpathSync(ocPath);
          const candidate = path.join(path.dirname(realPath), 'dist');
          if (fs.existsSync(candidate)) distDir = candidate;
        }
      } catch { /* which failed */ }
    }

    const debugLog = (msg: string) => { try { fs.appendFileSync(path.join(HOME, '.awareness-channel-debug.log'), `[${new Date().toISOString()}] ${msg}\n`); } catch {} };
    if (!distDir) {
      debugLog('dist NOT found. managed runtime + npm-root-g + which-openclaw all failed');
      console.log('[channel-registry] OpenClaw dist not found, using builtins only');
      return;
    }
    debugLog(`dist found: ${distDir}`);
    console.log(`[channel-registry] Found OpenClaw at: ${distDir}`);

    // Parse CLI help: extracts supported channel enum + per-channel config fields
    try {
      const helpOutput = safeShellExec(`openclaw channels add --help ${stderrRedirect}`);
      if (helpOutput) {
        const { cliChannels, channelFields } = parseCliHelp(helpOutput);
        if (cliChannels.size > 0) {
          applyCliHelp(cliChannels, channelFields);
          debugLog(`CLI channels: ${[...cliChannels].join(', ')}; fields for: ${[...channelFields.keys()].join(', ')}`);
        }
      }
    } catch { /* help not available */ }

    // Load channel-catalog.json
    try {
      const catalogPath = path.join(distDir, 'channel-catalog.json');
      const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
      if (catalog.entries) mergeCatalog(catalog.entries as CatalogEntry[]);
    } catch { /* catalog not found */ }

    // Load cli-startup-metadata.json
    try {
      const metaPath = path.join(distDir, 'cli-startup-metadata.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.channelOptions) mergeChannelOptions(meta.channelOptions);
    } catch { /* metadata not found */ }
  } catch { /* openclaw not installed */ }
}

// --- Channel Conversations (Unified Inbox) ---

/**
 * Get or create a persistent Gateway WS client for channel session queries.
 * Lazy-connects on first use, auto-reconnects on disconnect.
 */
async function getGatewayWs(): Promise<GatewayClient> {
  if (!gatewayWsClient) {
    gatewayWsClient = new GatewayClient();

    // Forward real-time channel messages to renderer
    gatewayWsClient.on('event:session.message', (payload: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('channel:message', {
          sessionKey: payload.sessionKey || payload.key || '',
          message: payload.message || payload,
        });
      }
    });
  }

  if (!gatewayWsClient.isConnected) {
    try {
      await gatewayWsClient.connect();
    } catch (err: any) {
      const message = err?.message || '';
      if (!/pairing required/i.test(message)) throw err;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('chat:status', {
          type: 'gateway',
          message: 'Approving local Gateway device access...',
        });
      }

      const approvalOutput = await runAsync('openclaw devices approve --latest 2>&1', 30000).catch(() => '');
      if (!/Approved\s+/i.test(approvalOutput || '')) {
        throw err;
      }

      await gatewayWsClient.connect();
    }
  }
  return gatewayWsClient;
}

/** Channel icon lookup for known channels. */
// CHANNEL_ICONS removed — frontend now uses <ChannelIcon> component with registry

const WORKSPACE_DIR = path.join(HOME, '.openclaw', 'workspace');

function readCurrentWorkspaceDir() {
  return getAgentWorkspaceDir(HOME);
}

const doctor = createDoctor({
  shellExec: safeShellExecAsync,
  shellRun: runAsync,
  homedir: HOME,
  platform: process.platform,
});

// --- System Tray ---

function createTray() {
  const iconPath = path.join(__dirname, isDev ? '../resources/icon.png' : '../../resources/icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
    trayIcon.setTemplateImage(true); // macOS dark/light mode support
  } catch {
    return; // Skip tray if icon not found
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('AwarenessClaw');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show AwarenessClaw',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'New Chat',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
          mainWindow.webContents.send('tray:new-chat');
        }
      },
    },
    {
      label: 'Open Dashboard',
      click: async () => {
        const url = await resolveDashboardUrl(readShellOutputAsync);
        shell.openExternal(url);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: 'CmdOrCtrl+Q',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // Click tray icon to show window (macOS convention)
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createWindow();
    }
  });
}

const daemonWatchdog = createDaemonWatchdog({
  homedir: HOME,
  getEnhancedPath,
  getLocalDaemonHealth,
});

ipcMain.handle('daemon:mark-connected', () => {
  daemonWatchdog.markConnected();
});

registerAppUtilityHandlers({
  safeShellExecAsync,
  readShellOutputAsync,
  homedir: HOME,
});
registerAppRuntimeHandlers({
  home: HOME,
  safeShellExecAsync,
  getLocalDaemonHealth,
  runAsync,
  getBundledNpmBin,
  shutdownLocalDaemon,
  clearAwarenessLocalNpxCache,
});
registerChatHandlers({
  sendToRenderer: (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, payload);
    }
  },
  ensureGatewayRunning,
  prepareGatewayForChat,
  prepareCliFallback,
  getGatewayWs,
  getConnectedGatewayWs: () => (gatewayWsClient?.isConnected ? gatewayWsClient : null),
  callMcpStrict,
  getEnhancedPath,
  wrapWindowsCommand,
  stripAnsi,
});
registerAgentHandlers({
  home: HOME,
  safeShellExecAsync,
  readShellOutputAsync,
  ensureGatewayRunning,
  runAsync,
});
registerChannelConfigHandlers({
  home: HOME,
  safeShellExecAsync,
  readShellOutputAsync,
  runAsync,
  discoverOpenClawChannels,
  parseCliHelp,
  applyCliHelp,
  mergeCatalog,
  mergeChannelOptions,
  getAllChannels,
  serializeRegistry,
  getChannel,
  buildCLIFlags,
  toOpenclawId,
});
registerChannelListHandlers({
  home: HOME,
  safeShellExecAsync,
  readShellOutputAsync,
  toFrontendId,
});
registerChannelSessionHandlers({
  getGatewayWs,
  toFrontendId,
});
registerChannelSetupHandlers({
  getMainWindow: () => mainWindow,
  getChannel,
  runAsync,
  safeShellExecAsync,
  readShellOutputAsync,
  channelLoginWithQR,
});
registerCronHandlers({
  safeShellExecAsync,
});
registerGatewayHandlers({
  readShellOutputAsync,
  runAsync,
  startGatewayWithRepair: () => startGatewayWithRepair(),
  isGatewayRunningOutput: (output) => isGatewayRunningOutput(output ?? null),
});
registerMemoryHandlers();
registerFileDialogHandlers();
registerOpenClawConfigHandlers({
  home: HOME,
  safeShellExecAsync,
  mergeOpenClawConfig,
});
registerSkillHandlers({
  home: HOME,
  runAsync,
  readShellOutputAsync,
});
registerCloudWorkspaceHandlers({
  home: HOME,
  getWorkspaceDir: readCurrentWorkspaceDir,
});
registerConfigIoHandlers({
  home: HOME,
  getMainWindow: () => mainWindow,
  redactSensitiveValues,
  stripRedactedValues,
  mergeOpenClawConfig,
});
registerSetupHandlers({
  home: HOME,
  getEnhancedPath,
  getNodeVersion,
  runAsync,
  safeShellExecAsync,
  getBundledNpmBin,
  resolveBundledCache,
  downloadFile,
  sleep,
  getLocalDaemonHealth,
  checkDaemonHealth,
  waitForLocalDaemonReady,
  sendSetupDaemonStatus,
  startLocalDaemonDetached,
  runSpawn,
  forceStopLocalDaemon,
  clearAwarenessLocalNpxCache,
  formatDaemonSetupError,
  persistAwarenessPluginConfig,
  applyAwarenessPluginConfig,
  sanitizeAwarenessPluginConfig,
  mergeOpenClawConfig,
  getDaemonStartupPromise: () => daemonStartupPromise,
  setDaemonStartupPromise: (value) => { daemonStartupPromise = value; },
  getDaemonStartupLastKickoff: () => daemonStartupLastKickoff,
  setDaemonStartupLastKickoff: (value) => { daemonStartupLastKickoff = value; },
  sendSetupStatus,
});
registerRuntimeHealthHandlers({
  home: HOME,
  app,
  dirname: __dirname,
  safeShellExec,
  safeShellExecAsync,
  doctor,
  computeSha256,
  checkDaemonHealth,
  waitForLocalDaemonReady,
  sendSetupDaemonStatus,
  sleep,
  recentDaemonStartup: () => !!daemonStartupPromise || (Date.now() - daemonStartupLastKickoff < 180000),
  getMainWindow: () => mainWindow,
});

// --- App Lifecycle ---

app.whenReady().then(() => {
  // Deploy internal hook for awareness memory backup (idempotent, version-gated)
  ensureInternalHook(HOME);

  // Ensure config has required gateway defaults before anything tries to start
  repairOpenClawConfigFile();

  createWindow();
  if (process.platform === 'darwin') {
    createTray();
  }

  // Best-effort: start Gateway early so it's ready when user sends first message
  startGatewayRepairInBackground().catch((err) => {
    console.warn('[startup] Gateway pre-start failed (will retry on first chat):', err?.message || err);
  });

  // Start watchdog after a delay (give startup flow time to connect daemon first)
  setTimeout(() => {
    if (!daemonWatchdog.isRunning()) daemonWatchdog.startDaemonWatchdog();
  }, 30_000);
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  createWindow();
});

app.on('before-quit', () => {
  isQuitting = true;
  daemonWatchdog.stopDaemonWatchdog();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
