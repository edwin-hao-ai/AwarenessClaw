export interface ElectronAPI {
  getPlatform: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  getDashboardUrl: () => Promise<{ url: string | null }>;
  appZoomGet?: () => Promise<{ success: boolean; factor: number; error?: string }>;
  appZoomIn?: () => Promise<{ success: boolean; factor: number; error?: string }>;
  appZoomOut?: () => Promise<{ success: boolean; factor: number; error?: string }>;
  appZoomReset?: () => Promise<{ success: boolean; factor: number; error?: string }>;
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
  chatSend?: (message: string, sessionId?: string, options?: { thinkingLevel?: string; model?: string; files?: string[]; workspacePath?: string; agentId?: string }) => Promise<{ success: boolean; text?: string; error?: string; sessionId?: string; awaitingApproval?: boolean; approvalRequestId?: string; approvalCommand?: string; approvalDetail?: string; unverifiedLocalFileOperation?: boolean; vpnDnsCompatibilityIssue?: boolean; preferResultText?: boolean }>;
  chatAbort?: (sessionId?: string) => Promise<{ success: boolean; error?: string }>;
  chatLoadHistory?: (sessionId: string) => Promise<{ success: boolean; messages?: unknown[]; error?: string }>;
  chatApprove?: (sessionId: string, approvalRequestId: string) => Promise<{ success: boolean; command?: string; error?: string }>;
  onChatStream?: (callback: (chunk: string) => void) => void;
  onChatStreamEnd?: (callback: () => void) => void;
  onChatThinking?: (callback: (text: string) => void) => void;
  onChatDebug?: (callback: (msg: string) => void) => void;
  onChatEvent?: (callback: (event: unknown) => void) => void;
  onChatStatus?: (callback: (status: { type: string; tool?: string; toolStatus?: string; toolId?: string; message?: string; detail?: string; approvalRequestId?: string; approvalCommand?: string }) => void) => void;
  onMemoryWarning?: (callback: (payload: { type: string; message: string }) => void) => void;
  filePreview?: (filePath: string) => Promise<unknown>;
  selectFile?: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ filePath: string | null }>;
  selectDirectory?: () => Promise<{ directoryPath: string | null }>;
  permissionsGet?: () => Promise<{
    success: boolean;
    profile: string;
    alsoAllow: string[];
    denied: string[];
    execSecurity?: 'deny' | 'allowlist' | 'full';
    execAsk?: 'off' | 'on-miss' | 'always';
    execAskFallback?: 'deny' | 'allowlist' | 'full';
    execAutoAllowSkills?: boolean;
    execAllowlist?: Array<{ id?: string; pattern: string; source?: string; lastUsedAt?: number; lastUsedCommand?: string; lastResolvedPath?: string }>;
    error?: string;
  }>;
  permissionsUpdate?: (changes: {
    alsoAllow?: string[];
    denied?: string[];
    execSecurity?: 'deny' | 'allowlist' | 'full';
    execAsk?: 'off' | 'on-miss' | 'always';
    execAskFallback?: 'deny' | 'allowlist' | 'full';
    execAutoAllowSkills?: boolean;
    execAllowlist?: Array<{ id?: string; pattern: string; source?: string; lastUsedAt?: number; lastUsedCommand?: string; lastResolvedPath?: string }>;
  }) => Promise<{ success: boolean; error?: string }>;
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
  skillInstallDeps?: (installSpecs: Array<{ id: string; kind: string; label: string; bins: string[]; package?: string; formula?: string; module?: string }>, skillName?: string) => Promise<{ success: boolean; error?: string; verified?: string[]; unverified?: string[] }>;
  skillLocalInfo?: (name: string) => Promise<{ success: boolean; info?: { install?: Array<{ id: string; kind: string; label: string; bins: string[]; package?: string }>; homepage?: string }; error?: string }>;
  skillGetConfig?: (slug: string) => Promise<{ success: boolean; config?: Record<string, string>; enabled?: boolean; apiKey?: string; env?: Record<string, string>; error?: string }>;
  skillSaveConfig?: (slug: string, config: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>;
  readExistingConfig?: () => Promise<{ exists: boolean; hasProviders: boolean; providers: string[]; primaryModel: string; hasApiKey: boolean }>;
  bootstrap?: () => Promise<{ success: boolean; output?: string | null }>;
  modelsReadProviders?: () => Promise<{ success: boolean; providers: Array<{ key: string; baseUrl: string; apiType?: string; hasApiKey: boolean; models: Array<{ id: string; name: string }> }>; primaryModel: string }>;
  modelsDiscover?: (input: { providerKey: string; baseUrl: string; apiKey?: string }) => Promise<{ success: boolean; models: Array<{ id: string; name: string }>; error?: string }>;
  memoryLearningStatus?: (opts?: { agentId?: string; workspacePath?: string }) => Promise<{
    success: boolean;
    rootDir?: string;
    learningsDir?: string;
    pendingCount?: number;
    highPriorityPendingCount?: number;
    promotionProposalCount?: number;
    readyForPromotionCount?: number;
    error?: string;
  }>;
  memoryPromotionList?: (opts?: { agentId?: string; workspacePath?: string }) => Promise<{
    success: boolean;
    rootDir?: string;
    learningsDir?: string;
    proposalFilePath?: string;
    items?: Array<{
      id: string;
      status: 'proposed' | 'approved' | 'rejected';
      target: 'AGENTS.md' | 'SOUL.md' | 'TOOLS.md';
      patternKey: string;
      summary: string;
      ruleText: string;
      evidenceCount: number;
      evidenceIds: string[];
      createdAt?: string;
      approvedAt?: string;
    }>;
    error?: string;
  }>;
  memoryPromotionApply?: (payload: { proposalId: string; agentId?: string; workspacePath?: string }) => Promise<{
    success: boolean;
    rootDir?: string;
    learningsDir?: string;
    proposalFilePath?: string;
    targetFilePath?: string;
    proposal?: {
      id: string;
      status: 'proposed' | 'approved' | 'rejected';
      target: 'AGENTS.md' | 'SOUL.md' | 'TOOLS.md';
      patternKey: string;
      summary: string;
      ruleText: string;
      evidenceCount: number;
      evidenceIds: string[];
      createdAt?: string;
      approvedAt?: string;
    };
    error?: string;
  }>;
  memoryPromotionReject?: (payload: { proposalId: string; agentId?: string; workspacePath?: string }) => Promise<{
    success: boolean;
    rootDir?: string;
    learningsDir?: string;
    proposalFilePath?: string;
    proposal?: {
      id: string;
      status: 'proposed' | 'approved' | 'rejected';
      target: 'AGENTS.md' | 'SOUL.md' | 'TOOLS.md';
      patternKey: string;
      summary: string;
      ruleText: string;
      evidenceCount: number;
      evidenceIds: string[];
      createdAt?: string;
      approvedAt?: string;
    };
    error?: string;
  }>;
  memoryPromotionApplyAll?: (opts?: { agentId?: string; workspacePath?: string }) => Promise<{
    success: boolean;
    rootDir?: string;
    learningsDir?: string;
    proposalFilePath?: string;
    result?: {
      requestedCount: number;
      appliedCount: number;
      skippedCount: number;
      applied: Array<{
        proposalId: string;
        target: 'AGENTS.md' | 'SOUL.md' | 'TOOLS.md';
        targetFilePath: string;
      }>;
    };
    error?: string;
  }>;
  memoryLogLearning?: (payload: {
    type: 'learning' | 'error' | 'feature';
    summary: string;
    details?: string;
    suggestedAction?: string;
    area?: 'frontend' | 'backend' | 'infra' | 'tests' | 'docs' | 'config';
    priority?: 'low' | 'medium' | 'high' | 'critical';
    category?: 'correction' | 'insight' | 'knowledge_gap' | 'best_practice';
    commandName?: string;
    source?: string;
    relatedFiles?: string[];
    tags?: string[];
    complexity?: 'simple' | 'medium' | 'complex';
    frequency?: 'first_time' | 'recurring';
    userContext?: string;
    agentId?: string;
    workspacePath?: string;
  }) => Promise<{
    success: boolean;
    id?: string;
    filePath?: string;
    rootDir?: string;
    learningsDir?: string;
    promotion?: {
      generatedCount?: number;
      proposalFilePath?: string;
      proposalIds?: string[];
    };
    error?: string;
  }>;

  // Task Center
  workflowConfig?: () => Promise<{ maxSpawnDepth: number; maxChildrenPerAgent: number; agentToAgentEnabled: boolean }>;
  workflowEnableCollaboration?: () => Promise<{ success: boolean; config?: { maxSpawnDepth: number; agentToAgentEnabled: boolean } }>;
  workflowCheckLobster?: () => Promise<{ installed: boolean; enabled: boolean }>;
  workflowInstallLobster?: () => Promise<{ success: boolean; error?: string }>;
  taskCreate?: (params: { title: string; agentId: string; model?: string; thinking?: string; timeoutSeconds?: number; sessionKey?: string }) => Promise<{ success: boolean; runId?: string; sessionKey?: string; error?: string }>;
  taskCancel?: (sessionKey: string) => Promise<{ success: boolean; error?: string }>;
  taskDetail?: (sessionKey: string) => Promise<{ success: boolean; messages?: unknown[]; error?: string }>;
  workflowList?: () => Promise<{ workflows: Array<{ id: string; name: string; description: string; icon: string; yamlPath: string; isBuiltin: boolean }> }>;
  workflowRun?: (yamlPath: string, args: Record<string, string>) => Promise<{ success: boolean; status?: string; output?: unknown; error?: string }>;
  workflowApprove?: (resumeToken: string, approve: boolean) => Promise<{ success: boolean; error?: string }>;
  workflowSave?: (fileName: string, content: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  workflowDelete?: (yamlPath: string) => Promise<{ success: boolean; error?: string }>;
  onTaskStatusUpdate?: (callback: (data: { event: string; runId: string; agentId: string; status: string; result: string; sessionKey: string }) => void) => (() => void) | undefined;
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
