import { useState, useEffect, useRef } from 'react';
import { Moon, Sun, Monitor, Check, Loader2, Trash2, ExternalLink, Cloud, Lock, Shield, Code2 } from 'lucide-react';
import { useAppConfig, useDynamicProviders } from '../lib/store';
import { getUsageStats, clearUsage, type UsageStats } from '../lib/usage';
import { useI18n } from '../lib/i18n';
import { useExternalNavigator } from '../lib/useExternalNavigator';
import OpenClawConfigSectionForm from '../components/OpenClawConfigSectionForm';
import { SettingsSection, SettingsToggle } from '../components/settings/SettingsPrimitives';
import { SettingsPermissionsPanel } from '../components/settings/SettingsPermissionsPanel';
import { SettingsUsagePanel, SettingsVersionPanel } from '../components/settings/SettingsStatsPanels';
import { SettingsCloudAuthModal } from '../components/settings/SettingsCloudAuthModal';
import { SettingsAppearancePanel, SettingsMemoryPanel, SettingsMemoryPrivacyPanel, SettingsTokenPanel } from '../components/settings/SettingsCorePanels';
import { SettingsExtensionsPanel, SettingsGatewayPanel, SettingsHealthPanel, SettingsLogsModal, SettingsSecurityAuditPanel, SettingsSystemPanel } from '../components/settings/SettingsOperationsPanels';
import { buildDynamicSectionsFromSchema, getValueAtPath, setValueAtPath, type DynamicConfigSection } from '../lib/openclaw-capabilities';
import pkg from '../../package.json';

const KNOWN_ALLOWED_TOOLS = [
  { id: 'awareness_init', label: 'Awareness Init', desc: 'Bootstrap memory instructions automatically', risk: 'Core' },
  { id: 'awareness_get_agent_prompt', label: 'Prompt Pack', desc: 'Load installed Awareness prompt pack', risk: 'Core' },
  { id: 'exec', label: 'Shell Commands', desc: 'Run coding and terminal commands on your machine', risk: 'High' },
  { id: 'awareness_recall', label: 'Memory Recall', desc: 'Search past decisions and knowledge cards', risk: 'Normal' },
  { id: 'awareness_record', label: 'Memory Save', desc: 'Write new knowledge back to Awareness memory', risk: 'Normal' },
  { id: 'awareness_lookup', label: 'Knowledge Lookup', desc: 'Read structured memory cards', risk: 'Normal' },
  { id: 'awareness_perception', label: 'Project Signals', desc: 'Read file patterns and activity signals', risk: 'Elevated' },
];

const KNOWN_DENIED_COMMANDS = [
  { id: 'camera.snap', label: 'Camera', desc: 'Block taking photos or screen clips', impact: 'Privacy' },
  { id: 'screen.record', label: 'Screen Recording', desc: 'Block recording the screen', impact: 'Privacy' },
  { id: 'contacts.add', label: 'Contacts', desc: 'Block reading or adding contacts', impact: 'Privacy' },
  { id: 'calendar.add', label: 'Calendar', desc: 'Block creating calendar events', impact: 'Privacy' },
  { id: 'sms.send', label: 'SMS / Messages', desc: 'Block sending text messages', impact: 'Privacy' },
  { id: 'exec', label: 'Shell Commands', desc: 'Hard-block running arbitrary shell commands', impact: 'Critical' },
];

const WEB_PROVIDER_GUIDANCE: Record<string, { title: string; detail: string; requiresKey: boolean }> = {
  brave: {
    title: 'settings.web.guide.brave.title',
    detail: 'settings.web.guide.brave.detail',
    requiresKey: true,
  },
  perplexity: {
    title: 'settings.web.guide.perplexity.title',
    detail: 'settings.web.guide.perplexity.detail',
    requiresKey: true,
  },
  grok: {
    title: 'settings.web.guide.grok.title',
    detail: 'settings.web.guide.grok.detail',
    requiresKey: true,
  },
  browser: {
    title: 'settings.web.guide.browser.title',
    detail: 'settings.web.guide.browser.detail',
    requiresKey: false,
  },
};

type ExecApprovalSecurity = 'deny' | 'allowlist' | 'full';
type ExecApprovalAsk = 'off' | 'on-miss' | 'always';
type ExecApprovalAllowlistEntry = {
  id?: string;
  pattern: string;
  source?: string;
  lastUsedAt?: number;
  lastUsedCommand?: string;
  lastResolvedPath?: string;
};

type PermissionState = {
  profile: string;
  alsoAllow: string[];
  denied: string[];
  execSecurity: ExecApprovalSecurity;
  execAsk: ExecApprovalAsk;
  execAskFallback: ExecApprovalSecurity;
  execAutoAllowSkills: boolean;
  execAllowlist: ExecApprovalAllowlistEntry[];
};

export default function Settings() {
  const { t } = useI18n();
  const { config, updateConfig, syncConfig } = useAppConfig();
  const { openExternal, isOpening } = useExternalNavigator();
  const DEFAULT_EXEC_ASK = 'on-miss' as const;
  const DEFAULT_EXEC_SECURITY = 'deny' as const;
  const DEFAULT_EXEC_ASK_FALLBACK = 'deny' as const;
  const BASE_REQUIRED_TOOLS = ['awareness_init', 'awareness_get_agent_prompt'] as const;
  const STANDARD_ALLOWED_TOOLS = ['exec', 'awareness_recall', 'awareness_record', 'awareness_lookup'] as const;
  const DEVELOPER_EXTRA_TOOLS = ['awareness_perception'] as const;
  const [gatewayStatus, setGatewayStatus] = useState<'checking' | 'running' | 'stopped'>('checking');
  const [gatewayLoading, setGatewayLoading] = useState(false);
  const [logs, setLogs] = useState('');
  const [showLogs, setShowLogs] = useState(false);
  const [webSections, setWebSections] = useState<DynamicConfigSection[]>([]);
  const [webValues, setWebValues] = useState<Record<string, any>>({});
  const [webLoading, setWebLoading] = useState(true);
  const [webSaving, setWebSaving] = useState(false);
  const [webError, setWebError] = useState<string | null>(null);
  const [webSaved, setWebSaved] = useState(false);

  // Permissions state
  const [permissions, setPermissions] = useState<PermissionState | null>(null);
  const [newAllowTool, setNewAllowTool] = useState('');
  const [newDenyCmd, setNewDenyCmd] = useState('');
  const [newAllowlistPattern, setNewAllowlistPattern] = useState('');
  const [showAdvancedPerms, setShowAdvancedPerms] = useState(false);

  // Cloud auth state
  const [showCloudAuth, setShowCloudAuth] = useState(false);
  const [cloudAuthStep, setCloudAuthStep] = useState<'init' | 'loading' | 'waiting' | 'select' | 'done' | 'error'>('init');
  const [cloudDeviceCode, setCloudDeviceCode] = useState('');
  const [cloudUserCode, setCloudUserCode] = useState('');
  const [cloudVerifyUrl, setCloudVerifyUrl] = useState('');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [cloudMemories, setCloudMemories] = useState<Array<{ id: string; name: string }>>([]);
  const [cloudMode, setCloudMode] = useState<string>('local');
  const cloudPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Permission presets
  const PERMISSION_PRESETS = {
    safe: {
      label: t('settings.permissions.safe', 'Safe'),
      desc: t('settings.permissions.safe.desc', 'Minimal tool allowlist. Host exec still follows OpenClaw approval policy.'),
      icon: <Lock size={16} />,
      color: 'blue',
      alsoAllow: [...BASE_REQUIRED_TOOLS] as string[],
      denied: ['exec', 'bash', 'shell', 'camera.snap', 'screen.record', 'contacts.add', 'calendar.add', 'sms.send'],
      execSecurity: 'deny' as const,
      execAsk: 'on-miss' as const,
      execAskFallback: 'deny' as const,
      execAutoAllowSkills: false,
    },
    standard: {
      label: t('settings.permissions.standard', 'Standard'),
      desc: t('settings.permissions.standard.desc', 'Coding + Awareness tools, while host exec still follows OpenClaw approvals.'),
      icon: <Shield size={16} />,
      color: 'emerald',
      alsoAllow: [...BASE_REQUIRED_TOOLS, ...STANDARD_ALLOWED_TOOLS] as string[],
      denied: ['camera.snap', 'screen.record', 'contacts.add', 'calendar.add', 'sms.send'],
      execSecurity: 'allowlist' as const,
      execAsk: 'on-miss' as const,
      execAskFallback: 'deny' as const,
      execAutoAllowSkills: false,
    },
    developer: {
      label: t('settings.permissions.developer', 'Developer'),
      desc: t('settings.permissions.developer.desc', 'Broad tool access. This does not bypass OpenClaw host approval/security rules.'),
      icon: <Code2 size={16} />,
      color: 'purple',
      alsoAllow: [...BASE_REQUIRED_TOOLS, ...STANDARD_ALLOWED_TOOLS, ...DEVELOPER_EXTRA_TOOLS] as string[],
      denied: [] as string[],
      execSecurity: 'full' as const,
      execAsk: 'off' as const,
      execAskFallback: 'full' as const,
      execAutoAllowSkills: true,
    },
  };

  type PresetKey = keyof typeof PERMISSION_PRESETS;

  const detectPreset = (): PresetKey | null => {
    if (!permissions) return null;
    for (const [key, preset] of Object.entries(PERMISSION_PRESETS)) {
      const allowMatch = JSON.stringify([...preset.alsoAllow].sort()) === JSON.stringify([...permissions.alsoAllow].sort());
      const denyMatch = JSON.stringify([...preset.denied].sort()) === JSON.stringify([...permissions.denied].sort());
      const execSecurityMatch = preset.execSecurity === permissions.execSecurity;
      const execAskMatch = preset.execAsk === permissions.execAsk;
      const execAskFallbackMatch = preset.execAskFallback === permissions.execAskFallback;
      const autoAllowSkillsMatch = preset.execAutoAllowSkills === permissions.execAutoAllowSkills;
      if (allowMatch && denyMatch && execSecurityMatch && execAskMatch && execAskFallbackMatch && autoAllowSkillsMatch) return key as PresetKey;
    }
    return null; // custom
  };

  const applyPreset = async (key: PresetKey) => {
    const preset = PERMISSION_PRESETS[key];
    await savePermissions({
      alsoAllow: preset.alsoAllow,
      denied: preset.denied,
      execSecurity: preset.execSecurity,
      execAsk: preset.execAsk,
      execAskFallback: preset.execAskFallback,
      execAutoAllowSkills: preset.execAutoAllowSkills,
    });
  };

  // Plugins state — entries is Record<name, {enabled}> in openclaw.json
  const [plugins, setPlugins] = useState<Record<string, { enabled?: boolean }>>({});

  // Hooks state — hooks is Record<name, {enabled, entries?}> in openclaw.json
  const [hooks, setHooks] = useState<Record<string, { enabled?: boolean; entries?: Record<string, { enabled?: boolean }> }>>({});

  // Dynamic providers
  const { providers: allProviders } = useDynamicProviders();

  // Security audit
  const [securityIssues, setSecurityIssues] = useState<Array<{ level: string; message: string; fix?: string }>>([]);

  // Doctor (System Health)
  const [doctorReport, setDoctorReport] = useState<any>(null);
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [fixingId, setFixingId] = useState<string | null>(null);

  // Usage stats
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);

  // System version info
  const [versionInfo, setVersionInfo] = useState<{
    platform?: string; arch?: string; nodeVersion?: string; openclawVersion?: string;
    awarenessPluginVersion?: string; daemonRunning?: boolean; daemonVersion?: string;
    daemonStats?: { memories?: number; knowledge?: number; sessions?: number };
  } | null>(null);

  // Load version info on mount
  useEffect(() => {
    const loadVersions = async () => {
      if (!window.electronAPI) return;
      const env = await (window.electronAPI as any).detectEnvironment();
      setVersionInfo({
        platform: env.platform,
        arch: env.arch,
        nodeVersion: env.systemNodeVersion || null,
        openclawVersion: env.openclawVersion || null,
        awarenessPluginVersion: env.awarenessPluginVersion || null,
        daemonRunning: env.daemonRunning || false,
        daemonVersion: env.daemonVersion || null,
        daemonStats: env.daemonStats || null,
      });
    };
    loadVersions();
  }, []);

  // Load permissions, plugins, hooks on mount
  useEffect(() => {
    const api = window.electronAPI as any;
    if (!api) return;
    api.permissionsGet().then((res: any) => {
      if (res.success) setPermissions({
        profile: res.profile,
        alsoAllow: res.alsoAllow || [],
        denied: res.denied || [],
        execSecurity: res.execSecurity || DEFAULT_EXEC_SECURITY,
        execAsk: res.execAsk || DEFAULT_EXEC_ASK,
        execAskFallback: res.execAskFallback || DEFAULT_EXEC_ASK_FALLBACK,
        execAutoAllowSkills: Boolean(res.execAutoAllowSkills),
        execAllowlist: Array.isArray(res.execAllowlist) ? res.execAllowlist : [],
      });
    });
    api.pluginsList?.().then((res: any) => {
      if (res.success && res.entries && typeof res.entries === 'object') setPlugins(res.entries);
    }).catch(() => {});
    api.hooksList?.().then((res: any) => {
      if (res.success && res.hooks && typeof res.hooks === 'object') setHooks(res.hooks);
    }).catch(() => {});
    api.securityCheck?.().then((res: any) => {
      if (res?.issues) setSecurityIssues(res.issues);
    }).catch(() => {});
    setUsageStats(getUsageStats());
    // Run doctor on mount
    runDoctor();

    if (!api.openclawConfigSchema || !api.openclawConfigRead) {
      setWebLoading(false);
      return;
    }

    api.openclawConfigSchema().then(async (schemaResult: any) => {
      if (!schemaResult?.success || !schemaResult.schema) {
        setWebError(schemaResult?.error || 'Failed to load OpenClaw config schema.');
        setWebLoading(false);
        return;
      }

      const valueResult = await api.openclawConfigRead?.('tools.web');
      const nextValues = (valueResult?.success ? valueResult.value : {}) || {};
      setWebValues(nextValues);
      setWebSections(buildDynamicSectionsFromSchema(schemaResult.schema, 'tools.web', nextValues));
      setWebLoading(false);
    }).catch(() => {
      setWebError('Failed to load OpenClaw config schema.');
      setWebLoading(false);
    });
  }, []);

  const runDoctor = async () => {
    setDoctorLoading(true);
    try {
      const report = await (window.electronAPI as any).doctorRun?.();
      if (report) setDoctorReport(report);
    } catch {}
    setDoctorLoading(false);
  };

  const handleFix = async (checkId: string) => {
    setFixingId(checkId);
    try {
      await (window.electronAPI as any).doctorFix?.(checkId);
      // Re-run all checks after fix (fixing one may affect others)
      await runDoctor();
    } catch {}
    setFixingId(null);
  };

  const savePermissions = async (changes: Partial<PermissionState>) => {
    if (!window.electronAPI || !permissions) return;
    const updated: PermissionState = {
      ...permissions,
      ...changes,
      execSecurity: changes.execSecurity || permissions.execSecurity || DEFAULT_EXEC_SECURITY,
      execAsk: changes.execAsk || permissions.execAsk || DEFAULT_EXEC_ASK,
      execAskFallback: changes.execAskFallback || permissions.execAskFallback || DEFAULT_EXEC_ASK_FALLBACK,
      execAutoAllowSkills: changes.execAutoAllowSkills ?? permissions.execAutoAllowSkills,
      execAllowlist: changes.execAllowlist || permissions.execAllowlist || [],
    };
    setPermissions(updated);
    await (window.electronAPI as any).permissionsUpdate(changes);
  };

  // Check gateway status — only poll when page is visible, reduced frequency
  useEffect(() => {
    checkGateway();
    let interval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (!interval) interval = setInterval(checkGateway, 30000);
    };
    const stopPolling = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };

    const onVisibility = () => {
      if (document.hidden) { stopPolling(); }
      else { checkGateway(); startPolling(); }
    };

    document.addEventListener('visibilitychange', onVisibility);
    if (!document.hidden) startPolling();

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const checkGateway = async () => {
    if (!window.electronAPI) { setGatewayStatus('stopped'); return; }
    const result = await (window.electronAPI as any).gatewayStatus();
    setGatewayStatus(result.running ? 'running' : 'stopped');
  };

  const handleGatewayAction = async (action: 'start' | 'stop' | 'restart') => {
    setGatewayLoading(true);
    const api = window.electronAPI as any;
    if (action === 'start') await api.gatewayStart();
    else if (action === 'stop') await api.gatewayStop();
    else await api.gatewayRestart();
    await checkGateway();
    setGatewayLoading(false);
  };

  const loadLogs = async () => {
    if (!window.electronAPI) return;
    const result = await (window.electronAPI as any).getRecentLogs();
    setLogs(result.logs || t('settings.gateway.noLogs', 'No logs'));
    setShowLogs(true);
  };

  const handleToggle = (key: keyof typeof config, value: boolean) => {
    updateConfig({ [key]: value } as any);
    syncConfig(allProviders);
  };

  const handleRecallLimit = (value: number) => {
    updateConfig({ recallLimit: value });
    syncConfig(allProviders);
  };

  const handleWebFieldChange = (path: string, nextValue: any) => {
    setWebValues((prev) => setValueAtPath(prev, path.replace(/^tools\.web\./, ''), nextValue));
    setWebSaved(false);
  };

  const selectedWebProvider = String(webValues?.search?.provider || '').trim();
  const webProviderGuide = WEB_PROVIDER_GUIDANCE[selectedWebProvider];
  const webProviderApiKey = webValues?.search?.apiKey;
  const webProviderMissingKey = !!(webProviderGuide?.requiresKey && (!webProviderApiKey || (typeof webProviderApiKey === 'string' && !webProviderApiKey.trim())));

  const knownAllowed = permissions
    ? KNOWN_ALLOWED_TOOLS.map((tool) => ({ ...tool, enabled: permissions.alsoAllow.includes(tool.id) }))
    : [];
  const allowedNow = knownAllowed.filter((tool) => tool.enabled);
  const availableToAllow = knownAllowed.filter((tool) => !tool.enabled);
  const customAllowed = permissions
    ? permissions.alsoAllow.filter((tool) => !KNOWN_ALLOWED_TOOLS.some((known) => known.id === tool))
    : [];

  const knownDenied = permissions
    ? KNOWN_DENIED_COMMANDS.map((cmd) => ({ ...cmd, blocked: permissions.denied.includes(cmd.id) }))
    : [];
  const blockedNow = knownDenied.filter((cmd) => cmd.blocked);
  const customDenied = permissions
    ? permissions.denied.filter((cmd) => !KNOWN_DENIED_COMMANDS.some((known) => known.id === cmd))
    : [];

  const toggleAllowedTool = (toolId: string) => {
    if (!permissions) return;
    const isOn = permissions.alsoAllow.includes(toolId);
    savePermissions({
      alsoAllow: isOn
        ? permissions.alsoAllow.filter((tool) => tool !== toolId)
        : [...permissions.alsoAllow, toolId],
    });
  };

  const toggleDeniedCommand = (commandId: string) => {
    if (!permissions) return;
    const isOn = permissions.denied.includes(commandId);
    savePermissions({
      denied: isOn
        ? permissions.denied.filter((command) => command !== commandId)
        : [...permissions.denied, commandId],
    });
  };

  const saveWebConfig = async () => {
    const api = window.electronAPI as any;
    if (!api?.openclawConfigWrite) return;
    setWebSaving(true);
    setWebError(null);
    const result = await api.openclawConfigWrite('tools.web', webValues);
    setWebSaving(false);
    if (!result?.success) {
      setWebError(result?.error || 'Failed to save Web settings.');
      return;
    }
    setWebSaved(true);
    setTimeout(() => setWebSaved(false), 2500);
  };

  // Check cloud status on mount
  useEffect(() => {
    const api = window.electronAPI as any;
    api?.cloudStatus?.().then((res: any) => {
      if (res?.success) setCloudMode(res.mode || 'local');
    }).catch(() => {});
  }, []);

  // Cleanup cloud auth polling on unmount
  useEffect(() => {
    return () => { if (cloudPollRef.current) clearTimeout(cloudPollRef.current); };
  }, []);

  const startCloudAuth = async () => {
    const api = window.electronAPI as any;
    if (!api) return;
    setCloudAuthStep('loading');
    const res = await api.cloudAuthStart();
    if (!res?.success || !res.device_code) {
      setCloudAuthStep('error');
      return;
    }
    setCloudDeviceCode(res.device_code);
    setCloudUserCode(res.user_code);
    setCloudVerifyUrl(`${res.verification_uri}?code=${res.user_code}`);
    setCloudAuthStep('waiting');

    // Open browser automatically
    void openExternal(res.verification_uri + '?code=' + res.user_code, 'settings-cloud-auth');

    // Sequential polling — daemon holds each request up to 30s (long poll),
    // so we use recursive setTimeout to avoid request pileup.
    if (cloudPollRef.current) clearTimeout(cloudPollRef.current);
    const expiresIn = (res.expires_in || 600) * 1000;
    const startTime = Date.now();
    const deviceCode = res.device_code;

    const doPoll = async () => {
      if (Date.now() - startTime > expiresIn) {
        // Don't jump to error — stay on waiting screen so user can click refresh
        return;
      }
      try {
        const poll = await api.cloudAuthPoll(deviceCode);
        // Direct awareness.market response: { status: "approved", api_key: "..." }
        // or { status: "pending" } or { status: "expired" }
        if (poll?.api_key) {
          setCloudApiKey(poll.api_key);
          const memRes = await api.cloudListMemories(poll.api_key);
          const mems = memRes?.memories || [];
          if (mems.length <= 1) {
            const memId = mems[0]?.id || '';
            await api.cloudConnect(poll.api_key, memId);
            setCloudMode('hybrid');
            updateConfig({ memoryMode: 'cloud' });
            syncConfig(allProviders);
            setCloudAuthStep('done');
          } else {
            setCloudMemories(mems);
            setCloudAuthStep('select');
          }
          return; // Stop polling
        }
        if (poll?.status === 'expired' || poll?.status === 'denied') {
          setCloudAuthStep('error');
          return;
        }
      } catch { /* network error, retry */ }
      // Poll every 5s (direct API call, no daemon long-poll)
      cloudPollRef.current = setTimeout(doPoll, 5000);
    };
    // Start first poll after 1s (daemon does its own 30s long-poll internally)
    cloudPollRef.current = setTimeout(doPoll, 1000);
  };

  const selectCloudMemory = async (memoryId: string) => {
    const api = window.electronAPI as any;
    if (!api) return;
    await api.cloudConnect(cloudApiKey, memoryId);
    setCloudMode('hybrid');
    updateConfig({ memoryMode: 'cloud' });
    syncConfig(allProviders);
    setCloudAuthStep('done');
  };

  const handleCloudDisconnect = async () => {
    const api = window.electronAPI as any;
    if (!api) return;
    await api.cloudDisconnect();
    setCloudMode('local');
    updateConfig({ memoryMode: 'local' });
    syncConfig(allProviders);
  };

  const addCustomAllowedTool = () => {
    const toolName = newAllowTool.trim();
    if (!permissions || !toolName || permissions.alsoAllow.includes(toolName)) return;
    savePermissions({ alsoAllow: [...permissions.alsoAllow, toolName] });
    setNewAllowTool('');
  };

  const addCustomDeniedCommand = () => {
    const commandName = newDenyCmd.trim();
    if (!permissions || !commandName || permissions.denied.includes(commandName)) return;
    savePermissions({ denied: [...permissions.denied, commandName] });
    setNewDenyCmd('');
  };

  const addAllowlistPattern = () => {
    const pattern = newAllowlistPattern.trim();
    if (!permissions || !pattern || permissions.execAllowlist.some((entry) => entry.pattern === pattern)) return;
    savePermissions({
      execAllowlist: [
        ...permissions.execAllowlist,
        { id: `manual-${Date.now()}`, pattern },
      ],
    });
    setNewAllowlistPattern('');
  };

  const removeAllowlistPattern = (pattern: string) => {
    if (!permissions) return;
    savePermissions({
      execAllowlist: permissions.execAllowlist.filter((entry) => entry.pattern !== pattern),
    });
  };
  return (
    <div className="h-full overflow-y-auto">
      <div className="px-6 py-4 border-b border-slate-800">
        <h1 className="text-lg font-semibold">⚙️ {t('settings.title')}</h1>
      </div>

      <div className="p-6 space-y-6 max-w-2xl">
        <SettingsSection title={`🌐 ${t('settings.web.title', 'Web & Browser')}`}>
          <div className="p-4 space-y-4">
            <div className="text-xs text-slate-500">
              {t('settings.web.desc', 'Configure OpenClaw web search and browser-adjacent capabilities directly from Desktop. This form is generated from the OpenClaw config schema, so supported fields track the installed OpenClaw version.')}
            </div>

            {webProviderGuide && (
              <div className={`rounded-xl border px-3 py-3 text-xs ${webProviderMissingKey ? 'border-amber-500/30 bg-amber-500/10 text-amber-200' : 'border-sky-500/20 bg-sky-500/10 text-sky-100'}`}>
                <div className="font-medium mb-1">{t(webProviderGuide.title, webProviderGuide.title)}</div>
                <div className="opacity-80">{t(webProviderGuide.detail, webProviderGuide.detail)}</div>
                {webProviderMissingKey && <div className="mt-2 text-amber-300">{t('settings.web.guide.missingCredential', 'Current status: provider selected, but credential is still missing.')}</div>}
              </div>
            )}

            {webLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <Loader2 size={12} className="animate-spin" />
                {t('settings.web.loading', 'Loading OpenClaw capability schema...')}
              </div>
            ) : webSections.length > 0 ? (
              <>
                <OpenClawConfigSectionForm
                  sections={webSections}
                  values={Object.fromEntries(
                    webSections
                      .flatMap((section) => section.fields)
                      .map((field) => [field.path, getValueAtPath({ tools: { web: webValues } }, field.path)]),
                  )}
                  onChange={handleWebFieldChange}
                />

                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-slate-500">
                    {t('settings.web.hotReloadHint', 'OpenClaw hot-reloads most tools.web changes. Browser or web search fixes should not require a manual restart.')}
                  </div>
                  <div className="flex items-center gap-3">
                    {webSaved && <span className="text-xs text-emerald-400">{t('settings.web.saved', 'Saved to OpenClaw')}</span>}
                    <button
                      onClick={saveWebConfig}
                      disabled={webSaving}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 rounded-lg text-white transition-colors"
                    >
                      {webSaving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                      {t('settings.web.save', 'Save Web Settings')}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-xs text-slate-500">{t('settings.web.noSchema', 'This OpenClaw version does not expose a dynamic web capability schema yet.')}</div>
            )}

            {webError && (
              <div className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2">
                {webError}
              </div>
            )}
          </div>
        </SettingsSection>

        <SettingsMemoryPanel
          t={t}
          config={config}
          cloudMode={cloudMode}
          onToggle={handleToggle}
          onRecallLimitChange={handleRecallLimit}
          onSelectMode={(mode) => {
            updateConfig({ memoryMode: mode });
            if (mode === 'cloud' && cloudMode !== 'hybrid' && cloudMode !== 'cloud') {
              setShowCloudAuth(true);
              setCloudAuthStep('init');
              setTimeout(() => startCloudAuth(), 100);
            }
          }}
          onCloudDisconnect={handleCloudDisconnect}
          onCloudConnect={() => {
            setShowCloudAuth(true);
            setCloudAuthStep('init');
            setTimeout(() => startCloudAuth(), 100);
          }}
        />

        <SettingsMemoryPrivacyPanel
          t={t}
          blockedSources={config.memoryBlockedSources || []}
          onToggleSource={(id, nextAllowed) => {
            const blocked = config.memoryBlockedSources || [];
            const next = nextAllowed ? blocked.filter((source: string) => source !== id) : [...blocked, id];
            updateConfig({ memoryBlockedSources: next });
            syncConfig(allProviders);
          }}
          onClearAll={async () => {
            if (!confirm(t('settings.privacy.clearConfirm', 'Delete ALL local memories? This cannot be undone.'))) return;
            try {
              const response = await fetch('http://127.0.0.1:37800/api/v1/knowledge/cleanup', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patterns: ['.*'] }),
              });
              if (response.ok) alert(t('settings.privacy.cleared', 'All knowledge cards deleted.'));
              else alert(t('settings.privacy.clearFailed', 'Failed to clear memories.'));
            } catch {
              alert(t('settings.privacy.clearFailed', 'Failed to clear memories. Is the daemon running?'));
            }
          }}
        />

        <SettingsTokenPanel
          t={t}
          thinkingLevel={config.thinkingLevel || 'low'}
          recallLimit={config.recallLimit}
          autoRecall={config.autoRecall}
          onThinkingLevelChange={(value) => updateConfig({ thinkingLevel: value as any })}
          onRecallLimitChange={handleRecallLimit}
        />

        <SettingsAppearancePanel
          t={t}
          language={config.language}
          theme={config.theme}
          onLanguageChange={(value) => updateConfig({ language: value })}
          onThemeChange={(value) => updateConfig({ theme: value })}
        />

        {/* Permissions */}
        {permissions && (
          <SettingsPermissionsPanel
            t={t}
            permissions={permissions}
            presets={(Object.entries(PERMISSION_PRESETS) as [PresetKey, typeof PERMISSION_PRESETS[PresetKey]][]).map(([key, preset]) => ({ key, preset }))}
            activePreset={detectPreset()}
            allowedNow={allowedNow}
            availableToAllow={availableToAllow}
            customAllowed={customAllowed}
            blockedNow={blockedNow}
            customDenied={customDenied}
            knownAllowedTools={KNOWN_ALLOWED_TOOLS}
            knownDeniedCommands={KNOWN_DENIED_COMMANDS}
            showAdvancedPerms={showAdvancedPerms}
            newAllowTool={newAllowTool}
            newDenyCmd={newDenyCmd}
            onApplyPreset={(key) => applyPreset(key as PresetKey)}
            onToggleAllowedTool={toggleAllowedTool}
            onToggleDeniedCommand={toggleDeniedCommand}
            onSaveExecSecurity={(mode) => savePermissions({ execSecurity: mode })}
            onSaveExecAsk={(mode) => savePermissions({ execAsk: mode })}
            onSaveExecAskFallback={(mode) => savePermissions({ execAskFallback: mode })}
            onSaveExecAutoAllowSkills={(value) => savePermissions({ execAutoAllowSkills: value })}
            onAddAllowlistPattern={addAllowlistPattern}
            onRemoveAllowlistPattern={removeAllowlistPattern}
            onToggleAdvanced={() => setShowAdvancedPerms((value) => !value)}
            onNewAllowToolChange={setNewAllowTool}
            onNewDenyCmdChange={setNewDenyCmd}
            newAllowlistPattern={newAllowlistPattern}
            onNewAllowlistPatternChange={setNewAllowlistPattern}
            onAddCustomAllowed={addCustomAllowedTool}
            onAddCustomDenied={addCustomDeniedCommand}
          />
        )}

        <SettingsHealthPanel
          t={t}
          doctorLoading={doctorLoading}
          doctorReport={doctorReport}
          fixingId={fixingId}
          onRunDoctor={runDoctor}
          onFix={handleFix}
        />

        <SettingsSecurityAuditPanel t={t} securityIssues={securityIssues} />

        <SettingsExtensionsPanel
          t={t}
          plugins={plugins}
          hooks={hooks}
          onTogglePlugin={async (name, value) => {
            setPlugins((prev) => ({ ...prev, [name]: { ...prev[name], enabled: value } }));
            const api = window.electronAPI as any;
            await api.pluginsToggle?.(name, value);
          }}
          onToggleHook={async (name, value) => {
            setHooks((prev) => ({ ...prev, [name]: { ...prev[name], enabled: value } }));
            const api = window.electronAPI as any;
            await api.hooksToggle?.(name, value);
          }}
        />

        <SettingsGatewayPanel
          t={t}
          gatewayStatus={gatewayStatus}
          gatewayLoading={gatewayLoading}
          onGatewayAction={handleGatewayAction}
          onLoadLogs={loadLogs}
        />

        <SettingsSystemPanel
          t={t}
          autoUpdate={config.autoUpdate}
          autoStart={config.autoStart}
          onAutoUpdateChange={(value) => updateConfig({ autoUpdate: value })}
          onAutoStartChange={async (value) => {
            updateConfig({ autoStart: value });
            if (window.electronAPI) {
              await (window.electronAPI as any).setLoginItem(value);
            }
          }}
          onRunDiagnostic={async () => {
            if (!window.electronAPI) return;
            const env = await (window.electronAPI as any).detectEnvironment();
            const info = [
              `${t('settings.diagnostic.platform')}: ${env.platform} ${env.arch}`,
              `${t('settings.diagnostic.nodejs')}: ${env.systemNodeVersion || t('settings.diagnostic.notInstalled')}`,
              `${t('settings.diagnostic.openclaw')}: ${env.openclawVersion || t('settings.diagnostic.notInstalled')}`,
              `${t('settings.diagnostic.configFile')}: ${env.hasExistingConfig ? t('settings.diagnostic.exists') : t('settings.diagnostic.notExists')}`,
            ].join('\n');
            alert(info);
          }}
          onExport={async () => {
            if (!window.electronAPI) return;
            const result = await (window.electronAPI as any).configExport();
            if (result.success) alert(`${t('settings.export.success')}\n${result.path}`);
            else if (result.error !== 'Cancelled') alert(`${t('settings.export.failed')} ${result.error}`);
          }}
          onImport={async () => {
            if (!window.electronAPI) return;
            const result = await (window.electronAPI as any).configImport();
            if (result.success) {
              alert(t('settings.import.success'));
              window.location.reload();
            } else if (result.error !== 'Cancelled') {
              const msg = result.error === 'Invalid config file format'
                ? t('settings.import.formatError', 'Invalid config file. Please use a file exported from AwarenessClaw.')
                : `${t('settings.import.failed')} ${result.error}`;
              alert(msg);
            }
          }}
          onResetSetup={() => {
            localStorage.removeItem('awareness-claw-setup-done');
            window.location.reload();
          }}
        />

        <SettingsLogsModal t={t} show={showLogs} logs={logs} onClose={() => setShowLogs(false)} />

        {/* Usage Stats Panel */}
        {usageStats && usageStats.totalMessages > 0 && (
          <SettingsUsagePanel
            usageStats={usageStats}
            t={t}
            onClear={() => {
              if (confirm(t('settings.usage.clearConfirm', 'Clear all usage data? This cannot be undone.'))) {
                clearUsage();
                setUsageStats(getUsageStats());
              }
            }}
          />
        )}

        <SettingsVersionPanel
          packageVersion={pkg.version}
          versionInfo={versionInfo}
          t={t}
          onOpenGithub={() => { void openExternal('https://github.com/edwin-hao-ai/AwarenessClaw', 'settings-github'); }}
          githubOpening={isOpening('settings-github')}
        />
      </div>

      <SettingsCloudAuthModal
        t={t}
        open={showCloudAuth}
        step={cloudAuthStep}
        userCode={cloudUserCode}
        verifyUrl={cloudVerifyUrl}
        memories={cloudMemories}
        onClose={() => {
          setShowCloudAuth(false);
          if (cloudPollRef.current) clearTimeout(cloudPollRef.current);
        }}
        onOpenBrowser={() => { void openExternal(cloudVerifyUrl, 'settings-cloud-auth'); }}
        browserOpening={isOpening('settings-cloud-auth')}
        onRefreshCode={() => {
          if (cloudPollRef.current) clearTimeout(cloudPollRef.current);
          startCloudAuth();
        }}
        onSelectMemory={selectCloudMemory}
        onRetry={() => { setCloudAuthStep('init'); }}
      />
    </div>
  );
}
