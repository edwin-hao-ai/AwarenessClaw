const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPlatform: () => ipcRenderer.invoke('app:get-platform'),
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
  getDashboardUrl: () => ipcRenderer.invoke('app:get-dashboard-url'),

  // Setup wizard
  detectEnvironment: () => ipcRenderer.invoke('setup:detect-environment'),
  installNodeJs: () => ipcRenderer.invoke('setup:install-nodejs'),
  installOpenClaw: () => ipcRenderer.invoke('setup:install-openclaw'),
  installPlugin: () => ipcRenderer.invoke('setup:install-plugin'),
  startDaemon: () => ipcRenderer.invoke('setup:start-daemon'),
  saveConfig: (config: Record<string, unknown>) => ipcRenderer.invoke('setup:save-config', config),
  openAuthUrl: (url: string) => ipcRenderer.invoke('setup:open-auth-url', url),
});
