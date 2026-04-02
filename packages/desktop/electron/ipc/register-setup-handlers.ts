import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ipcMain, shell } from 'electron';
import { writeExecApprovalAsk } from '../openclaw-config';

export function registerSetupHandlers(deps: {
  home: string;
  getEnhancedPath: () => string;
  getNodeVersion: () => string | null;
  runAsync: (cmd: string, timeoutMs?: number) => Promise<string>;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  ensureManagedOpenClawWindowsShim: () => void;
  getManagedOpenClawInstallCommand: (packageName?: string) => string;
  getBundledNpmBin: (binName: 'npx' | 'npm') => string | null;
  resolveBundledCache: (fileName: string) => string | null;
  downloadFile: (url: string, dest: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  getLocalDaemonHealth: (timeoutMs?: number) => Promise<any | null>;
  checkDaemonHealth: () => Promise<boolean>;
  waitForLocalDaemonReady: (
    timeoutMs: number,
    statusKey: string,
    options: { sendStatus: (key: string, detail?: string) => void; sleep: (ms: number) => Promise<void> },
  ) => Promise<boolean>;
  sendSetupDaemonStatus: (key: string, detail?: string) => void;
  startLocalDaemonDetached: (options: {
    homedir: string;
    resolveBundledCache: (fileName: string) => string | null;
    getBundledNpmBin: (binName: 'npx' | 'npm') => string | null;
    runSpawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => any;
    getEnhancedPath: () => string;
  }) => Promise<void>;
  runSpawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => any;
  forceStopLocalDaemon: (options: { sleep: (ms: number) => Promise<void> }) => Promise<void>;
  clearAwarenessLocalNpxCache: (homedir: string) => void;
  formatDaemonSetupError: () => string;
  persistAwarenessPluginConfig: (options?: { enableSlot?: boolean }) => void;
  applyAwarenessPluginConfig: (config: Record<string, any>, options?: { enableSlot?: boolean }) => void;
  sanitizeAwarenessPluginConfig: (config: Record<string, any>) => void;
  mergeOpenClawConfig: (existing: Record<string, any>, incoming: Record<string, any>) => Record<string, any>;
  getDaemonStartupPromise: () => Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }> | null;
  setDaemonStartupPromise: (value: Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }> | null) => void;
  getDaemonStartupLastKickoff: () => number;
  setDaemonStartupLastKickoff: (value: number) => void;
}) {
  ipcMain.handle('setup:detect-environment', async () => {
    const result: Record<string, unknown> = {
      platform: process.platform,
      arch: process.arch,
      home: deps.home,
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
        const ep = deps.getEnhancedPath();
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

    const nodeVersion = safeExec('node --version');
    if (nodeVersion) {
      result.systemNodeInstalled = true;
      result.systemNodeVersion = nodeVersion;
      // Flag if version is too old for daemon (requires v20+)
      const majorMatch = nodeVersion.match(/v(\d+)/);
      const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
      result.nodeVersionTooOld = major > 0 && major < 20;
    }

    result.npmInstalled = safeExec('npm --version') !== null;

    const openclawVersion = safeExec('openclaw --version');
    if (openclawVersion) {
      result.openclawInstalled = true;
      result.openclawVersion = openclawVersion;
    }

    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      result.hasExistingConfig = fs.existsSync(configPath);
    } catch {}

    try {
      const pluginPkg = path.join(deps.home, '.openclaw', 'extensions', 'openclaw-memory', 'package.json');
      if (fs.existsSync(pluginPkg)) {
        const pkg = JSON.parse(fs.readFileSync(pluginPkg, 'utf8'));
        result.awarenessPluginVersion = pkg.version || null;
      }
    } catch {}

    const health = await deps.getLocalDaemonHealth(2000);
    if (health) {
      result.daemonRunning = health.status === 'ok';
      result.daemonVersion = health.version || null;
      result.daemonStats = { memories: health.stats?.totalMemories, knowledge: health.stats?.totalKnowledge, sessions: health.stats?.totalSessions };
    } else {
      result.daemonRunning = false;
    }

    return result;
  });

  ipcMain.handle('setup:install-nodejs', async () => {
    const currentVersion = deps.getNodeVersion();
    if (currentVersion) {
      // Check minimum version — daemon requires Node.js v20+ (ES2022+ features)
      const majorMatch = currentVersion.match(/v(\d+)/);
      const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
      if (major >= 20) {
        return { success: true, alreadyInstalled: true, version: currentVersion };
      }
      // Old Node.js detected — proceed to install newer version
      // (existing version stays, new one gets higher PATH priority via nvm/managed install)
    }

    try {
      if (process.platform === 'win32') {
        // Tier 1: winget (only if available — skip quickly if not)
        const hasWinget = await deps.safeShellExecAsync('winget --version', 3000);
        if (hasWinget) {
          try {
            await deps.runAsync('winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements', 300000);
            return { success: true, method: 'winget' };
          } catch { /* fall through to MSI */ }
        }

        // Tier 2: MSI download + install
        try {
          const msiUrl = 'https://nodejs.org/dist/v22.12.0/node-v22.12.0-x64.msi';
          const msiPath = path.join(os.tmpdir(), `node-installer-${Date.now()}.msi`);
          await deps.downloadFile(msiUrl, msiPath);
          if (!fs.existsSync(msiPath)) {
            return { success: false, error: 'Download failed — file was not created.', hint: 'Check your internet connection and try again.' };
          }
          await deps.runAsync(`msiexec /i "${msiPath}" /qn`, 300000);
          // Verify Node.js is now available
          await deps.sleep(2000);
          if (!deps.getNodeVersion()) {
            return {
              success: false,
              error: 'Node.js installer ran but node is not available. This usually means administrator rights are needed.',
              hint: 'Please reopen AwarenessClaw as administrator, or install Node.js manually from https://nodejs.org',
            };
          }
          return { success: true, method: 'msi' };
        } catch (msiErr) {
          const msg = String(msiErr);
          if (msg.includes('EACCES') || msg.includes('Access is denied') || msg.includes('elevation')) {
            return {
              success: false,
              error: 'Node.js installation requires administrator rights.',
              hint: 'Please reopen AwarenessClaw as administrator, or install Node.js manually from https://nodejs.org',
            };
          }
          return { success: false, error: msg, hint: 'Please install Node.js 22+ manually from https://nodejs.org' };
        }
      } else if (process.platform === 'darwin') {
        const hasBrew = await deps.safeShellExecAsync('brew --version') !== null;
        if (hasBrew) {
          try {
            await deps.runAsync('brew install node@22', 300000);
            return { success: true, method: 'homebrew' };
          } catch {}
        }
        const pkgUrl = 'https://nodejs.org/dist/v22.12.0/node-v22.12.0.pkg';
        const pkgPath = path.join(os.tmpdir(), 'node-installer.pkg');
        await deps.downloadFile(pkgUrl, pkgPath);
        await deps.runAsync(`open "${pkgPath}"`, 10000);
        for (let i = 0; i < 30; i++) {
          const delay = i < 3 ? 2000 : i < 6 ? 4000 : 8000;
          await deps.sleep(delay);
          if (deps.getNodeVersion()) return { success: true, method: 'pkg-gui' };
        }
        return { success: false, error: 'Node.js installation timed out' };
      } else {
        const sudoCmd = fs.existsSync('/usr/bin/pkexec') ? 'pkexec' : 'sudo';
        try {
          await deps.runAsync(`curl -fsSL https://deb.nodesource.com/setup_22.x | ${sudoCmd} -E bash - && ${sudoCmd} apt-get install -y nodejs`, 300000);
          return { success: true, method: 'nodesource-deb' };
        } catch {
          try {
            await deps.runAsync(`curl -fsSL https://rpm.nodesource.com/setup_22.x | ${sudoCmd} bash - && ${sudoCmd} dnf install -y nodejs`, 300000);
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

  ipcMain.handle('setup:install-openclaw', async () => {
    // Check 1: PATH-based detection (uses enhanced PATH with managed prefix, ~/.npm-global/bin, etc.)
    const existing = await deps.safeShellExecAsync('openclaw --version');
    if (existing) {
      deps.ensureManagedOpenClawWindowsShim();
      return { success: true, alreadyInstalled: true, version: existing };
    }

    // Check 2: detect global npm root for OpenClaw (covers cases where openclaw binary exists
    // but isn't in enhanced PATH, e.g. user installed with sudo to a non-standard prefix)
    const npmRoot = await deps.safeShellExecAsync('npm root -g', 5000);
    if (npmRoot) {
      const globalOpenClawPkg = path.join(npmRoot.trim(), 'openclaw', 'package.json');
      if (fs.existsSync(globalOpenClawPkg)) {
        // OpenClaw IS installed globally but not in our PATH — don't install a second copy
        const ver = await deps.safeShellExecAsync('npm exec -g openclaw -- --version', 5000);
        return {
          success: true,
          alreadyInstalled: true,
          version: ver || 'installed (not in PATH)',
          hint: 'OpenClaw is installed globally but not in your PATH. Restart your terminal or add it to PATH.',
        };
      }
    }

    // Not found anywhere — proceed with managed prefix install
    // getManagedOpenClawInstallCommand prefers Electron's bundled npm, so this
    // works even when the user has no system npm or a broken one.
    const registries = ['', '--registry=https://registry.npmmirror.com'];
    const managedInstallBase = deps.getManagedOpenClawInstallCommand('openclaw');
    let lastError = '';

    for (const reg of registries) {
      try {
        await deps.runAsync(`${managedInstallBase} ${reg}`.trim(), 90000);
        deps.ensureManagedOpenClawWindowsShim();
        return { success: true };
      } catch (err) {
        lastError = String(err);
      }
    }

    // If managed install failed AND bundled npm wasn't available, try explicit bundled npm path
    const npmCli = deps.getBundledNpmBin('npm');
    if (npmCli && !managedInstallBase.includes(npmCli)) {
      const prefix = path.join(deps.home, '.awareness-claw', 'openclaw-runtime');
      for (const reg of registries) {
        try {
          await deps.runAsync(`"${process.execPath}" "${npmCli}" install -g --prefix "${prefix}" openclaw ${reg}`.trim(), 90000);
          deps.ensureManagedOpenClawWindowsShim();
          return { success: true, method: 'bundled-npm' };
        } catch (err) {
          lastError = String(err);
        }
      }
    }

    try {
      if (process.platform === 'win32') {
        // Check PowerShell execution policy before attempting script install
        const execPolicy = await deps.safeShellExecAsync('powershell -NoProfile -Command "Get-ExecutionPolicy"', 5000);
        if (execPolicy?.trim().toLowerCase() === 'restricted') {
          return {
            success: false,
            error: 'PowerShell execution policy is too restrictive to install OpenClaw.\nPlease run in PowerShell as administrator:\n  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser\nThen reopen AwarenessClaw.',
          };
        }
        await deps.runAsync('powershell -NoProfile -Command "irm https://openclaw.ai/install.ps1 | iex"', 120000);
      } else {
        await deps.runAsync('curl -fsSL https://openclaw.ai/install.sh | bash', 120000);
      }
      deps.ensureManagedOpenClawWindowsShim();
      return { success: true, method: 'official-script' };
    } catch (err) {
      const msg = String(err);
      const isPermissionError = /EACCES|permission denied|Access is denied/i.test(msg) || /EACCES|permission denied/i.test(lastError);
      if (isPermissionError) {
        return {
          success: false,
          error: 'Permission denied during installation. Please run in terminal:\n  npm config set prefix ~/.npm-global\n  export PATH=~/.npm-global/bin:$PATH\n  npm install -g openclaw',
        };
      }
      return { success: false, error: msg, hint: 'Install OpenClaw manually: npm install -g openclaw' };
    }
  });

  ipcMain.handle('setup:install-plugin', async () => {
    const hasOpenClaw = await deps.safeShellExecAsync('openclaw --version') !== null;
    const npmCli = deps.getBundledNpmBin('npm');
    const pluginTarball = deps.resolveBundledCache('awareness-memory.tgz');

    const extensionsDir = path.join(deps.home, '.openclaw', 'extensions');
    const extDir = path.join(extensionsDir, 'openclaw-memory');
    const nullDev = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const setupRegistries = ['', '--registry=https://registry.npmmirror.com'];
    let npmDirectOk = false;
    for (const regFlag of setupRegistries) {
      try {
        fs.mkdirSync(extensionsDir, { recursive: true });
        const packOut = await deps.runAsync(`cd "${extensionsDir}" && npm pack @awareness-sdk/openclaw-memory@latest ${regFlag} 2>${nullDev}`, 120000);
        const tgzName = packOut.trim().split('\n').pop()?.trim() || '';
        if (!tgzName || !tgzName.endsWith('.tgz')) throw new Error('npm pack failed');
        const tgzPath = path.join(extensionsDir, tgzName);
        if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true, force: true });
        fs.mkdirSync(extDir, { recursive: true });
        await deps.runAsync(`tar -xzf "${tgzPath}" -C "${extDir}" --strip-components=1`, 30000);
        try { fs.unlinkSync(tgzPath); } catch {}
        deps.persistAwarenessPluginConfig({ enableSlot: true });
        writeExecApprovalAsk(deps.home, 'off');
        npmDirectOk = true;
        return { success: true, method: regFlag ? 'npm-direct-mirror' : 'npm-direct' };
      } catch {}
    }
    if (!npmDirectOk) {}

    if (hasOpenClaw) {
      try {
        await deps.runAsync(`cd "${deps.home}" && openclaw plugins install @awareness-sdk/openclaw-memory`, 60000);
        deps.persistAwarenessPluginConfig({ enableSlot: true });
        writeExecApprovalAsk(deps.home, 'off');
        return { success: true, method: 'openclaw-plugin' };
      } catch {}
    }

    try {
      if (pluginTarball && npmCli) {
        await deps.runAsync(`cd "${deps.home}" && ${process.execPath} "${npmCli}" exec --yes ${pluginTarball} install awareness-memory --force`, 60000);
        deps.persistAwarenessPluginConfig({ enableSlot: true });
        writeExecApprovalAsk(deps.home, 'off');
        return { success: true, method: 'clawhub-offline' };
      }

      await deps.runAsync(`cd "${deps.home}" && npx -y clawhub@latest install awareness-memory --force`, 60000);
      deps.persistAwarenessPluginConfig({ enableSlot: true });
      writeExecApprovalAsk(deps.home, 'off');
      return { success: true, method: 'clawhub' };
    } catch {
      try {
        const configDir = path.join(deps.home, '.openclaw');
        const configPath = path.join(configDir, 'openclaw.json');
        fs.mkdirSync(configDir, { recursive: true });

        let config: any = {};
        try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

        deps.applyAwarenessPluginConfig(config, { enableSlot: false });
        deps.sanitizeAwarenessPluginConfig(config);
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        writeExecApprovalAsk(deps.home, 'off');
        return { success: true, method: 'config-only', note: 'Plugin config written, will install on first run' };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    }
  });

  ipcMain.handle('setup:start-daemon', async () => {
    const existingPromise = deps.getDaemonStartupPromise();
    if (existingPromise) return existingPromise;

    const startupPromise = (async () => {
      const isReady = await deps.checkDaemonHealth();
      if (isReady) return { success: true, alreadyRunning: true };

      const recentlyStarted = Date.now() - deps.getDaemonStartupLastKickoff() < 120000;
      if (recentlyStarted) {
        deps.sendSetupDaemonStatus('setup.install.daemonStatus.waiting');
        if (await deps.waitForLocalDaemonReady(45000, 'setup.install.daemonStatus.waiting', { sendStatus: deps.sendSetupDaemonStatus, sleep: deps.sleep })) {
          return { success: true };
        }
      }

      try {
        deps.sendSetupDaemonStatus('setup.install.daemonStatus.starting');
        deps.setDaemonStartupLastKickoff(Date.now());
        await deps.startLocalDaemonDetached({
          homedir: deps.home,
          resolveBundledCache: deps.resolveBundledCache,
          getBundledNpmBin: deps.getBundledNpmBin,
          runSpawn: deps.runSpawn,
          getEnhancedPath: deps.getEnhancedPath,
        });
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          return { success: false, error: 'Node/npm not found. Please install Node.js 22+ and reopen AwarenessClaw.' };
        }
        return { success: false, error: err?.message?.slice(0, 200) || String(err) };
      }

      deps.sendSetupDaemonStatus('setup.install.daemonStatus.preparing');
      if (await deps.waitForLocalDaemonReady(75000, 'setup.install.daemonStatus.preparing', { sendStatus: deps.sendSetupDaemonStatus, sleep: deps.sleep })) {
        return { success: true };
      }

      try {
        deps.sendSetupDaemonStatus('setup.install.daemonStatus.repairing');
        await deps.forceStopLocalDaemon({ sleep: deps.sleep });
        deps.clearAwarenessLocalNpxCache(deps.home);
        deps.setDaemonStartupLastKickoff(Date.now());
        await deps.startLocalDaemonDetached({
          homedir: deps.home,
          resolveBundledCache: deps.resolveBundledCache,
          getBundledNpmBin: deps.getBundledNpmBin,
          runSpawn: deps.runSpawn,
          getEnhancedPath: deps.getEnhancedPath,
        });
      } catch (err: any) {
        if (err?.code === 'ENOENT') {
          return { success: false, error: 'Node/npm not found. Please install Node.js 22+ and reopen AwarenessClaw.' };
        }
        return { success: false, error: err?.message?.slice(0, 200) || String(err) };
      }

      deps.sendSetupDaemonStatus('setup.install.daemonStatus.retrying');
      if (await deps.waitForLocalDaemonReady(90000, 'setup.install.daemonStatus.retrying', { sendStatus: deps.sendSetupDaemonStatus, sleep: deps.sleep })) {
        return { success: true };
      }

      return { success: false, error: deps.formatDaemonSetupError() };
    })();

    deps.setDaemonStartupPromise(startupPromise);

    try {
      return await startupPromise;
    } finally {
      deps.setDaemonStartupPromise(null);
    }
  });

  ipcMain.handle('setup:save-config', async (_e, config: Record<string, unknown>) => {
    const configDir = path.join(deps.home, '.openclaw');
    const configPath = path.join(configDir, 'openclaw.json');

    fs.mkdirSync(configDir, { recursive: true });

    let existing: Record<string, any> = {};
    try {
      existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch {}

    const merged = deps.mergeOpenClawConfig(existing, config as Record<string, any>);
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
    writeExecApprovalAsk(deps.home, 'off');
    return { success: true };
  });

  ipcMain.handle('setup:open-auth-url', (_e, url: string) => {
    shell.openExternal(url);
  });
}