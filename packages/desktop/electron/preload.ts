const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  getDashboardUrl: () => ipcRenderer.invoke('app:get-dashboard-url'),
  startupEnsureRuntime: () => ipcRenderer.invoke('app:startup-ensure-runtime'),
  onStartupStatus: (callback: (status: { message: string; progress?: number }) => void) => {
    ipcRenderer.on('app:startup-status', (_e: any, status: { message: string; progress?: number }) => callback(status));
  },
  checkUpdates: () => ipcRenderer.invoke('app:check-updates'),
  upgradeComponent: (component: string) => ipcRenderer.invoke('app:upgrade-component', component),

  // Setup wizard
  detectEnvironment: () => ipcRenderer.invoke('setup:detect-environment'),
  installNodeJs: () => ipcRenderer.invoke('setup:install-nodejs'),
  installOpenClaw: () => ipcRenderer.invoke('setup:install-openclaw'),
  installPlugin: () => ipcRenderer.invoke('setup:install-plugin'),
  startDaemon: () => ipcRenderer.invoke('setup:start-daemon'),
  onSetupDaemonStatus: (callback: (status: { key: string; detail?: string }) => void) => {
    const listener = (_e: any, status: { key: string; detail?: string }) => callback(status);
    ipcRenderer.on('setup:daemon-status', listener);
    return () => ipcRenderer.removeListener('setup:daemon-status', listener);
  },
  saveConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('setup:save-config', config),
  openAuthUrl: (url: string) => ipcRenderer.invoke('setup:open-auth-url', url),
  readExistingConfig: () => ipcRenderer.invoke('setup:read-existing-config'),
  bootstrap: () => ipcRenderer.invoke('setup:bootstrap'),

  // Chat
  chatSend: (message: string, sessionId?: string, options?: { thinkingLevel?: string; model?: string; files?: string[]; workspacePath?: string; agentId?: string }) => ipcRenderer.invoke('chat:send', message, sessionId, options),
  chatAbort: () => ipcRenderer.invoke('chat:abort'),
  chatApprove: (sessionId: string, approvalRequestId: string) => ipcRenderer.invoke('chat:approve', sessionId, approvalRequestId, 'allow-once'),
  onChatStream: (callback: (chunk: string) => void) => {
    ipcRenderer.on('chat:stream', (_e: any, chunk: string) => callback(chunk));
  },
  onChatStreamEnd: (callback: () => void) => {
    ipcRenderer.on('chat:stream-end', () => callback());
  },
  onChatStatus: (callback: (status: { type: string; tool?: string; toolStatus?: string; toolId?: string; detail?: string; approvalRequestId?: string; approvalCommand?: string }) => void) => {
    ipcRenderer.on('chat:status', (_e: any, status: any) => callback(status));
  },
  onChatThinking: (callback: (text: string) => void) => {
    ipcRenderer.on('chat:thinking', (_e: any, text: string) => callback(text));
  },
  onChatDebug: (callback: (msg: string) => void) => {
    ipcRenderer.on('chat:debug', (_e: any, msg: string) => callback(msg));
  },

  // Channel management
  channelSave: (channelId: string, config: Record<string, string>) => ipcRenderer.invoke('channel:save', channelId, config),
  channelTest: (channelId: string) => ipcRenderer.invoke('channel:test', channelId),
  channelReadConfig: (channelId: string) => ipcRenderer.invoke('channel:read-config', channelId),
  channelSetup: (channelId: string) => ipcRenderer.invoke('channel:setup', channelId),
  channelListConfigured: () => ipcRenderer.invoke('channel:list-configured'),
  channelListSupported: () => ipcRenderer.invoke('channel:list-supported'),
  channelGetRegistry: () => ipcRenderer.invoke('channel:get-registry'),
  onChannelQR: (callback: (art: string) => void) => {
    ipcRenderer.on('channel:qr-art', (_e: any, art: string) => callback(art));
  },
  onChannelStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('channel:status', (_e: any, status: string) => callback(status));
  },

  // Channel conversations (unified inbox — view all channel chat history)
  channelSessions: () => ipcRenderer.invoke('channel:sessions'),
  channelHistory: (sessionKey: string) => ipcRenderer.invoke('channel:history', sessionKey),
  channelReply: (sessionKey: string, text: string) => ipcRenderer.invoke('channel:reply', sessionKey, text),
  onChannelMessage: (callback: (msg: { sessionKey: string; message: any }) => void) => {
    ipcRenderer.on('channel:message', (_e: any, msg: any) => callback(msg));
  },

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

  // Config import/export
  configExport: () => ipcRenderer.invoke('config:export'),
  configImport: () => ipcRenderer.invoke('config:import'),

  // File preview
  filePreview: (filePath: string) => ipcRenderer.invoke('file:preview', filePath),
  selectFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => ipcRenderer.invoke('file:select', options),
  selectDirectory: () => ipcRenderer.invoke('directory:select'),

  // Tray events
  onTrayNewChat: (callback: () => void) => {
    ipcRenderer.on('tray:new-chat', () => callback());
  },

  // Skills / ClawHub
  skillListInstalled: () => ipcRenderer.invoke('skill:list-installed'),
  skillExplore: () => ipcRenderer.invoke('skill:explore'),
  skillSearch: (query: string) => ipcRenderer.invoke('skill:search', query),
  skillDetail: (slug: string) => ipcRenderer.invoke('skill:detail', slug),
  skillInstall: (slug: string) => ipcRenderer.invoke('skill:install', slug),
  skillUninstall: (slug: string) => ipcRenderer.invoke('skill:uninstall', slug),
  skillGetConfig: (slug: string) => ipcRenderer.invoke('skill:get-config', slug),
  skillSaveConfig: (slug: string, config: Record<string, unknown>) => ipcRenderer.invoke('skill:save-config', slug, config),

  // Plugins management
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsToggle: (name: string, enabled: boolean) => ipcRenderer.invoke('plugins:toggle', name, enabled),

  // Generic OpenClaw config access
  openclawConfigRead: (dotPath?: string) => ipcRenderer.invoke('openclaw-config:read', dotPath),
  openclawConfigWrite: (dotPath: string, value: unknown) => ipcRenderer.invoke('openclaw-config:write', dotPath, value),
  openclawConfigSchema: () => ipcRenderer.invoke('openclaw-config:schema'),

  // Hooks management
  hooksList: () => ipcRenderer.invoke('hooks:list'),
  hooksToggle: (hookName: string, enabled: boolean) => ipcRenderer.invoke('hooks:toggle', hookName, enabled),

  // Permissions & Workspace
  permissionsGet: () => ipcRenderer.invoke('permissions:get'),
  permissionsUpdate: (changes: { alsoAllow?: string[]; denied?: string[]; execAsk?: 'off' | 'on-miss' }) => ipcRenderer.invoke('permissions:update', changes),
  workspaceReadFile: (filename: string) => ipcRenderer.invoke('workspace:read-file', filename),
  workspaceWriteFile: (filename: string, content: string) => ipcRenderer.invoke('workspace:write-file', filename, content),

  // Agents management
  agentsList: () => ipcRenderer.invoke('agents:list'),
  agentsAdd: (name: string, model?: string, systemPrompt?: string) => ipcRenderer.invoke('agents:add', name, model, systemPrompt),
  agentsDelete: (id: string) => ipcRenderer.invoke('agents:delete', id),
  agentsSetIdentity: (id: string, name: string, emoji: string, avatar?: string, theme?: string) => ipcRenderer.invoke('agents:set-identity', id, name, emoji, avatar, theme),
  agentsBind: (id: string, binding: string) => ipcRenderer.invoke('agents:bind', id, binding),
  agentsUnbind: (id: string, binding: string) => ipcRenderer.invoke('agents:unbind', id, binding),

  // Models (dynamic)
  modelsReadProviders: () => ipcRenderer.invoke('models:read-providers'),
  modelsDiscover: (input: { providerKey: string; baseUrl: string; apiKey?: string }) => ipcRenderer.invoke('models:discover', input),

  // Security audit
  securityCheck: () => ipcRenderer.invoke('security:check'),

  // Memory API
  memorySearch: (query: string) => ipcRenderer.invoke('memory:search', query),
  memoryGetCards: () => ipcRenderer.invoke('memory:get-cards'),
  memoryGetTasks: () => ipcRenderer.invoke('memory:get-tasks'),
  memoryGetContext: (query?: string) => ipcRenderer.invoke('memory:get-context', query),
  memoryGetPerception: () => ipcRenderer.invoke('memory:get-perception'),
  memoryGetDailySummary: () => ipcRenderer.invoke('memory:get-daily-summary'),
  memoryGetEvents: (opts?: { limit?: number; offset?: number; search?: string }) => ipcRenderer.invoke('memory:get-events', opts || {}),
  memoryCheckHealth: () => ipcRenderer.invoke('memory:check-health'),

  // Cloud Memory Auth
  cloudAuthStart: () => ipcRenderer.invoke('cloud:auth-start'),
  cloudAuthPoll: (deviceCode: string) => ipcRenderer.invoke('cloud:auth-poll', deviceCode),
  cloudListMemories: (apiKey: string) => ipcRenderer.invoke('cloud:list-memories', apiKey),
  cloudConnect: (apiKey: string, memoryId: string) => ipcRenderer.invoke('cloud:connect', apiKey, memoryId),
  cloudDisconnect: () => ipcRenderer.invoke('cloud:disconnect'),
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),

  // App Doctor (System Health)
  doctorRun: () => ipcRenderer.invoke('doctor:run'),
  doctorFix: (checkId: string) => ipcRenderer.invoke('doctor:fix', checkId),

  // Launch at Login
  setLoginItem: (enabled: boolean) => ipcRenderer.invoke('app:set-login-item', enabled),
  getLoginItem: () => ipcRenderer.invoke('app:get-login-item'),

  // Memory warning (fire-and-forget from main process)
  onMemoryWarning: (callback: (payload: { type: string; message: string }) => void) => {
    ipcRenderer.on('chat:memory-warning', (_e: any, payload: { type: string; message: string }) => callback(payload));
  },

  // Daemon watchdog
  daemonMarkConnected: () => ipcRenderer.invoke('daemon:mark-connected'),
});
