import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock image imports (vitest doesn't handle static assets)
vi.mock('../assets/logo.png', () => ({ default: 'logo.png' }));
vi.mock('../assets/logo.svg', () => ({ default: 'logo.svg' }));

// Mock DOM APIs not available in jsdom
Element.prototype.scrollIntoView = vi.fn();
HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock matchMedia (not available in jsdom)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock clipboard
Object.assign(navigator, {
  clipboard: { writeText: vi.fn(() => Promise.resolve()) },
});

// Set test language to English
localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));

// Mock Electron API for tests
Object.defineProperty(window, 'electronAPI', {
  value: {
    getPlatform: () => Promise.resolve('darwin'),
    openExternal: () => Promise.resolve(),
    getDashboardUrl: () => Promise.resolve({ url: null }),
    startupEnsureRuntime: () => Promise.resolve({ ok: true, fixed: [], warnings: [] }),
    onStartupStatus: () => {},
    detectEnvironment: () => Promise.resolve({
      platform: 'darwin',
      arch: 'arm64',
      home: '/Users/test',
      systemNodeInstalled: true,
      systemNodeVersion: 'v22.0.0',
      npmInstalled: true,
      openclawInstalled: true,
      openclawVersion: '2026.3.23',
      hasExistingConfig: true,
    }),
    installNodeJs: () => Promise.resolve({ success: true, alreadyInstalled: true }),
    installOpenClaw: () => Promise.resolve({ success: true }),
    installPlugin: () => Promise.resolve({ success: true }),
    startDaemon: () => Promise.resolve({ success: true }),
    saveConfig: () => Promise.resolve({ success: true }),
    openAuthUrl: () => Promise.resolve(),
    readExistingConfig: () => Promise.resolve({
      exists: true,
      hasProviders: true,
      providers: ['qwen-portal'],
      primaryModel: 'qwen-portal/qwen-turbo',
      hasApiKey: true,
    }),
    chatSend: (msg: string) => Promise.resolve({
      success: true,
      text: `Mock response to: ${msg}`,
      sessionId: 'test-session',
    }),
    onChatDebug: () => {},
    onChatThinking: () => {},
    onChatStream: () => {},
    onChatStreamEnd: () => {},
    onChatStatus: () => {},
    checkUpdates: () => Promise.resolve({ updates: [] }),
    channelSave: () => Promise.resolve({ success: true }),
    channelTest: () => Promise.resolve({ success: true }),
    channelSetup: () => Promise.resolve({ success: true }),
    channelReadConfig: () => Promise.resolve({ success: false }),
    selectFile: () => Promise.resolve({ filePath: null }),
    cronList: () => Promise.resolve({ jobs: [] }),
    cronAdd: () => Promise.resolve({ success: true }),
    cronRemove: () => Promise.resolve({ success: true }),
    gatewayStatus: () => Promise.resolve({ running: true }),
    gatewayStart: () => Promise.resolve({ success: true }),
    gatewayStop: () => Promise.resolve({ success: true }),
    gatewayRestart: () => Promise.resolve({ success: true }),
    getRecentLogs: () => Promise.resolve({ logs: 'Test log output' }),
    memorySearch: () => Promise.resolve({ result: { content: [{ text: '[]' }] } }),
    memoryGetCards: () => Promise.resolve({ error: 'mock: daemon not connected' }),
    memoryGetEvents: () => Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 }),
    memoryCheckHealth: () => Promise.resolve({ error: 'Not running' }),
    memoryGetDailySummary: () => Promise.resolve({ cards: { result: { content: [{ text: '{"knowledge_cards":[]}' }] } }, tasks: { result: { content: [{ text: '{"action_items":[]}' }] } } }),
    skillListInstalled: () => Promise.resolve({ success: true, skills: {} }),
    skillExplore: () => Promise.resolve({ success: true, skills: [] }),
    skillSearch: () => Promise.resolve({ success: true, results: [] }),
    skillInstall: () => Promise.resolve({ success: true }),
    skillUninstall: () => Promise.resolve({ success: true }),
    permissionsGet: () => Promise.resolve({ success: true, profile: 'coding', alsoAllow: [], denied: [], execSecurity: 'deny', execAsk: 'on-miss', execAskFallback: 'deny', execAutoAllowSkills: false, execAllowlist: [] }),
    permissionsUpdate: () => Promise.resolve({ success: true }),
    workspaceReadFile: () => Promise.resolve({ success: true, content: '', exists: false }),
    workspaceWriteFile: () => Promise.resolve({ success: true }),
    filePreview: () => Promise.resolve({ type: 'text', content: 'mock', size: 4 }),
    selectDirectory: () => Promise.resolve({ directoryPath: null }),
    onTrayNewChat: () => {},
    configExport: () => Promise.resolve({ success: true }),
    configImport: () => Promise.resolve({ success: true }),
    upgradeComponent: () => Promise.resolve({ success: true }),
    channelListConfigured: () => Promise.resolve({ success: true, configured: ['telegram'] }),
    channelListSupported: () => Promise.resolve({ success: false, channels: [] }),
    channelGetRegistry: () => Promise.resolve({ channels: [
      { id: 'local', openclawId: 'local', label: 'Local Chat', color: '#6366F1', iconType: 'svg', connectionType: 'one-click', configFields: [], saveStrategy: 'cli', order: 0, source: 'builtin' },
      { id: 'wechat', openclawId: 'openclaw-weixin', label: 'WeChat', color: '#07C160', iconType: 'svg', connectionType: 'one-click', configFields: [], saveStrategy: 'json-direct', setupFlow: 'qr-login', order: 4, source: 'builtin' },
      { id: 'telegram', openclawId: 'telegram', label: 'Telegram', color: '#26A5E4', iconType: 'svg', connectionType: 'token', configFields: [{ key: 'token', label: 'Token', type: 'password', required: true, cliFlag: '--token' }], saveStrategy: 'cli', order: 1, source: 'openclaw-dynamic' },
      { id: 'discord', openclawId: 'discord', label: 'Discord', color: '#5865F2', iconType: 'svg', connectionType: 'token', configFields: [{ key: 'token', label: 'Token', type: 'password', required: true, cliFlag: '--token' }], saveStrategy: 'cli', order: 2, source: 'openclaw-dynamic' },
      { id: 'whatsapp', openclawId: 'whatsapp', label: 'WhatsApp', color: '#25D366', iconType: 'svg', connectionType: 'one-click', configFields: [], saveStrategy: 'cli', setupFlow: 'qr-login', order: 3, source: 'openclaw-dynamic' },
      { id: 'slack', openclawId: 'slack', label: 'Slack', color: '#4A154B', iconType: 'svg', connectionType: 'multi-field', configFields: [{ key: 'botToken', label: 'Bot Token', type: 'password', required: true, cliFlag: '--bot-token' }, { key: 'appToken', label: 'App Token', type: 'password', required: true, cliFlag: '--app-token' }], saveStrategy: 'cli', order: 5, source: 'openclaw-dynamic' },
      { id: 'signal', openclawId: 'signal', label: 'Signal', color: '#3A76F0', iconType: 'svg', connectionType: 'one-click', configFields: [], saveStrategy: 'cli', setupFlow: 'add-then-login', order: 6, source: 'openclaw-dynamic' },
    ] }),
    memoryGetPerception: () => Promise.resolve({ result: { content: [{ text: '{"signals":[]}' }] } }),
    memoryGetTasks: () => Promise.resolve({ result: { content: [{ text: '[]' }] } }),
    memoryGetContext: () => Promise.resolve({ result: { content: [{ text: '{}' }] } }),
    skillDetail: () => Promise.resolve({ success: true, skill: { name: 'test', version: '1.0.0', description: 'Test skill' } }),
    skillGetConfig: () => Promise.resolve({ success: true, config: {} }),
    skillSaveConfig: () => Promise.resolve({ success: true }),
    pluginsList: () => Promise.resolve({ success: true, plugins: {} }),
    pluginsToggle: () => Promise.resolve({ success: true }),
    hooksList: () => Promise.resolve({ success: true, hooks: {} }),
    hooksToggle: () => Promise.resolve({ success: true }),
    openclawConfigRead: () => Promise.resolve({ success: true, value: { search: { provider: 'brave' } } }),
    openclawConfigWrite: () => Promise.resolve({ success: true }),
    openclawConfigSchema: () => Promise.resolve({ success: true, schema: {
      properties: {
        tools: {
          properties: {
            web: {
              properties: {
                search: {
                  type: 'object',
                  properties: {
                    enabled: { type: 'boolean' },
                    provider: { type: 'string' },
                    apiKey: { anyOf: [{ type: 'string' }, { type: 'object' }] },
                    maxResults: { type: 'integer' },
                  },
                },
              },
            },
          },
        },
      },
    } }),
    bootstrap: () => Promise.resolve({ success: true }),
    agentsList: () => Promise.resolve({ success: true, agents: [{ id: 'main', name: 'Claw', emoji: '🦞', isDefault: true, bindings: ['telegram'] }] }),
    agentsAdd: () => Promise.resolve({ success: true }),
    agentsDelete: () => Promise.resolve({ success: true }),
    agentsSetIdentity: () => Promise.resolve({ success: true }),
    agentsBind: () => Promise.resolve({ success: true }),
    agentsUnbind: () => Promise.resolve({ success: true }),
    agentsListFiles: () => Promise.resolve({ success: true, files: ['SOUL.md', 'USER.md', 'IDENTITY.md', 'TOOLS.md', 'AGENTS.md'] }),
    agentsReadFile: () => Promise.resolve({ success: true, content: '', path: '' }),
    agentsWriteFile: () => Promise.resolve({ success: true }),
    modelsReadProviders: () => Promise.resolve({ success: true, providers: [], primaryModel: '' }),
    modelsDiscover: () => Promise.resolve({ success: true, models: [] }),
    securityCheck: () => Promise.resolve({ issues: [] }),
    doctorRun: () => Promise.resolve({ timestamp: Date.now(), checks: [], summary: { pass: 0, warn: 0, fail: 0, skipped: 0 } }),
    doctorFix: () => Promise.resolve({ id: 'test', success: true, message: 'Fixed' }),
    setLoginItem: () => Promise.resolve({ success: true }),
    getLoginItem: () => Promise.resolve({ openAtLogin: false }),
    daemonMarkConnected: () => Promise.resolve(),
  },
  writable: true,
});
