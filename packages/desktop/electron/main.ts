const electron = require('electron');
const { app, BrowserWindow, ipcMain, shell, Tray, Menu, nativeImage, dialog } = electron;
import path from 'path';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import https from 'https';
import http from 'http';
import crypto from 'crypto';
import { createDoctor } from './doctor';

let mainWindow: typeof BrowserWindow.prototype | null = null;
let tray: typeof Tray.prototype | null = null;
let isQuitting = false;

const isDev = !app.isPackaged;
const HOME = os.homedir();

// --- Bundled Node.js path management ---
// Electron bundles Node.js, but we need a system-accessible node/npm for OpenClaw.
// Strategy: Use system node if available, otherwise auto-install via official installer.

/** Safe shell exec (SYNC) — explicit shell + enhanced PATH + short timeout. Never hangs.
 *  Uses --norc --noprofile to avoid .bashrc errors (e.g. missing cargo/env). */
function safeShellExec(cmd: string, timeoutMs = 5000): string | null {
  try {
    const enhancedPath = getEnhancedPath();
    if (process.platform === 'win32') {
      return execSync(cmd, { encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe', shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath } }).trim();
    }
    return execSync(`/bin/bash --norc --noprofile -c 'export PATH="${enhancedPath}"; ${cmd.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe', env: { ...process.env, PATH: enhancedPath },
    }).trim();
  } catch {
    return null;
  }
}

/** Async shell exec — non-blocking, for hot-path IPC handlers.
 *  Uses --norc --noprofile to avoid .bashrc errors (e.g. missing cargo/env). */
function safeShellExecAsync(cmd: string, timeoutMs = 5000): Promise<string | null> {
  return new Promise(resolve => {
    const enhancedPath = getEnhancedPath();
    const shellCmd = process.platform === 'win32' ? cmd : `export PATH="${enhancedPath}"; ${cmd}`;
    const child = process.platform === 'win32'
      ? spawn(cmd, [], { shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath }, stdio: 'pipe' })
      : spawn('/bin/bash', ['--norc', '--noprofile', '-c', shellCmd], { env: { ...process.env, PATH: enhancedPath }, stdio: 'pipe' });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; child.kill(); resolve(null); } }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.on('close', (code: number | null) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve(code === 0 ? stdout.trim() : null); }
    });
    child.on('error', () => { if (!settled) { settled = true; clearTimeout(timer); resolve(null); } });
  });
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
    // User-specific paths FIRST — they override system defaults
    // (e.g. ~/.npm-global/bin/openclaw@3.28 must beat /usr/local/bin/openclaw@3.13)
    extras.push(
      `${HOME}/.npm-global/bin`, // custom npm prefix — MUST be before /usr/local/bin
      `${HOME}/.local/bin`,
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
    );
    // nvm: detect actual installed version instead of hardcoding
    try {
      const nvmDir = path.join(HOME, '.nvm', 'versions', 'node');
      if (fs.existsSync(nvmDir)) {
        const versions = fs.readdirSync(nvmDir).filter(v => v.startsWith('v')).sort().reverse();
        if (versions.length > 0) extras.push(path.join(nvmDir, versions[0], 'bin'));
      }
    } catch { /* nvm not installed, ignore */ }
    // fnm: fast node manager
    try {
      const fnmDefault = path.join(HOME, '.fnm', 'aliases', 'default', 'bin');
      if (fs.existsSync(fnmDefault)) extras.push(fnmDefault);
    } catch { /* fnm not installed, ignore */ }
    // snap (Linux only)
    if (process.platform === 'linux') {
      extras.push('/snap/bin');
    }
  } else if (process.platform === 'win32') {
    extras.push(
      `${process.env.APPDATA}\\npm`,                      // npm default global
      `${process.env.LOCALAPPDATA}\\pnpm`,                 // pnpm global
      `${process.env.ProgramFiles}\\nodejs`,                // official installer
      `${process.env.ProgramFiles} (x86)\\nodejs`,          // 32-bit
      `${process.env.LOCALAPPDATA}\\fnm_multishells`,       // fnm on Windows
    );
  }

  return [...extras, base].join(path.delimiter);
}

function getBundledNpmBin(binName: 'npx' | 'npm') {
  const candidates = [
    path.join(app.getPath('exe'), '..', '..', 'resources', 'app.asar.unpacked', 'node_modules', 'npm', 'bin', `${binName}-cli.js`),
    path.join(app.getAppPath(), 'node_modules', 'npm', 'bin', `${binName}-cli.js`),
    path.join(__dirname, '..', 'node_modules', 'npm', 'bin', `${binName}-cli.js`),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function resolveBundledCache(fileName: string) {
  const candidates = [
    path.join(app.getPath('exe'), '..', '..', 'resources', 'app.asar.unpacked', 'cache', fileName),
    path.join(app.getAppPath(), 'cache', fileName),
    path.join(__dirname, '..', 'cache', fileName),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

function requestLocalDaemon(pathname: string, method: 'GET' | 'POST' = 'GET', timeoutMs = 2000): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: 37800,
      path: pathname,
      method,
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ statusCode: res.statusCode || 0, body }));
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Local daemon request timed out'));
    });
    req.end();
  });
}

async function getLocalDaemonHealth(timeoutMs = 2000): Promise<any | null> {
  try {
    const response = await requestLocalDaemon('/healthz', 'GET', timeoutMs);
    if (response.statusCode !== 200 || !response.body) return null;
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}

async function shutdownLocalDaemon(timeoutMs = 3000): Promise<boolean> {
  try {
    const response = await requestLocalDaemon('/shutdown', 'POST', timeoutMs);
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}

/** Run a command with enhanced PATH and explicit shell (critical for packaged Electron).
 *  Uses --norc --noprofile on macOS/Linux to avoid .bashrc errors. */
function run(cmd: string, opts: Record<string, unknown> = {}): string {
  const enhancedPath = getEnhancedPath();
  if (process.platform === 'win32') {
    return execSync(cmd, { encoding: 'utf8', timeout: 180000, stdio: 'pipe', shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath }, ...opts } as any);
  }
  return execSync(`/bin/bash --norc --noprofile -c 'export PATH="${enhancedPath}"; ${cmd.replace(/'/g, "'\\''")}'`, {
    encoding: 'utf8', timeout: 180000, stdio: 'pipe', env: { ...process.env, PATH: enhancedPath }, ...opts,
  } as any);
}

function runSpawn(cmd: string, args: string[], opts: Record<string, unknown> = {}) {
  const tryBundledNpx = () => {
    const npxCli = getBundledNpmBin('npx');
    if (!npxCli) return null;
    return spawn(process.execPath, [npxCli, ...args], {
      env: { ...process.env, PATH: getEnhancedPath() },
      ...opts,
    });
  };

  if (cmd === 'npx') {
    try {
      return spawn(cmd, args, {
        env: { ...process.env, PATH: getEnhancedPath() },
        ...opts,
      });
    } catch (err: any) {
      if (err?.code === 'ENOENT') {
        const child = tryBundledNpx();
        if (child) return child;
      }
      throw err;
    }
  }

  return spawn(cmd, args, {
    env: { ...process.env, PATH: getEnhancedPath() },
    ...opts,
  });
}

/** Async version of run() — for IPC handlers. Never blocks the main thread.
 *  Uses --norc --noprofile to avoid .bashrc errors (e.g. missing cargo/env). */
function runAsync(cmd: string, timeoutMs = 180000): Promise<string> {
  return new Promise((resolve, reject) => {
    const enhancedPath = getEnhancedPath();
    const rewriteNpx = (c: string) => {
      if (!c.trim().startsWith('npx ')) return c;
      const npxCli = getBundledNpmBin('npx');
      if (!npxCli) return c;
      const rest = c.trim().slice(4); // remove leading 'npx '
      return `${process.execPath} "${npxCli}" ${rest}`;
    };

    const shellCmdRaw = process.platform === 'win32' ? cmd : `export PATH="${enhancedPath}"; ${cmd}`;
    const shellCmd = rewriteNpx(shellCmdRaw);
    const child = process.platform === 'win32'
      ? spawn(cmd, [], { shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath }, stdio: 'pipe' })
      : spawn('/bin/bash', ['--norc', '--noprofile', '-c', shellCmd], { env: { ...process.env, PATH: enhancedPath }, stdio: 'pipe' });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; child.kill(); reject(new Error('Command timed out')); }
    }, timeoutMs);
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code: number | null) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(stderr.trim() || `Exit code ${code}`));
      }
    });
    child.on('error', (err: Error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(err); }
    });
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

  // On macOS, hide to tray instead of quitting when closing window
  // But allow actual quit when isQuitting is set (from tray Quit or Cmd+Q)
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
      const ep = getEnhancedPath();
      if (process.platform === 'win32') {
        return execSync(cmd, { encoding: 'utf8', timeout: 5000, stdio: 'pipe', shell: 'cmd.exe', env: { ...process.env, PATH: ep } }).trim();
      }
      return execSync(`/bin/bash --norc --noprofile -c 'export PATH="${ep}"; ${cmd.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf8', timeout: 5000, stdio: 'pipe', env: { ...process.env, PATH: ep },
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

  // Check Awareness plugin version
  try {
    const pluginPkg = path.join(HOME, '.openclaw', 'extensions', 'openclaw-memory', 'package.json');
    if (fs.existsSync(pluginPkg)) {
      const pkg = JSON.parse(fs.readFileSync(pluginPkg, 'utf8'));
      result.awarenessPluginVersion = pkg.version || null;
    }
  } catch { /* ignore */ }

  // Check local daemon status via Node-native HTTP to avoid curl/platform differences
  const health = await getLocalDaemonHealth(2000);
  if (health) {
    result.daemonRunning = health.status === 'ok';
    result.daemonVersion = health.version || null;
    result.daemonStats = { memories: health.stats?.totalMemories, knowledge: health.stats?.totalKnowledge, sessions: health.stats?.totalSessions };
  } else {
    result.daemonRunning = false;
  }

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
        await runAsync('winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements', 300000);
        return { success: true, method: 'winget' };
      } catch {
        const msiUrl = 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi';
        const msiPath = path.join(os.tmpdir(), 'node-installer.msi');
        await downloadFile(msiUrl, msiPath);
        await runAsync(`msiexec /i "${msiPath}" /qn`, 300000);
        return { success: true, method: 'msi' };
      }
    } else if (process.platform === 'darwin') {
      const hasBrew = await safeShellExecAsync('brew --version') !== null;
      if (hasBrew) {
        try {
          await runAsync('brew install node@22', 300000);
          return { success: true, method: 'homebrew' };
        } catch { /* fall through to pkg */ }
      }
      const pkgUrl = 'https://nodejs.org/dist/v22.12.0/node-v22.12.0.pkg';
      const pkgPath = path.join(os.tmpdir(), 'node-installer.pkg');
      await downloadFile(pkgUrl, pkgPath);
      await runAsync(`open "${pkgPath}"`, 10000);
      for (let i = 0; i < 120; i++) {
        await sleep(2000);
        if (getNodeVersion()) return { success: true, method: 'pkg-gui' };
      }
      return { success: false, error: 'Node.js installation timed out' };
    } else {
      // Linux: try pkexec (GUI password prompt) first, fallback to sudo, then manual hint
      const sudoCmd = fs.existsSync('/usr/bin/pkexec') ? 'pkexec' : 'sudo';
      try {
        await runAsync(`curl -fsSL https://deb.nodesource.com/setup_22.x | ${sudoCmd} -E bash - && ${sudoCmd} apt-get install -y nodejs`, 300000);
        return { success: true, method: 'nodesource-deb' };
      } catch {
        try {
          await runAsync(`curl -fsSL https://rpm.nodesource.com/setup_22.x | ${sudoCmd} bash - && ${sudoCmd} dnf install -y nodejs`, 300000);
          return { success: true, method: 'nodesource-rpm' };
        } catch (err) {
          return {
            success: false,
            error: String(err),
            hint: 'Linux requires admin privileges. Please run in terminal:\n  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -\n  sudo apt-get install -y nodejs',
          };
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
  const existing = await safeShellExecAsync('openclaw --version');
  if (existing) {
    return { success: true, alreadyInstalled: true, version: existing };
  }

  // Detect package manager preference
  const hasPnpm = await safeShellExecAsync('pnpm --version', 3000);
  const hasYarn = !hasPnpm ? await safeShellExecAsync('yarn --version', 3000) : null;
  const pmBase = hasPnpm ? 'pnpm add -g' : hasYarn ? 'yarn global add' : 'npm install -g';
  const registries = ['', '--registry=https://registry.npmmirror.com'];

  for (const reg of registries) {
    try {
      await runAsync(`${pmBase} openclaw ${reg}`.trim(), 90000);
      return { success: true };
    } catch { continue; }
  }

  try {
    if (process.platform === 'win32') {
      await runAsync('powershell -Command "irm https://openclaw.ai/install.ps1 | iex"', 120000);
    } else {
      await runAsync('curl -fsSL https://openclaw.ai/install.sh | bash', 120000);
    }
    return { success: true, method: 'official-script' };
  } catch (err) {
    return { success: false, error: String(err), hint: 'Install OpenClaw manually: npm install -g openclaw' };
  }
});

/**
 * Step 3: Install Awareness memory plugin
 * Must check if openclaw exists first; use short timeouts to avoid UI freeze.
 */
ipcMain.handle('setup:install-plugin', async () => {
  const hasOpenClaw = await safeShellExecAsync('openclaw --version') !== null;
  const npmCli = getBundledNpmBin('npm');
  const pluginTarball = resolveBundledCache('awareness-memory.tgz');

  if (hasOpenClaw) {
    try {
      await runAsync('openclaw plugins install @awareness-sdk/openclaw-memory', 60000);
      return { success: true, method: 'openclaw-plugin' };
    } catch { /* fall through to clawhub */ }
  }

  try {
    if (pluginTarball && npmCli) {
      await runAsync(`${process.execPath} "${npmCli}" exec --yes ${pluginTarball} install awareness-memory --force`, 60000);
      return { success: true, method: 'clawhub-offline' };
    }

    await runAsync('npx -y clawhub@latest install awareness-memory --force', 60000);
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

  // Helper: fallback to bundled npm-cli (packs with the app) to avoid missing system npx
  const startDaemonViaBundledNpm = async () => {
      const npmCli = getBundledNpmBin('npm');
    if (!npmCli) throw new Error('Bundled npm not found');

      const offlineTarball = resolveBundledCache('awareness-sdk-local.tgz');
      const execArgs = offlineTarball
        ? ['exec', '--yes', offlineTarball, 'start', '--project', HOME]
        : ['exec', '--yes', '@awareness-sdk/local', 'start', '--project', HOME];

      const child = spawn(process.execPath, [npmCli, ...execArgs], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PATH: getEnhancedPath() },
    });
    child.unref();
  };

  // Start daemon
  // IMPORTANT: pass --project to avoid cwd=/ in packaged Electron (ENOENT: mkdir '/.awareness')
  const startWithNpx = () => new Promise<void>((resolve, reject) => {
    const child = runSpawn('npx', ['@awareness-sdk/local', 'start', '--project', HOME], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', reject);
    child.unref();
    resolve();
  });

  try {
    await startWithNpx();
  } catch (err: any) {
    if (err?.code === 'ENOENT') {
      // System npx missing — fall back to bundled npm exec
      try {
        await startDaemonViaBundledNpm();
      } catch (fallbackErr) {
        return { success: false, error: 'Node/npm not found. Please install Node.js 22+ and reopen AwarenessClaw.' };
      }
    } else {
      return { success: false, error: String(err) };
    }
  }

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

  const merged = mergeOpenClawConfig(existing, config as Record<string, any>);

  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return { success: true };
});

/**
 * Check for updates — compare installed vs npm latest versions
 */
ipcMain.handle('app:check-updates', async () => {
  const updates: any[] = [];

  // Check OpenClaw version (async — non-blocking)
  // `openclaw --version` returns "OpenClaw 2026.3.28 (f9b1079)" — extract semver before commit hash
  const currentOC = await safeShellExecAsync('openclaw --version');
  if (currentOC) {
    const versionMatch = currentOC.match(/(\d+\.\d+\.\d+)/);
    const current = versionMatch ? versionMatch[1] : null;
    if (current) {
      const latestOC = await safeShellExecAsync('npm view openclaw version', 10000);
      if (latestOC && latestOC.trim() !== current) {
        updates.push({
          component: 'openclaw',
          label: 'OpenClaw',
          currentVersion: current,
          latestVersion: latestOC.trim(),
        });
      }
    }
  }

  // Check Awareness plugin version — check OpenClaw extensions dir (actual installed location)
  try {
    let installedVersion: string | null = null;

    // 1. Check OpenClaw extensions dir (the real installed plugin)
    const extPkgPath = path.join(HOME, '.openclaw', 'extensions', 'openclaw-memory', 'package.json');
    if (fs.existsSync(extPkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'));
        installedVersion = pkg?.version || null;
      } catch { /* corrupted package.json */ }
    }

    // 2. Fallback to ClawHub lock.json
    if (!installedVersion) {
      const lockPath = path.join(HOME, '.openclaw', 'workspace', '.clawhub', 'lock.json');
      if (fs.existsSync(lockPath)) {
        const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        installedVersion = lock?.skills?.['awareness-memory']?.version || null;
      }
    }

    if (installedVersion) {
      const latestPlugin = await safeShellExecAsync('npm view @awareness-sdk/openclaw-memory version', 10000);
      if (latestPlugin && latestPlugin.trim() !== installedVersion) {
        updates.push({
          component: 'plugin',
          label: 'Awareness Memory Plugin',
          currentVersion: installedVersion,
          latestVersion: latestPlugin.trim(),
        });
      }
    }
  } catch { /* ignore plugin check errors */ }

  // Check local daemon (@awareness-sdk/local) version
  try {
    const health = await getLocalDaemonHealth(2000);
    const daemonCurrent = health?.version;
    if (daemonCurrent) {
      const latestDaemon = await safeShellExecAsync('npm view @awareness-sdk/local version', 10000);
      if (latestDaemon && latestDaemon.trim() !== daemonCurrent) {
        updates.push({
          component: 'daemon',
          label: 'Awareness Local Daemon',
          currentVersion: daemonCurrent,
          latestVersion: latestDaemon.trim(),
        });
      }
    }
  } catch { /* daemon not running or check failed */ }

  return { updates };
});

ipcMain.handle('app:upgrade-component', async (_e, component: string) => {
  try {
    if (component === 'openclaw') {
      // Record pre-upgrade version for rollback verification
      const preVer = await safeShellExecAsync('openclaw --version', 5000);
      const preMatch = preVer?.match(/(\d+\.\d+\.\d+)/);
      const preSemver = preMatch ? preMatch[1] : null;

      // Detect package manager (pnpm > yarn > npm)
      const hasPnpm = await safeShellExecAsync('pnpm --version', 3000);
      const hasYarn = !hasPnpm ? await safeShellExecAsync('yarn --version', 3000) : null;
      const installCmd = hasPnpm ? 'pnpm add -g openclaw@latest'
        : hasYarn ? 'yarn global add openclaw@latest'
        : 'npm install -g openclaw@latest';

      // Pre-check: verify npm/pnpm global prefix is writable
      const prefixCmd = hasPnpm ? 'pnpm config get global-bin-dir' : 'npm config get prefix';
      const prefix = await safeShellExecAsync(prefixCmd, 5000);
      if (prefix && !hasPnpm) {
        try {
          fs.accessSync(prefix.trim(), fs.constants.W_OK);
        } catch {
          // Fallback: try npx (no global install needed)
          try {
            await runAsync('npx openclaw@latest --version', 30000);
            return {
              success: true,
              version: 'latest (via npx)',
              hint: `npm global dir not writable. Using npx fallback. To fix permanently:\n  npm config set prefix ~/.npm-global`,
            };
          } catch { /* npx also failed, report the original permission error */ }
          return {
            success: false,
            error: `npm global directory (${prefix.trim()}) is not writable. Run this in terminal:\n  npm config set prefix ~/.npm-global\n  export PATH=~/.npm-global/bin:$PATH`,
          };
        }
      }

      await runAsync(installCmd, 120000);
      const newVer = await safeShellExecAsync('openclaw --version');
      const vMatch = newVer?.match(/(\d+\.\d+\.\d+)/);
      const newSemver = vMatch ? vMatch[1] : newVer?.trim();

      // Post-upgrade: verify openclaw still works (catch broken upgrades)
      if (!newSemver) {
        return {
          success: false,
          error: `Upgrade may have failed — openclaw not responding after install. Previous version: ${preSemver || 'unknown'}`,
        };
      }

      return { success: true, version: newSemver, previousVersion: preSemver };
    } else if (component === 'plugin') {
      // Remove old extension first to avoid "plugin already exists" error
      const extDir = path.join(HOME, '.openclaw', 'extensions', 'openclaw-memory');
      if (fs.existsSync(extDir)) {
        fs.rmSync(extDir, { recursive: true, force: true });
      }
      // Use openclaw plugins install as primary method
      try {
        await runAsync('openclaw plugins install @awareness-sdk/openclaw-memory', 90000);
        return { success: true, method: 'openclaw-plugin' };
      } catch {
        // Fallback: clawhub install (installs to ClawHub skills dir, not extensions)
        try {
          await runAsync('npx -y clawhub@latest install awareness-memory --force', 90000);
          return { success: true, method: 'clawhub' };
        } catch (e: any) {
          throw new Error(`Plugin upgrade failed: ${e.message?.slice(0, 200)}`);
        }
      }
    } else if (component === 'daemon') {
      // Stop existing daemon, then restart with latest via npx
      // The daemon runs via npx (not global install), so we just need to restart with @latest
      await shutdownLocalDaemon(3000);
      await new Promise(r => setTimeout(r, 1000));
      // Start new version — npx will fetch latest
      // IMPORTANT: Must pass --project to avoid cwd=/ in packaged Electron (ENOENT: mkdir '/.awareness')
      const projectDir = HOME;
      await runAsync(`npx -y @awareness-sdk/local@latest start --port 37800 --project "${projectDir}" --background`, 30000);
      // Verify new version
      await new Promise(r => setTimeout(r, 2000));
      const health = await getLocalDaemonHealth(3000);
      if (health?.version) return { success: true, version: health.version };
      return { success: true, version: 'latest' };
    }
    return { success: false, error: 'Unknown component' };
  } catch (err: any) {
    console.error(`[upgrade] ${component} failed:`, err.message);
    const msg = err.message || '';
    // Detect permission errors and provide friendly guidance
    if (msg.includes('EACCES') || msg.includes('permission denied') || msg.includes('Permission denied')) {
      return {
        success: false,
        error: 'Permission denied. Run this in terminal to fix:\n  npm config set prefix ~/.npm-global\n  export PATH=~/.npm-global/bin:$PATH',
      };
    }
    return { success: false, error: msg.slice(0, 300) };
  }
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
  const result = await safeShellExecAsync('openclaw doctor --fix 2>&1', 30000);
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
 * Read full provider + model list from openclaw.json (for dynamic model selector)
 */
ipcMain.handle('models:read-providers', async () => {
  const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const providers = config?.models?.providers || {};
    const primaryModel = config?.agents?.defaults?.model?.primary || '';

    // Convert openclaw.json provider format → UI-friendly format
    const result: Array<{
      key: string;
      baseUrl: string;
      apiType?: string;
      hasApiKey: boolean;
      models: Array<{ id: string; name: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }>;
    }> = [];

    for (const [key, prov] of Object.entries(providers) as [string, any][]) {
      result.push({
        key,
        baseUrl: prov.baseUrl || '',
        apiType: prov.api,
        hasApiKey: !!prov.apiKey,
        models: (prov.models || []).map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          reasoning: m.reasoning,
          contextWindow: m.contextWindow,
          maxTokens: m.maxTokens,
        })),
      });
    }

    return { success: true, providers: result, primaryModel };
  } catch {
    return { success: false, providers: [], primaryModel: '' };
  }
});

/**
 * Security audit: check openclaw.json file permissions + extension allowlist
 */
ipcMain.handle('security:check', async () => {
  const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
  const issues: Array<{ level: 'warning' | 'info'; message: string; fix?: string }> = [];

  // Check file permissions / ACLs
  if (process.platform === 'win32') {
    try {
      const acl = safeShellExec(`icacls "${configPath}"`, 5000);
      if (acl) {
        const broadAccess = /(Everyone|BUILTIN\\Users|Users):\([^\n]*[FMW]/i.test(acl);
        if (broadAccess) {
          issues.push({
            level: 'warning',
            message: 'openclaw.json appears accessible to broad Windows user groups',
            fix: 'Restrict the file so only your current Windows account can read and modify it.',
          });
        }
      }
    } catch { /* ignore if icacls is unavailable */ }
  } else {
    try {
      const stat = fs.statSync(configPath);
      const mode = (stat.mode & 0o777).toString(8);
      if (mode !== '600') {
        issues.push({
          level: 'warning',
          message: `openclaw.json permissions are ${mode} (should be 600)`,
          fix: `chmod 600 ~/.openclaw/openclaw.json`,
        });
      }
    } catch { /* file doesn't exist yet */ }
  }

  // Check if tools.alsoAllow is too permissive
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(raw);
    const alsoAllow = config?.tools?.alsoAllow || [];
    if (alsoAllow.includes('*') || alsoAllow.length > 20) {
      issues.push({
        level: 'warning',
        message: `tools.alsoAllow has ${alsoAllow.length} entries (broad permissions)`,
      });
    }
    // Check extensions directory for unknown plugins
    const extDir = path.join(HOME, '.openclaw', 'extensions');
    if (fs.existsSync(extDir)) {
      const exts = fs.readdirSync(extDir).filter(d => !d.startsWith('.'));
      const knownExtensions = ['openclaw-memory'];
      const unknown = exts.filter(e => !knownExtensions.includes(e));
      if (unknown.length > 0) {
        issues.push({
          level: 'info',
          message: `${unknown.length} third-party extension(s): ${unknown.join(', ')}`,
        });
      }
    }
  } catch { /* ignore */ }

  // Check offline bundles for manifest and checksum coverage
  try {
    const cacheDirCandidates = [
      path.join(app.getPath('exe'), '..', '..', 'resources', 'app.asar.unpacked', 'cache'),
      path.join(app.getAppPath(), 'cache'),
      path.join(__dirname, '..', 'cache'),
    ];
    const cacheDir = cacheDirCandidates.find((dir) => fs.existsSync(dir));
    if (cacheDir) {
      const manifestPath = path.join(cacheDir, 'manifest.json');
      const bundleNames = ['awareness-sdk-local.tgz', 'awareness-memory.tgz'];
      const presentBundles = bundleNames.filter((name) => fs.existsSync(path.join(cacheDir, name)));

      if (presentBundles.length > 0 && !fs.existsSync(manifestPath)) {
        issues.push({
          level: 'warning',
          message: 'Offline bundles are missing manifest.json version metadata',
          fix: 'Ship cache/manifest.json with version and checksum entries for every offline bundle.',
        });
      }

      for (const bundleName of presentBundles) {
        const bundlePath = path.join(cacheDir, bundleName);
        const checksumPath = `${bundlePath}.sha256`;
        if (!fs.existsSync(checksumPath)) {
          issues.push({
            level: 'warning',
            message: `Offline bundle ${bundleName} has no SHA256 checksum file`,
            fix: `Add ${bundleName}.sha256 so packaged bundles can be verified before use.`,
          });
          continue;
        }

        const expected = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]?.toLowerCase();
        const actual = computeSha256(bundlePath).toLowerCase();
        if (!expected || expected !== actual) {
          issues.push({
            level: 'warning',
            message: `Offline bundle ${bundleName} failed checksum verification`,
            fix: 'Rebuild the offline bundle and regenerate its .sha256 file before release.',
          });
        }
      }
    }
  } catch { /* ignore cache audit errors */ }

  // Upgrade rollback readiness
  const rollbackDir = path.join(HOME, '.openclaw', '.upgrade-backups');
  if (!fs.existsSync(rollbackDir)) {
    issues.push({
      level: 'info',
      message: 'No local upgrade rollback snapshots found yet',
      fix: 'Keep the previous installer until automatic rollback snapshots are implemented for all components.',
    });
  }

  return { issues };
});

// --- Agents Management ---

ipcMain.handle('agents:list', async () => {
  try {
    const output = await safeShellExecAsync('openclaw agents list --json --bindings', 8000);
    if (output) {
      try {
        const parsed = JSON.parse(output);
        // Handle multiple known JSON schemas:
        // - array directly: [{id, name, ...}]
        // - {agents: [...]}
        // - {data: [...]}
        // - single object (wrapped in array)
        let list: any[] = [];
        if (Array.isArray(parsed)) {
          list = parsed;
        } else if (Array.isArray(parsed.agents)) {
          list = parsed.agents;
        } else if (Array.isArray(parsed.data)) {
          list = parsed.data;
        } else if (parsed && typeof parsed === 'object' && (parsed.id || parsed.name)) {
          list = [parsed]; // single agent object
        }
        if (list.length > 0) {
          const agents = list.map((a: any) => ({
            id: a.id || a.name || 'main',
            name: a.identityName || a.displayName || a.name || a.id,
            emoji: a.identityEmoji || a.emoji || '🤖',
            model: a.model || a.defaultModel || null,
            bindings: Array.isArray(a.bindingDetails) ? a.bindingDetails : Array.isArray(a.bindings) ? a.bindings : [],
            isDefault: a.isDefault === true || a.default === true || a.id === 'main',
            workspace: a.workspace || a.workspacePath || null,
            routes: a.routes || a.channels || [],
          }));
          return { success: true, agents };
        }
      } catch { /* parse failed, fall through to fallback */ }
    }
    // Fallback: default agent
    return { success: true, agents: [{ id: 'main', name: 'Main Agent', emoji: '🦞', isDefault: true, bindings: [] }] };
  } catch {
    return { success: true, agents: [{ id: 'main', name: 'Main Agent', emoji: '🦞', isDefault: true, bindings: [] }] };
  }
});

ipcMain.handle('agents:add', async (_e, name: string, model?: string, systemPrompt?: string) => {
  try {
    // Ensure Gateway is running (agents need it)
    await ensureGatewayRunning();
    // Ensure base directories exist
    const baseWsDir = path.join(HOME, '.openclaw', 'workspaces');
    const baseAgentsDir = path.join(HOME, '.openclaw', 'agents');
    fs.mkdirSync(baseWsDir, { recursive: true });
    fs.mkdirSync(baseAgentsDir, { recursive: true });
    // Use independent workspace dir (not inside agents/ state dir)
    const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const wsDir = path.join(baseWsDir, slug);
    fs.mkdirSync(wsDir, { recursive: true });
    const flags = [`--non-interactive`, `--workspace "${wsDir}"`];
    if (model) flags.push(`--model "${model.replace(/"/g, '\\"')}"`);
    await runAsync(`openclaw agents add "${name.replace(/"/g, '\\"')}" ${flags.join(' ')}`, 15000);
    // Write SOUL.md if system prompt provided
    if (systemPrompt) {
      const agentDir = path.join(baseAgentsDir, slug, 'agent');
      fs.mkdirSync(agentDir, { recursive: true });
      fs.writeFileSync(path.join(wsDir, 'SOUL.md'), systemPrompt, 'utf-8');
      // Also write to agent dir as fallback
      fs.writeFileSync(path.join(agentDir, 'SOUL.md'), systemPrompt, 'utf-8');
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) };
  }
});

ipcMain.handle('agents:delete', async (_e, agentId: string) => {
  if (agentId === 'main') return { success: false, error: 'Cannot delete default agent' };
  try {
    const output = await runAsync(`openclaw agents delete "${agentId.replace(/"/g, '\\"')}" --force --json 2>&1`, 10000);
    return { success: true, output };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) };
  }
});

ipcMain.handle('agents:set-identity', async (_e, agentId: string, name: string, emoji: string, avatar?: string, theme?: string) => {
  try {
    const flags: string[] = [];
    if (name) flags.push(`--name "${name.replace(/"/g, '\\"')}"`);
    if (emoji) flags.push(`--emoji "${emoji}"`);
    if (avatar) flags.push(`--avatar "${avatar.replace(/"/g, '\\"')}"`);
    if (theme) flags.push(`--theme "${theme}"`);
    if (flags.length === 0) return { success: false, error: 'No changes' };
    await runAsync(`openclaw agents set-identity --agent "${agentId}" ${flags.join(' ')}`, 10000);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) };
  }
});

ipcMain.handle('agents:bind', async (_e, agentId: string, binding: string) => {
  try {
    await runAsync(`openclaw agents bind --agent "${agentId}" --bind "${binding.replace(/"/g, '\\"')}"`, 10000);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) };
  }
});

ipcMain.handle('agents:unbind', async (_e, agentId: string, binding: string) => {
  try {
    await runAsync(`openclaw agents unbind --agent "${agentId}" --bind "${binding.replace(/"/g, '\\"')}"`, 10000);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) };
  }
});

// --- Agent Workspace File Management ---

ipcMain.handle('agents:read-file', async (_e, agentId: string, fileName: string) => {
  // Read a workspace file (SOUL.md, TOOLS.md, IDENTITY.md, USER.md, MEMORY.md) for an agent
  const allowedFiles = ['SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md'];
  if (!allowedFiles.includes(fileName)) return { success: false, error: 'File not allowed' };
  try {
    // Try agent workspace dir first, then agent state dir
    const slug = agentId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    const candidates = [
      path.join(HOME, '.openclaw', 'workspaces', slug, fileName),
      path.join(HOME, '.openclaw', 'agents', slug, 'agent', fileName),
      // Default agent uses the global workspace
      path.join(HOME, '.openclaw', 'workspace', fileName),
    ];
    for (const fp of candidates) {
      if (fs.existsSync(fp)) {
        return { success: true, content: fs.readFileSync(fp, 'utf-8'), path: fp };
      }
    }
    return { success: true, content: '', path: candidates[0] }; // Empty = file doesn't exist yet
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) };
  }
});

ipcMain.handle('agents:write-file', async (_e, agentId: string, fileName: string, content: string) => {
  const allowedFiles = ['SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md'];
  if (!allowedFiles.includes(fileName)) return { success: false, error: 'File not allowed' };
  try {
    const slug = agentId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    // Write to both workspace and agent dir to ensure it's picked up
    const wsDir = path.join(HOME, '.openclaw', 'workspaces', slug);
    const agentDir = path.join(HOME, '.openclaw', 'agents', slug, 'agent');
    const globalWs = path.join(HOME, '.openclaw', 'workspace');
    // For default agent, use global workspace
    const isDefault = agentId === 'main' || agentId === 'default';
    const targets = isDefault
      ? [globalWs]
      : [wsDir, agentDir];
    for (const dir of targets) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 200) };
  }
});

/**
 * Get OpenClaw dashboard URL with auth token
 */
ipcMain.handle('app:get-dashboard-url', async () => {
  const output = await safeShellExecAsync('openclaw dashboard --no-open', 10000);
  if (!output) return { url: null };

  // Try multiple patterns — OpenClaw may change the label text across versions
  const patterns = [
    /Dashboard URL:\s*(http[^\s]+)/i,
    /dashboard:\s*(http[^\s]+)/i,
    /url:\s*(http[^\s]+)/i,
    /(http:\/\/localhost:\d+[^\s]*)/,   // any localhost URL as fallback
  ];
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) return { url: match[1] };
  }

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

const REDACTED_VALUE = '__REDACTED__';

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
      if (incomingPlugins.allow) merged.plugins.allow = incomingPlugins.allow;
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
    } else if (key === 'tools') {
      merged.tools = JSON.parse(JSON.stringify(merged.tools || {}));
      const incomingTools = value as any;
      if (incomingTools.alsoAllow) {
        const existingAllow = new Set(merged.tools.alsoAllow || []);
        for (const tool of incomingTools.alsoAllow) existingAllow.add(tool);
        merged.tools.alsoAllow = [...existingAllow];
      }
      if (incomingTools.denied) merged.tools.denied = incomingTools.denied;
      if (incomingTools.profile) merged.tools.profile = incomingTools.profile;
    } else {
      merged[key] = value;
    }
  }

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

/**
 * Ensure Gateway is running before sending chat messages.
 * Auto-starts if stopped. Returns true if gateway is ready.
 */
async function ensureGatewayRunning(): Promise<boolean> {
  try {
    const status = await safeShellExecAsync('openclaw status 2>/dev/null', 5000);
    if (status?.includes('running')) return true;
    // Gateway not running — auto-start it
    const send = (ch: string, data: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ch, data);
    };
    send('chat:status', { type: 'gateway', message: 'Starting Gateway...' });
    const child = runSpawn('openclaw', ['up'], { detached: true, stdio: 'ignore' });
    child.unref();
    // Poll until gateway is ready (max 10s)
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const check = await safeShellExecAsync('openclaw status 2>/dev/null', 3000);
      if (check?.includes('running')) {
        send('chat:status', { type: 'gateway', message: 'Gateway started' });
        return true;
      }
    }
    send('chat:status', { type: 'gateway', message: 'Gateway failed to start' });
    return false;
  } catch {
    return false;
  }
}

/**
 * Chat via `openclaw agent -m "..." --json`
 * Non-interactive, one message at a time, returns JSON response.
 * Streaming: read stdout line by line as response comes in.
 */
ipcMain.handle('chat:send', async (_e, message: string, sessionId?: string, options?: { thinkingLevel?: string; model?: string; files?: string[] }) => {
  // Auto-start Gateway if not running (users should never need to manually start it)
  const gatewayReady = await ensureGatewayRunning();
  if (!gatewayReady) {
    return { text: '', error: 'Gateway failed to start. Please check Settings → Gateway and try again.' };
  }

  return new Promise((resolve) => {
    let stdout = '';
    const sid = sessionId || `ac-${Date.now()}`;
    const escapedMsg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
    // Use --verbose on to get thinking/tool status events
    const thinkingFlag = options?.thinkingLevel && options.thinkingLevel !== 'off'
      ? ` --thinking ${options.thinkingLevel}` : '';
    // Note: openclaw agent does NOT support --model flag.
    // Model is configured in openclaw.json → agents.defaults.model (synced by store.ts syncToOpenClaw).
    // File attachments: openclaw agent does not have --files flag either.
    // Files are passed by prepending file context to the message.
    // Images get a special hint so the agent knows to analyze visually.
    let fullMsg = escapedMsg;
    if (options?.files && options.files.length > 0) {
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
      const images: string[] = [];
      const others: string[] = [];
      for (const f of options.files) {
        const ext = path.extname(f).toLowerCase();
        (imageExts.includes(ext) ? images : others).push(f.replace(/"/g, '\\"'));
      }
      const parts: string[] = [];
      if (images.length > 0) parts.push(`[Images to analyze: ${images.join(', ')}] (use exec tool to read or describe these image files)`);
      if (others.length > 0) parts.push(`[Attached files: ${others.join(', ')}]`);
      fullMsg = `${parts.join('\\n')}\\n\\n${escapedMsg}`;
    }
    const cmd = `openclaw agent --local --session-id "${sid}" -m "${fullMsg}" --verbose on${thinkingFlag}`;
    const enhancedPath = getEnhancedPath();

    const child = process.platform === 'win32'
      ? spawn(cmd, [], {
        cwd: os.homedir(),
        shell: 'cmd.exe',
        env: { ...process.env, PATH: enhancedPath },
      })
      : spawn('/bin/bash', ['--norc', '--noprofile', '-c',
        `export PATH="${enhancedPath}"; ${cmd}`
      ], {
        cwd: os.homedir(),
        env: { ...process.env, PATH: enhancedPath },
      });

    const send = (channel: string, data: any) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, data);
    };

    // Line buffer for handling partial lines across chunks
    let lineBuffer = '';

    const isNoiseLine = (line: string) => {
      const t = line.trimStart();
      return t.startsWith('[plugins]') || t.startsWith('[tools]') ||
        t.startsWith('[agent/') || t.startsWith('[agents/') ||
        t.startsWith('[diagnostic]') ||
        t.startsWith('Registered plugin') || t.startsWith('[context-diag]') ||
        t.startsWith('[tool]') || t.startsWith('[tool update]') ||
        t.startsWith('[permission') || t.startsWith('[info]') ||
        t.startsWith('[warn]') || t.startsWith('[error]') ||
        t.startsWith('[acp-client]') || t.startsWith('[commands]') ||
        t.startsWith('[reload]') || t.startsWith('Config warnings');
    };

    const parseStatusLine = (t: string) => {
      // Agent lifecycle
      if (t.includes('run agent start')) {
        send('chat:status', { type: 'thinking' });
        return;
      }
      if (t.includes('run agent end') && t.includes('isError=false')) {
        send('chat:status', { type: 'generating' });
        return;
      }
      if (t.includes('run agent end') && t.includes('isError=true')) {
        send('chat:status', { type: 'error' });
        return;
      }

      // Tool call events: [tool] <title> (<status>)
      const toolMatch = t.match(/^\[tool\]\s+(.+?)\s+\((\w+)\)$/);
      if (toolMatch) {
        send('chat:status', { type: 'tool_call', tool: toolMatch[1], toolStatus: toolMatch[2] });
        return;
      }
      // Embedded agent tool events: [agent/embedded] embedded run tool start/end: ... tool=<name> toolCallId=<id>
      const embeddedToolStart = t.match(/embedded run tool start:.*tool=(\w+)\s+toolCallId=(\S+)/);
      if (embeddedToolStart) {
        send('chat:status', { type: 'tool_call', tool: embeddedToolStart[1], toolStatus: 'running', toolId: embeddedToolStart[2] });
        return;
      }
      const embeddedToolEnd = t.match(/embedded run tool end:.*tool=(\w+)\s+toolCallId=(\S+)/);
      if (embeddedToolEnd) {
        send('chat:status', { type: 'tool_update', toolId: embeddedToolEnd[2], toolStatus: 'completed' });
        return;
      }
      // Tool update: [tool update] <id>: <status>
      const toolUpdateMatch = t.match(/^\[tool update\]\s+(.+?):\s+(.+)$/);
      if (toolUpdateMatch) {
        send('chat:status', { type: 'tool_update', toolId: toolUpdateMatch[1], toolStatus: toolUpdateMatch[2] });
        return;
      }
      // Permission: [permission auto-approved] <tool> (<kind>)
      const permMatch = t.match(/^\[permission (?:auto-approved|approved)\]\s+(.+?)(?:\s+\(.+\))?$/);
      if (permMatch) {
        send('chat:status', { type: 'tool_call', tool: permMatch[1], toolStatus: 'approved' });
        return;
      }

      // Awareness memory events
      if (t.includes('Awareness auto-recall injected')) {
        send('chat:status', { type: 'tool_call', tool: 'Awareness Memory', toolStatus: 'recalling' });
      } else if (t.includes('Awareness auto-capture')) {
        send('chat:status', { type: 'tool_call', tool: 'Awareness Memory', toolStatus: 'saving' });
      } else if (t.includes('Awareness perception')) {
        send('chat:status', { type: 'tool_call', tool: 'Awareness Perception', toolStatus: 'cached' });
      }
    };

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      // Handle line buffering for proper parsing
      const combined = lineBuffer + chunk;
      const parts = combined.split('\n');
      // Last element might be incomplete — buffer it
      lineBuffer = parts.pop() || '';

      for (const line of parts) {
        const t = line.trim();
        if (!t) continue;

        if (isNoiseLine(line)) {
          parseStatusLine(t);
        } else {
          // Real content — stream it to frontend
          send('chat:stream', line + '\n');
        }
      }
    });

    child.stderr?.on('data', () => { /* ignore stderr */ });

    child.on('exit', () => {
      // Flush remaining buffer
      if (lineBuffer.trim() && !isNoiseLine(lineBuffer)) {
        send('chat:stream', lineBuffer);
      }
      send('chat:stream-end', {});

      // Also resolve with full clean text as fallback
      const cleanText = stdout.split('\n').filter(l => !isNoiseLine(l)).join('\n').trim();
      resolve({ success: true, text: cleanText || 'No response', sessionId: sid });

      // Fire-and-forget: write desktop chat to Awareness memory
      if (cleanText && cleanText !== 'No response') {
        const userSnippet = message.slice(0, 300);
        const assistantSnippet = cleanText.slice(0, 400);
        const brief = `Request: ${userSnippet}\nResult: ${assistantSnippet}`;
        callMcp('awareness_record', {
          content: brief,
          event_type: 'turn_brief',
          source: 'desktop',
        }).catch(() => { /* daemon may not be running */ });
      }
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
  try {
    // Feishu is plugin-based, write directly to openclaw.json
    if (channelId === 'feishu') {
      const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
      let existing: any = {};
      try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      if (!existing.channels) existing.channels = {};
      existing.channels.feishu = { ...existing.channels.feishu, ...config, enabled: true };
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
      return { success: true };
    }

    // Matrix: not in --channel enum, write config directly to openclaw.json
    // Google Chat: complex config (serviceAccountFile), write directly
    // WeChat: plugin-based, write directly (same as feishu)
    if (channelId === 'matrix' || channelId === 'google-chat' || channelId === 'googlechat') {
      const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
      let existing: any = {};
      try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      if (!existing.channels) existing.channels = {};
      const key = channelId === 'google-chat' ? 'googlechat' : channelId;
      existing.channels[key] = { ...existing.channels[key], ...config, enabled: true };
      fs.writeFileSync(configPath, JSON.stringify(existing, null, 2));
      return { success: true };
    }

    // Native channels: use `openclaw channels add` with real CLI flags
    // Verified via `openclaw channels add --help` (2026.3.28):
    //   --channel (telegram|whatsapp|discord|irc|googlechat|slack|signal|imessage|line)
    //   --token (Telegram/Discord/LINE)
    //   --bot-token + --app-token (Slack)
    //   --signal-number + --cli-path + --http-url (Signal)
    //   --cli-path + --db-path (iMessage)
    //   --homeserver + --user-id + --password + --access-token (Matrix — but not in --channel enum)
    //   --webhook-url + --audience + --audience-type (Google Chat)
    const esc = (v: string) => v.replace(/"/g, '\\"');
    const args: string[] = [`--channel ${channelId}`];
    // Map config keys to real CLI flags
    if (config.token) args.push(`--token "${esc(config.token)}"`);
    if (config.botToken) args.push(`--bot-token "${esc(config.botToken)}"`);
    if (config.appToken) args.push(`--app-token "${esc(config.appToken)}"`);

    const addCmd = `openclaw channels add ${args.join(' ')} 2>&1`;
    try {
      await runAsync(addCmd, 15000);
      return { success: true };
    } catch (firstErr: any) {
      const msg = firstErr.message || '';
      if (msg.includes('already') || msg.includes('exists')) {
        try {
          await runAsync(`openclaw channels remove --channel ${channelId} 2>&1`, 10000);
          await runAsync(addCmd, 15000);
          return { success: true };
        } catch (retryErr: any) {
          return { success: false, error: retryErr.message?.slice(0, 300) };
        }
      }
      return { success: false, error: msg.slice(0, 300) };
    }
  } catch (err: any) {
    return { success: false, error: (err.message || String(err)).slice(0, 300) };
  }
});

ipcMain.handle('channel:test', async (_e, channelId: string) => {
  // Step 1: Verify channel config in openclaw.json
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const channelConfig = existing?.channels?.[channelId];
    if (!channelConfig || !channelConfig.enabled) {
      return { success: false, error: 'Channel not configured' };
    }
    const hasCredentials = channelConfig.token || channelConfig.appId || channelConfig.webhook
      || channelConfig.bot_token || channelConfig.signal_number || channelConfig.db_path
      || channelConfig.homeserver || channelConfig.webhook_url;
    if (!hasCredentials) {
      return { success: false, error: 'No credentials found' };
    }

    // Step 2: Check gateway status (channels need gateway running)
    const gwStatus = await safeShellExecAsync('openclaw channels status 2>&1', 8000);
    const gwRunning = gwStatus && (gwStatus.includes('running') || gwStatus.includes('active'));

    // Step 3: Try verify via openclaw channels list
    const listOutput = await safeShellExecAsync('openclaw channels list 2>&1', 8000);
    const isListed = listOutput && listOutput.toLowerCase().includes(channelId);

    if (isListed && gwRunning) {
      return { success: true, output: `${channelId}: configured and gateway active` };
    } else if (isListed) {
      return { success: true, output: `${channelId}: configured. Start Gateway to activate.` };
    }
    // Config validated but not in openclaw list — still OK (credentials saved)
    return { success: true, output: `${channelId}: credentials saved. Start Gateway to connect.` };
  } catch {
    return { success: false, error: 'Could not read channel configuration' };
  }
});

// Read a channel's saved config (for pre-filling edit wizard)
ipcMain.handle('channel:read-config', async (_e, channelId: string) => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const channelConfig = existing?.channels?.[channelId];
    if (channelConfig) {
      return { success: true, config: channelConfig };
    }
    return { success: false };
  } catch {
    return { success: false };
  }
});

// One-click channel setup: backend handles install, config, and login automatically
/**
 * Channel login with real-time QR detection.
 * Spawns login command, streams stdout, auto-opens QR URLs in browser.
 * Returns success only if login completes; timeout = failure.
 */
function channelLoginWithQR(loginCmd: string, timeoutMs = 120000): Promise<{ success: boolean; output?: string; error?: string }> {
  const ep = getEnhancedPath();
  return new Promise((resolve) => {
    let settled = false;
    let stdout = '';
    let qrOpened = false;

    const child = spawn('/bin/bash', ['--norc', '--noprofile', '-c', `export PATH="${ep}"; ${loginCmd} 2>&1`]);

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      // Look for QR URLs and auto-open in browser
      // Skip internal URLs (localhost, 127.0.0.1, docs, github)
      if (!qrOpened) {
        const urls = stdout.match(/https?:\/\/\S+/g) || [];
        for (const url of urls) {
          if (url.includes('localhost') || url.includes('127.0.0.1') ||
              url.includes('docs.openclaw') || url.includes('github.com')) continue;
          qrOpened = true;
          shell.openExternal(url);
          break;
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => { stdout += data.toString(); });

    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve({ success: true, output: 'Connected!' });
      } else {
        // Non-zero but QR was opened means user didn't scan in time
        if (qrOpened) {
          resolve({ success: false, error: 'QR code expired. Click "Try again" to get a new QR code.' });
        } else {
          resolve({ success: false, error: stdout.slice(-300) || `Exit code ${code}` });
        }
      }
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      resolve({ success: false, error: String(err).slice(0, 300) });
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      if (qrOpened) {
        resolve({ success: false, error: 'QR code expired. Click "Try again" to get a new QR code.' });
      } else {
        resolve({ success: false, error: 'Connection timed out. Make sure Gateway is running.' });
      }
    }, timeoutMs);
  });
}

ipcMain.handle('channel:setup', async (_e: any, channelId: string) => {
  // WeChat: plugin-based (openclaw-weixin)
  if (channelId === 'wechat') {
    try { await runAsync('openclaw plugins install "@tencent-weixin/openclaw-weixin" 2>&1', 30000); } catch { /* already installed */ }
    return channelLoginWithQR('openclaw channels login --channel openclaw-weixin');
  }

  // Signal: add channel first, then QR link
  if (channelId === 'signal') {
    try { await runAsync('openclaw channels add --channel signal 2>&1', 15000); } catch { /* may exist */ }
    return channelLoginWithQR('openclaw channels login --channel signal');
  }

  // iMessage: just add — no login needed (macOS auto-detects)
  if (channelId === 'imessage') {
    try {
      await runAsync('openclaw channels add --channel imessage 2>&1', 15000);
      return { success: true, output: 'iMessage connected.' };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 300) };
    }
  }

  // WhatsApp + others: add then QR login
  try { await safeShellExecAsync(`openclaw channels add --channel ${channelId} 2>&1`, 10000); } catch { /* may exist */ }
  return channelLoginWithQR(`openclaw channels login --channel ${channelId}`);
});

// Channel status: fast config read first, then CLI check cached for 60s
const _channelStatusCache: { configured: string[]; ts: number } = { configured: [], ts: 0 };
const _keyToFrontend: Record<string, string> = { 'openclaw-weixin': 'wechat', 'googlechat': 'google-chat' };

function readConfiguredFromFile(): string[] {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const channels = existing?.channels || {};
    const configured: string[] = [];
    for (const [id, cfg] of Object.entries(channels)) {
      if ((cfg as any)?.enabled) configured.push(_keyToFrontend[id] || id);
    }
    return configured;
  } catch { return []; }
}

ipcMain.handle('channel:list-configured', async () => {
  // Return instantly from config file (fast — no CLI call)
  const fromFile = readConfiguredFromFile();

  // If cache is fresh (< 60s), use it
  if (Date.now() - _channelStatusCache.ts < 60000 && _channelStatusCache.configured.length > 0) {
    return { success: true, configured: _channelStatusCache.configured };
  }

  // Return file-based result immediately, refresh cache in background
  safeShellExecAsync('openclaw channels list 2>/dev/null', 15000).then((output) => {
    if (!output) return;
    // First try JSON output (more stable across versions)
    try {
      const jsonParsed = JSON.parse(output);
      const arr = Array.isArray(jsonParsed) ? jsonParsed : (jsonParsed.channels || jsonParsed.items || []);
      const jsonConfigured: string[] = arr
        .filter((ch: any) => {
          const s = (ch.status || ch.state || '').toLowerCase();
          return s.includes('configured') || s.includes('linked') || s.includes('active') || s.includes('enabled');
        })
        .map((ch: any) => {
          const id = (ch.id || ch.name || '').toLowerCase();
          return _keyToFrontend[id] || id;
        })
        .filter(Boolean);
      if (jsonConfigured.length > 0) {
        _channelStatusCache.configured = jsonConfigured;
        _channelStatusCache.ts = Date.now();
        return;
      }
    } catch { /* not JSON, fall through to text parsing */ }
    // Text parsing — try multiple patterns in order of likelihood
    const configured: string[] = [];
    for (const line of output.split('\n')) {
      // Pattern 1: "- telegram default: configured, enabled" (current format)
      const m1 = line.match(/^-\s+(\S+)\s+.*?:\s*(configured|linked|active)/i);
      if (m1) { configured.push(_keyToFrontend[m1[1].toLowerCase()] || m1[1].toLowerCase()); continue; }
      // Pattern 2: "telegram: configured" (simplified format)
      const m2 = line.match(/^\s*(\w[\w-]*)\s*:\s*(configured|linked|active|enabled)/i);
      if (m2 && m2[1] !== 'Channels') { configured.push(_keyToFrontend[m2[1].toLowerCase()] || m2[1].toLowerCase()); continue; }
      // Pattern 3: "telegram [configured]" (bracket format)
      const m3 = line.match(/^\s*(\w[\w-]*)\s+\[(configured|linked|active)\]/i);
      if (m3) { configured.push(_keyToFrontend[m3[1].toLowerCase()] || m3[1].toLowerCase()); }
    }
    if (configured.length > 0) {
      _channelStatusCache.configured = configured;
      _channelStatusCache.ts = Date.now();
    }
  }).catch(() => {});

  return { success: true, configured: fromFile };
});

// Dynamically detect supported channels from OpenClaw
ipcMain.handle('channel:list-supported', async () => {
  try {
    const output = await safeShellExecAsync('openclaw channels list', 8000);
    if (output) {
      // Try JSON first
      try {
        const parsed = JSON.parse(output);
        const arr = Array.isArray(parsed) ? parsed : (parsed.channels || parsed.items || []);
        const channels = arr.map((ch: any) => (ch.id || ch.name || '').toLowerCase()).filter(Boolean);
        if (channels.length > 0) return { success: true, channels };
      } catch { /* not JSON */ }
      // Text fallback — extract channel names from various line formats
      const SKIP_WORDS = new Set(['channels', 'no', 'available', 'configured', 'status', 'list']);
      const channels: string[] = [];
      for (const line of output.split('\n')) {
        // Match channel name at start of line (with optional bullet or indent)
        const match = line.match(/^[-*\s]*(\w[\w-]+)/);
        if (match) {
          const name = match[1].toLowerCase();
          if (!SKIP_WORDS.has(name) && name.length > 1) channels.push(name);
        }
      }
      if (channels.length > 0) return { success: true, channels };
    }
    return { success: false, channels: [] };
  } catch {
    return { success: false, channels: [] };
  }
});

// --- Cron Management ---

ipcMain.handle('cron:list', async () => {
  const jsonOutput = await safeShellExecAsync('openclaw cron list --json 2>/dev/null', 10000);
  if (jsonOutput) {
    try {
      // Extract JSON from output (may have non-JSON prefix lines)
      const jsonStart = jsonOutput.indexOf('{');
      if (jsonStart >= 0) {
        const parsed = JSON.parse(jsonOutput.substring(jsonStart));
        // openclaw returns { jobs: [...], total, ... } — extract the jobs array
        const jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || []);
        return { jobs };
      }
    } catch { /* fall through to plain text mode */ }
  }

  const plainOutput = await safeShellExecAsync('openclaw cron list 2>/dev/null', 10000);
  if (!plainOutput) return { jobs: [], error: 'OpenClaw not available' };

  const lines = plainOutput.split('\n').filter(l => l.trim());
  return { jobs: lines, raw: true };
});

ipcMain.handle('cron:add', async (_e, expression: string, command: string) => {
  const result = await safeShellExecAsync(`openclaw cron add "${expression}" "${command}"`, 10000);
  return { success: !!result, output: result };
});

ipcMain.handle('cron:remove', async (_e, id: string) => {
  const result = await safeShellExecAsync(`openclaw cron remove "${id}"`, 10000);
  return { success: !!result, output: result };
});

// --- Gateway Management ---
// Correct commands: `openclaw gateway start/stop/status/restart`
// NOT `openclaw up` (doesn't exist) or `openclaw status` (loads all plugins = 15s+)

ipcMain.handle('gateway:status', async () => {
  // `openclaw gateway status` is faster than `openclaw status` (skips full plugin load)
  const output = await safeShellExecAsync('openclaw gateway status 2>&1', 15000);
  const isRunning = output ? (output.includes('running') || output.includes('active')) : false;
  return { running: isRunning, output };
});

ipcMain.handle('gateway:start', async () => {
  try {
    // Use `openclaw gateway start` (not `openclaw up`)
    const output = await runAsync('openclaw gateway start 2>&1', 20000);
    return { success: true, output };
  } catch (err: any) {
    // May fail if already running — check status
    const status = await safeShellExecAsync('openclaw gateway status 2>&1', 15000);
    if (status && (status.includes('running') || status.includes('active'))) {
      return { success: true, output: 'Gateway already running' };
    }
    return { success: false, error: err.message?.slice(0, 300) || String(err) };
  }
});

ipcMain.handle('gateway:stop', async () => {
  try {
    const result = await runAsync('openclaw gateway stop 2>&1', 15000);
    return { success: true, output: result };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 300) };
  }
});

ipcMain.handle('gateway:restart', async () => {
  try {
    const result = await runAsync('openclaw gateway restart 2>&1', 20000);
    return { success: true, output: result };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 300) };
  }
});

// --- Log Viewer ---

ipcMain.handle('logs:recent', async () => {
  // Try gateway logs first (most relevant), fallback to general logs
  let output = await safeShellExecAsync('openclaw gateway logs --lines 100 2>&1', 10000);
  if (!output || output.includes('not found')) {
    output = await safeShellExecAsync('openclaw logs --lines 100 2>&1', 10000);
  }
  // Also include the app's own log file if exists
  const appLogPath = path.join(HOME, '.openclaw', 'gateway.log');
  let appLog = '';
  try {
    if (fs.existsSync(appLogPath)) {
      const content = fs.readFileSync(appLogPath, 'utf8');
      const lines = content.split('\n');
      appLog = lines.slice(-50).join('\n'); // Last 50 lines
    }
  } catch {}
  const combined = [output || '', appLog ? `\n--- gateway.log (last 50 lines) ---\n${appLog}` : ''].join('').trim();
  return { logs: combined || 'No logs available' };
});

// --- Skills / ClawHub ---

const CLAWHUB_API = 'https://clawhub.ai/api/v1';
const WORKSPACE_DIR = path.join(HOME, '.openclaw', 'workspace');
const LOCK_FILE = path.join(WORKSPACE_DIR, '.clawhub', 'lock.json');

ipcMain.handle('skill:list-installed', async () => {
  try {
    const raw = fs.readFileSync(LOCK_FILE, 'utf8');
    const lock = JSON.parse(raw);
    return { success: true, skills: lock.skills || {} };
  } catch {
    return { success: true, skills: {} };
  }
});

ipcMain.handle('skill:explore', async () => {
  // ClawHub has no "browse all" — search popular keywords to build a recommendation list
  const keywords = ['memory', 'coding', 'search', 'automation', 'file', 'git', 'test'];
  const seen = new Set<string>();
  const all: any[] = [];
  for (const kw of keywords) {
    try {
      const res = await fetchJson(`${CLAWHUB_API}/search?q=${kw}&limit=8`);
      const results = res?.results || [];
      for (const r of results) {
        if (!seen.has(r.slug)) { seen.add(r.slug); all.push(r); }
      }
    } catch { /* skip */ }
  }
  return { success: true, skills: all };
});

ipcMain.handle('skill:search', async (_e, query: string) => {
  try {
    const res = await fetchJson(`${CLAWHUB_API}/search?q=${encodeURIComponent(query)}&limit=20`);
    return { success: true, results: res?.results || [] };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('skill:detail', async (_e, slug: string) => {
  try {
    const res = await fetchJson(`${CLAWHUB_API}/skills/${encodeURIComponent(slug)}`);
    return { success: true, skill: res?.skill || null };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('skill:install', async (_e, slug: string) => {
  try {
    await runAsync(`npx -y clawhub@latest install ${slug} --force`, 60000);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 300) };
  }
});

ipcMain.handle('skill:uninstall', async (_e, slug: string) => {
  try {
    await runAsync(`npx -y clawhub@latest uninstall ${slug}`, 30000);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message?.slice(0, 300) };
  }
});

// --- Skill Config ---

ipcMain.handle('skill:get-config', async (_e, slug: string) => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const skillConfig = config.skills?.[slug]?.config || {};
    return { success: true, config: skillConfig };
  } catch (err: any) {
    return { success: false, error: err.message, config: {} };
  }
});

ipcMain.handle('skill:save-config', async (_e, slug: string, newConfig: Record<string, unknown>) => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    let config: any = {};
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    if (!config.skills) config.skills = {};
    if (!config.skills[slug]) config.skills[slug] = {};
    config.skills[slug].config = { ...config.skills[slug].config, ...newConfig };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// --- Plugins ---

ipcMain.handle('plugins:list', async () => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const entries = config.plugins?.entries || [];
    return { success: true, entries };
  } catch (err: any) {
    return { success: false, error: err.message, entries: [] };
  }
});

ipcMain.handle('plugins:toggle', async (_e, name: string, enabled: boolean) => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    let config: any = {};
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    if (!config.plugins) config.plugins = {};
    if (!config.plugins.entries) config.plugins.entries = {};
    if (config.plugins.entries[name]) {
      config.plugins.entries[name].enabled = enabled;
    } else {
      config.plugins.entries[name] = { enabled };
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// --- Hooks ---

ipcMain.handle('hooks:list', async () => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const hooks = config.hooks || {};
    return { success: true, hooks };
  } catch (err: any) {
    return { success: false, error: err.message, hooks: {} };
  }
});

ipcMain.handle('hooks:toggle', async (_e, hookName: string, enabled: boolean) => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    let config: any = {};
    try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
    if (!config.hooks) config.hooks = {};
    if (config.hooks[hookName]) {
      config.hooks[hookName].enabled = enabled;
    } else {
      config.hooks[hookName] = { enabled };
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

/** Simple JSON GET fetch using Node.js https */
function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON response')); }
      });
    }).on('error', reject).on('timeout', function(this: any) { this.destroy(); reject(new Error('Request timeout')); });
  });
}

// --- Permissions & Workspace ---

ipcMain.handle('permissions:get', async () => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const tools = config.tools || {};
    return {
      success: true,
      profile: tools.profile || 'default',
      alsoAllow: tools.alsoAllow || [],
      denied: tools.denied || [],
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('permissions:update', async (_e, changes: { alsoAllow?: string[]; denied?: string[] }) => {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!config.tools) config.tools = {};
    if (changes.alsoAllow !== undefined) config.tools.alsoAllow = changes.alsoAllow;
    if (changes.denied !== undefined) config.tools.denied = changes.denied;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('workspace:read-file', async (_e, filename: string) => {
  // Only allow reading known workspace files
  const allowed = ['SOUL.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md'];
  if (!allowed.includes(filename)) return { success: false, error: 'File not allowed' };
  try {
    const filePath = path.join(WORKSPACE_DIR, filename);
    if (!fs.existsSync(filePath)) return { success: true, content: '', exists: false };
    return { success: true, content: fs.readFileSync(filePath, 'utf8'), exists: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('workspace:write-file', async (_e, filename: string, content: string) => {
  const allowed = ['SOUL.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md'];
  if (!allowed.includes(filename)) return { success: false, error: 'File not allowed' };
  try {
    const filePath = path.join(WORKSPACE_DIR, filename);
    fs.writeFileSync(filePath, content);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
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

ipcMain.handle('memory:get-daily-summary', async () => {
  // Get today's knowledge cards and recent activity for a daily digest
  const cards = await callMcp('awareness_lookup', { type: 'knowledge', limit: 10 });
  const tasks = await callMcp('awareness_lookup', { type: 'tasks', limit: 5, status: 'open' });
  return { cards, tasks };
});

/** Fetch memory events (timeline) from daemon REST API */
ipcMain.handle('memory:get-events', async (_e, opts: { limit?: number; offset?: number; search?: string }) => {
  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;
  const search = opts?.search || '';

  const endpoint = search
    ? `http://127.0.0.1:37800/api/v1/memories/search?q=${encodeURIComponent(search)}&limit=${limit}`
    : `http://127.0.0.1:37800/api/v1/memories?limit=${limit}&offset=${offset}`;

  return new Promise((resolve) => {
    const req = http.request(endpoint, { method: 'GET', timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid JSON' }); }
      });
    });
    req.on('error', (err: Error) => resolve({ error: String(err) }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.end();
  });
});

/** Check daemon health status */
ipcMain.handle('memory:check-health', async () => {
  return new Promise((resolve) => {
    const req = http.request('http://127.0.0.1:37800/healthz', { method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid JSON' }); }
      });
    });
    req.on('error', () => resolve({ error: 'Not running' }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.end();
  });
});

// --- Config Import/Export ---

ipcMain.handle('config:export', async () => {
  const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
  if (!fs.existsSync(configPath)) return { success: false, error: 'No config found' };

  const exportChoice = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    buttons: ['Export with secrets', 'Export safe copy', 'Cancel'],
    cancelId: 2,
    defaultId: 1,
    title: 'Export Configuration',
    message: 'This file may contain API keys, tokens, and other private settings.',
    detail: 'Choose "Export safe copy" to hide sensitive values before saving.',
  });

  if (exportChoice.response === 2) return { success: false, error: 'Cancelled' };
  const redactSecrets = exportChoice.response === 1;

  const result = await dialog.showSaveDialog(mainWindow!, {
    title: 'Export Configuration',
    defaultPath: 'awareness-config.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' };

  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const exportData = {
      _exportVersion: 1,
      _exportDate: new Date().toISOString(),
      _redacted: redactSecrets,
      openclawConfig: redactSecrets ? redactSensitiveValues(config) : config,
    };
    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2));
    shell.showItemInFolder(result.filePath); // reveal exported file in Finder / Explorer
    return { success: true, path: result.filePath, redacted: redactSecrets };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('config:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    title: 'Import Configuration',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });

  if (result.canceled || !result.filePaths[0]) return { success: false, error: 'Cancelled' };

  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const data = JSON.parse(raw);

    // Validate format
    if (!data.openclawConfig) return { success: false, error: 'Invalid config file format' };

    // Write openclaw.json (deep merge with existing)
    const configDir = path.join(HOME, '.openclaw');
    if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, 'openclaw.json');

    let existing: Record<string, unknown> = {};
    try { existing = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

    const sanitizedImport = stripRedactedValues(data.openclawConfig || {});
    const merged = mergeOpenClawConfig(existing as Record<string, any>, sanitizedImport as Record<string, any>);

    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    return { success: true, config: sanitizedImport, redactedImport: !!data._redacted };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// --- File Preview ---

ipcMain.handle('file:preview', async (_e, filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico'].includes(ext);

    if (isImage) {
      // Return base64 data URI for images (limit 5MB)
      if (stat.size > 5 * 1024 * 1024) return { type: 'image', error: 'Image too large (>5MB)' };
      const data = fs.readFileSync(filePath);
      const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
      return { type: 'image', dataUri: `data:${mime};base64,${data.toString('base64')}`, size: stat.size };
    }

    // Text files: read first 20 lines (limit 1MB)
    if (stat.size > 1024 * 1024) return { type: 'text', content: '(File too large for preview)', size: stat.size, lines: 0 };
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const preview = lines.slice(0, 20).join('\n');
    return { type: 'text', content: preview, size: stat.size, lines: lines.length, truncated: lines.length > 20 };
  } catch (err: any) {
    return { type: 'error', error: err.message };
  }
});

// File picker dialog (for Google Chat service account key, etc.)
ipcMain.handle('file:select', async (_e: any, options?: { filters?: Array<{ name: string; extensions: string[] }> }) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { filePath: null };
  return { filePath: result.filePaths[0] };
});

// --- App Doctor (System Health) ---

const doctor = createDoctor({
  shellExec: safeShellExecAsync,
  shellRun: runAsync,
  homedir: HOME,
  platform: process.platform,
});

ipcMain.handle('doctor:run', async () => doctor.runAllChecks());
ipcMain.handle('doctor:fix', async (_e: any, checkId: string) => doctor.runFix(checkId));

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

// --- App Lifecycle ---

app.whenReady().then(() => {
  createWindow();
  if (process.platform === 'darwin') {
    createTray();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
