/**
 * Shared OpenClaw configuration utilities.
 *
 * Used by both main.ts and doctor.ts to avoid code duplication.
 * All functions accept explicit parameters (e.g. homedir) instead of relying on module-level globals.
 */

import fs from 'fs';
import path from 'path';

// --- Constants ---

export const GATEWAY_DEFAULT_PORT = 18789;

export const GATEWAY_DEFAULTS = {
  mode: 'local' as const,
  bind: 'loopback' as const,
  port: GATEWAY_DEFAULT_PORT,
};

// --- Plugin allow-list normalization ---

/**
 * Normalize a `plugins.allow` value into a deduplicated string array.
 * Handles the case where OpenClaw config writes it as a single string instead of an array.
 */
export function normalizePluginAllow(value: unknown): string[] | undefined {
  const rawValues = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? [value]
      : [];

  const normalized = Array.from(new Set(
    rawValues
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean),
  ));

  return normalized.length > 0 ? normalized : undefined;
}

// --- Gateway status detection ---

/**
 * Determine whether `openclaw gateway status` output indicates a running Gateway.
 * Rejects negative signals (stopped, not running, probe failed) before accepting positive ones.
 */
export function isGatewayRunningOutput(output: string | null): boolean {
  if (!output) return false;

  const normalized = output.toLowerCase();
  if (
    normalized.includes('runtime: stopped') ||
    normalized.includes('not running') ||
    normalized.includes('no listener detected') ||
    normalized.includes('rpc probe: failed')
  ) {
    return false;
  }

  return normalized.includes('runtime: running') ||
    normalized.includes('rpc probe: ok') ||
    normalized.includes('listening:');
}

// --- Managed runtime paths ---

export function getManagedOpenClawPrefix(homedir: string): string {
  return path.join(homedir, '.awareness-claw', 'openclaw-runtime');
}

export function getManagedOpenClawEntrypoint(homedir: string): string | null {
  const entry = path.join(getManagedOpenClawPrefix(homedir), 'node_modules', 'openclaw', 'openclaw.mjs');
  return fs.existsSync(entry) ? entry : null;
}

export function getGatewayPort(homedir: string): number {
  try {
    const configPath = path.join(homedir, '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return Number(config?.gateway?.port) || GATEWAY_DEFAULT_PORT;
  } catch {
    return GATEWAY_DEFAULT_PORT;
  }
}

// --- Windows Gateway service script repair ---

export interface GatewayServiceScriptOptions {
  /** Full node invocation command, e.g. `"C:\\Program Files\\nodejs\\node.exe"` or `node` */
  nodeCommand: string;
  /** TMPDIR override for the gateway.cmd script (defaults to homedir/AppData/Local/Temp) */
  tmpdir?: string;
}

/**
 * Repair `~/.openclaw/gateway.cmd` to point at the managed runtime entrypoint.
 * Fixes stale paths from old global installs or bad Electron references.
 */
export function repairWindowsGatewayServiceScript(homedir: string, options: GatewayServiceScriptOptions): void {
  if (process.platform !== 'win32') return;

  const entry = getManagedOpenClawEntrypoint(homedir);
  if (!entry) return;

  const gatewayScriptPath = path.join(homedir, '.openclaw', 'gateway.cmd');
  const { nodeCommand, tmpdir } = options;
  const gatewayPort = getGatewayPort(homedir);
  const desiredCommand = `${nodeCommand} "${entry}" gateway --port ${gatewayPort}`;

  let shouldRewrite = !fs.existsSync(gatewayScriptPath);
  if (!shouldRewrite) {
    try {
      const current = fs.readFileSync(gatewayScriptPath, 'utf8');
      shouldRewrite = !current.includes(desiredCommand) ||
        current.includes('AwarenessClaw.exe') ||
        current.includes('AppData\\Roaming\\npm\\node_modules\\openclaw\\dist\\index.js');
    } catch {
      shouldRewrite = true;
    }
  }

  if (!shouldRewrite) return;

  const resolvedTmpdir = tmpdir || path.join(homedir, 'AppData', 'Local', 'Temp');
  const content = [
    '@echo off',
    'rem OpenClaw Gateway (AwarenessClaw managed runtime)',
    `set "TMPDIR=${resolvedTmpdir}"`,
    `set "OPENCLAW_GATEWAY_PORT=${gatewayPort}"`,
    'set "OPENCLAW_WINDOWS_TASK_NAME=OpenClaw Gateway"',
    'set "OPENCLAW_SERVICE_MARKER=openclaw"',
    'set "OPENCLAW_SERVICE_KIND=gateway"',
    desiredCommand,
    '',
  ].join('\r\n');

  fs.mkdirSync(path.dirname(gatewayScriptPath), { recursive: true });
  fs.writeFileSync(gatewayScriptPath, content, 'utf8');
}
