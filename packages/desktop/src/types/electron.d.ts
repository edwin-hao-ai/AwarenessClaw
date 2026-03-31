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
  installOpenClaw: () => Promise<{ success: boolean; alreadyInstalled?: boolean; error?: string }>;
  installPlugin: () => Promise<{ success: boolean; error?: string }>;
  startDaemon: () => Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }>;
  onSetupDaemonStatus?: (callback: (status: { key: string; detail?: string }) => void) => (() => void);
  saveConfig: (config: Record<string, unknown>) => Promise<{ success: boolean }>;
  openAuthUrl: (url: string) => Promise<void>;
  chatSend?: (message: string, sessionId?: string, options?: { thinkingLevel?: string; model?: string; files?: string[]; workspacePath?: string }) => Promise<{ success: boolean; text?: string; error?: string; sessionId?: string }>;
  onChatStream?: (callback: (chunk: string) => void) => void;
  onChatStreamEnd?: (callback: () => void) => void;
  onChatStatus?: (callback: (status: { type: string; tool?: string; toolStatus?: string; toolId?: string; message?: string }) => void) => void;
  filePreview?: (filePath: string) => Promise<unknown>;
  selectFile?: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ filePath: string | null }>;
  selectDirectory?: () => Promise<{ directoryPath: string | null }>;
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
