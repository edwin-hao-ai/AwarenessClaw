/**
 * Unified Channel Registry — single source of truth for all channel metadata.
 *
 * Design principle: Only WeChat + Local are "builtin" (custom logic).
 * Everything else is dynamically discovered from OpenClaw's install directory
 * and enhanced with known overrides (brand colors, multi-field configs, one-click flows).
 *
 * Data sources:
 *   - OpenClaw dist/channel-catalog.json (labels, blurbs, npm packages)
 *   - OpenClaw dist/cli-startup-metadata.json (full channel ID list)
 *   - KNOWN_OVERRIDES below (our UX enhancements for channels we've verified)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigField {
  key: string;
  label: string;
  placeholder?: string;
  type: 'password' | 'text' | 'file';
  hint?: string;
  required?: boolean;
  cliFlag: string;
}

export interface ChannelDef {
  id: string;
  openclawId: string;
  label: string;
  description?: string;
  color: string;
  iconType: 'svg' | 'letter';
  connectionType: 'token' | 'multi-field' | 'one-click';
  configFields: ConfigField[];
  saveStrategy: 'cli' | 'json-direct';
  pluginPackage?: string;
  setupFlow?: 'qr-login' | 'add-only' | 'add-then-login';
  source: 'builtin' | 'openclaw-dynamic';
  order: number;
  docsSlug?: string;
}

// ---------------------------------------------------------------------------
// Only 2 true builtins: local (not a channel) + wechat (third-party plugin)
// ---------------------------------------------------------------------------

const BUILTIN_CHANNELS: ChannelDef[] = [
  {
    id: 'local', openclawId: 'local', label: 'Local Chat',
    description: 'Chat directly from the desktop app',
    color: '#6366F1', iconType: 'svg',
    connectionType: 'one-click', configFields: [],
    saveStrategy: 'cli', order: 0, source: 'builtin',
  },
  {
    id: 'wechat', openclawId: 'openclaw-weixin', label: 'WeChat',
    description: 'Link WeChat via QR',
    color: '#07C160', iconType: 'svg',
    connectionType: 'one-click', configFields: [],
    saveStrategy: 'json-direct', pluginPackage: '@tencent-weixin/openclaw-weixin',
    setupFlow: 'qr-login', order: 4, source: 'builtin',
  },
];

// ---------------------------------------------------------------------------
// Known overrides — UX enhancements for channels we've verified
// Applied on top of OpenClaw dynamic discovery
// ---------------------------------------------------------------------------

interface KnownOverride {
  label?: string;
  color?: string;
  iconType?: 'svg';
  connectionType?: 'one-click' | 'multi-field';
  configFields?: ConfigField[];
  saveStrategy?: 'json-direct'; // only set for channels NOT in `openclaw channels add --channel` enum
  setupFlow?: 'qr-login' | 'add-only' | 'add-then-login';
  order?: number;
}

// Dynamic: populated at runtime from `openclaw channels add --help`
// Channels in this set use CLI `channels add`, others use json-direct write
let _cliSupportedChannels = new Set<string>();

/** Parse CLI-supported channels from `openclaw channels add --help` output */
export function parseCliSupportedChannels(helpOutput: string): Set<string> {
  const match = helpOutput.match(/--channel\s+<\w+>\s+Channel\s*\n\s*\(([^)]+)\)/);
  if (match) {
    return new Set(match[1].split('|').map(s => s.trim().toLowerCase()));
  }
  return new Set();
}

/** Set the CLI-supported channels (called from main.ts after running --help) */
export function setCliSupportedChannels(channels: Set<string>): void {
  _cliSupportedChannels = channels;
}

/** Check if a channel uses CLI or json-direct */
export function isCliSupported(id: string): boolean {
  return _cliSupportedChannels.has(id);
}

const KNOWN_OVERRIDES: Record<string, KnownOverride> = {
  // -- One-click channels (QR / auto) --
  whatsapp: { color: '#25D366', iconType: 'svg', connectionType: 'one-click', configFields: [], setupFlow: 'qr-login', order: 3 },
  signal:   { color: '#3A76F0', iconType: 'svg', connectionType: 'one-click', configFields: [], setupFlow: 'add-then-login', order: 6 },
  imessage: { color: '#34C759', iconType: 'svg', connectionType: 'one-click', configFields: [], setupFlow: 'add-only', order: 7 },

  // -- Single-token channels (with brand colors for SVG icons) --
  telegram: { color: '#26A5E4', iconType: 'svg', order: 1 },
  discord:  { color: '#5865F2', iconType: 'svg', order: 2 },
  line:     { color: '#06C755', iconType: 'svg', order: 10 },
  feishu:   { color: '#3370FF', iconType: 'svg', order: 8 },

  // -- Multi-field channels --
  slack: {
    color: '#4A154B', iconType: 'svg', connectionType: 'multi-field', order: 5,
    configFields: [
      { key: 'botToken', label: 'Bot Token (xoxb-...)', placeholder: 'xoxb-...', type: 'password', required: true, cliFlag: '--bot-token' },
      { key: 'appToken', label: 'App Token (xapp-...)', placeholder: 'xapp-...', type: 'password', required: true, cliFlag: '--app-token' },
    ],
  },
  matrix: {
    color: '#0DBD8B', iconType: 'svg', connectionType: 'multi-field', order: 11,
    configFields: [
      { key: 'homeserver', label: 'Homeserver URL', placeholder: 'https://matrix.org', type: 'text', required: true, cliFlag: '--homeserver' },
      { key: 'userId', label: 'User ID', placeholder: '@bot:matrix.org', type: 'text', required: true, cliFlag: '--user-id' },
      { key: 'password', label: 'Password', placeholder: '', type: 'password', required: true, cliFlag: '--password' },
    ],
  },
  googlechat: {
    label: 'Google Chat', color: '#1A73E8', iconType: 'svg', connectionType: 'multi-field', order: 9,
    configFields: [
      { key: 'webhookUrl', label: 'Webhook URL', placeholder: 'https://chat.googleapis.com/...', type: 'text', required: true, cliFlag: '--webhook-url' },
    ],
  },
  nostr: {
    connectionType: 'multi-field',
    configFields: [
      { key: 'privateKey', label: 'Private Key (nsec...)', placeholder: 'nsec1...', type: 'password', required: true, cliFlag: '--private-key' },
    ],
  },
  tlon: {
    connectionType: 'multi-field',
    configFields: [
      { key: 'ship', label: 'Ship Name', placeholder: '~sampel-palnet', type: 'text', required: true, cliFlag: '--ship' },
      { key: 'url', label: 'Ship URL', placeholder: 'https://...', type: 'text', required: true, cliFlag: '--url' },
      { key: 'code', label: 'Login Code', placeholder: '', type: 'password', required: true, cliFlag: '--code' },
    ],
  },
  msteams: {
    label: 'Microsoft Teams', connectionType: 'multi-field',
    configFields: [
      { key: 'appId', label: 'App ID', placeholder: '', type: 'text', required: true, cliFlag: '' },
      { key: 'appPassword', label: 'App Password', placeholder: '', type: 'password', required: true, cliFlag: '' },
      { key: 'tenantId', label: 'Tenant ID', placeholder: '', type: 'text', required: true, cliFlag: '' },
    ],
  },
  bluebubbles: {
    connectionType: 'multi-field',
    configFields: [
      { key: 'webhookPath', label: 'Webhook Path', placeholder: '', type: 'text', required: true, cliFlag: '--webhook-path' },
    ],
  },
};

// Default single-token config field (used for most channels)
const DEFAULT_TOKEN_FIELD: ConfigField = { key: 'token', label: 'Token', placeholder: '', type: 'password', required: true, cliFlag: '--token' };

// ---------------------------------------------------------------------------
// Index maps
// ---------------------------------------------------------------------------

const _byFrontendId = new Map<string, ChannelDef>();
const _byOpenclawId = new Map<string, ChannelDef>();
let _dynamicChannels: ChannelDef[] = [];

function _rebuildIndices() {
  _byFrontendId.clear();
  _byOpenclawId.clear();
  for (const ch of BUILTIN_CHANNELS) {
    _byFrontendId.set(ch.id, ch);
    _byOpenclawId.set(ch.openclawId, ch);
  }
  for (const ch of _dynamicChannels) {
    if (!_byFrontendId.has(ch.id)) _byFrontendId.set(ch.id, ch);
    if (!_byOpenclawId.has(ch.openclawId)) _byOpenclawId.set(ch.openclawId, ch);
  }
}

_rebuildIndices();

// ---------------------------------------------------------------------------
// Deterministic color from string hash
// ---------------------------------------------------------------------------

const PALETTE = [
  '#6366F1', '#EC4899', '#F59E0B', '#10B981', '#3B82F6',
  '#8B5CF6', '#EF4444', '#14B8A6', '#F97316', '#06B6D4',
  '#84CC16', '#E879F9', '#22D3EE', '#A78BFA', '#FB923C',
];

function hashColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

// ---------------------------------------------------------------------------
// Build a ChannelDef from OpenClaw data + known overrides
// ---------------------------------------------------------------------------

function buildDynamicChannel(id: string, label: string, opts: {
  description?: string; npmSpec?: string; docsSlug?: string; catalogOrder?: number;
}): ChannelDef {
  const override = KNOWN_OVERRIDES[id];
  const isOneClick = override?.connectionType === 'one-click';
  const isMultiField = override?.connectionType === 'multi-field';

  return {
    id,
    openclawId: id,
    label: override?.label || label,
    description: opts.description || '',
    color: override?.color || hashColor(id),
    iconType: override?.iconType || 'letter',
    connectionType: isOneClick ? 'one-click' : isMultiField ? 'multi-field' : 'token',
    configFields: isOneClick ? [] : (override?.configFields || [{ ...DEFAULT_TOKEN_FIELD }]),
    saveStrategy: _cliSupportedChannels.has(id) ? 'cli' : 'json-direct',
    pluginPackage: opts.npmSpec || `@openclaw/${id}`,
    setupFlow: override?.setupFlow,
    source: 'openclaw-dynamic',
    order: override?.order ?? (100 + (opts.catalogOrder ?? 0)),
    docsSlug: opts.docsSlug || id,
  };
}

// ---------------------------------------------------------------------------
// Dynamic discovery
// ---------------------------------------------------------------------------

export interface CatalogEntry {
  name: string;
  openclaw?: {
    channel?: { id: string; label?: string; blurb?: string; selectionLabel?: string; docsPath?: string; order?: number };
    install?: { npmSpec?: string };
  };
}

/** Merge channel-catalog.json entries. Builtin channels (local, wechat) are never overridden. */
export function mergeCatalog(entries: CatalogEntry[]): void {
  const builtinIds = new Set(BUILTIN_CHANNELS.map(c => c.id));
  const builtinOcIds = new Set(BUILTIN_CHANNELS.map(c => c.openclawId));
  const added: ChannelDef[] = [];

  for (const entry of entries) {
    const ch = entry.openclaw?.channel;
    if (!ch?.id) continue;
    if (builtinIds.has(ch.id) || builtinOcIds.has(ch.id)) continue;

    added.push(buildDynamicChannel(ch.id, ch.label || ch.id, {
      description: ch.blurb || ch.selectionLabel || '',
      npmSpec: entry.openclaw?.install?.npmSpec,
      docsSlug: ch.docsPath?.replace(/^\/channels\//, '') || ch.id,
      catalogOrder: ch.order ?? added.length,
    }));
  }

  _dynamicChannels = added;
  _rebuildIndices();
}

/** Merge cli-startup-metadata channelOptions. Only adds IDs not already known. */
export function mergeChannelOptions(channelIds: string[]): void {
  const added: ChannelDef[] = [];
  for (const id of channelIds) {
    if (_byFrontendId.has(id) || _byOpenclawId.has(id)) continue;
    const label = id.charAt(0).toUpperCase() + id.slice(1).replace(/-/g, ' ');
    added.push(buildDynamicChannel(id, label, { catalogOrder: 200 + added.length }));
  }
  if (added.length > 0) {
    _dynamicChannels.push(...added);
    _rebuildIndices();
  }
}

/** Initialize from serialized data (renderer side, after IPC). */
export function loadFromSerialized(channels: ChannelDef[]): void {
  _dynamicChannels = channels.filter(c => c.source !== 'builtin');
  _rebuildIndices();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getAllChannels(): ChannelDef[] {
  return [...BUILTIN_CHANNELS, ..._dynamicChannels].sort((a, b) => a.order - b.order);
}

export function getBuiltinChannels(): ChannelDef[] {
  return [...BUILTIN_CHANNELS];
}

export function getChannel(id: string): ChannelDef | undefined {
  return _byFrontendId.get(id);
}

export function getChannelByOpenclawId(ocId: string): ChannelDef | undefined {
  return _byOpenclawId.get(ocId);
}

export function toOpenclawId(frontendId: string): string {
  return _byFrontendId.get(frontendId)?.openclawId ?? frontendId;
}

export function toFrontendId(openclawId: string): string {
  return _byOpenclawId.get(openclawId)?.id ?? openclawId;
}

export function isOneClick(id: string): boolean {
  return _byFrontendId.get(id)?.connectionType === 'one-click';
}

export function hasBrandIcon(id: string): boolean {
  return _byFrontendId.get(id)?.iconType === 'svg';
}

export function buildCLIFlags(channelDef: ChannelDef, config: Record<string, string>): string {
  const parts: string[] = [];
  for (const field of channelDef.configFields) {
    const val = config[field.key];
    if (val) {
      const escaped = val.replace(/"/g, '\\"');
      parts.push(`${field.cliFlag} "${escaped}"`);
    }
  }
  return parts.join(' ');
}

export function serializeRegistry(): ChannelDef[] {
  return getAllChannels();
}
