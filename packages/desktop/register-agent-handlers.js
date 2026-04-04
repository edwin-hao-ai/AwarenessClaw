"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerAgentHandlers = registerAgentHandlers;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
const openclaw_shell_output_1 = require("../openclaw-shell-output");
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
function toAgentSlug(agentId) {
    return agentId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}
function isAllowedMarkdownFile(fileName) {
    return path_1.default.basename(fileName) === fileName && /^[A-Za-z0-9._-]+\.md$/i.test(fileName);
}
function getAgentReadDirectories(home, agentId) {
    const slug = toAgentSlug(agentId);
    const globalWorkspaceDir = path_1.default.join(home, '.openclaw', 'workspace');
    const agentDir = path_1.default.join(home, '.openclaw', 'agents', slug, 'agent');
    if (DEFAULT_AGENT_IDS.has(agentId))
        return [globalWorkspaceDir, agentDir];
    // OpenClaw uses two possible workspace paths depending on how the agent was created:
    // - ~/.openclaw/workspaces/<slug> (if --workspace was passed)
    // - ~/.openclaw/workspace-<slug> (OpenClaw's default when no --workspace is passed)
    // Check both, prefer whichever actually exists.
    const nestedWsDir = path_1.default.join(home, '.openclaw', 'workspaces', slug);
    const flatWsDir = path_1.default.join(home, '.openclaw', `workspace-${slug}`);
    const wsDir = fs_1.default.existsSync(flatWsDir) ? flatWsDir : nestedWsDir;
    return [wsDir, agentDir];
}
function listMarkdownFilesFromDirectories(directories) {
    const discovered = new Set();
    for (const directory of directories) {
        if (!fs_1.default.existsSync(directory))
            continue;
        for (const entry of fs_1.default.readdirSync(directory, { withFileTypes: true })) {
            if (!entry.isFile())
                continue;
            if (!isAllowedMarkdownFile(entry.name))
                continue;
            discovered.add(entry.name);
        }
    }
    return Array.from(discovered).sort((left, right) => {
        const leftIndex = PREFERRED_MARKDOWN_ORDER.indexOf(left);
        const rightIndex = PREFERRED_MARKDOWN_ORDER.indexOf(right);
        if (leftIndex !== -1 || rightIndex !== -1) {
            if (leftIndex === -1)
                return 1;
            if (rightIndex === -1)
                return -1;
            return leftIndex - rightIndex;
        }
        return left.localeCompare(right);
    });
}
function registerAgentHandlers(deps) {
    electron_1.ipcMain.handle('agents:list', async () => {
        try {
            const output = await deps.readShellOutputAsync('openclaw agents list --json --bindings', 15000);
            if (output) {
                try {
                    const parsed = (0, openclaw_shell_output_1.parseJsonShellOutput)(output);
                    if (!parsed) {
                        throw new Error('Could not parse agents JSON');
                    }
                    let list = [];
                    if (Array.isArray(parsed)) {
                        list = parsed;
                    }
                    else if (Array.isArray(parsed.agents)) {
                        list = parsed.agents;
                    }
                    else if (Array.isArray(parsed.data)) {
                        list = parsed.data;
                    }
                    else if (parsed && typeof parsed === 'object' && (parsed.id || parsed.name)) {
                        list = [parsed];
                    }
                    if (list.length > 0) {
                        const agents = list.map((a) => ({
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
                }
                catch { }
            }
            return { success: true, agents: [{ id: 'main', name: 'Main Agent', emoji: '🦞', isDefault: true, bindings: [] }] };
        }
        catch {
            return { success: true, agents: [{ id: 'main', name: 'Main Agent', emoji: '🦞', isDefault: true, bindings: [] }] };
        }
    });
    electron_1.ipcMain.handle('agents:add', async (_e, name, model, systemPrompt) => {
        try {
            // Allow Unicode display names (Chinese, Japanese, etc.) — only strip shell-unsafe chars
            const displayName = name.replace(/["\\\n\r]/g, '').trim();
            if (!displayName)
                return { success: false, error: 'Invalid agent name' };
            await deps.ensureGatewayRunning();
            // Slug must be ASCII for filesystem safety
            const slug = displayName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `agent-${Date.now()}`;
            // Use OpenClaw's default workspace path format: ~/.openclaw/workspace-<slug>
            // NOT ~/.openclaw/workspaces/<slug> which is our old convention.
            // --non-interactive requires --workspace, and OpenClaw seeds workspace files
            // (AGENTS.md, BOOTSTRAP.md, SOUL.md, etc.) only when the dir does NOT exist.
            const wsDir = path_1.default.join(deps.home, '.openclaw', `workspace-${slug}`);
            const spawnArgs = ['agents', 'add', displayName, '--non-interactive', '--workspace', wsDir];
            const safeModel = model ? model.replace(/[^a-zA-Z0-9/_:.-]/g, '') : '';
            if (safeModel) {
                spawnArgs.push('--model', safeModel);
            }
            // OpenClaw loads all plugins on every CLI invocation (15-20s), so 45s timeout is needed
            await deps.runSpawnAsync('openclaw', spawnArgs, 45000);
            if (systemPrompt) {
                const agentDir = path_1.default.join(deps.home, '.openclaw', 'agents', slug, 'agent');
                fs_1.default.mkdirSync(wsDir, { recursive: true });
                fs_1.default.mkdirSync(agentDir, { recursive: true });
                fs_1.default.writeFileSync(path_1.default.join(wsDir, 'SOUL.md'), systemPrompt, 'utf-8');
                fs_1.default.writeFileSync(path_1.default.join(agentDir, 'SOUL.md'), systemPrompt, 'utf-8');
            }
            return { success: true, agentId: slug };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200) };
        }
    });
    electron_1.ipcMain.handle('agents:delete', async (_e, agentId) => {
        if (agentId === 'main')
            return { success: false, error: 'Cannot delete default agent' };
        try {
            const output = await deps.runSpawnAsync('openclaw', ['agents', 'delete', agentId, '--force', '--json'], 30000);
            return { success: true, output };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200) };
        }
    });
    electron_1.ipcMain.handle('agents:set-identity', async (_e, agentId, name, emoji, avatar, theme) => {
        try {
            const args = ['agents', 'set-identity', '--agent', agentId];
            if (name) {
                args.push('--name', name);
            }
            if (emoji) {
                args.push('--emoji', emoji);
            }
            if (avatar) {
                args.push('--avatar', avatar);
            }
            if (theme) {
                args.push('--theme', theme);
            }
            if (args.length <= 4)
                return { success: false, error: 'No changes' };
            await deps.runSpawnAsync('openclaw', args, 30000);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200) };
        }
    });
    electron_1.ipcMain.handle('agents:bind', async (_e, agentId, binding) => {
        try {
            await deps.runSpawnAsync('openclaw', ['agents', 'bind', '--agent', agentId, '--bind', binding], 30000);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200) };
        }
    });
    electron_1.ipcMain.handle('agents:unbind', async (_e, agentId, binding) => {
        try {
            await deps.runSpawnAsync('openclaw', ['agents', 'unbind', '--agent', agentId, '--bind', binding], 30000);
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200) };
        }
    });
    electron_1.ipcMain.handle('agents:list-files', async (_e, agentId) => {
        try {
            const directories = getAgentReadDirectories(deps.home, agentId);
            return { success: true, files: listMarkdownFilesFromDirectories(directories) };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200), files: [] };
        }
    });
    electron_1.ipcMain.handle('agents:read-file', async (_e, agentId, fileName) => {
        if (!isAllowedMarkdownFile(fileName))
            return { success: false, error: 'File not allowed' };
        try {
            const candidates = getAgentReadDirectories(deps.home, agentId).map((directory) => path_1.default.join(directory, fileName));
            for (const fp of candidates) {
                if (fs_1.default.existsSync(fp)) {
                    return { success: true, content: fs_1.default.readFileSync(fp, 'utf-8'), path: fp };
                }
            }
            return { success: true, content: '', path: candidates[0] };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200) };
        }
    });
    electron_1.ipcMain.handle('agents:write-file', async (_e, agentId, fileName, content) => {
        if (!isAllowedMarkdownFile(fileName))
            return { success: false, error: 'File not allowed' };
        try {
            // Use getAgentReadDirectories which already handles both workspace path formats
            const targets = getAgentReadDirectories(deps.home, agentId);
            for (const dir of targets) {
                fs_1.default.mkdirSync(dir, { recursive: true });
                fs_1.default.writeFileSync(path_1.default.join(dir, fileName), content, 'utf-8');
            }
            return { success: true };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200) };
        }
    });
    // Delete a workspace file (e.g. BOOTSTRAP.md after first-run wizard completes)
    electron_1.ipcMain.handle('agents:delete-file', async (_e, agentId, fileName) => {
        if (!isAllowedMarkdownFile(fileName))
            return { success: false, error: 'File not allowed' };
        try {
            // Use getAgentReadDirectories which handles both workspace path formats
            const targets = getAgentReadDirectories(deps.home, agentId);
            let deleted = false;
            for (const dir of targets) {
                const fp = path_1.default.join(dir, fileName);
                if (fs_1.default.existsSync(fp)) {
                    fs_1.default.unlinkSync(fp);
                    deleted = true;
                }
            }
            return { success: true, deleted };
        }
        catch (err) {
            return { success: false, error: err.message?.slice(0, 200) };
        }
    });
}
