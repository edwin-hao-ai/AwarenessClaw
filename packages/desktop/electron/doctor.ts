/**
 * App Doctor — automatic diagnostics and repair for AwarenessClaw.
 *
 * Checks: node, openclaw, version conflicts, gateway, plugin, daemon, bindings, permissions.
 * Each check returns a user-friendly result; fixable items can be auto-repaired.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import {
  normalizePluginAllow,
  isGatewayRunningOutput,
  getGatewayPort,
  GATEWAY_DEFAULTS,
  writeExecApprovalAsk,
} from './openclaw-config';

const OPENCLAW_INSTALL_TIMEOUT_MS = 300000;

// --- Types ---

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'skipped';
export type Fixability = 'auto' | 'manual' | 'none';

export interface CheckResult {
  id: string;
  label: string;
  status: CheckStatus;
  message: string;
  fixable: Fixability;
  fixDescription?: string;
  detail?: string;
}

export interface DoctorReport {
  timestamp: number;
  checks: CheckResult[];
  summary: { pass: number; warn: number; fail: number; skipped: number };
}

export interface FixResult {
  id: string;
  success: boolean;
  message: string;
}

export interface DoctorDeps {
  shellExec: (cmd: string, timeout?: number) => Promise<string | null>;
  shellRun: (cmd: string, timeout?: number) => Promise<string>;
  homedir: string;
  platform: NodeJS.Platform;
}

// --- Shared context (built once, reused by all checks) ---

interface Ctx {
  nodeVersion: string | null;
  nodePath: string | null;
  openclawVersion: string | null;
  openclawPath: string | null;
  openclawPackageDir: string | null;
  openclawCandidates: string[];
  npmPrefix: string | null;
  configPath: string;
  config: any | null;
  deps: DoctorDeps;
}

// Native npm install — no managed prefix
function getNpmInstallCommand(packageName = 'openclaw') {
  return `npm install -g ${packageName}`;
}

function persistAwarenessPluginConfig(homedir: string) {
  const configDir = path.join(homedir, '.openclaw');
  const configPath = path.join(configDir, 'openclaw.json');
  fs.mkdirSync(configDir, { recursive: true });

  let config: Record<string, any> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    config = {};
  }

  if (!config.plugins) config.plugins = {};
  config.gateway = {
    ...(config.gateway || {}),
    mode: GATEWAY_DEFAULTS.mode,
    bind: config.gateway?.bind || GATEWAY_DEFAULTS.bind,
    port: Number(config.gateway?.port) || GATEWAY_DEFAULTS.port,
  };
  if (!config.plugins.entries) config.plugins.entries = {};
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
  config.plugins.allow = Array.from(new Set([...(normalizePluginAllow(config.plugins.allow) || []), 'openclaw-memory']));
  config.plugins.slots = { ...(config.plugins.slots || {}), memory: 'openclaw-memory' };
  if (config.plugins.entries['memory-awareness']) delete config.plugins.entries['memory-awareness'];
  if (Array.isArray(config.plugins.allow)) {
    config.plugins.allow = config.plugins.allow.filter((pluginId: string) => pluginId !== 'memory-awareness');
    if (config.plugins.allow.length === 0) delete config.plugins.allow;
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  writeExecApprovalAsk(homedir, 'off');
}



function pickFirstCommandPath(output: string | null): string | null {
  if (!output) return null;
  const lines = output.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines[0] || null;
}

function parseCommandPaths(output: string | null): string[] {
  if (!output) return [];
  return Array.from(new Set(output.split(/\r?\n/).map(line => line.trim()).filter(Boolean)));
}

function normalizeWindowsCommandCandidates(paths: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const candidate of paths) {
    const parsed = path.parse(candidate);
    const normalizedKey = path.join(parsed.dir.toLowerCase(), parsed.name.toLowerCase());
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    normalized.push(candidate);
  }

  return normalized;
}

function parseAgentBindings(output: string | null): any[] {
  if (!output) return [];

  const objectStart = output.indexOf('{');
  const arrayStart = output.indexOf('[');
  const jsonStart = [objectStart, arrayStart].filter(index => index >= 0).sort((a, b) => a - b)[0];
  if (jsonStart === undefined) return [];

  try {
    const parsed = JSON.parse(output.slice(jsonStart));
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.bindings)) return parsed.bindings;
    if (Array.isArray(parsed.data)) return parsed.data;
  } catch {
    return [];
  }

  return [];
}

function getEnabledChannels(config: any | null): string[] {
  if (!config?.channels || typeof config.channels !== 'object') return [];
  return Object.entries(config.channels)
    .filter(([, value]: [string, any]) => value?.enabled)
    .map(([channelId]) => channelId);
}

async function getUnboundChannels(ctx: Ctx): Promise<string[] | null> {
  const enabledChannels = getEnabledChannels(ctx.config);
  if (enabledChannels.length === 0) return [];

  const output = await ctx.deps.shellExec('openclaw agents bindings --json 2>/dev/null', 10000);
  const bindings = parseAgentBindings(output);
  if (!output || bindings.length === 0) return null;

  const boundChannels = new Set(bindings.map((binding: any) => binding.match?.channel).filter(Boolean));
  return enabledChannels.filter((channelId) => !boundChannels.has(channelId));
}

async function buildContext(deps: DoctorDeps): Promise<Ctx> {
  const configPath = path.join(deps.homedir, '.openclaw', 'openclaw.json');
  let config: any = null;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

  const findCommand = deps.platform === 'win32' ? 'where' : 'which -a';
  const nodeLookup = await deps.shellExec(`${findCommand} node`, 3000);
  const nodePath = pickFirstCommandPath(nodeLookup);
  const nodeVersion = nodePath ? await deps.shellExec('node --version', 3000) : null;
  const openclawLookup = await deps.shellExec(`${findCommand} openclaw`, 3000);
  const openclawCandidatesRaw = parseCommandPaths(openclawLookup);
  const openclawCandidates = deps.platform === 'win32'
    ? normalizeWindowsCommandCandidates(openclawCandidatesRaw)
    : openclawCandidatesRaw;
  const openclawPath = openclawCandidates[0] || null;
  const npmRoot = await deps.shellExec('npm root -g', 5000);
  const openclawPackageDir = npmRoot
    ? path.join(npmRoot.trim(), 'openclaw')
    : null;
  const hasOpenClawPackage = !!openclawPackageDir && fs.existsSync(path.join(openclawPackageDir, 'package.json'));
  let openclawVersion = openclawPath ? await deps.shellExec('openclaw --version', 8000) : null;
  if (!openclawVersion && hasOpenClawPackage) {
    openclawVersion = await deps.shellExec('openclaw --version', 8000);
    if (!openclawVersion) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(openclawPackageDir!, 'package.json'), 'utf8'));
        if (pkg?.version) openclawVersion = `OpenClaw ${pkg.version}`;
      } catch {}
    }
  }
  const npmPrefix = await deps.shellExec('npm config get prefix', 5000);

  return {
    nodeVersion: nodeVersion?.trim() || null,
    nodePath: nodePath?.trim() || null,
    openclawVersion: openclawVersion?.trim() || null,
    openclawPath: openclawPath?.trim() || null,
    openclawPackageDir: hasOpenClawPackage ? openclawPackageDir : null,
    openclawCandidates,
    npmPrefix: npmPrefix?.trim() || null,
    configPath, config, deps,
  };
}

// --- Check functions ---

async function checkNodeInstalled(ctx: Ctx): Promise<CheckResult> {
  if (ctx.nodePath && ctx.nodeVersion) {
    return { id: 'node-installed', label: 'Node.js', status: 'pass', message: `Installed (${ctx.nodeVersion})`, fixable: 'none' };
  }
  return { id: 'node-installed', label: 'Node.js', status: 'fail', message: 'Node.js is not installed. Install it from nodejs.org', fixable: 'manual', fixDescription: 'Visit nodejs.org to download and install Node.js' };
}

async function checkOpenclawInstalled(ctx: Ctx): Promise<CheckResult> {
  if (!ctx.nodePath) return { id: 'openclaw-installed', label: 'OpenClaw', status: 'skipped', message: 'Skipped (Node.js required)', fixable: 'none' };
  if ((ctx.openclawPath || ctx.openclawPackageDir) && ctx.openclawVersion) {
    return { id: 'openclaw-installed', label: 'OpenClaw', status: 'pass', message: `Installed (${ctx.openclawVersion.match(/\d+\.\d+\.\d+/)?.[0] || ctx.openclawVersion})`, fixable: 'none' };
  }
  return { id: 'openclaw-installed', label: 'OpenClaw', status: 'fail', message: 'OpenClaw is not installed', fixable: 'auto', fixDescription: 'Install OpenClaw via npm' };
}

async function checkOpenclawCommandHealth(ctx: Ctx): Promise<CheckResult> {
  if (!ctx.openclawPath && !ctx.openclawPackageDir) {
    return { id: 'openclaw-command-health', label: 'OpenClaw command path', status: 'skipped', message: 'Skipped (OpenClaw not installed)', fixable: 'none' };
  }

  if (!ctx.openclawPath && ctx.openclawPackageDir) {
    return {
      id: 'openclaw-command-health',
      label: 'OpenClaw command path',
      status: 'warn',
      message: ctx.deps.platform === 'win32'
        ? 'OpenClaw is installed, but the Windows command shim is missing or not visible yet.'
        : 'OpenClaw is installed, but the shell command is missing from the current PATH.',
      fixable: 'auto',
      fixDescription: ctx.deps.platform === 'win32'
        ? 'Refresh the Windows OpenClaw command shims'
        : 'Refresh the OpenClaw command link',
    };
  }

  const duplicates = ctx.openclawCandidates.filter(candidate => candidate !== ctx.openclawPath);
  if (duplicates.length === 0) {
    return { id: 'openclaw-command-health', label: 'OpenClaw command path', status: 'pass', message: 'Command path is healthy', fixable: 'none' };
  }

  return {
    id: 'openclaw-command-health',
    label: 'OpenClaw command path',
    status: 'warn',
    message: ctx.deps.platform === 'win32'
      ? 'Multiple OpenClaw command shims found. This can cause slow startup or launch the wrong version.'
      : 'Multiple OpenClaw command paths found. The app may start the wrong version.',
    fixable: 'auto',
    fixDescription: ctx.deps.platform === 'win32'
      ? 'Refresh the Windows OpenClaw command shims'
      : 'Install and pin the AwarenessClaw managed OpenClaw runtime',
    detail: ctx.openclawCandidates.join('; '),
  };
}

async function fixOpenclawCommandHealth(ctx: Ctx): Promise<FixResult> {
  try {
    if (ctx.deps.platform !== 'win32') {
      // Best-effort: remove stale global OpenClaw to avoid two instances
      try {
        await ctx.deps.shellRun('npm uninstall -g openclaw 2>&1', 60000);
      } catch {
        // May need sudo — that's OK, managed install will still pin the correct version
      }
      await ctx.deps.shellRun(`${getNpmInstallCommand('openclaw@latest')} 2>&1`, OPENCLAW_INSTALL_TIMEOUT_MS);
      return {
        id: 'openclaw-command-health',
        success: true,
        message: 'OpenClaw reinstalled to resolve command path conflicts',
      };
    }

    // Windows: clean stale shims, then reinstall
    const shimDir = path.join(process.env.APPDATA || path.join(ctx.deps.homedir, 'AppData', 'Roaming'), 'npm');
    try {
      await ctx.deps.shellRun('npm uninstall -g openclaw 2>&1', 60000);
    } catch {}

    for (const fileName of ['openclaw', 'openclaw.cmd', 'openclaw.ps1']) {
      const filePath = path.join(shimDir, fileName);
      if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
    }

    await ctx.deps.shellRun(`${getNpmInstallCommand()} 2>&1`, OPENCLAW_INSTALL_TIMEOUT_MS);
    return { id: 'openclaw-command-health', success: true, message: 'OpenClaw command shims refreshed' };
  } catch (err: any) {
    return { id: 'openclaw-command-health', success: false, message: err.message?.slice(0, 200) || 'Cleanup failed' };
  }
}

async function fixOpenclawInstall(ctx: Ctx): Promise<FixResult> {
  try {
    await ctx.deps.shellRun(`${getNpmInstallCommand()} 2>&1`, OPENCLAW_INSTALL_TIMEOUT_MS);
    return { id: 'openclaw-installed', success: true, message: 'OpenClaw installed successfully' };
  } catch (err: any) {
    return { id: 'openclaw-installed', success: false, message: err.message?.slice(0, 200) || 'Installation failed' };
  }
}

async function checkOpenclawVersion(ctx: Ctx): Promise<CheckResult> {
  if (!ctx.openclawVersion) return { id: 'openclaw-version', label: 'OpenClaw version', status: 'skipped', message: 'Skipped (OpenClaw not installed)', fixable: 'none' };
  try {
    const latest = await ctx.deps.shellExec('npm view openclaw version 2>/dev/null', 10000);
    const current = ctx.openclawVersion.match(/(\d+\.\d+\.\d+)/)?.[1];
    const latestVer = latest?.trim();
    if (current && latestVer && current !== latestVer) {
      return { id: 'openclaw-version', label: 'OpenClaw version', status: 'warn', message: `Update available: ${current} → ${latestVer}`, fixable: 'auto', fixDescription: `Update to ${latestVer}` };
    }
    return { id: 'openclaw-version', label: 'OpenClaw version', status: 'pass', message: `Up to date (${current})`, fixable: 'none' };
  } catch {
    return { id: 'openclaw-version', label: 'OpenClaw version', status: 'pass', message: 'Could not check for updates', fixable: 'none' };
  }
}

async function fixOpenclawUpdate(ctx: Ctx): Promise<FixResult> {
  try {
    await ctx.deps.shellRun(`${getNpmInstallCommand('openclaw@latest')} 2>&1`, OPENCLAW_INSTALL_TIMEOUT_MS);
    return { id: 'openclaw-version', success: true, message: 'Updated successfully' };
  } catch (err: any) {
    return { id: 'openclaw-version', success: false, message: err.message?.slice(0, 200) || 'Update failed' };
  }
}

async function checkMultiVersionConflicts(ctx: Ctx): Promise<CheckResult> {
  if (ctx.deps.platform !== 'darwin' && ctx.deps.platform !== 'linux') {
    return { id: 'openclaw-conflicts', label: 'Version conflicts', status: 'skipped', message: 'Skipped (platform check)', fixable: 'none' };
  }
  if (!ctx.openclawPath) return { id: 'openclaw-conflicts', label: 'Version conflicts', status: 'skipped', message: 'Skipped', fixable: 'none' };

  const globalPaths = ['/usr/local/lib/node_modules/openclaw', '/usr/lib/node_modules/openclaw'];
  const npmGlobal = path.join(ctx.deps.homedir, '.npm-global', 'lib', 'node_modules', 'openclaw');
  const conflicts: string[] = [];

  for (const p of globalPaths) {
    if (fs.existsSync(path.join(p, 'package.json')) && fs.existsSync(path.join(npmGlobal, 'package.json'))) {
      try {
        const oldVer = JSON.parse(fs.readFileSync(path.join(p, 'package.json'), 'utf8')).version;
        const newVer = JSON.parse(fs.readFileSync(path.join(npmGlobal, 'package.json'), 'utf8')).version;
        if (oldVer !== newVer) conflicts.push(`${p} (v${oldVer}) conflicts with ~/.npm-global (v${newVer})`);
      } catch {}
    }
  }

  if (conflicts.length > 0) {
    return { id: 'openclaw-conflicts', label: 'Version conflicts', status: 'fail', message: 'Multiple OpenClaw versions found', fixable: 'manual',
      fixDescription: 'Run: sudo rm -rf /usr/local/lib/node_modules/openclaw /usr/local/bin/openclaw',
      detail: conflicts.join('; ') };
  }
  return { id: 'openclaw-conflicts', label: 'Version conflicts', status: 'pass', message: 'No conflicts', fixable: 'none' };
}

async function checkLaunchAgentPath(ctx: Ctx): Promise<CheckResult> {
  if (ctx.deps.platform !== 'darwin') return { id: 'launchagent-path', label: 'Gateway service', status: 'skipped', message: 'Skipped (macOS only)', fixable: 'none' };

  const plistPath = path.join(ctx.deps.homedir, 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist');
  if (!fs.existsSync(plistPath)) {
    return { id: 'launchagent-path', label: 'Gateway service', status: 'warn', message: 'Gateway service not installed', fixable: 'auto', fixDescription: 'Run openclaw gateway start to install' };
  }

  try {
    const plist = fs.readFileSync(plistPath, 'utf8');
    // Extract the openclaw path from ProgramArguments
    const indexJsMatch = plist.match(/<string>([^<]*node_modules\/openclaw\/dist\/index\.js)<\/string>/);
    if (indexJsMatch) {
      const indexJsPath = indexJsMatch[1];
      if (!fs.existsSync(indexJsPath)) {
        return { id: 'launchagent-path', label: 'Gateway service', status: 'fail',
          message: 'Gateway points to a deleted OpenClaw path',
          fixable: 'auto', fixDescription: 'Update Gateway to use the correct OpenClaw path',
          detail: `Missing: ${indexJsPath}` };
      }
    }
    return { id: 'launchagent-path', label: 'Gateway service', status: 'pass', message: 'Service paths correct', fixable: 'none' };
  } catch {
    return { id: 'launchagent-path', label: 'Gateway service', status: 'warn', message: 'Could not read Gateway service config', fixable: 'none' };
  }
}

async function fixLaunchAgentPath(ctx: Ctx): Promise<FixResult> {
  const plistPath = path.join(ctx.deps.homedir, 'Library', 'LaunchAgents', 'ai.openclaw.gateway.plist');
  try {
    let plist = fs.readFileSync(plistPath, 'utf8');
    // Find the correct openclaw index.js
    const correctPath = path.join(ctx.deps.homedir, '.npm-global', 'lib', 'node_modules', 'openclaw', 'dist', 'index.js');
    if (!fs.existsSync(correctPath)) {
      return { id: 'launchagent-path', success: false, message: 'Cannot find OpenClaw installation' };
    }
    // Replace any openclaw index.js path with the correct one
    plist = plist.replace(/<string>[^<]*node_modules\/openclaw\/dist\/index\.js<\/string>/, `<string>${correctPath}</string>`);
    fs.writeFileSync(plistPath, plist);
    // Reload the LaunchAgent
    const uid = (await ctx.deps.shellExec('id -u', 3000))?.trim() || '501';
    await ctx.deps.shellExec(`launchctl bootout gui/${uid}/ai.openclaw.gateway 2>/dev/null`, 5000);
    await ctx.deps.shellExec(`launchctl bootstrap gui/${uid} "${plistPath}" 2>/dev/null`, 5000);
    return { id: 'launchagent-path', success: true, message: 'Gateway service path fixed and reloaded' };
  } catch (err: any) {
    return { id: 'launchagent-path', success: false, message: err.message?.slice(0, 200) || 'Fix failed' };
  }
}

async function checkGatewayRunning(ctx: Ctx): Promise<CheckResult> {
  if (!ctx.openclawPath) return { id: 'gateway-running', label: 'Gateway', status: 'skipped', message: 'Skipped (OpenClaw not installed)', fixable: 'none' };
  const output = await ctx.deps.shellExec('openclaw gateway status 2>&1', 15000);
  if (isGatewayRunningOutput(output)) {
    return { id: 'gateway-running', label: 'Gateway', status: 'pass', message: 'Running', fixable: 'none' };
  }
  return { id: 'gateway-running', label: 'Gateway', status: 'fail', message: 'Gateway is not running', fixable: 'auto', fixDescription: 'Start the Gateway' };
}

async function fixGatewayStart(ctx: Ctx): Promise<FixResult> {
  try {
    await ctx.deps.shellRun('openclaw gateway start 2>&1', 20000);
    return { id: 'gateway-running', success: true, message: 'Gateway started' };
  } catch (err: any) {
    const message = err?.message || '';
    if (ctx.deps.platform === 'win32' && /schtasks run failed/i.test(message)) {
      try {
        await ctx.deps.shellRun('openclaw gateway install 2>&1', 30000);
        await ctx.deps.shellRun('openclaw gateway start 2>&1', 20000);
        return { id: 'gateway-running', success: true, message: 'Gateway service installed and started' };
      } catch (installErr: any) {
        const installMessage = installErr?.message || '';
        if (/EACCES|Access is denied|permission denied|拒绝访问|schtasks create failed/i.test(installMessage)) {
          try {
            await ctx.deps.shellRun('start "" /B openclaw gateway run --force', 10000);
            return {
              id: 'gateway-running',
              success: true,
              message: 'Gateway started in the current Windows session without installing a service',
            };
          } catch {
            return {
              id: 'gateway-running',
              success: false,
              message: 'Windows blocked Gateway service installation. Reopen AwarenessClaw as administrator once, then run Doctor again.',
            };
          }
        }
        return { id: 'gateway-running', success: false, message: installMessage.slice(0, 200) || 'Could not repair Gateway service' };
      }
    }
    return { id: 'gateway-running', success: false, message: 'Could not start Gateway. Check logs in Settings.' };
  }
}

async function checkPluginInstalled(ctx: Ctx): Promise<CheckResult> {
  const pluginPath = path.join(ctx.deps.homedir, '.openclaw', 'extensions', 'openclaw-memory');
  if (fs.existsSync(path.join(pluginPath, 'package.json'))) {
    return { id: 'plugin-installed', label: 'Awareness plugin', status: 'pass', message: 'Installed', fixable: 'none' };
  }
  return { id: 'plugin-installed', label: 'Awareness plugin', status: 'fail', message: 'Awareness Memory plugin is missing', fixable: 'auto', fixDescription: 'Install the Awareness Memory plugin' };
}

async function fixPluginInstall(ctx: Ctx): Promise<FixResult> {
  const HOME = ctx.deps.homedir;
  const extensionsDir = path.join(HOME, '.openclaw', 'extensions');
  const extDir = path.join(extensionsDir, 'openclaw-memory');
  const nullDev = ctx.deps.platform === 'win32' ? 'NUL' : '/dev/null';

  // Primary: direct npm pack + extract (avoids openclaw/clawhub cwd=/ path issues in Electron)
  try {
    fs.mkdirSync(extensionsDir, { recursive: true });
    if (fs.existsSync(extDir)) fs.rmSync(extDir, { recursive: true, force: true });
    const packOut = await ctx.deps.shellRun(`cd "${extensionsDir}" && npm pack @awareness-sdk/openclaw-memory@latest 2>${nullDev}`, 60000);
    // Find the .tgz filename in npm pack output (last line is usually the filename,
    // but npm may also emit warnings — use .find() for robustness)
    const tgzName = packOut.trim().split('\n').map(l => l.trim()).reverse().find(l => l.endsWith('.tgz')) || '';
    if (!tgzName) throw new Error('npm pack failed');
    const tgzPath = path.join(extensionsDir, tgzName);
    fs.mkdirSync(extDir, { recursive: true });
    await ctx.deps.shellRun(`tar -xzf "${tgzPath}" -C "${extDir}" --strip-components=1`, 30000);
    try { fs.unlinkSync(tgzPath); } catch { /* best-effort */ }
    persistAwarenessPluginConfig(HOME);
    return { id: 'plugin-installed', success: true, message: 'Plugin installed' };
  } catch { /* fall through */ }

  // Fallback: openclaw plugins install with cd to HOME
  try {
    await ctx.deps.shellRun(`cd "${HOME}" && openclaw plugins install awareness-memory 2>&1`, 30000);
    persistAwarenessPluginConfig(HOME);
    return { id: 'plugin-installed', success: true, message: 'Plugin installed via OpenClaw' };
  } catch (err: any) {
    return { id: 'plugin-installed', success: false, message: err.message?.slice(0, 200) || 'Installation failed' };
  }
}

async function checkDaemonRunning(ctx: Ctx): Promise<CheckResult> {
  return new Promise((resolve) => {
    const req = http.get('http://127.0.0.1:37800/healthz', { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ id: 'daemon-running', label: 'Local Daemon', status: 'pass', message: 'Running', fixable: 'none' });
        } else {
          resolve({ id: 'daemon-running', label: 'Local Daemon', status: 'fail', message: 'Daemon not responding', fixable: 'auto', fixDescription: 'Restart the local daemon' });
        }
      });
    });
    req.on('error', () => {
      resolve({ id: 'daemon-running', label: 'Local Daemon', status: 'fail', message: 'Local Daemon is not running', fixable: 'auto', fixDescription: 'Start the local daemon' });
    });
    req.on('timeout', () => { req.destroy(); resolve({ id: 'daemon-running', label: 'Local Daemon', status: 'fail', message: 'Daemon not responding', fixable: 'auto', fixDescription: 'Restart daemon' }); });
  });
}

async function fixDaemonStart(ctx: Ctx): Promise<FixResult> {
  try {
    // Clean corrupted npx cache first (common cause of ENOTEMPTY errors)
    const npxCacheDir = path.join(ctx.deps.homedir, '.npm', '_npx');
    if (fs.existsSync(npxCacheDir)) {
      try {
        const entries = fs.readdirSync(npxCacheDir);
        for (const entry of entries) {
          const entryPath = path.join(npxCacheDir, entry, 'node_modules', '@awareness-sdk');
          if (fs.existsSync(entryPath)) {
            fs.rmSync(path.join(npxCacheDir, entry), { recursive: true, force: true });
          }
        }
      } catch { /* best effort cleanup */ }
    }
    const projectDir = path.join(ctx.deps.homedir, '.openclaw');
    await ctx.deps.shellRun(`npx -y @awareness-sdk/local@latest start --port 37800 --project "${projectDir}" --background 2>&1`, 60000);
    await new Promise(r => setTimeout(r, 5000));
    return { id: 'daemon-running', success: true, message: 'Daemon started' };
  } catch (err: any) {
    return { id: 'daemon-running', success: false, message: err.message?.slice(0, 200) || 'Could not start daemon' };
  }
}

async function checkChannelBindings(ctx: Ctx): Promise<CheckResult> {
  if (!ctx.openclawPath || !ctx.config) return { id: 'channel-bindings', label: 'Channel routing', status: 'skipped', message: 'Skipped', fixable: 'none' };
  const enabledChannels = getEnabledChannels(ctx.config);
  if (enabledChannels.length === 0) return { id: 'channel-bindings', label: 'Channel routing', status: 'pass', message: 'No channels configured', fixable: 'none' };

  try {
    const unbound = await getUnboundChannels(ctx);
    if (unbound === null) {
      return { id: 'channel-bindings', label: 'Channel routing', status: 'warn', message: 'Could not verify channel routing', fixable: 'none' };
    }

    if (unbound.length > 0) {
      return { id: 'channel-bindings', label: 'Channel routing', status: 'warn',
        message: `${unbound.length} channel(s) not bound to any agent`, fixable: 'auto',
        fixDescription: `Bind ${unbound.join(', ')} to the main agent`, detail: unbound.join(', ') };
    }

    return { id: 'channel-bindings', label: 'Channel routing', status: 'pass', message: 'All channels routed', fixable: 'none' };
  } catch {
    return { id: 'channel-bindings', label: 'Channel routing', status: 'warn', message: 'Could not verify channel routing', fixable: 'none' };
  }
}

async function fixChannelBindings(ctx: Ctx): Promise<FixResult> {
  const unboundChannels = await getUnboundChannels(ctx);
  if (unboundChannels === null) {
    return { id: 'channel-bindings', success: false, message: 'Could not verify which channels still need binding' };
  }

  if (unboundChannels.length === 0) {
    return { id: 'channel-bindings', success: true, message: 'All channels are already bound' };
  }

  let fixed = 0;
  const failed: string[] = [];

  for (const ch of unboundChannels) {
    try {
      await ctx.deps.shellRun(`openclaw agents bind --agent main --bind "${ch}" 2>&1`, 10000);
      fixed++;
    } catch {
      failed.push(ch);
    }
  }

  if (failed.length > 0) {
    return { id: 'channel-bindings', success: false, message: `Could not bind: ${failed.join(', ')}` };
  }

  return { id: 'channel-bindings', success: true, message: `Bound ${fixed} channel(s) to main agent` };
}

async function checkConfigPermissions(ctx: Ctx): Promise<CheckResult> {
  if (ctx.deps.platform === 'win32') return { id: 'config-permissions', label: 'Config security', status: 'skipped', message: 'Skipped (Windows)', fixable: 'none' };
  try {
    const stat = fs.statSync(ctx.configPath);
    const mode = (stat.mode & 0o777).toString(8);
    if (mode !== '600') {
      return { id: 'config-permissions', label: 'Config security', status: 'warn', message: `Config file permissions too open (${mode})`, fixable: 'auto', fixDescription: 'Set permissions to 600 (owner only)' };
    }
    return { id: 'config-permissions', label: 'Config security', status: 'pass', message: 'Permissions correct (600)', fixable: 'none' };
  } catch {
    return { id: 'config-permissions', label: 'Config security', status: 'skipped', message: 'Config file not found', fixable: 'none' };
  }
}

async function fixConfigPermissions(ctx: Ctx): Promise<FixResult> {
  try {
    fs.chmodSync(ctx.configPath, 0o600);
    return { id: 'config-permissions', success: true, message: 'Permissions set to 600' };
  } catch (err: any) {
    return { id: 'config-permissions', success: false, message: err.message?.slice(0, 200) || 'Failed' };
  }
}

async function checkNpmPrefixWritable(ctx: Ctx): Promise<CheckResult> {
  if (!ctx.npmPrefix) return { id: 'npm-prefix-writable', label: 'npm permissions', status: 'skipped', message: 'Skipped', fixable: 'none' };
  try {
    fs.accessSync(ctx.npmPrefix, fs.constants.W_OK);
    return { id: 'npm-prefix-writable', label: 'npm permissions', status: 'pass', message: 'npm global directory is writable', fixable: 'none' };
  } catch {
    return { id: 'npm-prefix-writable', label: 'npm permissions', status: 'warn',
      message: 'npm global directory is not writable — upgrades may fail', fixable: 'manual',
      fixDescription: 'Run: npm config set prefix ~/.npm-global && export PATH=~/.npm-global/bin:$PATH' };
  }
}

// --- Check registry ---

const CHECK_REGISTRY: Record<string, { check: (ctx: Ctx) => Promise<CheckResult>; fix?: (ctx: Ctx) => Promise<FixResult> }> = {
  'node-installed': { check: checkNodeInstalled },
  'openclaw-installed': { check: checkOpenclawInstalled, fix: fixOpenclawInstall },
  'openclaw-command-health': { check: checkOpenclawCommandHealth, fix: fixOpenclawCommandHealth },
  'openclaw-version': { check: checkOpenclawVersion, fix: fixOpenclawUpdate },
  'openclaw-conflicts': { check: checkMultiVersionConflicts },
  'launchagent-path': { check: checkLaunchAgentPath, fix: fixLaunchAgentPath },
  'gateway-running': { check: checkGatewayRunning, fix: fixGatewayStart },
  'plugin-installed': { check: checkPluginInstalled, fix: fixPluginInstall },
  'daemon-running': { check: checkDaemonRunning, fix: fixDaemonStart },
  'channel-bindings': { check: checkChannelBindings, fix: fixChannelBindings },
  'config-permissions': { check: checkConfigPermissions, fix: fixConfigPermissions },
  'npm-prefix-writable': { check: checkNpmPrefixWritable },
};

const CHECK_ORDER = [
  'node-installed', 'openclaw-installed', 'openclaw-command-health', 'openclaw-version', 'openclaw-conflicts',
  'launchagent-path', 'gateway-running', 'plugin-installed', 'daemon-running',
  'channel-bindings', 'config-permissions', 'npm-prefix-writable',
];

// --- Public API ---

export function createDoctor(deps: DoctorDeps) {
  async function runChecks(subset?: string[]): Promise<DoctorReport> {
    const ctx = await buildContext(deps);
    const checks: CheckResult[] = [];
    const order = subset || CHECK_ORDER;
    for (const id of order) {
      const entry = CHECK_REGISTRY[id];
      if (!entry) continue;
      try {
        const result = await entry.check(ctx);
        checks.push(result);
      } catch {
        checks.push({ id, label: id, status: 'fail', message: 'Check failed unexpectedly', fixable: 'none' });
      }
    }
    const summary = { pass: 0, warn: 0, fail: 0, skipped: 0 };
    for (const c of checks) summary[c.status]++;
    return { timestamp: Date.now(), checks, summary };
  }

  async function runAllChecks(): Promise<DoctorReport> {
    return runChecks();
  }

  async function runFix(checkId: string): Promise<FixResult> {
    const entry = CHECK_REGISTRY[checkId];
    if (!entry?.fix) return { id: checkId, success: false, message: 'No auto-fix available' };
    const ctx = await buildContext(deps);
    try {
      return await entry.fix(ctx);
    } catch (err: any) {
      return { id: checkId, success: false, message: err.message?.slice(0, 200) || 'Fix failed' };
    }
  }

  return { runAllChecks, runChecks, runFix };
}
