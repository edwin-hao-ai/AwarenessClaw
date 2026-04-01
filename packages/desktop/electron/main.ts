const electron = require('electron');
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog } = electron;
import path from 'path';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
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
import {
  normalizePluginAllow,
  isGatewayRunningOutput,
  GATEWAY_DEFAULTS,
  writeExecApprovalAsk,
} from './openclaw-config';

let mainWindow: typeof BrowserWindow.prototype | null = null;
let tray: typeof Tray.prototype | null = null;
let isQuitting = false;
let daemonStartupPromise: Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }> | null = null;
let daemonStartupLastKickoff = 0;
let gatewayWsClient: GatewayClient | null = null;

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

const isDev = !app.isPackaged;
const HOME = os.homedir();

const shellUtils = createShellUtils({ home: HOME, app });
const {
  ensureManagedOpenClawWindowsShim,
  getBundledNpmBin,
  getEnhancedPath,
  getGatewayPort,
  getManagedOpenClawInstallCommand,
  getNodeVersion,
  readShellOutputAsync,
  repairWindowsGatewayServiceScript,
  resolveBundledCache,
  rewriteOpenClawCommand,
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

function createWindow() {
  ensureManagedOpenClawWindowsShim();
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

const REDACTED_VALUE = '__REDACTED__';

const DESKTOP_DEFAULT_ALLOWED_TOOLS = [
  'exec',
  'awareness_init',
  'awareness_recall',
  'awareness_lookup',
  'awareness_record',
  'awareness_get_agent_prompt',
];

function hasAwarenessPluginInstalled() {
  return fs.existsSync(path.join(HOME, '.openclaw', 'extensions', 'openclaw-memory', 'package.json'));
}

function ensureDesktopDefaultToolPermissions(config: Record<string, any>) {
  config.tools = {
    ...(config.tools || {}),
    profile: config.tools?.profile || 'coding',
  };

  const existingAllow = new Set<string>(config.tools.alsoAllow || []);
  for (const tool of DESKTOP_DEFAULT_ALLOWED_TOOLS) {
    existingAllow.add(tool);
  }
  config.tools.alsoAllow = [...existingAllow];
}

function applyAwarenessPluginConfig(config: Record<string, any>, options?: { enableSlot?: boolean }) {
  if (!config.plugins) config.plugins = {};
  if (!config.plugins.entries) config.plugins.entries = {};

  ensureDesktopDefaultToolPermissions(config);

  config.plugins.entries['openclaw-memory'] = {
    ...(config.plugins.entries['openclaw-memory'] || {}),
    enabled: true,
    config: {
      ...(config.plugins.entries['openclaw-memory']?.config || {}),
      autoRecall: true,
      autoCapture: true,
      recallLimit: 8,
      localUrl: 'http://localhost:37800',
      baseUrl: 'https://awareness.market/api/v1',
      embeddingLanguage: 'multilingual',
    },
  };

  if (options?.enableSlot) {
    config.plugins.allow = Array.from(new Set([...(normalizePluginAllow(config.plugins.allow) || []), 'openclaw-memory']));
    config.plugins.slots = { ...(config.plugins.slots || {}), memory: 'openclaw-memory' };
  }
}

function sanitizeAwarenessPluginConfig(config: Record<string, any>) {
  ensureDesktopDefaultToolPermissions(config);

  config.gateway = {
    ...(config.gateway || {}),
    mode: GATEWAY_DEFAULTS.mode,
    bind: config.gateway?.bind || GATEWAY_DEFAULTS.bind,
    port: Number(config.gateway?.port) || GATEWAY_DEFAULTS.port,
  };

  if (!config.plugins) return;

  const normalizedAllow = normalizePluginAllow(config.plugins.allow);
  if (normalizedAllow) config.plugins.allow = normalizedAllow;
  else delete config.plugins.allow;

  if (config.plugins.entries?.['memory-awareness']) {
    delete config.plugins.entries['memory-awareness'];
  }

  if (Array.isArray(config.plugins.allow)) {
    config.plugins.allow = config.plugins.allow.filter((pluginId: string) => pluginId !== 'memory-awareness');
    if (!hasAwarenessPluginInstalled()) {
      config.plugins.allow = config.plugins.allow.filter((pluginId: string) => pluginId !== 'openclaw-memory');
    }
    if (config.plugins.allow.length === 0) delete config.plugins.allow;
  }

  if (config.plugins.slots?.memory === 'memory-awareness') {
    delete config.plugins.slots.memory;
  }

  if (!hasAwarenessPluginInstalled() && config.plugins.slots?.memory === 'openclaw-memory') {
    delete config.plugins.slots.memory;
  }

  if (config.plugins.slots && Object.keys(config.plugins.slots).length === 0) {
    delete config.plugins.slots;
  }
}

function persistAwarenessPluginConfig(options?: { enableSlot?: boolean }) {
  const configDir = path.join(HOME, '.openclaw');
  const configPath = path.join(configDir, 'openclaw.json');
  fs.mkdirSync(configDir, { recursive: true });

  let config: Record<string, any> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    config = {};
  }

  applyAwarenessPluginConfig(config, options);
  sanitizeAwarenessPluginConfig(config);
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeExecApprovalAsk(HOME, 'off');
}

function mergeOpenClawConfig(existing: Record<string, any>, incoming: Record<string, any>) {
  const merged = JSON.parse(JSON.stringify(existing || {}));

  for (const [key, value] of Object.entries(incoming || {})) {
    if (key === 'models') {
      merged.models = { ...(merged.models || {}) };
      const incomingModels = value as any;
      if (incomingModels?.providers) {
        merged.models.providers = { ...(merged.models.providers || {}) };
        for (const [providerKey, providerValue] of Object.entries(incomingModels.providers)) {
          merged.models.providers[providerKey] = {
            ...(merged.models.providers[providerKey] || {}),
            ...(providerValue as any),
          };
        }
      }
    } else if (key === 'agents') {
      merged.agents = JSON.parse(JSON.stringify(merged.agents || {}));
      const incomingAgents = value as any;
      if (incomingAgents?.defaults?.model?.primary) {
        if (!merged.agents.defaults) merged.agents.defaults = {};
        if (!merged.agents.defaults.model) merged.agents.defaults.model = {};
        merged.agents.defaults.model.primary = incomingAgents.defaults.model.primary;
      }
    } else if (key === 'plugins') {
      merged.plugins = JSON.parse(JSON.stringify(merged.plugins || {}));
      const incomingPlugins = value as any;
      const normalizedAllow = normalizePluginAllow(incomingPlugins.allow);
      if (normalizedAllow) merged.plugins.allow = normalizedAllow;
      if (incomingPlugins.slots) merged.plugins.slots = { ...(merged.plugins.slots || {}), ...incomingPlugins.slots };
      if (incomingPlugins.entries) {
        if (!merged.plugins.entries) merged.plugins.entries = {};
        for (const [entryId, entryConfig] of Object.entries(incomingPlugins.entries)) {
          const previous = merged.plugins.entries[entryId] || {};
          merged.plugins.entries[entryId] = { ...previous, ...(entryConfig as any) };
          if ((entryConfig as any)?.config && previous?.config) {
            merged.plugins.entries[entryId].config = { ...previous.config, ...(entryConfig as any).config };
          }
        }
      }
    } else if (key === 'gateway') {
      merged.gateway = {
        ...(merged.gateway || {}),
        ...(value as any),
      };
    } else if (key === 'tools') {
      merged.tools = JSON.parse(JSON.stringify(merged.tools || {}));
      const incomingTools = value as any;
      if (incomingTools.alsoAllow) {
        const existingAllow = new Set(merged.tools.alsoAllow || []);
        for (const tool of incomingTools.alsoAllow) existingAllow.add(tool);
        merged.tools.alsoAllow = [...existingAllow];
      }
      if (incomingTools.denied && incomingTools.denied.length > 0) merged.tools.denied = incomingTools.denied;
      if (incomingTools.profile) merged.tools.profile = incomingTools.profile;
    } else {
      merged[key] = value;
    }
  }

  sanitizeAwarenessPluginConfig(merged);

  return merged;
}

function redactSensitiveValues(value: any): any {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!value || typeof value !== 'object') return value;

  const redacted: Record<string, any> = {};
  const sensitiveKeyPattern = /(api.?key|token|secret|password|appsecret|bot.?token|webhook|authorization)/i;

  for (const [key, child] of Object.entries(value)) {
    if (sensitiveKeyPattern.test(key)) redacted[key] = REDACTED_VALUE;
    else redacted[key] = redactSensitiveValues(child);
  }

  return redacted;
}

function stripRedactedValues(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stripRedactedValues).filter((item) => item !== undefined);
  }
  if (!value || typeof value !== 'object') {
    return value === REDACTED_VALUE ? undefined : value;
  }

  const cleaned: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    const next = stripRedactedValues(child);
    if (next !== undefined) cleaned[key] = next;
  }
  return cleaned;
}

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
    // Compatibility: OpenClaw >= 2026.3.31 rejects channels.telegram.token.
    // Migrate legacy token -> botToken and remove token to keep config valid.
    if (current?.channels?.telegram?.token) {
      if (!current.channels.telegram.botToken) {
        current.channels.telegram.botToken = current.channels.telegram.token;
      }
      delete current.channels.telegram.token;
    }
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

async function startGatewayInUserSession(send?: (ch: string, data: any) => void): Promise<{ ok: boolean; error?: string }> {
  send?.('chat:status', { type: 'gateway', message: 'Starting temporary Gateway...' });

  try {
    if (process.platform === 'win32') {
      const child = runSpawn('cmd.exe', ['/d', '/c', 'start', '', '/b', 'openclaw', 'gateway', 'run', '--force'], {
        cwd: HOME,
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
    } else {
      const child = runSpawn('openclaw', ['gateway', 'run', '--force'], {
        cwd: HOME,
        detached: true,
        stdio: 'ignore',
      });
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
  ensureManagedOpenClawWindowsShim();
  repairWindowsGatewayServiceScript();
  const statusOutput = await readShellOutputAsync('openclaw gateway status 2>&1', 15000);
  if (isGatewayRunningOutput(statusOutput)) return { ok: true };

  const emit = (message: string) => send?.('chat:status', { type: 'gateway', message });
  const prefs = readRuntimePreferences();

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

/**
 * Chat via `openclaw agent -m "..." --json`
 * Non-interactive, one message at a time, returns JSON response.
 * Streaming: read stdout line by line as response comes in.
 */

// Track active chat child process for abort support
let activeChatChild: ReturnType<typeof spawn> | null = null;

ipcMain.handle('chat:abort', async (_e: any, sessionKey?: string) => {
  // Try WebSocket abort first (graceful)
  if (gatewayWsClient?.isConnected && sessionKey) {
    try {
      await gatewayWsClient.chatAbort(sessionKey);
      return { success: true };
    } catch { /* fall through to CLI kill */ }
  }
  // Fallback: kill CLI child process
  if (activeChatChild) {
    try { activeChatChild.kill('SIGTERM'); } catch { /* already dead */ }
    activeChatChild = null;
    return { success: true };
  }
  return { success: false, error: 'No active chat' };
});

ipcMain.handle('chat:approve', async (_e: any, sessionKey: string, approvalRequestId: string, decision?: 'allow-once') => {
  if (!sessionKey || !approvalRequestId) {
    return { success: false, error: 'Missing approval context' };
  }

  try {
    const ws = await getGatewayWs();
    const command = `/approve ${approvalRequestId} ${decision || 'allow-once'}`;
    await ws.chatSend(sessionKey, command);
    return { success: true, command };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('chat:send', async (_e: any, message: string, sessionId?: string, options?: { thinkingLevel?: string; model?: string; files?: string[]; workspacePath?: string; agentId?: string }) => {
  const send = (ch: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
  };

  // Auto-start Gateway if not running
  const gatewayReady = await ensureGatewayRunning();
  if (!gatewayReady.ok) {
    return { success: false, text: '', error: gatewayReady.error || 'Gateway failed to start. Please check Settings → Gateway and try again.' };
  }

  const sid = sessionId || `ac-${Date.now()}`;

  // Build full message with file/workspace context
  let fullMessage = message;
  if (options?.files && options.files.length > 0) {
    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
    const images: string[] = [];
    const others: string[] = [];
    for (const f of options.files) {
      const ext = path.extname(f).toLowerCase();
      (imageExts.includes(ext) ? images : others).push(f);
    }
    const parts: string[] = [];
    if (images.length > 0) parts.push(`[Images to analyze: ${images.join(', ')}] (use exec tool to read or describe these image files)`);
    if (others.length > 0) parts.push(`[Attached files: ${others.join(', ')}]`);
    fullMessage = `${parts.join('\n')}\n\n${message}`;
  }
  const requestedWorkspace = options?.workspacePath?.trim();
  if (requestedWorkspace) {
    try {
      if (!fs.statSync(requestedWorkspace).isDirectory()) {
        return { success: false, text: '', error: 'The selected project folder is not available.', sessionId: sid };
      }
    } catch {
      return { success: false, text: '', error: 'The selected project folder could not be found.', sessionId: sid };
    }
    fullMessage = `[Current project directory: ${requestedWorkspace}] (use this as base for relative file paths)\n${fullMessage}`;
  }

  // --- WebSocket RPC to Gateway (replaces CLI spawn) ---
  // Gateway's Command Queue handles message ordering automatically (default: collect mode).
  // Chat events (delta/tool_use/thinking) stream via WebSocket events → forwarded to frontend.

  let fullResponseText = '';
  let chatEventHandler: ((payload: any) => void) | null = null;
  let allEventsHandler: ((evt: any) => void) | null = null;

  try {
    const ws = await getGatewayWs();

    const { promise: chatDone, resolve: chatResolve } = (() => {
      let r: () => void;
      const p = new Promise<void>(res => { r = res; });
      return { promise: p, resolve: r! };
    })();
    const chatTimeout = setTimeout(() => chatResolve(), 120000);

    // Dedup sets for cumulative delta events
    const seenToolIds = new Set<string>();
    const completedToolIds = new Set<string>();
    let lastThinkingText = '';
    let pendingApprovalRequestId = '';
    let pendingApprovalCommand = '';
    let pendingApprovalDetail = '';

    // --- 1) Log ALL gateway events to renderer DevTools for diagnostics ---
    // (console.log in main process doesn't show in Chromium DevTools, must use IPC)
    allEventsHandler = (evt: any) => {
      const eventName = evt?.event || 'unknown';
      const preview = JSON.stringify(evt?.payload || evt).slice(0, 800);
      send('chat:debug', `[gw:${eventName}] ${preview}`);

      if (eventName.endsWith('.approval.requested')) {
        const request = evt?.payload?.request || {};
        const toolName = eventName.replace(/\.approval\.requested$/, '') || request.tool || 'tool';
        const detailParts: string[] = [];
        if (request.command) detailParts.push(String(request.command));
        if (request.cwd) detailParts.push(`cwd: ${request.cwd}`);
        const requestId = request.id || `approval-${toolName}-${Date.now()}`;
        const approvalCommand = `/approve ${requestId} allow-once`;
        pendingApprovalRequestId = requestId;
        pendingApprovalCommand = approvalCommand;
        pendingApprovalDetail = detailParts.join(' | ') || 'Waiting for approval';
        send('chat:status', {
          type: 'tool_approval',
          tool: toolName,
          toolStatus: 'awaiting_approval',
          toolId: requestId,
          approvalRequestId: requestId,
          approvalCommand,
          detail: pendingApprovalDetail,
        });
      }
    };
    ws.on('gateway-event', allEventsHandler);

    // --- 2) Handle chat events (text deltas, tool blocks, thinking blocks) ---
    chatEventHandler = (payload: any) => {
      if (!payload) return;
      const payloadSession = payload.sessionKey || payload.key || '';
      if (payloadSession && !payloadSession.endsWith(sid) && payloadSession !== sid) return;

      const state = payload.state;
      const msg = payload.message;

      if (state === 'delta' && msg && msg.role === 'assistant') {
        // --- Extract text from content (handles both string and block array) ---
        let textContent = '';
        if (Array.isArray(msg.content)) {
          textContent = msg.content.map((c: any) => c.type === 'text' ? (c.text || '') : '').join('');
        } else if (typeof msg.content === 'string') {
          textContent = msg.content;
        }

        // Stream only new portion (delta events are cumulative)
        if (textContent && textContent.length > fullResponseText.length) {
          const newChunk = textContent.slice(fullResponseText.length);
          fullResponseText = textContent;
          send('chat:stream', newChunk);
          send('chat:status', { type: 'generating' });
        }

        // --- Parse content blocks for tool_use / tool_result / thinking ---
        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'tool_use') {
              const toolId = block.id || `tc-${Date.now()}`;
              if (!seenToolIds.has(toolId)) {
                seenToolIds.add(toolId);
                send('chat:status', { type: 'tool_call', tool: block.name || 'tool', toolStatus: 'running', toolId });
              }
            } else if (block.type === 'tool_result') {
              const toolId = block.tool_use_id || '';
              if (toolId && !completedToolIds.has(toolId)) {
                completedToolIds.add(toolId);
                send('chat:status', { type: 'tool_update', toolId, toolStatus: 'completed' });
              }
            } else if (block.type === 'thinking' || block.type === 'reasoning') {
              const text = block.thinking || block.reasoning || block.text || '';
              if (text && text !== lastThinkingText) {
                lastThinkingText = text;
                send('chat:status', { type: 'thinking' });
                send('chat:thinking', text);
              }
            }
          }
        }

        // --- Check if the whole message.content string IS reasoning (OpenClaw sends
        //     reasoning as separate chat messages prefixed with "Reasoning:") ---
        if (typeof msg.content === 'string' && msg.content.startsWith('Reasoning:')) {
          const reasoningText = msg.content.replace(/^Reasoning:\s*/, '');
          if (reasoningText && reasoningText !== lastThinkingText) {
            lastThinkingText = reasoningText;
            // Undo: don't add reasoning prefix to main response text
            fullResponseText = fullResponseText.replace(msg.content, '').trim();
            send('chat:thinking', reasoningText);
            send('chat:status', { type: 'thinking' });
          }
        }
      } else if (state === 'final') {
        clearTimeout(chatTimeout);
        chatResolve();
      } else if (state === 'aborted' || state === 'error') {
        send('chat:status', { type: 'error' });
        clearTimeout(chatTimeout);
        chatResolve();
      }
    };

    ws.on('event:chat', chatEventHandler);
    send('chat:status', { type: 'thinking' });

    // Send message via Gateway WebSocket RPC
    await ws.chatSend(sid, fullMessage, {
      thinking: options?.thinkingLevel && options.thinkingLevel !== 'off' ? options.thinkingLevel : undefined,
    });

    // Wait for agent to finish
    await chatDone;

    // Cleanup listeners
    ws.removeListener('event:chat', chatEventHandler);
    ws.removeListener('gateway-event', allEventsHandler);

    const text = fullResponseText.trim() || '';
    send('chat:stream-end', {});

    const parseMcpTextPayload = (mcpResponse: any) => {
      const textPayload = mcpResponse?.result?.content?.[0]?.text;
      if (!textPayload || typeof textPayload !== 'string') return {};
      try {
        return JSON.parse(textPayload);
      } catch {
        return {};
      }
    };

    // Fire-and-forget: write desktop chat to Awareness memory
    if (text) {
      const memoryToolId = `memory-save-${Date.now()}`;
      send('chat:status', {
        type: 'tool_call',
        tool: 'awareness_record',
        toolStatus: 'saving',
        toolId: memoryToolId,
        detail: 'Save this turn to Awareness memory',
      });

      callMcpStrict('awareness_record', {
        action: 'remember',
        content: `Request: ${message}\nResult: ${text}`,
        event_type: 'turn_brief',
        source: 'desktop',
      }).then((result) => {
        const parsed = parseMcpTextPayload(result);
        if (parsed?.error) {
          throw new Error(parsed.error);
        }
        send('chat:status', {
          type: 'tool_update',
          toolId: memoryToolId,
          toolStatus: 'completed',
          detail: parsed?.filepath || 'Saved to Awareness memory',
        });
      }).catch((err) => {
        console.warn('[chat] Memory record failed:', err.message);
        send('chat:status', {
          type: 'tool_update',
          toolId: memoryToolId,
          toolStatus: 'failed',
          detail: err.message,
        });
        mainWindow?.webContents.send('chat:memory-warning', {
          type: 'record-failed',
          message: err.message,
        });
      });
    }

    if (!text && pendingApprovalRequestId) {
      return {
        success: true,
        text: '',
        sessionId: sid,
        awaitingApproval: true,
        approvalRequestId: pendingApprovalRequestId,
        approvalCommand: pendingApprovalCommand,
        approvalDetail: pendingApprovalDetail,
      };
    }

    return { success: true, text: text || 'No response', sessionId: sid };
  } catch (err: any) {
    if (gatewayWsClient) {
      if (chatEventHandler) gatewayWsClient.removeListener('event:chat', chatEventHandler);
      if (allEventsHandler) gatewayWsClient.removeListener('gateway-event', allEventsHandler);
    }
    send('chat:stream-end', {});
    const errorMsg = err?.message || String(err);
    // If WebSocket fails, fallback to CLI spawn (degraded mode without tool visibility)
    if (errorMsg.includes('WebSocket') || errorMsg.includes('connect') || errorMsg.includes('timed out')) {
      console.warn('[chat] WebSocket failed, falling back to CLI:', errorMsg);
      return chatSendViaCli(message, sid, options, send);
    }
    return { success: false, text: '', error: errorMsg, sessionId: sid };
  }
});

/** Fallback: send chat via CLI spawn when WebSocket is unavailable */
async function chatSendViaCli(
  message: string, sid: string,
  options: { thinkingLevel?: string; files?: string[]; workspacePath?: string; agentId?: string } | undefined,
  send: (ch: string, data: any) => void,
): Promise<any> {
  return new Promise((resolve) => {
    let stdout = '';
    const thinkingFlag = options?.thinkingLevel && options.thinkingLevel !== 'off'
      ? ` --thinking ${options.thinkingLevel}` : '';
    const agentFlag = options?.agentId && options.agentId !== 'main' ? ` --agent "${options.agentId}"` : '';
    const escapedMsg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    const cmd = rewriteOpenClawCommand(`openclaw agent --session-id "${sid}" -m "${escapedMsg}" --verbose on${thinkingFlag}${agentFlag}`);
    const enhancedPath = getEnhancedPath();
    const child = process.platform === 'win32'
      ? spawn(wrapWindowsCommand(cmd), [], { cwd: os.homedir(), shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' } })
      : spawn('/bin/bash', ['--norc', '--noprofile', '-c', `export PATH="${enhancedPath}"; ${cmd}`], { cwd: os.homedir(), env: { ...process.env, PATH: enhancedPath } });

    activeChatChild = child;
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = stripAnsi(data.toString()).replace(/\r/g, '');
      stdout += chunk;
      // Simple streaming — send non-noise lines
      for (const line of chunk.split('\n')) {
        const t = line.trim();
        if (t && !t.startsWith('[') && !t.startsWith('Config') && !t.startsWith('Registered') && !t.includes('plugin')) {
          send('chat:stream', t + '\n');
        }
      }
    });
    child.stderr?.on('data', () => {});
    child.on('exit', () => {
      activeChatChild = null;
      send('chat:stream-end', {});
      const clean = stdout.split('\n').filter(l => l.trim() && !l.trim().startsWith('[') && !l.includes('Config') && !l.includes('plugin')).join('\n').trim();
      resolve({ success: true, text: clean || 'No response', sessionId: sid });
    });
    child.on('error', (err) => resolve({ success: false, error: String(err), sessionId: sid }));
    setTimeout(() => { try { child.kill(); } catch {} resolve({ success: false, error: 'Response timeout', sessionId: sid }); }, 120000);
  });
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
      const globalRoot = safeShellExec('npm root -g 2>/dev/null')?.trim();
      if (globalRoot) {
        const candidate = path.join(globalRoot, 'openclaw', 'dist');
        if (fs.existsSync(candidate)) distDir = candidate;
      }
    } catch { /* npm not in PATH */ }

    // Strategy 2: resolve `which openclaw` symlink
    if (!distDir) {
      try {
        const ocPath = safeShellExec('which openclaw 2>/dev/null')?.trim();
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
      const helpOutput = safeShellExec('openclaw channels add --help 2>/dev/null');
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
    await gatewayWsClient.connect();
  }
  return gatewayWsClient;
}

/** Channel icon lookup for known channels. */
// CHANNEL_ICONS removed — frontend now uses <ChannelIcon> component with registry

const WORKSPACE_DIR = path.join(HOME, '.openclaw', 'workspace');

// --- Cloud Memory Auth (via local daemon proxy) ---

const DAEMON_BASE = 'http://127.0.0.1:37800/api/v1';

/** POST JSON to daemon */
function daemonPost(route: string, body: Record<string, any> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(`${DAEMON_BASE}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
      timeout: 15000,
    }, (res) => {
      let raw = '';
      res.on('data', (chunk: string) => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON from daemon')); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Daemon request timeout')); });
    req.write(data);
    req.end();
  });
}

/** GET JSON from daemon */
function daemonGet(route: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get(`${DAEMON_BASE}${route}`, { timeout: 10000 }, (res) => {
      let raw = '';
      res.on('data', (chunk: string) => { raw += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { reject(new Error('Invalid JSON from daemon')); }
      });
    }).on('error', reject).on('timeout', function(this: any) { this.destroy(); reject(new Error('Timeout')); });
  });
}

// --- Memory API (local daemon + cloud compatible) ---

/** Call local daemon MCP tool via JSON-RPC */
function callMcp(toolName: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve) => {
    const req = http.request('http://127.0.0.1:37800/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid JSON' }); }
      });
    });
    req.on('error', (err) => resolve({ error: String(err) }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.write(JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }));
    req.end();
  });
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
      click: () => {
        shell.openExternal('http://localhost:18789');
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
  homedir: HOME,
});
registerAppRuntimeHandlers({
  home: HOME,
  safeShellExecAsync,
  getLocalDaemonHealth,
  runAsync,
  getManagedOpenClawInstallCommand,
  ensureManagedOpenClawWindowsShim,
  shutdownLocalDaemon,
  clearAwarenessLocalNpxCache,
});
registerAgentHandlers({
  home: HOME,
  safeShellExecAsync,
  ensureGatewayRunning,
  runAsync,
});
registerChannelConfigHandlers({
  home: HOME,
  safeShellExecAsync,
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
});
registerSkillHandlers({
  home: HOME,
  runAsync,
});
registerCloudWorkspaceHandlers({
  home: HOME,
  workspaceDir: WORKSPACE_DIR,
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
  ensureManagedOpenClawWindowsShim,
  getManagedOpenClawInstallCommand,
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
  repairWindowsGatewayServiceScript();

  createWindow();
  if (process.platform === 'darwin') {
    createTray();
  }

  // Best-effort: start Gateway early so it's ready when user sends first message
  startGatewayWithRepair().catch((err) => {
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
