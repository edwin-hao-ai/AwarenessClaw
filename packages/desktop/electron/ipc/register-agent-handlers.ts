import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { parseJsonShellOutput } from '../openclaw-shell-output';

const DEFAULT_AGENT_IDS = new Set(['main', 'default']);
const PREFERRED_MARKDOWN_ORDER = [
  'AGENTS.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  'MEMORY.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
];

function toAgentSlug(agentId: string) {
  return agentId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

function isAllowedMarkdownFile(fileName: string) {
  return path.basename(fileName) === fileName && /^[A-Za-z0-9._-]+\.md$/i.test(fileName);
}

function getAgentReadDirectories(home: string, agentId: string) {
  const slug = toAgentSlug(agentId);
  const globalWorkspaceDir = path.join(home, '.openclaw', 'workspace');
  const agentDir = path.join(home, '.openclaw', 'agents', slug, 'agent');
  if (DEFAULT_AGENT_IDS.has(agentId)) return [globalWorkspaceDir, agentDir];
  // OpenClaw uses two possible workspace paths depending on how the agent was created:
  // - ~/.openclaw/workspaces/<slug> (if --workspace was passed)
  // - ~/.openclaw/workspace-<slug> (OpenClaw's default when no --workspace is passed)
  // Check both, prefer whichever actually exists.
  const nestedWsDir = path.join(home, '.openclaw', 'workspaces', slug);
  const flatWsDir = path.join(home, '.openclaw', `workspace-${slug}`);
  const wsDir = fs.existsSync(flatWsDir) ? flatWsDir : nestedWsDir;
  return [wsDir, agentDir];
}

function listMarkdownFilesFromDirectories(directories: string[]) {
  const discovered = new Set<string>();
  for (const directory of directories) {
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!isAllowedMarkdownFile(entry.name)) continue;
      discovered.add(entry.name);
    }
  }
  return Array.from(discovered).sort((left, right) => {
    const leftIndex = PREFERRED_MARKDOWN_ORDER.indexOf(left);
    const rightIndex = PREFERRED_MARKDOWN_ORDER.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });
}

export function registerAgentHandlers(deps: {
  home: string;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  ensureGatewayRunning: () => Promise<{ ok: boolean; error?: string }>;
  runAsync: (cmd: string, timeoutMs?: number) => Promise<string>;
  runSpawnAsync: (cmd: string, args: string[], timeoutMs?: number) => Promise<string>;
}) {
  ipcMain.handle('agents:list', async () => {
    try {
      const output = await deps.readShellOutputAsync('openclaw agents list --json --bindings', 15000);
      if (output) {
        try {
          const parsed = parseJsonShellOutput<any>(output);
          if (!parsed) {
            throw new Error('Could not parse agents JSON');
          }
          let list: any[] = [];
          if (Array.isArray(parsed)) {
            list = parsed;
          } else if (Array.isArray(parsed.agents)) {
            list = parsed.agents;
          } else if (Array.isArray(parsed.data)) {
            list = parsed.data;
          } else if (parsed && typeof parsed === 'object' && (parsed.id || parsed.name)) {
            list = [parsed];
          }
          if (list.length > 0) {
            const agents = list.map((a: any) => ({
              id: a.id || a.name || 'main',
              name: a.identityName || a.displayName || a.name || a.id,
              emoji: a.identityEmoji || a.emoji || '🤖',
              model: a.model || a.defaultModel || null,
              bindings: Array.isArray(a.bindingDetails) ? a.bindingDetails : Array.isArray(a.bindings) ? a.bindings : [],
              isDefault: a.isDefault === true || a.default === true || a.id === 'main',
              workspace: a.workspace || a.workspacePath || null,
              routes: a.routes || a.channels || [],
            }));
            return { success: true, agents };
          }
        } catch {}
      }
      return { success: true, agents: [{ id: 'main', name: 'Main Agent', emoji: '🦞', isDefault: true, bindings: [] }] };
    } catch {
      return { success: true, agents: [{ id: 'main', name: 'Main Agent', emoji: '🦞', isDefault: true, bindings: [] }] };
    }
  });

  ipcMain.handle('agents:add', async (_e: any, name: string, model?: string, systemPrompt?: string) => {
    try {
      // Allow Unicode display names (Chinese, Japanese, etc.) — only strip shell-unsafe chars
      const displayName = name.replace(/["\\\n\r]/g, '').trim();
      if (!displayName) return { success: false, error: 'Invalid agent name' };
      await deps.ensureGatewayRunning();
      // Slug must be ASCII for filesystem safety.
      // Chinese/Japanese/etc names produce empty slug after stripping, so we use oc-<timestamp>.
      // We also prefix with "oc-" to avoid OpenClaw reserved names like "main".
      const rawSlug = displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
      const slug = rawSlug || `oc-${Date.now()}`;
      // Use OpenClaw's default workspace path format: ~/.openclaw/workspace-<slug>
      // NOT ~/.openclaw/workspaces/<slug> which is our old convention.
      // --non-interactive requires --workspace, and OpenClaw seeds workspace files
      // (AGENTS.md, BOOTSTRAP.md, SOUL.md, etc.) only when the dir does NOT exist.
      //
      // CRITICAL: Pass the ASCII slug as the agent name to `openclaw agents add`, NOT the
      // Unicode displayName. OpenClaw normalizes non-ASCII names by stripping all non-ASCII
      // chars, which for pure Chinese names produces "" → fallback to "main" → rejected as
      // reserved. The display name is set afterwards via `agents set-identity`.
      const wsDir = path.join(deps.home, '.openclaw', `workspace-${slug}`);
      const spawnArgs = ['agents', 'add', slug, '--non-interactive', '--workspace', wsDir];
      const safeModel = model ? model.replace(/[^a-zA-Z0-9/_:.-]/g, '') : '';
      if (safeModel) { spawnArgs.push('--model', safeModel); }
      // OpenClaw loads all plugins on every CLI invocation (15-20s), so 45s timeout is needed
      await deps.runSpawnAsync('openclaw', spawnArgs, 45000);
      if (systemPrompt) {
        const agentDir = path.join(deps.home, '.openclaw', 'agents', slug, 'agent');
        fs.mkdirSync(wsDir, { recursive: true });
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(wsDir, 'SOUL.md'), systemPrompt, 'utf-8');
        fs.writeFileSync(path.join(agentDir, 'SOUL.md'), systemPrompt, 'utf-8');
      }
      return { success: true, agentId: slug };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:delete', async (_e: any, agentId: string) => {
    if (agentId === 'main') return { success: false, error: 'Cannot delete default agent' };
    try {
      const output = await deps.runSpawnAsync('openclaw', ['agents', 'delete', agentId, '--force', '--json'], 30000);
      return { success: true, output };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:set-identity', async (_e: any, agentId: string, name: string, emoji: string, avatar?: string, theme?: string) => {
    try {
      const args = ['agents', 'set-identity', '--agent', agentId];
      if (name) { args.push('--name', name); }
      if (emoji) { args.push('--emoji', emoji); }
      if (avatar) { args.push('--avatar', avatar); }
      if (theme) { args.push('--theme', theme); }
      if (args.length <= 4) return { success: false, error: 'No changes' };
      await deps.runSpawnAsync('openclaw', args, 30000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:bind', async (_e: any, agentId: string, binding: string) => {
    try {
      await deps.runSpawnAsync('openclaw', ['agents', 'bind', '--agent', agentId, '--bind', binding], 30000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:unbind', async (_e: any, agentId: string, binding: string) => {
    try {
      await deps.runSpawnAsync('openclaw', ['agents', 'unbind', '--agent', agentId, '--bind', binding], 30000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:list-files', async (_e: any, agentId: string) => {
    try {
      const directories = getAgentReadDirectories(deps.home, agentId);
      return { success: true, files: listMarkdownFilesFromDirectories(directories) };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200), files: [] };
    }
  });

  ipcMain.handle('agents:read-file', async (_e: any, agentId: string, fileName: string) => {
    if (!isAllowedMarkdownFile(fileName)) return { success: false, error: 'File not allowed' };
    try {
      const candidates = getAgentReadDirectories(deps.home, agentId).map((directory) => path.join(directory, fileName));
      for (const fp of candidates) {
        if (fs.existsSync(fp)) {
          return { success: true, content: fs.readFileSync(fp, 'utf-8'), path: fp };
        }
      }
      return { success: true, content: '', path: candidates[0] };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:write-file', async (_e: any, agentId: string, fileName: string, content: string) => {
    if (!isAllowedMarkdownFile(fileName)) return { success: false, error: 'File not allowed' };
    try {
      // Use getAgentReadDirectories which already handles both workspace path formats
      const targets = getAgentReadDirectories(deps.home, agentId);
      for (const dir of targets) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  // Delete a workspace file (e.g. BOOTSTRAP.md after first-run wizard completes)
  ipcMain.handle('agents:delete-file', async (_e: any, agentId: string, fileName: string) => {
    if (!isAllowedMarkdownFile(fileName)) return { success: false, error: 'File not allowed' };
    try {
      // Use getAgentReadDirectories which handles both workspace path formats
      const targets = getAgentReadDirectories(deps.home, agentId);
      let deleted = false;
      for (const dir of targets) {
        const fp = path.join(dir, fileName);
        if (fs.existsSync(fp)) {
          fs.unlinkSync(fp);
          deleted = true;
        }
      }
      return { success: true, deleted };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });
}