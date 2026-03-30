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
    permissionsGet: () => Promise.resolve({ success: true, profile: 'coding', alsoAllow: [], denied: [] }),
    permissionsUpdate: () => Promise.resolve({ success: true }),
    workspaceReadFile: () => Promise.resolve({ success: true, content: '', exists: false }),
    workspaceWriteFile: () => Promise.resolve({ success: true }),
    filePreview: () => Promise.resolve({ type: 'text', content: 'mock', size: 4 }),
    onTrayNewChat: () => {},
    configExport: () => Promise.resolve({ success: true }),
    configImport: () => Promise.resolve({ success: true }),
    upgradeComponent: () => Promise.resolve({ success: true }),
    channelListConfigured: () => Promise.resolve({ success: true, configured: ['telegram'] }),
    channelListSupported: () => Promise.resolve({ success: false, channels: [] }),
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
    bootstrap: () => Promise.resolve({ success: true }),
    agentsList: () => Promise.resolve({ success: true, agents: [{ id: 'main', name: 'Claw', emoji: '🦞', isDefault: true, bindings: ['telegram'] }] }),
    agentsAdd: () => Promise.resolve({ success: true }),
    agentsDelete: () => Promise.resolve({ success: true }),
    agentsSetIdentity: () => Promise.resolve({ success: true }),
    agentsBind: () => Promise.resolve({ success: true }),
    agentsUnbind: () => Promise.resolve({ success: true }),
    agentsReadFile: () => Promise.resolve({ success: true, content: '', path: '' }),
    agentsWriteFile: () => Promise.resolve({ success: true }),
    modelsReadProviders: () => Promise.resolve({ success: true, providers: [], primaryModel: '' }),
    securityCheck: () => Promise.resolve({ issues: [] }),
    doctorRun: () => Promise.resolve({ timestamp: Date.now(), checks: [], summary: { pass: 0, warn: 0, fail: 0, skipped: 0 } }),
    doctorFix: () => Promise.resolve({ id: 'test', success: true, message: 'Fixed' }),
  },
  writable: true,
});
