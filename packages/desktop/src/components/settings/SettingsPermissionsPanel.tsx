import type { ReactNode } from 'react';
import { Check, Plus, Shield, X, Zap } from 'lucide-react';
import { SettingsSection } from './SettingsPrimitives';

type PermissionState = {
  profile: string;
  alsoAllow: string[];
  denied: string[];
  execSecurity: 'deny' | 'allowlist' | 'full';
  execAsk: 'off' | 'on-miss' | 'always';
  execAskFallback: 'deny' | 'allowlist' | 'full';
  execAutoAllowSkills: boolean;
  execAllowlist: Array<{ id?: string; pattern: string; source?: string; lastUsedAt?: number; lastUsedCommand?: string; lastResolvedPath?: string }>;
};

type PermissionPreset = {
  label: string;
  desc: string;
  icon: ReactNode;
  color: string;
  alsoAllow: string[];
  denied: string[];
  execSecurity: 'deny' | 'allowlist' | 'full';
  execAsk: 'off' | 'on-miss' | 'always';
  execAskFallback: 'deny' | 'allowlist' | 'full';
  execAutoAllowSkills: boolean;
};

type PermissionCatalogItem = {
  id: string;
  label: string;
  desc: string;
  risk?: string;
  impact?: string;
};

export function SettingsPermissionsPanel({
  t,
  permissions,
  presets,
  activePreset,
  allowedNow,
  availableToAllow,
  customAllowed,
  blockedNow,
  customDenied,
  knownAllowedTools,
  knownDeniedCommands,
  showAdvancedPerms,
  newAllowTool,
  newDenyCmd,
  onApplyPreset,
  onToggleAllowedTool,
  onToggleDeniedCommand,
  onSaveExecSecurity,
  onSaveExecAsk,
  onSaveExecAskFallback,
  onSaveExecAutoAllowSkills,
  onAddAllowlistPattern,
  onRemoveAllowlistPattern,
  onToggleAdvanced,
  onNewAllowToolChange,
  onNewDenyCmdChange,
  newAllowlistPattern,
  onNewAllowlistPatternChange,
  onAddCustomAllowed,
  onAddCustomDenied,
}: {
  t: (key: string, fallback?: string) => string;
  permissions: PermissionState;
  presets: Array<{ key: string; preset: PermissionPreset }>;
  activePreset: string | null;
  allowedNow: Array<PermissionCatalogItem & { enabled?: boolean }>;
  availableToAllow: Array<PermissionCatalogItem & { enabled?: boolean }>;
  customAllowed: string[];
  blockedNow: Array<PermissionCatalogItem & { blocked?: boolean }>;
  customDenied: string[];
  knownAllowedTools: PermissionCatalogItem[];
  knownDeniedCommands: PermissionCatalogItem[];
  showAdvancedPerms: boolean;
  newAllowTool: string;
  newDenyCmd: string;
  onApplyPreset: (key: string) => void;
  onToggleAllowedTool: (toolId: string) => void;
  onToggleDeniedCommand: (commandId: string) => void;
  onSaveExecSecurity: (mode: 'deny' | 'allowlist' | 'full') => void;
  onSaveExecAsk: (mode: 'off' | 'on-miss' | 'always') => void;
  onSaveExecAskFallback: (mode: 'deny' | 'allowlist' | 'full') => void;
  onSaveExecAutoAllowSkills: (value: boolean) => void;
  onAddAllowlistPattern: () => void;
  onRemoveAllowlistPattern: (pattern: string) => void;
  onToggleAdvanced: () => void;
  onNewAllowToolChange: (value: string) => void;
  onNewDenyCmdChange: (value: string) => void;
  newAllowlistPattern: string;
  onNewAllowlistPatternChange: (value: string) => void;
  onAddCustomAllowed: () => void;
  onAddCustomDenied: () => void;
}) {
  const activePresetData = activePreset
    ? presets.find(({ key }) => key === activePreset)?.preset ?? null
    : null;

  const presetColorClasses: Record<string, { active: string; idle: string }> = {
    blue: {
      active: 'settings-glass-soft border-blue-500/35 text-slate-200',
      idle: 'settings-glass-soft text-slate-400 hover:border-blue-500/35 hover:text-blue-300',
    },
    emerald: {
      active: 'settings-glass-soft border-emerald-500/35 text-slate-200',
      idle: 'settings-glass-soft text-slate-400 hover:border-emerald-500/35 hover:text-emerald-300',
    },
    purple: {
      active: 'settings-glass-soft border-purple-500/35 text-slate-200',
      idle: 'settings-glass-soft text-slate-400 hover:border-purple-500/35 hover:text-purple-300',
    },
  };

  return (
    <SettingsSection title={(
      <span className="inline-flex items-center gap-2">
        <Shield size={15} className="text-emerald-300" />
        {t('settings.permissions')}
      </span>
    )}>
      <div className="p-5 space-y-5">
        <p className="text-xs leading-5 text-slate-500">{t('settings.permissions.presetDesc', 'This panel is a simplified desktop view of OpenClaw permissions. It controls tool allow/deny plus part of exec approval behavior.')}</p>
        <div className="settings-glass-soft px-3 py-3 text-[11px] leading-5 text-amber-300">
          {t('settings.permissions.coverageNote', 'This panel now covers OpenClaw exec approval defaults plus the main agent allowlist in ~/.openclaw/exec-approvals.json. Multi-agent scope switching and richer allowlist metadata editing are still not exposed here yet.')}
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {presets.map(({ key, preset }) => {
            const isActive = activePreset === key;
            const colorClasses = presetColorClasses[preset.color] ?? presetColorClasses.blue;
            return (
              <button
                key={key}
                onClick={() => onApplyPreset(key)}
                className={`relative flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all text-center ${isActive ? colorClasses.active : colorClasses.idle}`}
              >
                {isActive && (
                  <span className="absolute top-1.5 right-1.5">
                    <Check size={10} className="text-current opacity-80" />
                  </span>
                )}
                <span className="opacity-80">{preset.icon}</span>
                <span className="text-xs font-medium">{preset.label}</span>
              </button>
            );
          })}
        </div>

        {activePresetData ? (
          <div className="space-y-1 text-center">
            <p className="text-[11px] text-slate-500">{activePresetData.desc}</p>
            <p className="text-[10px] text-slate-600">{t('settings.permissions.hostExecPolicySummary', 'Host exec policy: {security} / ask: {ask} / fallback: {fallback}').replace('{security}', permissions.execSecurity).replace('{ask}', permissions.execAsk).replace('{fallback}', permissions.execAskFallback)}</p>
          </div>
        ) : (
          <div className="space-y-1 text-center">
            <p className="text-[11px] text-amber-500/80">{t('settings.permissions.custom', 'Custom configuration')}</p>
            <p className="text-[10px] text-slate-600">{t('settings.permissions.hostExecPolicySummary', 'Host exec policy: {security} / ask: {ask} / fallback: {fallback}').replace('{security}', permissions.execSecurity).replace('{ask}', permissions.execAsk).replace('{fallback}', permissions.execAskFallback)}</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="settings-glass-soft p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200">{t('settings.permissions.alreadyAllowed', 'Already Allowed')}</span>
              <span className="text-[10px] text-slate-400">{allowedNow.length + customAllowed.length}</span>
            </div>
            <div className="space-y-1.5">
              {allowedNow.length === 0 && customAllowed.length === 0 && (
                <div className="text-[11px] text-slate-500">{t('settings.permissions.noneAllowedSummary', 'Only the current desktop tool allowlist is active right now.')}</div>
              )}
              {allowedNow.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => onToggleAllowedTool(tool.id)}
                  className="w-full text-left rounded-lg settings-glass-soft px-3 py-2 hover:border-emerald-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-100">{tool.label}</span>
                      <span className="text-[10px] text-slate-400">{tool.risk}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">{tool.desc}</div>
                </button>
              ))}
              {customAllowed.map((tool) => (
                <div key={tool} className="flex items-center justify-between rounded-lg settings-glass-soft px-3 py-2">
                  <span className="text-[11px] font-mono text-slate-300">{tool}</span>
                  <button onClick={() => onToggleAllowedTool(tool)} className="settings-btn settings-btn-danger text-[10px] px-2 py-1">{t('common.remove', 'Remove')}</button>
                </div>
              ))}
            </div>
          </div>

          <div className="settings-glass-soft p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200">{t('settings.permissions.canBeEnabled', 'Can Be Enabled')}</span>
              <span className="text-[10px] text-slate-400">{availableToAllow.length}</span>
            </div>
            <div className="space-y-1.5">
              {availableToAllow.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => onToggleAllowedTool(tool.id)}
                  className="w-full text-left rounded-lg settings-glass-soft px-3 py-2 hover:border-sky-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-100">{tool.label}</span>
                      <span className="text-[10px] text-slate-400">{t('settings.permissions.allowAction', 'Allow')}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">{tool.desc}</div>
                </button>
              ))}
              {availableToAllow.length === 0 && (
                <div className="text-[11px] text-slate-500">{t('settings.permissions.allEnabledSummary', 'All built-in capabilities in this catalog are already enabled.')}</div>
              )}
            </div>
          </div>

          <div className="settings-glass-soft p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200">{t('settings.permissions.blockedNow', 'Blocked Right Now')}</span>
              <span className="text-[10px] text-slate-400">{blockedNow.length + customDenied.length}</span>
            </div>
            <div className="space-y-1.5">
              {blockedNow.length === 0 && customDenied.length === 0 && (
                <div className="text-[11px] text-slate-500">{t('settings.permissions.noneBlockedSummary', 'No extra desktop deny rules are being enforced beyond the selected preset.')}</div>
              )}
              {blockedNow.map((command) => (
                <button
                  key={command.id}
                  onClick={() => onToggleDeniedCommand(command.id)}
                  className="w-full text-left rounded-lg settings-glass-soft px-3 py-2 hover:border-rose-500/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-100">{command.label}</span>
                      <span className="text-[10px] text-slate-400">{command.impact}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 mt-1">{command.desc}</div>
                </button>
              ))}
              {customDenied.map((command) => (
                <div key={command} className="flex items-center justify-between rounded-lg settings-glass-soft px-3 py-2">
                  <span className="text-[11px] font-mono text-slate-300">{command}</span>
                  <button onClick={() => onToggleDeniedCommand(command)} className="settings-btn settings-btn-danger text-[10px] px-2 py-1">{t('common.remove', 'Remove')}</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="settings-glass-soft p-4 space-y-4">
          <div className="space-y-3">
            <div>
              <div className="text-xs font-medium text-slate-200">{t('settings.permissions.hostExecPolicy', 'Host exec policy')}</div>
              <div className="text-[11px] text-slate-500 mt-1">{t('settings.permissions.hostExecPolicyDesc', 'These controls now write OpenClaw exec approval defaults plus the main agent allowlist.')}</div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <div className="text-[11px] text-slate-400 mb-1">{t('settings.permissions.security', 'Security')}</div>
                <div className="settings-pill-group w-full">
                  {([
                    { key: 'deny' as const, label: t('settings.permissions.mode.deny', 'Deny') },
                    { key: 'allowlist' as const, label: t('settings.permissions.mode.allowlist', 'Allowlist') },
                    { key: 'full' as const, label: t('settings.permissions.mode.full', 'Full') },
                  ]).map((mode) => (
                    <button
                      key={mode.key}
                      onClick={() => onSaveExecSecurity(mode.key)}
                      className={`settings-pill-button flex-1 text-[11px] ${permissions.execSecurity === mode.key ? 'is-active' : ''}`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-400 mb-1">{t('settings.permissions.ask', 'Ask')}</div>
                <div className="settings-pill-group w-full">
                  {([
                    { key: 'off' as const, label: t('settings.permissions.askMode.off', 'Off') },
                    { key: 'on-miss' as const, label: t('settings.permissions.askMode.onMiss', 'On miss') },
                    { key: 'always' as const, label: t('settings.permissions.askMode.always', 'Always') },
                  ]).map((mode) => (
                    <button
                      key={mode.key}
                      onClick={() => onSaveExecAsk(mode.key)}
                      className={`settings-pill-button flex-1 text-[11px] ${permissions.execAsk === mode.key ? 'is-active' : ''}`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-400 mb-1">{t('settings.permissions.askFallback', 'Ask fallback')}</div>
                <div className="settings-pill-group w-full">
                  {([
                    { key: 'deny' as const, label: t('settings.permissions.mode.deny', 'Deny') },
                    { key: 'allowlist' as const, label: t('settings.permissions.mode.allowlist', 'Allowlist') },
                    { key: 'full' as const, label: t('settings.permissions.mode.full', 'Full') },
                  ]).map((mode) => (
                    <button
                      key={mode.key}
                      onClick={() => onSaveExecAskFallback(mode.key)}
                      className={`settings-pill-button flex-1 text-[11px] ${permissions.execAskFallback === mode.key ? 'is-active' : ''}`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <label className="settings-glass-soft flex items-start gap-3 px-3 py-2">
            <input
              type="checkbox"
              checked={permissions.execAutoAllowSkills}
              onChange={(event) => onSaveExecAutoAllowSkills(event.target.checked)}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs font-medium text-slate-200">{t('settings.permissions.autoAllowSkillClis', 'Auto-allow skill CLIs')}</div>
              <div className="text-[11px] text-slate-500 mt-1">{t('settings.permissions.autoAllowSkillClisDesc', 'Mirror OpenClaw autoAllowSkills so known skill binaries are treated as implicitly trusted on the host.')}</div>
            </div>
          </label>

          <div className="settings-glass-soft p-3 space-y-2">
            <div>
              <div className="text-xs font-medium text-slate-200">{t('settings.permissions.mainAgentAllowlist', 'Main agent allowlist')}</div>
              <div className="text-[11px] text-slate-500 mt-1">{t('settings.permissions.mainAgentAllowlistDesc', 'These patterns are written to agents.main.allowlist in exec-approvals.json.')}</div>
            </div>
            {permissions.execAllowlist.length > 0 ? (
              <div className="space-y-1.5">
                {permissions.execAllowlist.map((entry) => (
                  <div key={entry.id || entry.pattern} className="flex items-center justify-between gap-3 rounded-lg settings-glass-soft px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-mono text-slate-200 truncate">{entry.pattern}</div>
                      <div className="text-[10px] text-slate-500 truncate">{entry.lastResolvedPath || entry.lastUsedCommand || entry.source || t('settings.permissions.manualPattern', 'Manual pattern')}</div>
                    </div>
                    <button onClick={() => onRemoveAllowlistPattern(entry.pattern)} className="settings-btn settings-btn-danger text-[10px] px-2 py-1">{t('common.remove', 'Remove')}</button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">{t('settings.permissions.noAllowlistEntries', 'No explicit allowlist entries for the main agent yet.')}</div>
            )}
            <div className="flex gap-1.5">
              <input
                value={newAllowlistPattern}
                onChange={(event) => onNewAllowlistPatternChange(event.target.value)}
                placeholder="/opt/homebrew/bin/rg or ~/Projects/**/bin/tool"
                className="settings-input flex-1 px-2 py-1 text-[11px] font-mono"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onAddAllowlistPattern();
                  }
                }}
              />
              <button
                data-testid="add-allowlist-pattern"
                onClick={onAddAllowlistPattern}
                className="settings-btn settings-btn-secondary px-2 py-1 text-[11px]"
              >
                <Plus size={11} />
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={onToggleAdvanced}
          className="settings-btn settings-btn-secondary w-full text-[11px] pt-1"
        >
          <Zap size={10} />
          {showAdvancedPerms
            ? t('settings.permissions.hideAdvanced', 'Hide advanced settings')
            : t('settings.permissions.showAdvanced', 'Advanced settings')}
        </button>

        {showAdvancedPerms && (
          <div className="space-y-4 pt-2 border-t border-slate-700/50">
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Check size={11} className="text-emerald-400" />
                <span className="text-xs font-medium text-slate-300">{t('settings.permissions.allowed', 'Extra allowed tools')}</span>
              </div>
              <div className="space-y-1.5 mb-2">
                {knownAllowedTools.map((tool) => {
                  const enabled = permissions.alsoAllow.includes(tool.id);
                  return (
                    <button
                      key={tool.id}
                      onClick={() => onToggleAllowedTool(tool.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-all ${
                        enabled
                          ? 'settings-glass-soft border-emerald-500/45 text-slate-200'
                          : 'settings-glass-soft text-slate-400 hover:border-slate-500/45'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border ${enabled ? 'bg-emerald-600 border-emerald-500' : 'border-slate-600'}`}>
                        {enabled && <Check size={10} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">{tool.label}</div>
                        <div className="text-[10px] text-slate-500 truncate">{tool.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                {customAllowed.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {customAllowed.map((tool) => (
                      <span key={tool} className="flex items-center gap-1 px-2 py-0.5 settings-glass-soft rounded text-[10px] text-slate-300 font-mono">
                        {tool}
                        <button onClick={() => onToggleAllowedTool(tool)} className="hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <input
                    value={newAllowTool}
                    onChange={(event) => onNewAllowToolChange(event.target.value)}
                    placeholder={t('perm.tool.custom', 'Custom tool name (advanced)...')}
                    className="settings-input flex-1 px-2 py-1 text-[11px] font-mono"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        onAddCustomAllowed();
                      }
                    }}
                  />
                  <button
                    data-testid="add-allow-tool"
                    onClick={onAddCustomAllowed}
                    className="settings-btn settings-btn-secondary px-2 py-1 text-[11px]"
                  >
                    <Plus size={11} />
                  </button>
                </div>
              </div>
            </div>

            <div className="border-t border-slate-700/50 pt-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Shield size={11} className="text-red-400" />
                <span className="text-xs font-medium text-slate-300">{t('settings.permissions.denied', 'Blocked commands')}</span>
              </div>
              <div className="space-y-1.5 mb-2">
                {knownDeniedCommands.map((command) => {
                  const blocked = permissions.denied.includes(command.id);
                  return (
                    <button
                      key={command.id}
                      onClick={() => onToggleDeniedCommand(command.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-all ${
                        blocked
                          ? 'settings-glass-soft border-red-500/45 text-slate-200'
                          : 'settings-glass-soft text-slate-400 hover:border-slate-500/45'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded flex-shrink-0 flex items-center justify-center border ${blocked ? 'bg-red-600 border-red-500' : 'border-slate-600'}`}>
                        {blocked && <X size={10} className="text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium">{command.label}</div>
                        <div className="text-[10px] text-slate-500 truncate">{command.desc}</div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                {customDenied.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {customDenied.map((command) => (
                      <span key={command} className="flex items-center gap-1 px-2 py-0.5 settings-glass-soft rounded text-[10px] text-slate-300 font-mono">
                        {command}
                        <button onClick={() => onToggleDeniedCommand(command)} className="hover:text-red-400 ml-0.5">×</button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-1.5">
                  <input
                    value={newDenyCmd}
                    onChange={(event) => onNewDenyCmdChange(event.target.value)}
                    placeholder={t('perm.deny.custom', 'Custom command name (advanced)...')}
                    className="settings-input flex-1 px-2 py-1 text-[11px] font-mono"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        onAddCustomDenied();
                      }
                    }}
                  />
                  <button
                    data-testid="add-deny-cmd"
                    onClick={onAddCustomDenied}
                    className="settings-btn settings-btn-secondary px-2 py-1 text-[11px]"
                  >
                    <Plus size={11} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}