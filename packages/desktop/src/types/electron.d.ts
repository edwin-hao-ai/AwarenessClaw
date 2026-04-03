export interface ElectronAPI {
  getPlatform: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  getDashboardUrl: () => Promise<{ url: string | null }>;
  startupEnsureRuntime: () => Promise<{
    ok: boolean;
    needsSetup?: boolean;
    blockingMessage?: string;
    fixed: string[];
    warnings: string[];
  }>;
  onStartupStatus: (callback: (status: { message: string; progress?: number }) => void) => void;
  detectEnvironment: () => Promise<EnvironmentInfo>;
  installNodeJs: () => Promise<{ success: boolean; alreadyInstalled?: boolean; method?: string; error?: string; hint?: string }>;
  installOpenClaw: () => Promise<{ success: boolean; alreadyInstalled?: boolean; version?: string; method?: string; error?: string; hint?: string }>;
  installPlugin: () => Promise<{ success: boolean; error?: string }>;
  startDaemon: () => Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }>;
  onSetupStatus?: (callback: (status: { stepKey: string; key: string; detail?: string }) => void) => (() => void);
  onSetupDaemonStatus?: (callback: (status: { key: string; detail?: string }) => void) => (() => void);
  saveConfig: (config: Record<string, unknown>) => Promise<{ success: boolean }>;
  openAuthUrl: (url: string) => Promise<void>;
  chatSend?: (message: string, sessionId?: string, options?: { thinkingLevel?: string; model?: string; files?: string[]; workspacePath?: string; agentId?: string }) => Promise<{ success: boolean; text?: string; error?: string; sessionId?: string; awaitingApproval?: boolean; approvalRequestId?: string; approvalCommand?: string; approvalDetail?: string }>;
  chatAbort?: (sessionId?: string) => Promise<{ success: boolean; error?: string }>;
  chatApprove?: (sessionId: string, approvalRequestId: string) => Promise<{ success: boolean; command?: string; error?: string }>;
  onChatStream?: (callback: (chunk: string) => void) => void;
  onChatStreamEnd?: (callback: () => void) => void;
  onChatThinking?: (callback: (text: string) => void) => void;
  onChatDebug?: (callback: (msg: string) => void) => void;
  onChatStatus?: (callback: (status: { type: string; tool?: string; toolStatus?: string; toolId?: string; message?: string; detail?: string; approvalRequestId?: string; approvalCommand?: string }) => void) => void;
  onMemoryWarning?: (callback: (payload: { type: string; message: string }) => void) => void;
  filePreview?: (filePath: string) => Promise<unknown>;
  selectFile?: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ filePath: string | null }>;
  selectDirectory?: () => Promise<{ directoryPath: string | null }>;
  permissionsGet?: () => Promise<{ success: boolean; profile: string; alsoAllow: string[]; denied: string[]; execAsk?: 'off' | 'on-miss'; error?: string }>;
  permissionsUpdate?: (changes: { alsoAllow?: string[]; denied?: string[]; execAsk?: 'off' | 'on-miss' }) => Promise<{ success: boolean; error?: string }>;
  openclawConfigRead?: (dotPath?: string) => Promise<{ success: boolean; value: unknown; error?: string }>;
  openclawConfigWrite?: (dotPath: string, value: unknown) => Promise<{ success: boolean; error?: string }>;
  openclawConfigSchema?: () => Promise<{ success: boolean; schema?: Record<string, unknown>; error?: string }>;
  agentsList?: () => Promise<{ success: boolean; agents?: Array<{ id: string; name?: string; emoji?: string; model?: string; bindings?: string[]; isDefault?: boolean; workspace?: string; routes?: string[] }>; error?: string }>;
  agentsAdd?: (name: string, model?: string, systemPrompt?: string) => Promise<{ success: boolean; error?: string }>;
  agentsDelete?: (id: string) => Promise<{ success: boolean; error?: string }>;
  agentsSetIdentity?: (id: string, name: string, emoji: string, avatar?: string, theme?: string) => Promise<{ success: boolean; error?: string }>;
  agentsBind?: (id: string, binding: string) => Promise<{ success: boolean; error?: string }>;
  agentsUnbind?: (id: string, binding: string) => Promise<{ success: boolean; error?: string }>;
  agentsListFiles?: (id: string) => Promise<{ success: boolean; files?: string[]; error?: string }>;
  agentsReadFile?: (id: string, fileName: string) => Promise<{ success: boolean; content?: string; path?: string; error?: string }>;
  agentsWriteFile?: (id: string, fileName: string, content: string) => Promise<{ success: boolean; error?: string }>;
  skillListInstalled?: () => Promise<{ success: boolean; skills?: Record<string, unknown>; report?: { skills?: unknown[] }; error?: string }>;
  skillExplore?: () => Promise<{ success: boolean; skills?: unknown[]; error?: string }>;
  skillSearch?: (query: string) => Promise<{ success: boolean; results?: unknown[]; error?: string }>;
  skillDetail?: (slug: string) => Promise<{ success: boolean; skill?: unknown; error?: string }>;
  skillInstall?: (slug: string) => Promise<{ success: boolean; error?: string }>;
  skillUninstall?: (slug: string) => Promise<{ success: boolean; error?: string }>;
  skillInstallDeps?: (installSpecs: Array<{ id: string; kind: string; label: string; bins: string[]; package?: string }>) => Promise<{ success: boolean; error?: string }>;
  skillLocalInfo?: (name: string) => Promise<{ success: boolean; info?: { install?: Array<{ id: string; kind: string; label: string; bins: string[]; package?: string }>; homepage?: string }; error?: string }>;
  skillGetConfig?: (slug: string) => Promise<{ success: boolean; config?: Record<string, string>; enabled?: boolean; apiKey?: string; env?: Record<string, string>; error?: string }>;
  skillSaveConfig?: (slug: string, config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  readExistingConfig?: () => Promise<{ exists: boolean; hasProviders: boolean; providers: string[]; primaryModel: string; hasApiKey: boolean }>;
  bootstrap?: () => Promise<{ success: boolean; output?: string | null }>;
  modelsReadProviders?: () => Promise<{ success: boolean; providers: Array<{ key: string; baseUrl: string; apiType?: string; hasApiKey: boolean; models: Array<{ id: string; name: string }> }>; primaryModel: string }>;
  modelsDiscover?: (input: { providerKey: string; baseUrl: string; apiKey?: string }) => Promise<{ success: boolean; models: Array<{ id: string; name: string }>; error?: string }>;
}

export interface EnvironmentInfo {
  platform: string;
  arch: string;
  home: string;
  nodeVersion: string;
  systemNodeInstalled: boolean;
  systemNodeVersion: string | null;
  npmInstalled: boolean;
  openclawInstalled: boolean;
  openclawVersion: string | null;
  hasExistingConfig: boolean;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// Electron webview tag support
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & {
      src?: string;
      allowpopups?: string;
      partition?: string;
      preload?: string;
    }, HTMLElement>;
  }
}
