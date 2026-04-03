import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';

function normalizeModelsUrl(baseUrl: string): string {
  const trimmed = (baseUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return trimmed.endsWith('/models') ? trimmed : `${trimmed}/models`;
}

function buildModelDiscoveryHeaders(providerKey: string, apiKey: string) {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
    headers['api-key'] = apiKey;
  }

  if (providerKey === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
  }

  return headers;
}

function parseDiscoveredModels(payload: any): Array<{ id: string; name: string; reasoning?: boolean; contextWindow?: number; maxTokens?: number }> {
  const candidates = Array.isArray(payload?.data)
    ? payload.data
    : Array.isArray(payload?.models)
      ? payload.models
      : Array.isArray(payload?.result?.models)
        ? payload.result.models
        : [];

  return candidates
    .filter((item: any) => !!item && typeof item.id === 'string')
    .map((item: any) => ({
      id: item.id,
      name: item.display_name || item.name || item.id,
      ...(typeof item.reasoning === 'boolean' ? { reasoning: item.reasoning } : {}),
      ...(typeof item.context_window === 'number' ? { contextWindow: item.context_window } : typeof item.contextWindow === 'number' ? { contextWindow: item.contextWindow } : {}),
      ...(typeof item.max_output_tokens === 'number' ? { maxTokens: item.max_output_tokens } : typeof item.maxTokens === 'number' ? { maxTokens: item.maxTokens } : {}),
    }));
}

export function registerRuntimeHealthHandlers(deps: {
  home: string;
  app: any;
  dirname: string;
  safeShellExec: (cmd: string, timeoutMs?: number) => string | null;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  doctor: any;
  computeSha256: (filePath: string) => string;
  checkDaemonHealth: () => Promise<boolean>;
  waitForLocalDaemonReady: (timeoutMs: number, statusKey: string, options: { sendStatus: (key: string, detail?: string) => void; sleep: (ms: number) => Promise<void> }) => Promise<boolean>;
  sendSetupDaemonStatus: (key: string, detail?: string) => void;
  sleep: (ms: number) => Promise<void>;
  recentDaemonStartup: () => boolean;
  getMainWindow: () => any;
}) {
  const startupRepairPriority = new Map([
    ['openclaw-command-health', 10],
    ['openclaw-installed', 20],
    ['plugin-installed', 30],
    ['daemon-running', 40],
    ['gateway-running', 50],
    ['channel-bindings', 60],
    ['launchagent-path', 70],
  ]);

  ipcMain.handle('setup:bootstrap', async () => {
    const result = await deps.safeShellExecAsync('openclaw doctor --fix 2>&1', 30000);
    return { success: !!result, output: result };
  });

  ipcMain.handle('setup:read-existing-config', async () => {
    const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
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
        hasApiKey: providerNames.some(name => providers[name]?.apiKey),
      };
    } catch {
      return { exists: false, hasProviders: false, providers: [], primaryModel: '', hasApiKey: false };
    }
  });

  ipcMain.handle('models:read-providers', async () => {
    const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
    try {
      const raw = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(raw);
      const providers = config?.models?.providers || {};
      const primaryModel = config?.agents?.defaults?.model?.primary || '';
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

  ipcMain.handle('models:discover', async (_e, input: { providerKey: string; baseUrl: string; apiKey?: string }) => {
    const providerKey = input?.providerKey || '';
    const baseUrl = input?.baseUrl || '';
    const apiKey = input?.apiKey || '';
    const url = normalizeModelsUrl(baseUrl);

    if (!providerKey || !url) {
      return { success: false, models: [], error: 'Missing provider key or base URL' };
    }

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildModelDiscoveryHeaders(providerKey, apiKey),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        return {
          success: false,
          models: [],
          error: `HTTP ${response.status}`,
        };
      }

      const payload = await response.json();
      const models = parseDiscoveredModels(payload);

      return {
        success: models.length > 0,
        models,
        error: models.length > 0 ? '' : 'No models discovered',
      };
    } catch (error: any) {
      return {
        success: false,
        models: [],
        error: error?.message || String(error),
      };
    }
  });

  ipcMain.handle('security:check', async () => {
    const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
    const issues: Array<{ level: 'warning' | 'info'; message: string; fix?: string }> = [];

    if (process.platform === 'win32') {
      try {
        const acl = deps.safeShellExec(`icacls "${configPath}"`, 5000);
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
      } catch {}
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
      } catch {}
    }

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
      const extDir = path.join(deps.home, '.openclaw', 'extensions');
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
    } catch {}

    try {
      const cacheDirCandidates = [
        path.join(deps.app.getPath('exe'), '..', '..', 'resources', 'app.asar.unpacked', 'cache'),
        path.join(deps.app.getAppPath(), 'cache'),
        path.join(deps.dirname, '..', 'cache'),
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
          const actual = deps.computeSha256(bundlePath).toLowerCase();
          if (!expected || expected !== actual) {
            issues.push({
              level: 'warning',
              message: `Offline bundle ${bundleName} failed checksum verification`,
              fix: 'Rebuild the offline bundle and regenerate its .sha256 file before release.',
            });
          }
        }
      }
    } catch {}

    const rollbackDir = path.join(deps.home, '.openclaw', '.upgrade-backups');
    if (!fs.existsSync(rollbackDir)) {
      issues.push({
        level: 'info',
        message: 'No local upgrade rollback snapshots found yet',
        fix: 'Keep the previous installer until automatic rollback snapshots are implemented for all components.',
      });
    }

    return { issues };
  });

  ipcMain.handle('app:startup-ensure-runtime', async () => {
    const fixed: string[] = [];
    const warnings: string[] = [];
    const sendStartupStatus = (message: string, progress: number) => {
      const mainWindow = deps.getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('app:startup-status', { message, progress });
      }
    };
    const autoFixChecks = new Set([
      'openclaw-command-health',
      'openclaw-installed',
      'plugin-installed',
      'daemon-running',
      'gateway-running',
      'channel-bindings',
    ]);

    if (process.platform === 'darwin') {
      autoFixChecks.add('launchagent-path');
    }

    const startupChecks = [
      'node-installed', 'openclaw-installed', 'openclaw-command-health',
      'plugin-installed', 'daemon-running', 'gateway-running', 'channel-bindings',
      ...(process.platform === 'darwin' ? ['launchagent-path'] : []),
    ];

    if (deps.recentDaemonStartup() && !(await deps.checkDaemonHealth())) {
      sendStartupStatus('Waiting for the local service to finish starting...', 22);
      await deps.waitForLocalDaemonReady(90000, 'setup.install.daemonStatus.waiting', { sendStatus: deps.sendSetupDaemonStatus, sleep: deps.sleep });
    }

    sendStartupStatus('Checking your installation...', 10);
    const initialReport = await deps.doctor.runChecks(startupChecks);
    const checksToRepair = initialReport.checks.filter((check: any) =>
      autoFixChecks.has(check.id)
      && check.fixable === 'auto'
      && (check.status === 'fail' || check.status === 'warn')
      && !(check.id === 'daemon-running' && deps.recentDaemonStartup())
    ).sort((left: any, right: any) => {
      const leftPriority = startupRepairPriority.get(left.id) ?? 999;
      const rightPriority = startupRepairPriority.get(right.id) ?? 999;
      return leftPriority - rightPriority;
    });

    if (checksToRepair.length === 0) {
      sendStartupStatus('Everything looks good. Finalizing startup...', 85);
    }

    for (const [index, check] of checksToRepair.entries()) {
      const progress = Math.min(80, 20 + Math.round(((index + 1) / checksToRepair.length) * 55));
      sendStartupStatus(`Repairing ${check.label}...`, progress);
      const fix = await deps.doctor.runFix(check.id);
      if (fix.success) fixed.push(fix.message);
      else warnings.push(fix.message || check.message);
    }

    sendStartupStatus('Finalizing startup...', 92);
    let finalReport = await deps.doctor.runChecks(startupChecks);
    if (deps.recentDaemonStartup()) {
      const daemonBlocking = finalReport.checks.find((check: any) => check.id === 'daemon-running' && check.status === 'fail');
      if (daemonBlocking) {
        sendStartupStatus('Local service is still warming up...', 94);
        await deps.waitForLocalDaemonReady(60000, 'setup.install.daemonStatus.waiting', { sendStatus: deps.sendSetupDaemonStatus, sleep: deps.sleep });
        finalReport = await deps.doctor.runChecks(startupChecks);
      }
    }
    const blocking = finalReport.checks.find((check: any) =>
      ['node-installed', 'openclaw-installed', 'plugin-installed', 'daemon-running'].includes(check.id)
      && check.status === 'fail'
    );

    const residualWarnings = finalReport.checks
      .filter((check: any) => check.status === 'warn')
      .map((check: any) => check.message);

    return {
      ok: !blocking,
      needsSetup: !!blocking,
      blockingMessage: blocking?.message,
      fixed,
      warnings: [...warnings, ...residualWarnings],
    };
  });

  ipcMain.handle('doctor:run', async () => deps.doctor.runAllChecks());
  ipcMain.handle('doctor:fix', async (_e: any, checkId: string) => deps.doctor.runFix(checkId));
}