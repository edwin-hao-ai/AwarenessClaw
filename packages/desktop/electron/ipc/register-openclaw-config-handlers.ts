import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import { DEFAULT_EXEC_APPROVAL_ASK, getExecApprovalAsk, writeExecApprovalAsk, type ExecApprovalAsk } from '../openclaw-config';

export function registerOpenClawConfigHandlers(deps: {
  home: string;
}) {
  ipcMain.handle('plugins:list', async () => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const entries = config.plugins?.entries || [];
      return { success: true, entries };
    } catch (err: any) {
      return { success: false, error: err.message, entries: [] };
    }
  });

  ipcMain.handle('plugins:toggle', async (_e, name: string, enabled: boolean) => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      let config: any = {};
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      if (!config.plugins) config.plugins = {};
      if (!config.plugins.entries) config.plugins.entries = {};
      if (config.plugins.entries[name]) {
        config.plugins.entries[name].enabled = enabled;
      } else {
        config.plugins.entries[name] = { enabled };
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('hooks:list', async () => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const hooks = config.hooks || {};
      return { success: true, hooks };
    } catch (err: any) {
      return { success: false, error: err.message, hooks: {} };
    }
  });

  ipcMain.handle('hooks:toggle', async (_e, hookName: string, enabled: boolean) => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      let config: any = {};
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      if (!config.hooks) config.hooks = {};
      if (config.hooks[hookName]) {
        config.hooks[hookName].enabled = enabled;
      } else {
        config.hooks[hookName] = { enabled };
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('permissions:get', async () => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const tools = config.tools || {};
      return {
        success: true,
        profile: tools.profile || 'default',
        alsoAllow: tools.alsoAllow || [],
        denied: tools.denied || [],
        execAsk: getExecApprovalAsk(deps.home),
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('permissions:update', async (_e, changes: { alsoAllow?: string[]; denied?: string[]; execAsk?: ExecApprovalAsk }) => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      let config: any = {};
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {}
      if (!config.tools) config.tools = {};
      if (changes.alsoAllow !== undefined) config.tools.alsoAllow = changes.alsoAllow;
      if (changes.denied !== undefined) {
        if (changes.denied.length > 0) {
          config.tools.denied = changes.denied;
        } else {
          delete config.tools.denied;
        }
      }
      const execAsk = changes.execAsk ?? DEFAULT_EXEC_APPROVAL_ASK;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      writeExecApprovalAsk(deps.home, execAsk);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}