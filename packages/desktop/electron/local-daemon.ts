import fs from 'fs';
import http from 'http';
import path from 'path';

export function clearAwarenessLocalNpxCache(homedir: string) {
  try {
    const npxCacheDir = path.join(homedir, '.npm', '_npx');
    if (!fs.existsSync(npxCacheDir)) return;

    const entries = fs.readdirSync(npxCacheDir);
    for (const entry of entries) {
      const entryDir = path.join(npxCacheDir, entry);
      const sdkDir = path.join(entryDir, 'node_modules', '@awareness-sdk');
      const localPkg = path.join(sdkDir, 'local', 'package.json');
      if (fs.existsSync(sdkDir) || fs.existsSync(localPkg)) {
        fs.rmSync(entryDir, { recursive: true, force: true });
      }
    }
  } catch {
    // Best-effort cache cleanup only.
  }
}

export function formatDaemonSetupError() {
  return 'Local service is taking longer than expected. AwarenessClaw already retried automatically. Please keep this window open, check your network, and try again in a minute.';
}

export function requestLocalDaemon(pathname: string, method: 'GET' | 'POST' = 'GET', timeoutMs = 2000): Promise<{ statusCode: number; body: string }> {
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

export async function getLocalDaemonHealth(timeoutMs = 2000): Promise<any | null> {
  try {
    const response = await requestLocalDaemon('/healthz', 'GET', timeoutMs);
    if (response.statusCode !== 200 || !response.body) return null;
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}

export async function shutdownLocalDaemon(timeoutMs = 3000): Promise<boolean> {
  try {
    const response = await requestLocalDaemon('/shutdown', 'POST', timeoutMs);
    return response.statusCode >= 200 && response.statusCode < 300;
  } catch {
    return false;
  }
}

export function checkDaemonHealth(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:37800/healthz', { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

export async function forceStopLocalDaemon(options: { sleep: (ms: number) => Promise<void> }) {
  await shutdownLocalDaemon(3000);
  await options.sleep(1500);

  const health = await getLocalDaemonHealth(2000);
  if (health?.pid && health?.version) {
    try { process.kill(health.pid, 'SIGKILL'); } catch { /* already dead */ }
    await options.sleep(1000);
  }
}

export async function startLocalDaemonDetached(options: {
  homedir: string;
  resolveBundledCache: (fileName: string) => string | null;
  getBundledNpmBin: (binName: 'npx' | 'npm') => string | null;
  runSpawn: (cmd: string, args: string[], opts?: Record<string, unknown>) => any;
  getEnhancedPath: () => string;
}) {
  const projectDir = path.join(options.homedir, '.openclaw');
  const offlineTarball = options.resolveBundledCache('awareness-sdk-local.tgz');
  const npxArgs = ['-y', offlineTarball || '@awareness-sdk/local@latest', 'start', '--port', '37800', '--project', projectDir, '--background'];

  const launchDetached = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
    const child = options.runSpawn(command, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, PATH: options.getEnhancedPath() },
    });

    const handleError = (err: any) => reject(err);
    child.once('error', handleError);
    child.once('spawn', () => {
      child.removeListener('error', handleError);
      child.unref();
      resolve();
    });
  });

  const startViaBundledNodeCli = async () => {
    const bundledNpxCli = options.getBundledNpmBin('npx');
    if (bundledNpxCli) {
      await launchDetached('node', [bundledNpxCli, ...npxArgs]);
      return;
    }

    const npmCli = options.getBundledNpmBin('npm');
    if (!npmCli) throw new Error('Bundled npm not found');

    const execArgs = offlineTarball
      ? ['exec', '--yes', offlineTarball, 'start', '--port', '37800', '--project', projectDir, '--background']
      : ['exec', '--yes', '@awareness-sdk/local@latest', 'start', '--port', '37800', '--project', projectDir, '--background'];

    await launchDetached('node', [npmCli, ...execArgs]);
  };

  const startWithWindowsShellNpx = () => launchDetached('cmd.exe', ['/d', '/c', 'npx', ...npxArgs]);
  const startWithNpx = () => launchDetached(process.platform === 'win32' ? 'npx.cmd' : 'npx', npxArgs);

  if (process.platform === 'win32') {
    try {
      await startViaBundledNodeCli();
      return;
    } catch (err: any) {
      if (err?.code !== 'ENOENT' && err?.message !== 'Bundled npm not found') throw err;
      await startWithWindowsShellNpx();
      return;
    }
  }

  try {
    await startWithNpx();
  } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
    await startViaBundledNodeCli();
  }
}

export async function waitForLocalDaemonReady(timeoutMs: number, statusKey: string, options: {
  sendStatus: (key: string, detail?: string) => void;
  sleep: (ms: number) => Promise<void>;
}) {
  const startedAt = Date.now();
  let lastStatusAt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (await checkDaemonHealth()) return true;

    const elapsed = Date.now() - startedAt;
    if (elapsed - lastStatusAt >= 10000) {
      lastStatusAt = elapsed;
      options.sendStatus(statusKey, `${Math.max(1, Math.ceil((timeoutMs - elapsed) / 1000))}s`);
    }

    await options.sleep(1500);
  }

  return false;
}