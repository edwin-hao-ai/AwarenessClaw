const electron = require('electron');
const { app, BrowserWindow, ipcMain, shell } = electron;
import path from 'path';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';

let mainWindow: typeof BrowserWindow.prototype | null = null;

const isDev = !app.isPackaged;
const HOME = os.homedir();

// --- Bundled Node.js path management ---
// Electron bundles Node.js, but we need a system-accessible node/npm for OpenClaw.
// Strategy: Use system node if available, otherwise auto-install via official installer.

/** Safe shell exec — explicit shell + enhanced PATH + short timeout. Never hangs. */
function safeShellExec(cmd: string, timeoutMs = 5000): string | null {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: 'pipe',
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
      env: { ...process.env, PATH: getEnhancedPath() },
    }).trim();
  } catch {
    return null;
  }
}

function getNodeVersion(): string | null {
  return safeShellExec('node --version');
}

/**
 * Build a shell PATH that includes common Node.js install locations.
 * After we auto-install Node.js, it may not be in the default Electron PATH.
 */
function getEnhancedPath(): string {
  const base = process.env.PATH || '';
  const extras: string[] = [];

  if (process.platform === 'darwin' || process.platform === 'linux') {
    extras.push(
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${HOME}/.nvm/versions/node/v22.0.0/bin`, // nvm common path
      `${HOME}/.local/bin`,
      '/usr/bin',
    );
  } else if (process.platform === 'win32') {
    extras.push(
      `${process.env.APPDATA}\\npm`,
      `${process.env.ProgramFiles}\\nodejs`,
      `${process.env.ProgramFiles} (x86)\\nodejs`,
    );
  }

  return [...extras, base].join(path.delimiter);
}

/** Run a command with enhanced PATH and explicit shell (critical for packaged Electron) */
function run(cmd: string, opts: Record<string, unknown> = {}): string {
  return execSync(cmd, {
    encoding: 'utf8',
    timeout: 180000,
    stdio: 'pipe',
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    env: { ...process.env, PATH: getEnhancedPath() },
    ...opts,
  } as any);
}

function runSpawn(cmd: string, args: string[], opts: Record<string, unknown> = {}) {
  return spawn(cmd, args, {
    env: { ...process.env, PATH: getEnhancedPath() },
    ...opts,
  });
}

// --- Window Creation ---

function createWindow() {
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
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- IPC Handlers ---

ipcMain.handle('app:get-platform', () => process.platform);

ipcMain.handle('app:open-external', (_e, url: string) => {
  shell.openExternal(url);
});

/**
 * Step 1: Detect environment
 * Returns system info + whether Node.js and OpenClaw are available
 *
 * IMPORTANT: In a packaged Electron app, the shell environment is minimal.
 * All execSync calls must: use short timeouts, explicit shell, enhanced PATH,
 * and be wrapped in try-catch to avoid freezing.
 */
ipcMain.handle('setup:detect-environment', async () => {
  const result: Record<string, unknown> = {
    platform: process.platform,
    arch: process.arch,
    home: HOME,
    electronNodeVersion: process.version,
    systemNodeInstalled: false,
    systemNodeVersion: null,
    npmInstalled: false,
    openclawInstalled: false,
    openclawVersion: null,
    hasExistingConfig: false,
  };

  const safeExec = (cmd: string): string | null => {
    try {
      return execSync(cmd, {
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe',
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
        env: { ...process.env, PATH: getEnhancedPath() },
      }).trim();
    } catch {
      return null;
    }
  };

  // Check system Node.js
  const nodeVersion = safeExec('node --version');
  if (nodeVersion) {
    result.systemNodeInstalled = true;
    result.systemNodeVersion = nodeVersion;
  }

  // Check npm
  result.npmInstalled = safeExec('npm --version') !== null;

  // Check OpenClaw
  const openclawVersion = safeExec('openclaw --version');
  if (openclawVersion) {
    result.openclawInstalled = true;
    result.openclawVersion = openclawVersion;
  }

  // Check existing config (no shell needed, pure fs)
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    result.hasExistingConfig = fs.existsSync(configPath);
  } catch { /* ignore */ }

  return result;
});

/**
 * Step 1.5: Install Node.js if not available
 * Uses official Node.js installer scripts
 */
ipcMain.handle('setup:install-nodejs', async () => {
  // Check if already have it
  if (getNodeVersion()) {
    return { success: true, alreadyInstalled: true };
  }

  try {
    if (process.platform === 'win32') {
      try {
        run('winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements', { timeout: 300000 });
        return { success: true, method: 'winget' };
      } catch {
        const msiUrl = 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi';
        const msiPath = path.join(os.tmpdir(), 'node-installer.msi');
        await downloadFile(msiUrl, msiPath);
        run(`msiexec /i "${msiPath}" /qn`, { timeout: 300000 });
        return { success: true, method: 'msi' };
      }
    } else if (process.platform === 'darwin') {
      // macOS: try brew, then official pkg
      const hasBrew = safeShellExec('brew --version') !== null;
      if (hasBrew) {
        try {
          run('brew install node@22', { timeout: 300000 });
          return { success: true, method: 'homebrew' };
        } catch { /* fall through to pkg */ }
      }
      // Official .pkg installer (no sudo needed for user-level install on modern macOS)
      const pkgUrl = 'https://nodejs.org/dist/v22.12.0/node-v22.12.0.pkg';
      const pkgPath = path.join(os.tmpdir(), 'node-installer.pkg');
      await downloadFile(pkgUrl, pkgPath);
      // Open the .pkg installer GUI — user clicks through, no sudo needed
      run(`open "${pkgPath}"`, { timeout: 10000 });
      // Wait for node to become available (user installs via GUI)
      for (let i = 0; i < 120; i++) {
        await sleep(2000);
        if (getNodeVersion()) return { success: true, method: 'pkg-gui' };
      }
      return { success: false, error: 'Node.js installation timed out' };
    } else {
      // Linux
      try {
        run('curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs', { timeout: 300000 });
        return { success: true, method: 'nodesource-deb' };
      } catch {
        try {
          run('curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo dnf install -y nodejs', { timeout: 300000 });
          return { success: true, method: 'nodesource-rpm' };
        } catch (err) {
          return { success: false, error: String(err) };
        }
      }
    }
  } catch (err) {
    return {
      success: false,
      error: String(err),
      hint: 'Please install Node.js 22+ manually from https://nodejs.org',
    };
  }
});

/**
 * Step 2: Install OpenClaw
 */
ipcMain.handle('setup:install-openclaw', async () => {
  // Check if already installed
  const existing = safeShellExec('openclaw --version');
  if (existing) {
    return { success: true, alreadyInstalled: true, version: existing };
  }

  // Try npm install — use 90s timeout (openclaw is a large package)
  const registries = [
    '', // default
    '--registry=https://registry.npmmirror.com',
  ];

  for (const reg of registries) {
    try {
      run(`npm install -g openclaw ${reg}`.trim(), { timeout: 90000 });
      return { success: true };
    } catch { continue; }
  }

  // Fallback: official install script
  try {
    if (process.platform === 'win32') {
      run('powershell -Command "irm https://openclaw.ai/install.ps1 | iex"', { timeout: 120000 });
    } else {
      run('curl -fsSL https://openclaw.ai/install.sh | bash', { timeout: 120000 });
    }
    return { success: true, method: 'official-script' };
  } catch (err) {
    // Even if install fails, write a placeholder config so user can continue
    return { success: false, error: String(err), hint: 'Install OpenClaw manually: npm install -g openclaw' };
  }
});

/**
 * Step 3: Install Awareness memory plugin
 * Must check if openclaw exists first; use short timeouts to avoid UI freeze.
 */
ipcMain.handle('setup:install-plugin', async () => {
  // Check if openclaw command exists
  const hasOpenClaw = safeShellExec('openclaw --version') !== null;

  if (hasOpenClaw) {
    try {
      run('openclaw plugins install @awareness-sdk/openclaw-memory', { timeout: 60000 });
      return { success: true, method: 'openclaw-plugin' };
    } catch { /* fall through to clawhub */ }
  }

  // Fallback: install via npm + clawhub (shorter timeout, no interactive prompts)
  try {
    run('npx -y clawhub@latest install awareness-memory --force', { timeout: 60000 });
    return { success: true, method: 'clawhub' };
  } catch {
    // Last resort: just configure the plugin in config file, skip actual install
    // The plugin will be auto-installed when user first runs openclaw
    try {
      const configDir = path.join(HOME, '.openclaw');
      const configPath = path.join(configDir, 'openclaw.json');
      fs.mkdirSync(configDir, { recursive: true });

      let config: any = {};
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

      if (!config.plugins) config.plugins = {};
      config.plugins['openclaw-memory'] = {
        enabled: true,
        config: {
          autoRecall: true,
          autoCapture: true,
          recallLimit: 8,
          localUrl: 'http://localhost:37800',
          baseUrl: 'https://awareness.market/api/v1',
          embeddingLanguage: 'multilingual',
        },
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return { success: true, method: 'config-only', note: 'Plugin config written, will install on first run' };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }
});

/**
 * Step 4: Start local Awareness daemon
 */
ipcMain.handle('setup:start-daemon', async () => {
  // Check if already running
  const isReady = await checkDaemonHealth();
  if (isReady) return { success: true, alreadyRunning: true };

  // Start daemon
  const child = runSpawn('npx', ['@awareness-sdk/local', 'start'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  // Poll for readiness (max 15 seconds)
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    if (await checkDaemonHealth()) return { success: true };
  }

  return { success: false, error: 'Daemon did not start in time' };
});

/**
 * Save merged config to ~/.openclaw/openclaw.json
 */
ipcMain.handle('setup:save-config', async (_e, config: Record<string, unknown>) => {
  const configDir = path.join(HOME, '.openclaw');
  const configPath = path.join(configDir, 'openclaw.json');

  fs.mkdirSync(configDir, { recursive: true });

  let existing: Record<string, any> = {};
  try {
    existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch { /* start fresh */ }

  // Deep merge: never overwrite user's existing providers, only add new ones
  const merged = { ...existing };

  for (const [key, value] of Object.entries(config)) {
    if (key === 'models' && existing.models) {
      // Deep merge providers: keep existing, add new
      merged.models = { ...existing.models };
      if ((value as any)?.providers) {
        merged.models.providers = { ...existing.models.providers, ...(value as any).providers };
      }
    } else if (key === 'agents' && existing.agents) {
      // Deep merge agents.defaults
      merged.agents = JSON.parse(JSON.stringify(existing.agents));
      if ((value as any)?.defaults?.model?.primary) {
        if (!merged.agents.defaults) merged.agents.defaults = {};
        if (!merged.agents.defaults.model) merged.agents.defaults.model = {};
        merged.agents.defaults.model.primary = (value as any).defaults.model.primary;
      }
    } else {
      merged[key] = value;
    }
  }

  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return { success: true };
});

/**
 * Check for updates — compare installed vs npm latest versions
 */
ipcMain.handle('app:check-updates', async () => {
  const updates: any[] = [];

  // Check OpenClaw version
  const currentOC = safeShellExec('openclaw --version');
  if (currentOC) {
    const latestOC = safeShellExec('npm view openclaw version', 10000);
    if (latestOC && latestOC !== currentOC.replace(/[^\d.]/g, '').trim()) {
      const current = currentOC.replace(/[^\d.]/g, '').trim();
      if (current !== latestOC.trim()) {
        updates.push({
          component: 'openclaw',
          label: 'OpenClaw',
          currentVersion: current,
          latestVersion: latestOC.trim(),
        });
      }
    }
  }

  // Check Awareness plugin version
  const currentPlugin = safeShellExec('npm ls -g @awareness-sdk/openclaw-memory --json 2>/dev/null', 10000);
  if (currentPlugin) {
    try {
      const parsed = JSON.parse(currentPlugin);
      const installed = parsed?.dependencies?.['@awareness-sdk/openclaw-memory']?.version;
      if (installed) {
        const latestPlugin = safeShellExec('npm view @awareness-sdk/openclaw-memory version', 10000);
        if (latestPlugin && latestPlugin.trim() !== installed) {
          updates.push({
            component: 'plugin',
            label: 'Awareness Memory 插件',
            currentVersion: installed,
            latestVersion: latestPlugin.trim(),
          });
        }
      }
    } catch {}
  }

  return { updates };
});

ipcMain.handle('setup:open-auth-url', (_e, url: string) => {
  shell.openExternal(url);
});

/**
 * Read existing openclaw.json to detect pre-configured providers/models.
 * Used by setup wizard to skip model selection if user already has OpenClaw configured.
 */
/**
 * Run openclaw onboard/doctor for new users
 */
ipcMain.handle('setup:bootstrap', async () => {
  const result = safeShellExec('openclaw doctor --fix 2>&1', 30000);
  return { success: !!result, output: result };
});

ipcMain.handle('setup:read-existing-config', async () => {
  const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const providers = config?.models?.providers || {};
    const primaryModel = config?.agents?.defaults?.model?.primary || '';
    const providerNames = Object.keys(providers);

    return {
      exists: true,
      hasProviders: providerNames.length > 0,
      providers: providerNames,
      primaryModel,
      // Check if the primary model's provider has an apiKey configured
      hasApiKey: providerNames.some(name => providers[name]?.apiKey),
    };
  } catch {
    return { exists: false, hasProviders: false, providers: [], primaryModel: '', hasApiKey: false };
  }
});

/**
 * Get OpenClaw dashboard URL with auth token
 */
ipcMain.handle('app:get-dashboard-url', async () => {
  const output = safeShellExec('openclaw dashboard --no-open', 10000);
  if (!output) return { url: null };

  // Parse: "Dashboard URL: http://127.0.0.1:18789/#token=xxx"
  const match = output.match(/Dashboard URL:\s*(http[^\s]+)/);
  if (match) return { url: match[1] };

  return { url: null };
});

// --- Helpers ---

function checkDaemonHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:37800/healthz', { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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

/**
 * Chat via `openclaw agent -m "..." --json`
 * Non-interactive, one message at a time, returns JSON response.
 * Streaming: read stdout line by line as response comes in.
 */
ipcMain.handle('chat:send', async (_e, message: string, sessionId?: string) => {
  return new Promise((resolve) => {
    let stdout = '';
    const sid = sessionId || `ac-${Date.now()}`;
    const escapedMsg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    // Use --verbose on to get thinking/tool status events
    const cmd = `openclaw agent --local --session-id "${sid}" -m "${escapedMsg}" --verbose on`;

    const child = spawn('/bin/bash', ['--norc', '--noprofile', '-c',
      `export PATH="${getEnhancedPath()}"; ${cmd}`
    ], {
      cwd: os.homedir(),
      env: { ...process.env, PATH: getEnhancedPath() },
    });

    const send = (channel: string, data: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
    };

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      for (const line of chunk.split('\n')) {
        const t = line.trim();
        // Parse status events from verbose output
        if (t.includes('run agent start')) {
          send('chat:status', { type: 'thinking' });
        } else if (t.includes('run agent end') && t.includes('isError=false')) {
          send('chat:status', { type: 'generating' });
        } else if (t.includes('run agent end') && t.includes('isError=true')) {
          send('chat:status', { type: 'error' });
        }
      }
    });

    child.stderr?.on('data', () => { /* ignore stderr */ });

    child.on('exit', () => {
      // Filter out ALL log/diagnostic lines, keep only the actual response
      const isNoise = (line: string) => {
        const t = line.trimStart();
        return t.startsWith('[plugins]') || t.startsWith('[tools]') ||
          t.startsWith('[agent/') || t.startsWith('[diagnostic]') ||
          t.startsWith('Registered plugin') || t.startsWith('[context-diag]');
      };
      const cleanText = stdout.split('\n').filter(l => !isNoise(l)).join('\n').trim();
      resolve({ success: true, text: cleanText || 'No response', sessionId: sid });
    });

    child.on('error', (err) => resolve({ success: false, error: String(err), sessionId: sid }));

    setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ success: false, error: '响应超时', sessionId: sid });
    }, 120000);
  });
});

// --- Channel Configuration ---

ipcMain.handle('channel:save', async (_e, channelId: string, config: Record<string, string>) => {
  const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
  try {
    let existing: any = {};
    try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

    if (!existing.channels) existing.channels = {};
    existing.channels[channelId] = {
      ...existing.channels[channelId],
      ...config,
      enabled: true,
    };

    fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('channel:test', async (_e, channelId: string) => {
  // Test channel connectivity by checking openclaw status
  const output = safeShellExec(`openclaw channels check ${channelId} 2>&1 || openclaw status`, 10000);
  return { success: !!output, output };
});

// --- Cron Management ---

ipcMain.handle('cron:list', async () => {
  const output = safeShellExec('openclaw cron list --json 2>/dev/null || openclaw cron list', 10000);
  if (!output) return { jobs: [], error: 'OpenClaw not available' };

  // Try to parse JSON output, fall back to text
  try {
    return { jobs: JSON.parse(output) };
  } catch {
    // Parse text format
    const lines = output.split('\n').filter(l => l.trim());
    return { jobs: lines, raw: true };
  }
});

ipcMain.handle('cron:add', async (_e, expression: string, command: string) => {
  const result = safeShellExec(`openclaw cron add "${expression}" "${command}"`, 10000);
  return { success: !!result, output: result };
});

ipcMain.handle('cron:remove', async (_e, id: string) => {
  const result = safeShellExec(`openclaw cron remove "${id}"`, 10000);
  return { success: !!result, output: result };
});

// --- Gateway Management ---

ipcMain.handle('gateway:status', async () => {
  const output = safeShellExec('openclaw status', 5000);
  const isRunning = output?.includes('running') || false;
  return { running: isRunning, output };
});

ipcMain.handle('gateway:start', async () => {
  try {
    // Start gateway in background
    const child = runSpawn('openclaw', ['up'], { detached: true, stdio: 'ignore' });
    child.unref();
    // Wait a bit and check
    await sleep(3000);
    const status = safeShellExec('openclaw status', 5000);
    return { success: true, output: status };
  } catch (err) {
    return { success: false, error: String(err) };
  }
});

ipcMain.handle('gateway:stop', async () => {
  const result = safeShellExec('openclaw stop', 10000);
  return { success: true, output: result };
});

ipcMain.handle('gateway:restart', async () => {
  safeShellExec('openclaw stop', 10000);
  await sleep(1000);
  const child = runSpawn('openclaw', ['up'], { detached: true, stdio: 'ignore' });
  child.unref();
  await sleep(3000);
  return { success: true };
});

// --- Log Viewer ---

ipcMain.handle('logs:recent', async () => {
  const output = safeShellExec('openclaw logs --lines 100 2>/dev/null || echo "No logs available"', 10000);
  return { logs: output || 'No logs available' };
});

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

ipcMain.handle('memory:search', async (_e, query: string) => {
  return callMcp('awareness_recall', {
    semantic_query: query,
    detail: 'summary',
    limit: 20,
  });
});

ipcMain.handle('memory:get-cards', async () => {
  return callMcp('awareness_lookup', { type: 'knowledge', limit: 50 });
});

ipcMain.handle('memory:get-tasks', async () => {
  return callMcp('awareness_lookup', { type: 'tasks', limit: 20, status: 'open' });
});

ipcMain.handle('memory:get-context', async () => {
  return callMcp('awareness_lookup', { type: 'context' });
});

ipcMain.handle('memory:get-perception', async () => {
  return callMcp('awareness_lookup', { type: 'perception' });
});

// --- App Lifecycle ---

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
