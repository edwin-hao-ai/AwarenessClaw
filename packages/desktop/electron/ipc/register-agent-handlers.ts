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
  const workspaceDir = path.join(home, '.openclaw', 'workspaces', slug);
  const agentDir = path.join(home, '.openclaw', 'agents', slug, 'agent');
  return DEFAULT_AGENT_IDS.has(agentId) ? [globalWorkspaceDir, agentDir] : [workspaceDir, agentDir];
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
      const baseWsDir = path.join(deps.home, '.openclaw', 'workspaces');
      const baseAgentsDir = path.join(deps.home, '.openclaw', 'agents');
      fs.mkdirSync(baseWsDir, { recursive: true });
      fs.mkdirSync(baseAgentsDir, { recursive: true });
      // Slug must be ASCII for filesystem safety
      const slug = displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `agent-${Date.now()}`;
      const wsDir = path.join(baseWsDir, slug);
      fs.mkdirSync(wsDir, { recursive: true });
      const flags = ['--non-interactive', `--workspace "${wsDir}"`];
      const safeModel = model ? model.replace(/[^a-zA-Z0-9/_:.-]/g, '') : '';
      if (safeModel) flags.push(`--model "${safeModel}"`);
      // OpenClaw loads all plugins on every CLI invocation (15-20s), so 45s timeout is needed
      await deps.runAsync(`openclaw agents add "${displayName}" ${flags.join(' ')}`, 45000);
      if (systemPrompt) {
        const agentDir = path.join(baseAgentsDir, slug, 'agent');
        fs.mkdirSync(agentDir, { recursive: true });
        fs.writeFileSync(path.join(wsDir, 'SOUL.md'), systemPrompt, 'utf-8');
        fs.writeFileSync(path.join(agentDir, 'SOUL.md'), systemPrompt, 'utf-8');
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:delete', async (_e: any, agentId: string) => {
    if (agentId === 'main') return { success: false, error: 'Cannot delete default agent' };
    try {
      const output = await deps.runAsync(`openclaw agents delete "${agentId.replace(/"/g, '\\"')}" --force --json 2>&1`, 30000);
      return { success: true, output };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:set-identity', async (_e: any, agentId: string, name: string, emoji: string, avatar?: string, theme?: string) => {
    try {
      const flags: string[] = [];
      if (name) flags.push(`--name "${name.replace(/"/g, '\\"')}"`);
      if (emoji) flags.push(`--emoji "${emoji}"`);
      if (avatar) flags.push(`--avatar "${avatar.replace(/"/g, '\\"')}"`);
      if (theme) flags.push(`--theme "${theme}"`);
      if (flags.length === 0) return { success: false, error: 'No changes' };
      await deps.runAsync(`openclaw agents set-identity --agent "${agentId}" ${flags.join(' ')}`, 30000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:bind', async (_e: any, agentId: string, binding: string) => {
    try {
      await deps.runAsync(`openclaw agents bind --agent "${agentId}" --bind "${binding.replace(/"/g, '\\"')}"`, 30000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:unbind', async (_e: any, agentId: string, binding: string) => {
    try {
      await deps.runAsync(`openclaw agents unbind --agent "${agentId}" --bind "${binding.replace(/"/g, '\\"')}"`, 30000);
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
      const slug = toAgentSlug(agentId);
      const wsDir = path.join(deps.home, '.openclaw', 'workspaces', slug);
      const agentDir = path.join(deps.home, '.openclaw', 'agents', slug, 'agent');
      const globalWs = path.join(deps.home, '.openclaw', 'workspace');
      const isDefault = DEFAULT_AGENT_IDS.has(agentId);
      const targets = isDefault ? [globalWs] : [wsDir, agentDir];
      for (const dir of targets) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fileName), content, 'utf-8');
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });
}