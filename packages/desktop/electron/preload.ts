const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external'),
  getDashboardUrl: () => ipcRenderer.invoke('app:get-dashboard-url'),
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),

  // Setup wizard
  detectEnvironment: () => ipcRenderer.invoke('setup:detect-environment'),
  installNodeJs: () => ipcRenderer.invoke('setup:install-nodejs'),
  installOpenClaw: () => ipcRenderer.invoke('setup:install-openclaw'),
  installPlugin: () => ipcRenderer.invoke('setup:install-plugin'),
  startDaemon: () => ipcRenderer.invoke('setup:start-daemon'),
  saveConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('setup:save-config', config),
  openAuthUrl: (url: string) => ipcRenderer.invoke('setup:open-auth-url', url),
  readExistingConfig: () => ipcRenderer.invoke('setup:read-existing-config'),
  bootstrap: () => ipcRenderer.invoke('setup:bootstrap'),

  // Chat
  chatSend: (message: string, sessionId?: string) => ipcRenderer.invoke('chat:send', message, sessionId),
  onChatStream: (callback: (chunk: string) => void) => {
    ipcRenderer.on('chat:stream', (_e: any, chunk: string) => callback(chunk));
  },
  onChatStatus: (callback: (status: { type: string; tool?: string }) => void) => {
    ipcRenderer.on('chat:status', (_e: any, status: any) => callback(status));
  },

  // Channel management
  channelSave: (channelId: string, config: Record<string, string>) => ipcRenderer.invoke('channel:save', channelId, config),
  channelTest: (channelId: string) => ipcRenderer.invoke('channel:test', channelId),

  // Cron management
  cronList: () => ipcRenderer.invoke('cron:list'),
  cronAdd: (expr: string, cmd: string) => ipcRenderer.invoke('cron:add', expr, cmd),
  cronRemove: (id: string) => ipcRenderer.invoke('cron:remove', id),

  // Gateway management
  gatewayStatus: () => ipcRenderer.invoke('gateway:status'),
  gatewayStart: () => ipcRenderer.invoke('gateway:start'),
  gatewayStop: () => ipcRenderer.invoke('gateway:stop'),
  gatewayRestart: () => ipcRenderer.invoke('gateway:restart'),

  // Log viewer
  getRecentLogs: () => ipcRenderer.invoke('logs:recent'),

  // Memory API
  memorySearch: (query: string) => ipcRenderer.invoke('memory:search', query),
  memoryGetCards: () => ipcRenderer.invoke('memory:get-cards'),
  memoryGetTasks: () => ipcRenderer.invoke('memory:get-tasks'),
  memoryGetContext: () => ipcRenderer.invoke('memory:get-context'),
  memoryGetPerception: () => ipcRenderer.invoke('memory:get-perception'),
});
