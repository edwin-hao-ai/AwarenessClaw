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
  detectEnvironment: () => Promise<EnvironmentInfo>;
  installNodeJs: () => Promise<{ success: boolean; alreadyInstalled?: boolean; method?: string; error?: string; hint?: string }>;
  installOpenClaw: () => Promise<{ success: boolean; alreadyInstalled?: boolean; error?: string }>;
  installPlugin: () => Promise<{ success: boolean; error?: string }>;
  startDaemon: () => Promise<{ success: boolean; alreadyRunning?: boolean; error?: string }>;
  saveConfig: (config: Record<string, unknown>) => Promise<{ success: boolean }>;
  openAuthUrl: (url: string) => Promise<void>;
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
