import fs from 'fs';
import path from 'path';
import { app, ipcMain, shell } from 'electron';

export function registerAppRuntimeHandlers(deps: {
  home: string;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  getLocalDaemonHealth: (timeoutMs?: number) => Promise<any | null>;
  runAsync: (cmd: string, timeoutMs?: number) => Promise<string>;
  getManagedOpenClawInstallCommand: (packageName?: string) => string;
  getManagedOpenClawEntrypoint: () => string | null;
  ensureManagedOpenClawWindowsShim: () => void;
  shutdownLocalDaemon: (timeoutMs?: number) => Promise<boolean>;
  clearAwarenessLocalNpxCache: (homedir: string) => void;
}) {
  ipcMain.handle('app:get-platform', () => process.platform);

  ipcMain.handle('app:open-external', (_e: any, url: string) => {
    shell.openExternal(url);
  });

  ipcMain.handle('app:set-login-item', (_e: any, enabled: boolean) => {
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true,
      });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle('app:get-login-item', () => {
    try {
      const settings = app.getLoginItemSettings();
      return { openAtLogin: settings.openAtLogin };
    } catch {
      return { openAtLogin: false };
    }
  });

  ipcMain.handle('app:check-updates', async () => {
    const updates: any[] = [];

    const currentOC = await deps.safeShellExecAsync('openclaw --version');
    if (currentOC) {
      const versionMatch = currentOC.match(/(\d+\.\d+\.\d+)/);
      const current = versionMatch ? versionMatch[1] : null;
      if (current) {
        const latestOC = await deps.safeShellExecAsync('npm view openclaw version', 10000);
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

    try {
      let installedVersion: string | null = null;

      const extPkgPath = path.join(deps.home, '.openclaw', 'extensions', 'openclaw-memory', 'package.json');
      if (fs.existsSync(extPkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(extPkgPath, 'utf8'));
          installedVersion = pkg?.version || null;
        } catch {}
      }

      if (!installedVersion) {
        const lockPath = path.join(deps.home, '.openclaw', 'workspace', '.clawhub', 'lock.json');
        if (fs.existsSync(lockPath)) {
          const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
          installedVersion = lock?.skills?.['awareness-memory']?.version || null;
        }
      }

      if (installedVersion) {
        const latestPlugin = await deps.safeShellExecAsync('npm view @awareness-sdk/openclaw-memory version', 10000);
        if (latestPlugin && latestPlugin.trim() !== installedVersion) {
          updates.push({
            component: 'plugin',
            label: 'Awareness Memory Plugin',
            currentVersion: installedVersion,
            latestVersion: latestPlugin.trim(),
          });
        }
      }
    } catch {}

    try {
      const health = await deps.getLocalDaemonHealth(2000);
      const daemonCurrent = health?.version;
      if (daemonCurrent) {
        const latestDaemon = await deps.safeShellExecAsync('npm view @awareness-sdk/local version', 10000);
        if (latestDaemon && latestDaemon.trim() !== daemonCurrent) {
          updates.push({
            component: 'daemon',
            label: 'Awareness Local Daemon',
            currentVersion: daemonCurrent,
            latestVersion: latestDaemon.trim(),
          });
        }
      }
    } catch {}

    return { updates };
  });

  ipcMain.handle('app:upgrade-component', async (_e: any, component: string) => {
    try {
      if (component === 'openclaw') {
        const preVer = await deps.safeShellExecAsync('openclaw --version', 5000);
        const preMatch = preVer?.match(/(\d+\.\d+\.\d+)/);
        const preSemver = preMatch ? preMatch[1] : null;

        let upgraded = false;
        const isAlreadyManaged = !!deps.getManagedOpenClawEntrypoint();

        if (isAlreadyManaged) {
          // Managed OpenClaw: `openclaw update` updates the GLOBAL npm, not
          // the managed prefix — so skip it and go straight to managed install.
          const managedCmd = deps.getManagedOpenClawInstallCommand('openclaw@latest');
          const registries = ['', '--registry=https://registry.npmmirror.com'];
          for (const reg of registries) {
            try {
              await deps.runAsync(`${managedCmd} ${reg}`.trim(), 120000);
              upgraded = true;
              break;
            } catch {}
          }
        } else if (preVer) {
          // Global OpenClaw: use its native update command
          try {
            await deps.runAsync('openclaw update --yes --no-restart 2>&1', 180000);
            upgraded = true;
          } catch {}
        }

        if (!upgraded && !isAlreadyManaged && !preVer) {
          // No OpenClaw at all — fresh install to managed prefix
          const managedCmd = deps.getManagedOpenClawInstallCommand('openclaw@latest');
          const registries = ['', '--registry=https://registry.npmmirror.com'];
          for (const reg of registries) {
            try {
              await deps.runAsync(`${managedCmd} ${reg}`.trim(), 120000);
              upgraded = true;
              break;
            } catch {}
          }
        }

        if (!upgraded) {
          // Only try official install scripts if no global OpenClaw exists,
          // to avoid installing a second copy that conflicts with the existing one.
          const hasGlobal = !!preVer && !deps.getManagedOpenClawEntrypoint();
          if (hasGlobal) {
            return {
              success: false,
              error: 'OpenClaw upgrade failed. Your OpenClaw is globally installed — please update it in terminal:\n  openclaw update\nor:\n  npm install -g openclaw@latest',
            };
          }
          try {
            if (process.platform === 'win32') {
              await deps.runAsync('powershell -Command "irm https://openclaw.ai/install.ps1 | iex"', 120000);
            } else {
              await deps.runAsync('curl -fsSL https://openclaw.ai/install.sh | bash', 120000);
            }
            upgraded = true;
          } catch {}
        }

        if (!upgraded) {
          return {
            success: false,
            error: 'OpenClaw upgrade failed. Check your network connection and try again.',
          };
        }

        deps.ensureManagedOpenClawWindowsShim();

        const newVer = await deps.safeShellExecAsync('openclaw --version');
        const vMatch = newVer?.match(/(\d+\.\d+\.\d+)/);
        const newSemver = vMatch ? vMatch[1] : newVer?.trim();

        if (!newSemver) {
          return {
            success: false,
            error: `Upgrade may have failed — openclaw not responding after install. Previous version: ${preSemver || 'unknown'}`,
          };
        }

        return { success: true, version: newSemver, previousVersion: preSemver };
      } else if (component === 'plugin') {
        const extDir = path.join(deps.home, '.openclaw', 'extensions', 'openclaw-memory');
        if (fs.existsSync(extDir)) {
          fs.rmSync(extDir, { recursive: true, force: true });
        }
        const extensionsDir = path.join(deps.home, '.openclaw', 'extensions');
        fs.mkdirSync(extensionsDir, { recursive: true });

        const nullDev = process.platform === 'win32' ? 'NUL' : '/dev/null';
        const pluginRegistries = ['', '--registry=https://registry.npmmirror.com'];

        const finalizePluginUpgrade = (dir: string): string => {
          let newVer = 'latest';
          try {
            const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
            newVer = pkg.version || 'latest';
          } catch {}
          try {
            const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
            if (fs.existsSync(configPath)) {
              const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
              const installs = config?.plugins?.installs;
              if (installs?.['openclaw-memory']) {
                installs['openclaw-memory'].version = newVer;
                installs['openclaw-memory'].resolvedVersion = newVer;
                installs['openclaw-memory'].resolvedSpec = `@awareness-sdk/openclaw-memory@${newVer}`;
                installs['openclaw-memory'].installedAt = new Date().toISOString();
                fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
              }
            }
          } catch {}
          return newVer;
        };

        for (const regFlag of pluginRegistries) {
          try {
            const packOut = await deps.runAsync(`cd "${extensionsDir}" && npm pack @awareness-sdk/openclaw-memory@latest ${regFlag} 2>${nullDev}`, 120000);
            const tgzName = packOut.trim().split('\n').pop()?.trim() || '';
            if (!tgzName || !tgzName.endsWith('.tgz')) {
              throw new Error('npm pack did not produce a tarball');
            }
            const tgzPath = path.join(extensionsDir, tgzName);
            if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true, force: true });
            fs.mkdirSync(extDir, { recursive: true });
            await deps.runAsync(`tar -xzf "${tgzPath}" -C "${extDir}" --strip-components=1`, 30000);
            try { fs.unlinkSync(tgzPath); } catch {}
            await deps.runAsync(`cd "${extDir}" && npm install --omit=dev --no-audit --no-fund`, 300000);

            const newVer = finalizePluginUpgrade(extDir);
            return { success: true, version: newVer, method: regFlag ? 'npm-direct-mirror' : 'npm-direct' };
          } catch {}
        }

        try {
          await deps.runAsync(`cd "${deps.home}" && openclaw plugins install @awareness-sdk/openclaw-memory`, 120000);
          const newVer = finalizePluginUpgrade(extDir);
          return { success: true, version: newVer, method: 'openclaw-plugin' };
        } catch {}

        try {
          await deps.runAsync(`cd "${deps.home}" && npx -y clawhub@latest install awareness-memory --force`, 120000);
          const newVer = finalizePluginUpgrade(extDir);
          return { success: true, version: newVer, method: 'clawhub' };
        } catch (e: any) {
          throw new Error(`Plugin upgrade failed: ${e.message?.slice(0, 200)}`);
        }
      } else if (component === 'daemon') {
        await deps.shutdownLocalDaemon(3000);

        for (let w = 0; w < 6; w++) {
          const health = await deps.getLocalDaemonHealth(1000);
          if (!health?.pid) break;
          if (w === 3 && health?.version) {
            try { process.kill(health.pid, 'SIGKILL'); } catch {}
          }
          await new Promise(r => setTimeout(r, 500));
        }

        deps.clearAwarenessLocalNpxCache(deps.home);

        await deps.runAsync(`npx -y @awareness-sdk/local@latest start --port 37800 --project "${path.join(deps.home, '.openclaw')}" --background`, 60000);
        for (let i = 0; i < 12; i++) {
          const delay = i < 3 ? 1000 : i < 6 ? 2000 : 3000;
          await new Promise(r => setTimeout(r, delay));
          const health = await deps.getLocalDaemonHealth(3000);
          if (health?.version) return { success: true, version: health.version };
        }
        return { success: true, version: 'latest' };
      }
      return { success: false, error: 'Unknown component' };
    } catch (err: any) {
      console.error(`[upgrade] ${component} failed:`, err.message);
      const msg = err.message || '';
      if (msg.includes('EACCES') || msg.includes('permission denied') || msg.includes('Permission denied')) {
        return {
          success: false,
          error: 'Permission denied. Run this in terminal to fix:\n  npm config set prefix ~/.npm-global\n  export PATH=~/.npm-global/bin:$PATH',
        };
      }
      return { success: false, error: msg.slice(0, 300) };
    }
  });
}