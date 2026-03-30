/**
 * App Doctor — automatic diagnostics and repair for AwarenessClaw.
 *
 * Checks: node, openclaw, version conflicts, gateway, plugin, daemon, bindings, permissions.
 * Each check returns a user-friendly result; fixable items can be auto-repaired.
 */

import fs from 'fs';
import path from 'path';
import http from 'http';

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
  npmPrefix: string | null;
  configPath: string;
  config: any | null;
  deps: DoctorDeps;
}

async function buildContext(deps: DoctorDeps): Promise<Ctx> {
  const configPath = path.join(deps.homedir, '.openclaw', 'openclaw.json');
  let config: any = null;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}

  const nodePath = await deps.shellExec('which node', 3000);
  const nodeVersion = nodePath ? await deps.shellExec('node --version', 3000) : null;
  const openclawPath = await deps.shellExec('which openclaw', 3000);
  const openclawVersion = openclawPath ? await deps.shellExec('openclaw --version 2>/dev/null | head -1', 8000) : null;
  const npmPrefix = await deps.shellExec('npm config get prefix 2>/dev/null', 5000);

  return {
    nodeVersion: nodeVersion?.trim() || null,
    nodePath: nodePath?.trim() || null,
    openclawVersion: openclawVersion?.trim() || null,
    openclawPath: openclawPath?.trim() || null,
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
  if (ctx.openclawPath && ctx.openclawVersion) {
    return { id: 'openclaw-installed', label: 'OpenClaw', status: 'pass', message: `Installed (${ctx.openclawVersion.match(/\d+\.\d+\.\d+/)?.[0] || ctx.openclawVersion})`, fixable: 'none' };
  }
  return { id: 'openclaw-installed', label: 'OpenClaw', status: 'fail', message: 'OpenClaw is not installed', fixable: 'auto', fixDescription: 'Install OpenClaw via npm' };
}

async function fixOpenclawInstall(ctx: Ctx): Promise<FixResult> {
  try {
    await ctx.deps.shellRun('npm install -g openclaw 2>&1', 60000);
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
    await ctx.deps.shellRun('npm update -g openclaw 2>&1', 60000);
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
    await ctx.deps.shellExec('launchctl bootout gui/501/ai.openclaw.gateway 2>/dev/null', 5000);
    await ctx.deps.shellExec(`launchctl bootstrap gui/501 "${plistPath}" 2>/dev/null`, 5000);
    return { id: 'launchagent-path', success: true, message: 'Gateway service path fixed and reloaded' };
  } catch (err: any) {
    return { id: 'launchagent-path', success: false, message: err.message?.slice(0, 200) || 'Fix failed' };
  }
}

async function checkGatewayRunning(ctx: Ctx): Promise<CheckResult> {
  if (!ctx.openclawPath) return { id: 'gateway-running', label: 'Gateway', status: 'skipped', message: 'Skipped (OpenClaw not installed)', fixable: 'none' };
  const output = await ctx.deps.shellExec('openclaw gateway status 2>&1', 15000);
  if (output && (output.includes('running') || output.includes('active'))) {
    return { id: 'gateway-running', label: 'Gateway', status: 'pass', message: 'Running', fixable: 'none' };
  }
  return { id: 'gateway-running', label: 'Gateway', status: 'fail', message: 'Gateway is not running', fixable: 'auto', fixDescription: 'Start the Gateway' };
}

async function fixGatewayStart(ctx: Ctx): Promise<FixResult> {
  try {
    await ctx.deps.shellRun('openclaw gateway start 2>&1', 20000);
    return { id: 'gateway-running', success: true, message: 'Gateway started' };
  } catch {
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
  try {
    await ctx.deps.shellRun('openclaw plugins install awareness-memory 2>&1', 30000);
    return { id: 'plugin-installed', success: true, message: 'Plugin installed' };
  } catch {
    try {
      await ctx.deps.shellRun('npx clawhub@latest install awareness-memory --force 2>&1', 30000);
      return { id: 'plugin-installed', success: true, message: 'Plugin installed via ClawHub' };
    } catch (err: any) {
      return { id: 'plugin-installed', success: false, message: err.message?.slice(0, 200) || 'Installation failed' };
    }
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
    await ctx.deps.shellRun('npx -y @awareness-sdk/local start 2>&1 &', 15000);
    // Wait a moment for startup
    await new Promise(r => setTimeout(r, 3000));
    return { id: 'daemon-running', success: true, message: 'Daemon started' };
  } catch (err: any) {
    return { id: 'daemon-running', success: false, message: err.message?.slice(0, 200) || 'Could not start daemon' };
  }
}

async function checkChannelBindings(ctx: Ctx): Promise<CheckResult> {
  if (!ctx.openclawPath || !ctx.config) return { id: 'channel-bindings', label: 'Channel routing', status: 'skipped', message: 'Skipped', fixable: 'none' };
  const channels = ctx.config.channels || {};
  const enabledChannels = Object.entries(channels).filter(([, v]: [string, any]) => v?.enabled).map(([k]) => k);
  if (enabledChannels.length === 0) return { id: 'channel-bindings', label: 'Channel routing', status: 'pass', message: 'No channels configured', fixable: 'none' };

  try {
    const output = await ctx.deps.shellExec('openclaw agents bindings --json 2>/dev/null', 10000);
    if (output) {
      const bindings = JSON.parse(output.substring(output.indexOf('[')));
      const boundChannels = new Set(bindings.map((b: any) => b.match?.channel).filter(Boolean));
      const unbound = enabledChannels.filter(ch => !boundChannels.has(ch));
      if (unbound.length > 0) {
        return { id: 'channel-bindings', label: 'Channel routing', status: 'warn',
          message: `${unbound.length} channel(s) not bound to any agent`, fixable: 'auto',
          fixDescription: `Bind ${unbound.join(', ')} to the main agent`, detail: unbound.join(', ') };
      }
    }
    return { id: 'channel-bindings', label: 'Channel routing', status: 'pass', message: 'All channels routed', fixable: 'none' };
  } catch {
    return { id: 'channel-bindings', label: 'Channel routing', status: 'warn', message: 'Could not verify channel routing', fixable: 'none' };
  }
}

async function fixChannelBindings(ctx: Ctx): Promise<FixResult> {
  const channels = ctx.config?.channels || {};
  const enabledChannels = Object.entries(channels).filter(([, v]: [string, any]) => v?.enabled).map(([k]) => k);
  let fixed = 0;
  for (const ch of enabledChannels) {
    try {
      await ctx.deps.shellRun(`openclaw agents bind --agent main --bind "${ch}" 2>&1`, 10000);
      fixed++;
    } catch { /* may already be bound */ }
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
  'node-installed', 'openclaw-installed', 'openclaw-version', 'openclaw-conflicts',
  'launchagent-path', 'gateway-running', 'plugin-installed', 'daemon-running',
  'channel-bindings', 'config-permissions', 'npm-prefix-writable',
];

// --- Public API ---

export function createDoctor(deps: DoctorDeps) {
  async function runAllChecks(): Promise<DoctorReport> {
    const ctx = await buildContext(deps);
    const checks: CheckResult[] = [];
    for (const id of CHECK_ORDER) {
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

  return { runAllChecks, runFix };
}
