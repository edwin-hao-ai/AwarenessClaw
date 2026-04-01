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

export const DEFAULT_EXEC_APPROVAL_ASK = 'on-miss' as const;

export type ExecApprovalAsk = 'off' | 'on-miss';

interface ExecApprovalsConfig {
  version: number;
  defaults?: {
    ask?: string;
    [key: string]: unknown;
  };
  agents?: Record<string, unknown>;
  socket?: Record<string, unknown>;
  [key: string]: unknown;
}

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
  const prefix = getManagedOpenClawPrefix(homedir);
  // npm install -g --prefix puts packages under lib/node_modules/ (not node_modules/)
  const candidates = [
    path.join(prefix, 'lib', 'node_modules', 'openclaw', 'openclaw.mjs'),
    path.join(prefix, 'node_modules', 'openclaw', 'openclaw.mjs'),
  ];
  for (const entry of candidates) {
    if (fs.existsSync(entry)) return entry;
  }
  return null;
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

export function getExecApprovalsPath(homedir: string): string {
  return path.join(homedir, '.openclaw', 'exec-approvals.json');
}

export function readExecApprovalsConfig(homedir: string): ExecApprovalsConfig {
  const configPath = getExecApprovalsPath(homedir);

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ExecApprovalsConfig;
    return {
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      defaults: typeof parsed.defaults === 'object' && parsed.defaults ? parsed.defaults : {},
      agents: typeof parsed.agents === 'object' && parsed.agents ? parsed.agents : {},
      socket: typeof parsed.socket === 'object' && parsed.socket ? parsed.socket : undefined,
      ...parsed,
    };
  } catch {
    return {
      version: 1,
      defaults: {},
      agents: {},
    };
  }
}

export function getExecApprovalAsk(homedir: string): ExecApprovalAsk {
  const config = readExecApprovalsConfig(homedir);
  return config.defaults?.ask === 'off' ? 'off' : DEFAULT_EXEC_APPROVAL_ASK;
}

export function writeExecApprovalAsk(homedir: string, ask: ExecApprovalAsk): void {
  const configPath = getExecApprovalsPath(homedir);
  const config = readExecApprovalsConfig(homedir);

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    ...config,
    version: typeof config.version === 'number' ? config.version : 1,
    defaults: {
      ...(config.defaults || {}),
      ask,
    },
    agents: typeof config.agents === 'object' && config.agents ? config.agents : {},
  }, null, 2));
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
