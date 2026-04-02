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

export function migrateLegacyChannelConfig(config: Record<string, any>): void {
  if (config?.channels?.telegram?.token) {
    if (!config.channels.telegram.botToken) {
      config.channels.telegram.botToken = config.channels.telegram.token;
    }
    delete config.channels.telegram.token;
  }
}

