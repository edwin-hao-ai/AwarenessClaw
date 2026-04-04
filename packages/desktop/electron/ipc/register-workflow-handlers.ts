/**
 * IPC handlers for Task Center — tasks (sub-agent spawn) + workflows (Lobster).
 *
 * Every task maps to an OpenClaw sub-agent run.
 * Every workflow maps to a Lobster YAML pipeline.
 * We never reinvent scheduling/routing — OpenClaw does it all.
 */

import fs from 'fs';
import path from 'path';
import { ipcMain, BrowserWindow } from 'electron';
import type { GatewayClient } from '../gateway-ws';
import { readJsonFileWithBom } from '../json-file';

// ---------------------------------------------------------------------------
// Deps injected from main.ts
// ---------------------------------------------------------------------------

interface WorkflowHandlerDeps {
  home: string;
  safeShellExecAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
  runAsync: (cmd: string, timeoutMs?: number) => Promise<string>;
  getGatewayWs: () => Promise<GatewayClient>;
  getMainWindow: () => BrowserWindow | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function openclawConfigPath(home: string): string {
  return path.join(home, '.openclaw', 'openclaw.json');
}

function tasksCachePath(home: string): string {
  const dir = path.join(home, '.openclaw', 'awarenessclaw');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'tasks.json');
}

function workflowsDir(home: string): string {
  const dir = path.join(home, '.openclaw', 'awarenessclaw', 'workflows');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read subagent config from openclaw.json. */
function readSubagentConfig(home: string): {
  maxSpawnDepth: number;
  maxChildrenPerAgent: number;
  agentToAgentEnabled: boolean;
} {
  try {
    const cfg = readJsonFileWithBom<Record<string, any>>(openclawConfigPath(home));
    const defaults = cfg?.agents?.defaults?.subagents || {};
    const a2a = cfg?.tools?.agentToAgent || {};
    return {
      maxSpawnDepth: defaults.maxSpawnDepth ?? 1,
      maxChildrenPerAgent: defaults.maxChildrenPerAgent ?? 5,
      agentToAgentEnabled: a2a.enabled ?? false,
    };
  } catch {
    return { maxSpawnDepth: 1, maxChildrenPerAgent: 5, agentToAgentEnabled: false };
  }
}

/** Write subagent config into openclaw.json (immutable merge). */
function writeSubagentConfig(
  home: string,
  patch: { maxSpawnDepth?: number; agentToAgentEnabled?: boolean },
): boolean {
  try {
    const cfgPath = openclawConfigPath(home);
    const cfg = readJsonFileWithBom<Record<string, any>>(cfgPath) || {};

    if (patch.maxSpawnDepth !== undefined) {
      if (!cfg.agents) cfg.agents = {};
      if (!cfg.agents.defaults) cfg.agents.defaults = {};
      if (!cfg.agents.defaults.subagents) cfg.agents.defaults.subagents = {};
      cfg.agents.defaults.subagents.maxSpawnDepth = patch.maxSpawnDepth;
    }

    if (patch.agentToAgentEnabled !== undefined) {
      if (!cfg.tools) cfg.tools = {};
      if (!cfg.tools.agentToAgent) cfg.tools.agentToAgent = {};
      cfg.tools.agentToAgent.enabled = patch.agentToAgentEnabled;
    }

    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sub-agent event listener (attaches to GatewayClient once)
// ---------------------------------------------------------------------------

let subagentListenerAttached = false;

function attachSubagentListener(deps: WorkflowHandlerDeps) {
  if (subagentListenerAttached) return;
  subagentListenerAttached = true;

  // We attach lazily when the first task operation happens.
  // The listener forwards sub-agent lifecycle events to the renderer.
  deps.getGatewayWs().then((ws) => {
    ws.on('event:agent', (payload: any) => {
      const win = deps.getMainWindow();
      if (!win || win.isDestroyed()) return;

      // Normalize event name from payload
      const eventName: string = payload?.event || payload?.state || '';

      // Sub-agent lifecycle events we care about
      if (
        eventName === 'subagent.spawned' ||
        eventName === 'agent.started' ||
        eventName === 'agent.step_started' ||
        eventName === 'agent.step_completed' ||
        eventName === 'agent.finished' ||
        eventName === 'tool.call' ||
        eventName === 'tool.output'
      ) {
        win.webContents.send('task:status-update', {
          event: eventName,
          runId: payload?.runId || payload?.data?.runId || '',
          agentId: payload?.agentId || payload?.data?.agentId || '',
          status: payload?.status || payload?.data?.status || '',
          result: payload?.result || payload?.data?.result || '',
          sessionKey: payload?.sessionKey || payload?.data?.sessionKey || '',
        });
      }
    });
  }).catch(() => {
    // Gateway not available — listener will be re-attempted on next operation.
    subagentListenerAttached = false;
  });
}

// ---------------------------------------------------------------------------
// Register IPC handlers
// ---------------------------------------------------------------------------

export function registerWorkflowHandlers(deps: WorkflowHandlerDeps) {
  const { home, safeShellExecAsync, runAsync, getMainWindow } = deps;

  // ---- Configuration ----

  /** Read current subagent/workflow config. */
  ipcMain.handle('workflow:config', async () => {
    return readSubagentConfig(home);
  });

  /** Enable multi-agent collaboration (set maxSpawnDepth=2, agentToAgent=true). */
  ipcMain.handle('workflow:enable-collaboration', async () => {
    const current = readSubagentConfig(home);
    const success = writeSubagentConfig(home, {
      maxSpawnDepth: Math.max(current.maxSpawnDepth, 2),
      agentToAgentEnabled: true,
    });
    if (!success) {
      return { success: false, error: 'Failed to write openclaw.json', config: readSubagentConfig(home) };
    }
    // Restart gateway so config takes effect.
    // Windows: gateway restart may timeout (known issue #49871) — use stop+start instead.
    // If restart fails, config is still saved and will take effect on next gateway start.
    let gatewayRestarted = false;
    try {
      await safeShellExecAsync('openclaw gateway stop', 10000);
      await safeShellExecAsync('openclaw gateway start', 15000);
      gatewayRestarted = true;
    } catch {
      // Best-effort — config is persisted regardless
    }
    return { success: true, gatewayRestarted, config: readSubagentConfig(home) };
  });

  /** Check if Lobster plugin is installed. */
  ipcMain.handle('workflow:check-lobster', async () => {
    // Cross-platform: openclaw plugins list works on all platforms
    const output = await safeShellExecAsync('openclaw plugins list 2>&1', 15000);
    if (!output) return { installed: false, enabled: false, error: 'Could not check plugins' };

    const lines = output.toLowerCase();
    const hasLobster = lines.includes('lobster');
    // "lobster" + "loaded" or "enabled" on same line
    const isEnabled = hasLobster && (lines.includes('loaded') || lines.includes('enabled'));
    return { installed: hasLobster, enabled: isEnabled };
  });

  /** Install Lobster plugin. Returns detailed status for UI feedback. */
  ipcMain.handle('workflow:install-lobster', async () => {
    try {
      // openclaw plugins install works cross-platform (Windows/macOS/Linux)
      await runAsync('openclaw plugins install lobster', 120000);

      // Verify installation
      const checkOutput = await safeShellExecAsync('openclaw plugins list 2>&1', 15000);
      const verified = checkOutput?.toLowerCase().includes('lobster') ?? false;

      if (!verified) {
        return { success: false, error: 'Installation completed but Lobster not found in plugins list. Try restarting OpenClaw.' };
      }

      return { success: true };
    } catch (err: any) {
      const msg = err?.message || '';
      // Friendly error messages
      if (msg.includes('EACCES') || msg.includes('permission') || msg.includes('denied')) {
        return { success: false, error: 'Permission denied. Try running as administrator or check npm permissions.' };
      }
      if (msg.includes('timed out') || msg.includes('timeout')) {
        return { success: false, error: 'Installation timed out. Please check your network connection and try again.' };
      }
      if (msg.includes('ENOTFOUND') || msg.includes('network')) {
        return { success: false, error: 'Network error. Please check your internet connection.' };
      }
      return { success: false, error: msg.slice(0, 300) || 'Installation failed' };
    }
  });

  // ---- Task CRUD (sub-agent facade) ----

  /**
   * Create & spawn a sub-agent task.
   * We send `/subagents spawn <agentId> "<task>"` as a user message
   * via Gateway chat.send to the main agent's session.
   * This ensures OpenClaw handles all spawn logic natively.
   */
  ipcMain.handle(
    'task:create',
    async (
      _e,
      params: {
        title: string;
        agentId: string;
        model?: string;
        thinking?: string;
        timeoutSeconds?: number;
        sessionKey?: string;
      },
    ) => {
      // Ensure sub-agent listener is attached
      attachSubagentListener(deps);

      // Build the spawn command
      const escaped = params.title.replace(/"/g, '\\"');
      let spawnCmd = `/subagents spawn ${params.agentId} "${escaped}"`;
      if (params.model) spawnCmd += ` --model ${params.model}`;
      if (params.thinking) spawnCmd += ` --thinking ${params.thinking}`;

      try {
        const ws = await deps.getGatewayWs();
        // Send spawn command to the main agent session
        const sessionKey = params.sessionKey || 'main';
        const result = await ws.chatSend(sessionKey, spawnCmd, {
          thinking: 'off', // No thinking needed for the spawn command itself
        });

        return {
          success: true,
          runId: result?.runId || '',
          sessionKey,
        };
      } catch (err: any) {
        // Fallback to CLI
        try {
          const escaped2 = params.title.replace(/"/g, '\\"').replace(/'/g, "'\\''");
          let cliCmd = `openclaw agent --session-id "ac-task-${Date.now()}" -m '/subagents spawn ${params.agentId} "${escaped2}"'`;
          if (params.model) cliCmd += ` --model ${params.model}`;
          const output = await runAsync(cliCmd, params.timeoutSeconds ? params.timeoutSeconds * 1000 : 120000);
          return { success: true, output, fallback: 'cli' };
        } catch (cliErr: any) {
          return { success: false, error: cliErr?.message?.slice(0, 300) || 'Spawn failed' };
        }
      }
    },
  );

  /** Cancel a running task (abort the sub-agent session). */
  ipcMain.handle('task:cancel', async (_e, sessionKey: string) => {
    try {
      const ws = await deps.getGatewayWs();
      await ws.chatAbort(sessionKey);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message?.slice(0, 200) || 'Cancel failed' };
    }
  });

  /** Get sub-agent session history (task detail). */
  ipcMain.handle('task:detail', async (_e, sessionKey: string) => {
    try {
      const ws = await deps.getGatewayWs();
      const messages = await ws.chatHistory(sessionKey);
      return { success: true, messages };
    } catch (err: any) {
      return { success: false, error: err?.message?.slice(0, 200) || 'Failed to load history' };
    }
  });

  // ---- Workflow CRUD (Lobster facade) ----

  /** Parse minimal YAML info from a workflow file (no js-yaml dependency). */
  function parseWorkflowYaml(content: string) {
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const name = nameMatch ? nameMatch[1].trim() : '';

    // Extract first comment line as description
    const descMatch = content.match(/^#\s*(.+)$/m);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract args (simple top-level keys under `args:`)
    const args: Array<{ name: string; required: boolean; default?: string }> = [];
    const argsBlock = content.match(/^args:\s*\n((?:  \S[^\n]*\n?)*)/m);
    if (argsBlock) {
      const argLines = argsBlock[1].matchAll(/^  (\w+):/gm);
      for (const m of argLines) {
        const argName = m[1];
        const defaultMatch = content.match(new RegExp(`^  ${argName}:[\\s\\S]*?default:\\s*"?([^"\\n]*)"?`, 'm'));
        args.push({
          name: argName,
          required: !defaultMatch,
          default: defaultMatch ? defaultMatch[1].trim() : undefined,
        });
      }
    }

    // Extract steps (id + type + approval)
    const steps: Array<{ id: string; type: string; approval?: boolean }> = [];
    const stepMatches = content.matchAll(/^\s+- id:\s*(\S+)/gm);
    for (const sm of stepMatches) {
      const stepId = sm[1];
      // Look ahead for step type
      const afterId = content.substring(sm.index! + sm[0].length, sm.index! + sm[0].length + 500);
      const hasApproval = /^\s+approval:/m.test(afterId);
      const hasRun = /^\s+run:/m.test(afterId);
      const hasPipeline = /^\s+pipeline:/m.test(afterId);
      const hasCommand = /^\s+command:/m.test(afterId);
      const type = hasApproval ? 'approval' : hasPipeline ? 'pipeline' : (hasRun || hasCommand) ? 'command' : 'unknown';
      steps.push({ id: stepId, type, approval: hasApproval || undefined });
    }

    return { name, description, args, steps };
  }

  /** List available workflow templates (builtin + custom). */
  ipcMain.handle('workflow:list', async () => {
    const workflows: Array<{
      id: string;
      name: string;
      description: string;
      icon: string;
      yamlPath: string;
      isBuiltin: boolean;
      args: Array<{ name: string; required: boolean; default?: string }>;
      steps: Array<{ id: string; type: string; approval?: boolean }>;
    }> = [];

    // Builtin templates (shipped with the app)
    // Try multiple possible paths (dev vs packaged)
    const possibleBuiltinDirs = [
      path.join(__dirname, '..', 'workflows'),
      path.join(__dirname, '..', '..', 'workflows'),
      path.join(__dirname, 'workflows'),
    ];
    for (const builtinDir of possibleBuiltinDirs) {
      if (!fs.existsSync(builtinDir)) continue;
      for (const file of fs.readdirSync(builtinDir)) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
        try {
          const filePath = path.join(builtinDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = parseWorkflowYaml(content);
          workflows.push({
            id: `builtin-${path.basename(file, path.extname(file))}`,
            name: parsed.name || path.basename(file, path.extname(file)),
            description: parsed.description,
            icon: '⚡',
            yamlPath: filePath,
            isBuiltin: true,
            args: parsed.args,
            steps: parsed.steps,
          });
        } catch { /* skip malformed files */ }
      }
      break; // Use only the first valid dir
    }

    // Custom workflows
    const customDir = workflowsDir(home);
    if (fs.existsSync(customDir)) {
      for (const file of fs.readdirSync(customDir)) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
        try {
          const filePath = path.join(customDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const parsed = parseWorkflowYaml(content);
          workflows.push({
            id: `custom-${path.basename(file, path.extname(file))}`,
            name: parsed.name || path.basename(file, path.extname(file)),
            description: parsed.description,
            icon: '📋',
            yamlPath: filePath,
            isBuiltin: false,
            args: parsed.args,
            steps: parsed.steps,
          });
        } catch { /* skip */ }
      }
    }

    return { workflows };
  });

  /** Execute a workflow via Lobster CLI. Cross-platform safe. */
  ipcMain.handle(
    'workflow:run',
    async (_e, yamlPath: string, args: Record<string, string>) => {
      try {
        // Cross-platform: use double quotes for JSON args (Windows cmd.exe doesn't support single quotes)
        const argsJson = JSON.stringify(args).replace(/"/g, '\\"');
        const cmd = `openclaw lobster run "${yamlPath}" --args-json "${argsJson}"`;
        const output = await runAsync(cmd, 600000); // 10 min timeout

        // Parse Lobster JSON envelope
        try {
          const jsonStart = output.indexOf('{');
          if (jsonStart >= 0) {
            const parsed = JSON.parse(output.substring(jsonStart));
            return { success: true, ...parsed };
          }
        } catch { /* not JSON */ }

        return { success: true, output };
      } catch (err: any) {
        const msg = err?.message || '';
        if (msg.includes('lobster') && (msg.includes('not found') || msg.includes('not recognized'))) {
          return { success: false, error: 'Lobster is not installed. Please install it from the Workflows tab.' };
        }
        return { success: false, error: msg.slice(0, 300) || 'Workflow execution failed' };
      }
    },
  );

  /** Approve/reject a workflow approval gate. Cross-platform safe. */
  ipcMain.handle(
    'workflow:approve',
    async (_e, resumeToken: string, approve: boolean) => {
      try {
        const payload = JSON.stringify({ action: 'resume', token: resumeToken, approve });
        // Cross-platform: avoid Unix-only echo pipe. Use --stdin-json flag if available,
        // otherwise write to temp file and pipe (works on both Windows and Unix).
        const isWin = process.platform === 'win32';
        let cmd: string;
        if (isWin) {
          // Windows: use PowerShell for stdin piping
          const escaped = payload.replace(/"/g, '\\"');
          cmd = `powershell -Command "echo '${escaped}' | openclaw lobster resume"`;
        } else {
          const escaped = payload.replace(/'/g, "'\\''");
          cmd = `echo '${escaped}' | openclaw lobster resume`;
        }
        const output = await runAsync(cmd, 30000);
        return { success: true, output };
      } catch (err: any) {
        return { success: false, error: err?.message?.slice(0, 200) || 'Approve failed' };
      }
    },
  );

  /** Save a custom workflow YAML. */
  ipcMain.handle('workflow:save', async (_e, fileName: string, content: string) => {
    try {
      const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
      const filePath = path.join(workflowsDir(home), safeName.endsWith('.yaml') ? safeName : `${safeName}.yaml`);
      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, path: filePath };
    } catch (err: any) {
      return { success: false, error: err?.message?.slice(0, 200) || 'Save failed' };
    }
  });

  /** Delete a custom workflow YAML. */
  ipcMain.handle('workflow:delete', async (_e, yamlPath: string) => {
    try {
      // Safety: only allow deleting from our custom workflows directory
      const customDir = workflowsDir(home);
      if (!yamlPath.startsWith(customDir)) {
        return { success: false, error: 'Cannot delete builtin workflows' };
      }
      fs.unlinkSync(yamlPath);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message?.slice(0, 200) || 'Delete failed' };
    }
  });
}
