export type ExecApprovalSecurity = 'deny' | 'allowlist' | 'full';
export type ExecApprovalAsk = 'off' | 'on-miss' | 'always';
export type PermissionPresetKey = 'safe' | 'standard' | 'developer';

export type PermissionPresetValues = {
  alsoAllow: string[];
  denied: string[];
  execSecurity: ExecApprovalSecurity;
  execAsk: ExecApprovalAsk;
  execAskFallback: ExecApprovalSecurity;
  execAutoAllowSkills: boolean;
};

export const BASE_REQUIRED_TOOLS = ['awareness_init', 'awareness_get_agent_prompt'] as const;
export const STANDARD_ALLOWED_TOOLS = ['exec', 'awareness_recall', 'awareness_record', 'awareness_lookup'] as const;
export const WEB_ALLOWED_TOOLS = ['web_search', 'web_fetch'] as const;
export const UI_ALLOWED_TOOLS = ['browser'] as const;
export const DEVELOPER_EXTRA_TOOLS = ['awareness_perception'] as const;

export const PERMISSION_PRESET_VALUES: Record<PermissionPresetKey, PermissionPresetValues> = {
  safe: {
    alsoAllow: [...BASE_REQUIRED_TOOLS],
    denied: ['exec', 'bash', 'shell', 'camera.snap', 'screen.record', 'contacts.add', 'calendar.add', 'sms.send'],
    execSecurity: 'deny',
    execAsk: 'on-miss',
    execAskFallback: 'deny',
    execAutoAllowSkills: false,
  },
  standard: {
    alsoAllow: [...BASE_REQUIRED_TOOLS, ...STANDARD_ALLOWED_TOOLS, ...WEB_ALLOWED_TOOLS, ...UI_ALLOWED_TOOLS],
    denied: ['camera.snap', 'screen.record', 'contacts.add', 'calendar.add', 'sms.send'],
    execSecurity: 'allowlist',
    execAsk: 'on-miss',
    execAskFallback: 'deny',
    execAutoAllowSkills: false,
  },
  developer: {
    alsoAllow: [...BASE_REQUIRED_TOOLS, ...STANDARD_ALLOWED_TOOLS, ...WEB_ALLOWED_TOOLS, ...UI_ALLOWED_TOOLS, ...DEVELOPER_EXTRA_TOOLS],
    denied: [],
    execSecurity: 'full',
    execAsk: 'off',
    execAskFallback: 'full',
    execAutoAllowSkills: true,
  },
};

export const DEFAULT_ONBOARDING_PERMISSION_PRESET: PermissionPresetKey = 'developer';