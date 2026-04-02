import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { parseJsonShellOutput } from '../openclaw-shell-output';

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
      const safeName = name.replace(/[^a-zA-Z0-9 _-]/g, '').trim();
      if (!safeName) return { success: false, error: 'Invalid agent name' };
      await deps.ensureGatewayRunning();
      const baseWsDir = path.join(deps.home, '.openclaw', 'workspaces');
      const baseAgentsDir = path.join(deps.home, '.openclaw', 'agents');
      fs.mkdirSync(baseWsDir, { recursive: true });
      fs.mkdirSync(baseAgentsDir, { recursive: true });
      const slug = safeName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const wsDir = path.join(baseWsDir, slug);
      fs.mkdirSync(wsDir, { recursive: true });
      const flags = ['--non-interactive', `--workspace "${wsDir}"`];
      const safeModel = model ? model.replace(/[^a-zA-Z0-9/_:.-]/g, '') : '';
      if (safeModel) flags.push(`--model "${safeModel}"`);
      await deps.runAsync(`openclaw agents add "${safeName}" ${flags.join(' ')}`, 15000);
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
      const output = await deps.runAsync(`openclaw agents delete "${agentId.replace(/"/g, '\\"')}" --force --json 2>&1`, 10000);
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
      await deps.runAsync(`openclaw agents set-identity --agent "${agentId}" ${flags.join(' ')}`, 10000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:bind', async (_e: any, agentId: string, binding: string) => {
    try {
      await deps.runAsync(`openclaw agents bind --agent "${agentId}" --bind "${binding.replace(/"/g, '\\"')}"`, 10000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:unbind', async (_e: any, agentId: string, binding: string) => {
    try {
      await deps.runAsync(`openclaw agents unbind --agent "${agentId}" --bind "${binding.replace(/"/g, '\\"')}"`, 10000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 200) };
    }
  });

  ipcMain.handle('agents:read-file', async (_e: any, agentId: string, fileName: string) => {
    const allowedFiles = ['SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'AGENTS.md'];
    if (!allowedFiles.includes(fileName)) return { success: false, error: 'File not allowed' };
    try {
      const slug = agentId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const candidates = [
        path.join(deps.home, '.openclaw', 'workspaces', slug, fileName),
        path.join(deps.home, '.openclaw', 'agents', slug, 'agent', fileName),
        path.join(deps.home, '.openclaw', 'workspace', fileName),
      ];
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
    const allowedFiles = ['SOUL.md', 'TOOLS.md', 'IDENTITY.md', 'USER.md', 'MEMORY.md', 'AGENTS.md'];
    if (!allowedFiles.includes(fileName)) return { success: false, error: 'File not allowed' };
    try {
      const slug = agentId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const wsDir = path.join(deps.home, '.openclaw', 'workspaces', slug);
      const agentDir = path.join(deps.home, '.openclaw', 'agents', slug, 'agent');
      const globalWs = path.join(deps.home, '.openclaw', 'workspace');
      const isDefault = agentId === 'main' || agentId === 'default';
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