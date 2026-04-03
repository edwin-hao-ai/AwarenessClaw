/**
 * Shared OpenClaw configuration utilities.
 *
 * Used by both main.ts and doctor.ts to avoid code duplication.
 * All functions accept explicit parameters (e.g. homedir) instead of relying on module-level globals.
 */

import fs from 'fs';
import path from 'path';
import { readJsonFileWithBom } from './json-file';

// --- Constants ---

export const GATEWAY_DEFAULT_PORT = 18789;

export const GATEWAY_DEFAULTS = {
  mode: 'local' as const,
  bind: 'loopback' as const,
  port: GATEWAY_DEFAULT_PORT,
};

export const DEFAULT_EXEC_APPROVAL_ASK = 'on-miss' as const;
export const DEFAULT_EXEC_APPROVAL_SECURITY = 'deny' as const;
export const DEFAULT_EXEC_APPROVAL_ASK_FALLBACK = 'deny' as const;

export type ExecApprovalAsk = 'off' | 'on-miss' | 'always';
export type ExecApprovalSecurity = 'deny' | 'allowlist' | 'full';

export type ExecApprovalAllowlistEntry = {
  id?: string;
  pattern: string;
  source?: string;
  lastUsedAt?: number;
  lastUsedCommand?: string;
  lastResolvedPath?: string;
};

export type ExecApprovalSettings = {
  security: ExecApprovalSecurity;
  ask: ExecApprovalAsk;
  askFallback: ExecApprovalSecurity;
  autoAllowSkills: boolean;
  allowlist: ExecApprovalAllowlistEntry[];
};

interface ExecApprovalsConfig {
  version: number;
  defaults?: {
    ask?: string;
    security?: string;
    askFallback?: string;
    autoAllowSkills?: boolean;
    [key: string]: unknown;
  };
  agents?: Record<string, {
    ask?: string;
    security?: string;
    askFallback?: string;
    autoAllowSkills?: boolean;
    allowlist?: ExecApprovalAllowlistEntry[];
    [key: string]: unknown;
  }>;
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
    const config = readJsonFileWithBom<Record<string, any>>(configPath);
    return Number(config?.gateway?.port) || GATEWAY_DEFAULT_PORT;
  } catch {
    return GATEWAY_DEFAULT_PORT;
  }
}

export function getAgentWorkspaceDir(homedir: string): string {
  const fallback = path.join(homedir, '.openclaw', 'workspace');
  try {
    const configPath = path.join(homedir, '.openclaw', 'openclaw.json');
    const config = readJsonFileWithBom<Record<string, any>>(configPath);
    const configured = config?.agents?.defaults?.workspace;
    return typeof configured === 'string' && configured.trim() ? configured.trim() : fallback;
  } catch {
    return fallback;
  }
}

export function getExecApprovalsPath(homedir: string): string {
  return path.join(homedir, '.openclaw', 'exec-approvals.json');
}

export function readExecApprovalsConfig(homedir: string): ExecApprovalsConfig {
  const configPath = getExecApprovalsPath(homedir);

  try {
    const parsed = readJsonFileWithBom<ExecApprovalsConfig>(configPath);
    return {
      ...parsed,
      version: typeof parsed.version === 'number' ? parsed.version : 1,
      defaults: typeof parsed.defaults === 'object' && parsed.defaults ? parsed.defaults : {},
      agents: typeof parsed.agents === 'object' && parsed.agents ? parsed.agents : {},
      socket: typeof parsed.socket === 'object' && parsed.socket ? parsed.socket : undefined,
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
  const ask = config.defaults?.ask;
  return ask === 'off' || ask === 'always' ? ask : DEFAULT_EXEC_APPROVAL_ASK;
}

export function writeExecApprovalAsk(homedir: string, ask: ExecApprovalAsk): void {
  writeExecApprovalSettings(homedir, { ask });
}

function normalizeExecApprovalSecurity(value: unknown): ExecApprovalSecurity {
  return value === 'deny' || value === 'full' ? value : DEFAULT_EXEC_APPROVAL_SECURITY;
}

function normalizeExecApprovalAsk(value: unknown): ExecApprovalAsk {
  return value === 'off' || value === 'always' ? value : DEFAULT_EXEC_APPROVAL_ASK;
}

function normalizeAllowlist(value: unknown): ExecApprovalAllowlistEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object')
    .map((entry) => ({
      ...(typeof entry.id === 'string' ? { id: entry.id } : {}),
      pattern: typeof entry.pattern === 'string' ? entry.pattern.trim() : '',
      ...(typeof entry.source === 'string' ? { source: entry.source } : {}),
      ...(typeof entry.lastUsedAt === 'number' ? { lastUsedAt: entry.lastUsedAt } : {}),
      ...(typeof entry.lastUsedCommand === 'string' ? { lastUsedCommand: entry.lastUsedCommand } : {}),
      ...(typeof entry.lastResolvedPath === 'string' ? { lastResolvedPath: entry.lastResolvedPath } : {}),
    }))
    .filter((entry) => entry.pattern);
}

export function getExecApprovalSettings(homedir: string, agentId = 'main'): ExecApprovalSettings {
  const config = readExecApprovalsConfig(homedir);
  const defaults = config.defaults || {};
  const agent = config.agents?.[agentId] || {};

  return {
    security: normalizeExecApprovalSecurity(agent.security ?? defaults.security),
    ask: normalizeExecApprovalAsk(agent.ask ?? defaults.ask),
    askFallback: normalizeExecApprovalSecurity(agent.askFallback ?? defaults.askFallback ?? DEFAULT_EXEC_APPROVAL_ASK_FALLBACK),
    autoAllowSkills: typeof (agent.autoAllowSkills ?? defaults.autoAllowSkills) === 'boolean'
      ? Boolean(agent.autoAllowSkills ?? defaults.autoAllowSkills)
      : false,
    allowlist: normalizeAllowlist(agent.allowlist),
  };
}

export function writeExecApprovalSettings(
  homedir: string,
  updates: Partial<ExecApprovalSettings>,
  agentId = 'main',
): void {
  const configPath = getExecApprovalsPath(homedir);
  const config = readExecApprovalsConfig(homedir);
  const defaults = config.defaults || {};
  const agents = typeof config.agents === 'object' && config.agents ? config.agents : {};
  const agent = agents[agentId] || {};

  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({
    ...config,
    version: typeof config.version === 'number' ? config.version : 1,
    defaults: {
      ...defaults,
      ...(updates.security !== undefined ? { security: updates.security } : {}),
      ...(updates.ask !== undefined ? { ask: updates.ask } : {}),
      ...(updates.askFallback !== undefined ? { askFallback: updates.askFallback } : {}),
      ...(updates.autoAllowSkills !== undefined ? { autoAllowSkills: updates.autoAllowSkills } : {}),
    },
    agents: {
      ...agents,
      [agentId]: {
        ...agent,
        ...(updates.allowlist !== undefined ? { allowlist: updates.allowlist } : {}),
      },
    },
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

