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

  function rawShellExecSync(cmd: string, timeoutMs = 5000): string | null {
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

  function rawShellExecAsync(cmd: string, timeoutMs = 5000): Promise<string | null> {
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

  function getOpenClawPackageDirSync(): string | null {
    const npmRoot = rawShellExecSync('npm root -g', 5000);
    if (!npmRoot) return null;
    const pkgDir = path.join(npmRoot.trim(), 'openclaw');
    return fs.existsSync(path.join(pkgDir, 'package.json')) ? pkgDir : null;
  }

  async function getOpenClawPackageDirAsync(): Promise<string | null> {
    const npmRoot = await rawShellExecAsync('npm root -g', 5000);
    if (!npmRoot) return null;
    const pkgDir = path.join(npmRoot.trim(), 'openclaw');
    return fs.existsSync(path.join(pkgDir, 'package.json')) ? pkgDir : null;
  }

  function getOpenClawEntryPath(pkgDir: string): string | null {
    const candidates = [
      path.join(pkgDir, 'openclaw.mjs'),
      path.join(pkgDir, 'dist', 'index.js'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
  }

  function buildOpenClawShellFallbackSync(): string | null {
    const existing = rawShellExecSync(process.platform === 'win32' ? 'where openclaw' : 'which openclaw', 3000);
    if (existing) return null;
    const pkgDir = getOpenClawPackageDirSync();
    if (!pkgDir) return null;
    const entryPath = getOpenClawEntryPath(pkgDir);
    if (!entryPath) return null;
    const candidate = `${getNodeInvocationCommand()} "${entryPath}"`;
    return rawShellExecSync(`${candidate} --version`, 8000) ? candidate : null;
  }

  async function buildOpenClawShellFallbackAsync(): Promise<string | null> {
    const existing = await rawShellExecAsync(process.platform === 'win32' ? 'where openclaw' : 'which openclaw', 3000);
    if (existing) return null;
    const pkgDir = await getOpenClawPackageDirAsync();
    if (!pkgDir) return null;
    const entryPath = getOpenClawEntryPath(pkgDir);
    if (!entryPath) return null;
    const candidate = `${getNodeInvocationCommand()} "${entryPath}"`;
    return await rawShellExecAsync(`${candidate} --version`, 8000) ? candidate : null;
  }

  function getOpenClawDirectSpawnSync(): { command: string; argsPrefix: string[] } | null {
    const existing = rawShellExecSync(process.platform === 'win32' ? 'where openclaw' : 'which openclaw', 3000);
    if (existing) return null;
    const pkgDir = getOpenClawPackageDirSync();
    if (!pkgDir) return null;
    const entryPath = getOpenClawEntryPath(pkgDir);
    if (!entryPath) return null;
    return { command: findNodeExecutable(), argsPrefix: [entryPath] };
  }

  function rewriteOpenClawShellCommand(command: string, fallback: string | null) {
    if (!fallback || !/\bopenclaw\b/.test(command)) return command;
    let rewritten = command.replace(/^openclaw\b/, fallback);
    rewritten = rewritten.replace(/(&&\s*)openclaw\b/g, `$1${fallback}`);
    rewritten = rewritten.replace(/(\|\|\s*)openclaw\b/g, `$1${fallback}`);
    rewritten = rewritten.replace(/(;\s*)openclaw\b/g, `$1${fallback}`);
    return rewritten;
  }

  function safeShellExec(cmd: string, timeoutMs = 5000): string | null {
    return rawShellExecSync(rewriteOpenClawShellCommand(cmd, buildOpenClawShellFallbackSync()), timeoutMs);
  }

  function safeShellExecAsync(cmd: string, timeoutMs = 5000): Promise<string | null> {
    return buildOpenClawShellFallbackAsync().then((fallback) => rawShellExecAsync(rewriteOpenClawShellCommand(cmd, fallback), timeoutMs));
  }

  function readShellOutputAsync(cmd: string, timeoutMs = 5000): Promise<string | null> {
    return new Promise(resolve => {
      const enhancedPath = getEnhancedPath();
      buildOpenClawShellFallbackAsync().then((fallback) => {
        const rewrittenCmd = rewriteOpenClawShellCommand(cmd, fallback);
        const shellCmd = process.platform === 'win32' ? wrapWindowsCommand(rewrittenCmd) : `export PATH="${enhancedPath}"; ${rewrittenCmd}`;
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
    const rewrittenCmd = rewriteOpenClawShellCommand(cmd, buildOpenClawShellFallbackSync());
    if (process.platform === 'win32') {
      return execSync(rewrittenCmd, { encoding: 'utf8', timeout: 180000, stdio: 'pipe', shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath }, ...opts } as any);
    }
    return execSync(`/bin/bash --norc --noprofile -c 'export PATH="${enhancedPath}"; ${rewrittenCmd.replace(/'/g, "'\\''")}'`, {
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

    if (cmd === 'openclaw') {
      const fallback = getOpenClawDirectSpawnSync();
      if (fallback) {
        return spawn(fallback.command, [...fallback.argsPrefix, ...args], {
          env: { ...process.env, PATH: getEnhancedPath() },
          ...opts,
        });
      }
    }

    return spawn(cmd, args, {
      env: { ...process.env, PATH: getEnhancedPath() },
      ...opts,
    });
  }

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

      buildOpenClawShellFallbackAsync().then((fallback) => {
        const rewrittenCommand = rewriteOpenClawShellCommand(cmd, fallback);
        const shellCmdRaw = process.platform === 'win32' ? wrapWindowsCommand(rewrittenCommand) : `export PATH="${enhancedPath}"; ${rewrittenCommand}`;
        const shellCmd = rewriteNpx(shellCmdRaw);
        const child = process.platform === 'win32'
          ? spawn(shellCmd, [], { shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' }, stdio: 'pipe' })
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
            else reject(new Error(stderr.trim() || stdout.trim().slice(-500) || `Exit code ${code}`));
          }
        });
        child.on('error', (err: Error) => {
          if (!settled) { settled = true; clearTimeout(timer); reject(err); }
        });
      }).catch(reject);
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
    runSpawn,
    safeShellExec,
    safeShellExecAsync,
    stripAnsi,
    wrapWindowsCommand,
  };
}
