import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import {
  getGatewayPort as getGatewayPortShared,
} from './openclaw-config';

export function createShellUtils(options: { home: string; app: any }) {
  const { home, app } = options;

  function wrapWindowsCommand(cmd: string) {
    return process.platform === 'win32' ? `chcp 65001>nul & ${cmd}` : cmd;
  }

  function stripAnsi(text: string) {
    return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
  }

  function getEnhancedPath(): string {
    const base = process.env.PATH || '';
    const extras: string[] = [];

    if (process.platform === 'darwin' || process.platform === 'linux') {
      extras.push(
        `${home}/.npm-global/bin`,
        `${home}/.local/bin`,
        '/opt/homebrew/bin',
        '/usr/local/bin',
        '/usr/bin',
      );
      try {
        const nvmDir = path.join(home, '.nvm', 'versions', 'node');
        if (fs.existsSync(nvmDir)) {
          const versions = fs.readdirSync(nvmDir).filter(v => v.startsWith('v')).sort().reverse();
          if (versions.length > 0) extras.push(path.join(nvmDir, versions[0], 'bin'));
        }
      } catch {}
      try {
        const fnmDefault = path.join(home, '.fnm', 'aliases', 'default', 'bin');
        if (fs.existsSync(fnmDefault)) extras.push(fnmDefault);
      } catch {}
      if (process.platform === 'linux') {
        extras.push('/snap/bin');
      }
    } else if (process.platform === 'win32') {
      const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const localappdata = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
      const programfiles = process.env.ProgramFiles || 'C:\\Program Files';
      extras.push(
        `${appdata}\\npm`,
        `${localappdata}\\pnpm`,
        `${programfiles}\\nodejs`,
        `${process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'}\\nodejs`,
        `${localappdata}\\fnm_multishells`,
      );
    }

    return [...extras, base].join(path.delimiter);
  }

  function findNodeExecutable() {
    const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
    const pathEntries = (getEnhancedPath() || '').split(path.delimiter).filter(Boolean);

    for (const entry of pathEntries) {
      const candidate = path.join(entry, executableName);
      if (fs.existsSync(candidate)) return candidate;
    }

    const fallback = safeShellExec(process.platform === 'win32' ? 'where node' : 'which node', 3000);
    if (fallback) {
      const firstLine = fallback.split(/\r?\n/).map(line => line.trim()).find(Boolean);
      if (firstLine) return firstLine;
    }

    return process.platform === 'win32' ? 'node.exe' : 'node';
  }

  function getNodeInvocationCommand() {
    const nodeExecutable = findNodeExecutable();
    return nodeExecutable.includes(' ') ? `"${nodeExecutable}"` : nodeExecutable;
  }

  function getGatewayPort() {
    return getGatewayPortShared(home);
  }

  function safeShellExec(cmd: string, timeoutMs = 5000): string | null {
    try {
      const enhancedPath = getEnhancedPath();
      if (process.platform === 'win32') {
        return execSync(wrapWindowsCommand(cmd), { encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe', shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' } }).trim();
      }
      return execSync(`/bin/bash --norc --noprofile -c 'export PATH="${enhancedPath}"; ${cmd.replace(/'/g, "'\\''")}'`, {
        encoding: 'utf8', timeout: timeoutMs, stdio: 'pipe', env: { ...process.env, PATH: enhancedPath },
      }).trim();
    } catch {
      return null;
    }
  }

  function safeShellExecAsync(cmd: string, timeoutMs = 5000): Promise<string | null> {
    return new Promise(resolve => {
      const enhancedPath = getEnhancedPath();
      const shellCmd = process.platform === 'win32' ? wrapWindowsCommand(cmd) : `export PATH="${enhancedPath}"; ${cmd}`;
      const child = process.platform === 'win32'
        ? spawn(shellCmd, [], { shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: 'pipe' })
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

  function readShellOutputAsync(cmd: string, timeoutMs = 5000): Promise<string | null> {
    return new Promise(resolve => {
      const enhancedPath = getEnhancedPath();
      const shellCmd = process.platform === 'win32' ? wrapWindowsCommand(cmd) : `export PATH="${enhancedPath}"; ${cmd}`;
      const child = process.platform === 'win32'
        ? spawn(shellCmd, [], { shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: 'pipe' })
        : spawn('/bin/bash', ['--norc', '--noprofile', '-c', shellCmd], { env: { ...process.env, PATH: enhancedPath }, stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          child.kill();
          resolve((stdout + stderr).trim() || null);
        }
      }, timeoutMs);
      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
      child.on('close', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve((stdout + stderr).trim() || null);
        }
      });
      child.on('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve((stdout + stderr).trim() || null);
        }
      });
    });
  }

  function getNodeVersion(): string | null {
    return safeShellExec('node --version');
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

  /**
   * Run a shell command asynchronously with activity-based timeout.
   * The timer resets every time stdout/stderr produces output.
   * This handles OpenClaw's slow plugin loading (15-30s) gracefully —
   * as long as it keeps printing "[plugins] Registered xxx", it won't timeout.
   * Only if nothing happens for `timeoutMs` does it abort.
   */
  function runAsync(cmd: string, timeoutMs = 180000): Promise<string> {
    return new Promise((resolve, reject) => {
      const enhancedPath = getEnhancedPath();
      const rewriteNpx = (command: string) => {
        if (!command.trim().startsWith('npx ')) return command;
        const npxCli = getBundledNpmBin('npx');
        if (!npxCli) return command;
        const rest = command.trim().slice(4);
        return `${process.execPath} "${npxCli}" ${rest}`;
      };

      const shellCmdRaw = process.platform === 'win32' ? wrapWindowsCommand(cmd) : `export PATH="${enhancedPath}"; ${cmd}`;
      const shellCmd = rewriteNpx(shellCmdRaw);
      const child = process.platform === 'win32'
        ? spawn(shellCmd, [], { shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: 'pipe' })
        : spawn('/bin/bash', ['--norc', '--noprofile', '-c', shellCmd], { env: { ...process.env, PATH: enhancedPath }, stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      let settled = false;

      // Activity-based timeout: reset on every stdout/stderr output
      let timer = setTimeout(() => {
        if (!settled) { settled = true; child.kill(); reject(new Error('Command timed out')); }
      }, timeoutMs);
      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!settled) { settled = true; child.kill(); reject(new Error('Command timed out')); }
        }, timeoutMs);
      };

      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); resetTimer(); });
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); resetTimer(); });
      child.on('close', (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (code === 0) resolve(stdout.trim());
          else reject(new Error(stderr.trim() || stdout.trim().slice(-500) || `Exit code ${code}`));
        }
      });
      child.on('error', (err: Error) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(err); }
      });
    });
  }

  /** Same as runAsync but with per-line progress callback. Activity-based timeout. */
  function runAsyncWithProgress(
    cmd: string,
    timeoutMs: number,
    onLine: (line: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const enhancedPath = getEnhancedPath();
      const rewriteNpx = (command: string) => {
        if (!command.trim().startsWith('npx ')) return command;
        const npxCli = getBundledNpmBin('npx');
        if (!npxCli) return command;
        const rest = command.trim().slice(4);
        return `${process.execPath} "${npxCli}" ${rest}`;
      };

      const shellCmdRaw = process.platform === 'win32' ? wrapWindowsCommand(cmd) : `export PATH="${enhancedPath}"; ${cmd}`;
      const shellCmd = rewriteNpx(shellCmdRaw);
      const child = process.platform === 'win32'
        ? spawn(shellCmd, [], { shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: 'pipe' })
        : spawn('/bin/bash', ['--norc', '--noprofile', '-c', shellCmd], { env: { ...process.env, PATH: enhancedPath }, stdio: 'pipe' });
      let stdout = '';
      let stderr = '';
      let stdoutBuf = '';
      let stderrBuf = '';
      let settled = false;

      // Activity-based timeout: reset on every output
      let timer = setTimeout(() => {
        if (!settled) { settled = true; child.kill(); reject(new Error('Command timed out')); }
      }, timeoutMs);
      const resetTimer = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!settled) { settled = true; child.kill(); reject(new Error('Command timed out')); }
        }, timeoutMs);
      };

      child.stdout?.on('data', (d: Buffer) => {
        const text = d.toString();
        stdout += text;
        stdoutBuf += text;
        resetTimer();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) onLine(line, 'stdout');
        }
      });
      child.stderr?.on('data', (d: Buffer) => {
        const text = d.toString();
        stderr += text;
        stderrBuf += text;
        resetTimer();
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() || '';
        for (const line of lines) {
          if (line.trim()) onLine(line, 'stderr');
        }
      });
      child.on('close', (code: number | null) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          if (code === 0) resolve(stdout.trim());
          else reject(new Error(stderr.trim() || stdout.trim().slice(-500) || `Exit code ${code}`));
        }
      });
      child.on('error', (err: Error) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(err); }
      });
    });
  }

  return {
    findNodeExecutable,
    getBundledNpmBin,
    getEnhancedPath,
    getGatewayPort,
    getNodeInvocationCommand,
    getNodeVersion,
    readShellOutputAsync,
    resolveBundledCache,
    run,
    runAsync,
    runAsyncWithProgress,
    runSpawn,
    safeShellExec,
    safeShellExecAsync,
    stripAnsi,
    wrapWindowsCommand,
  };
}
