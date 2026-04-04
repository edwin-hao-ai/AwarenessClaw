import { AlertTriangle, CheckCircle, ChevronRight, CircleX, Cloud, Code2, Download, ExternalLink, Loader2, Play, Puzzle, RefreshCw, RotateCw, Shield, SkipForward, Square, Stethoscope, Trash2, Upload, Webhook, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { SettingsModalShell, SettingsRow, SettingsSection, SettingsToggle } from './SettingsPrimitives';

type TFunction = (key: string, fallback?: string) => string;

export function SettingsHealthPanel({
  t,
  doctorLoading,
  doctorReport,
  fixingId,
  onRunDoctor,
  onFix,
}: {
  t: TFunction;
  doctorLoading: boolean;
  doctorReport: any;
  fixingId: string | null;
  onRunDoctor: () => void;
  onFix: (checkId: string) => void;
}) {
  return (
    <SettingsSection title={(
      <span className="inline-flex items-center gap-2">
        <Stethoscope size={15} className="text-rose-300" />
        {t('settings.health', 'System Health')}
      </span>
    )}>
      <div className="p-4 space-y-2">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs text-slate-500">{t('settings.health.desc', 'Automatic diagnostics for OpenClaw and AwarenessClaw')}</p>
          <button
            onClick={onRunDoctor}
            disabled={doctorLoading}
            className="settings-btn settings-btn-secondary disabled:opacity-50"
          >
            {doctorLoading ? <Loader2 size={10} className="animate-spin" /> : <RefreshCw size={10} />}
            {t('settings.health.recheck', 'Re-check')}
          </button>
        </div>
        {doctorLoading && !doctorReport && (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-4 justify-center">
            <Loader2 size={14} className="animate-spin" />
            {t('settings.health.checking', 'Running diagnostics...')}
          </div>
        )}
        {doctorReport && (
          <>
            {doctorReport.summary.fail === 0 && doctorReport.summary.warn === 0 && (
              <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                <CheckCircle size={14} className="shrink-0" />
                <p>{t('settings.health.allGood', 'All systems operational')}</p>
              </div>
            )}
            {doctorReport.checks.map((check: any) => (
              <div
                key={check.id}
                className={`flex items-center gap-3 p-2.5 rounded-xl text-xs ${
                  check.status === 'pass'
                    ? 'settings-glass-soft text-emerald-300'
                    : check.status === 'warn'
                      ? 'settings-glass-soft text-amber-300'
                      : check.status === 'fail'
                        ? 'settings-glass-soft text-red-400'
                        : 'settings-glass-soft text-slate-500'
                }`}
              >
                <span className="shrink-0">
                  {check.status === 'pass'
                    ? <CheckCircle size={14} />
                    : check.status === 'warn'
                      ? <AlertTriangle size={14} />
                      : check.status === 'fail'
                        ? <CircleX size={14} />
                        : <SkipForward size={14} />}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="font-medium">{check.label}</span>
                  <span className="ml-2 text-slate-400">{check.message}</span>
                  {check.fixable === 'manual' && check.fixDescription && (
                    <p className="text-[10px] text-slate-500 mt-0.5 font-mono break-all">{check.fixDescription}</p>
                  )}
                </div>
                {check.fixable === 'auto' && (
                  <button
                    onClick={() => onFix(check.id)}
                    disabled={fixingId === check.id}
                    className="settings-btn settings-btn-primary shrink-0 text-[10px] disabled:bg-slate-700"
                  >
                    {fixingId === check.id
                      ? <Loader2 size={10} className="animate-spin" />
                      : (check.id === 'channel-bindings' && String(check.detail || '').toLowerCase().includes('telegram'))
                        ? t('settings.health.fixTelegram', 'Fix Telegram')
                        : t('settings.health.fix', 'Fix')}
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </SettingsSection>
  );
}

export function SettingsSecurityAuditPanel({
  t,
  securityIssues,
}: {
  t: TFunction;
  securityIssues: Array<{ level: string; message: string; fix?: string }>;
}) {
  return (
    <SettingsSection title={(
      <span className="inline-flex items-center gap-2">
        <Shield size={15} className="text-amber-300" />
        {t('settings.security') || 'Security Audit'}
      </span>
    )}>
      <div className="p-4 space-y-2">
        {securityIssues.length === 0 ? (
          <div className="flex items-center gap-2 text-xs p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
            <CheckCircle size={14} className="shrink-0" />
            <p>{t('settings.security.allGood', 'No security issues found')}</p>
          </div>
        ) : (
          securityIssues.map((issue, index) => (
            <div
              key={`${issue.message}-${index}`}
              className={`flex items-start gap-2 text-xs p-2 rounded-lg ${
                issue.level === 'warning' ? 'settings-glass-soft text-amber-300' : 'settings-glass-soft text-slate-400'
              }`}
            >
              {issue.level === 'warning' ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <Shield size={14} className="mt-0.5 shrink-0" />}
              <div>
                <p>{issue.message}</p>
                {issue.fix && <code className="mt-1 block text-[10px] text-slate-500 settings-glass-soft px-2 py-1 rounded">{issue.fix}</code>}
              </div>
            </div>
          ))
        )}
      </div>
    </SettingsSection>
  );
}

export function SettingsExtensionsPanel({
  t,
  plugins,
  hooks,
  onTogglePlugin,
  onToggleHook,
}: {
  t: TFunction;
  plugins: Record<string, { enabled?: boolean }>;
  hooks: Record<string, { enabled?: boolean; entries?: Record<string, { enabled?: boolean }> }>;
  onTogglePlugin: (name: string, value: boolean) => void | Promise<void>;
  onToggleHook: (name: string, value: boolean) => void | Promise<void>;
}) {
  return (
    <>
      {Object.keys(plugins).length > 0 && (
        <SettingsSection title={(
          <span className="inline-flex items-center gap-2">
            <Puzzle size={15} className="text-violet-300" />
            {t('settings.plugins', 'Plugins')} ({Object.keys(plugins).length})
          </span>
        )}>
          {Object.entries(plugins).map(([name, cfg]) => {
            const enabled = cfg?.enabled !== false;
            return (
              <SettingsRow key={name} label={name}>
                <SettingsToggle checked={enabled} onChange={(value) => { void onTogglePlugin(name, value); }} />
              </SettingsRow>
            );
          })}
        </SettingsSection>
      )}

      {Object.keys(hooks).length > 0 && (
        <SettingsSection title={(
          <span className="inline-flex items-center gap-2">
            <Webhook size={15} className="text-cyan-300" />
            {t('settings.hooks', 'Hooks')} ({Object.keys(hooks).length})
          </span>
        )}>
          {Object.entries(hooks).map(([hookName, hookCfg]) => {
            const enabled = hookCfg?.enabled !== false;
            const subEntries = hookCfg?.entries ? Object.entries(hookCfg.entries) : [];
            return (
              <div key={hookName} className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
                    <Webhook size={12} /> {hookName}
                  </div>
                  <SettingsToggle checked={enabled} onChange={(value) => { void onToggleHook(hookName, value); }} />
                </div>
                {subEntries.length > 0 && (
                  <div className="ml-4 space-y-1 border-l border-slate-700/50 pl-3">
                    {subEntries.map(([subName, subCfg]) => (
                      <div key={subName} className="flex items-center justify-between gap-2 py-0.5">
                        <code className="text-[11px] font-mono text-slate-500 truncate flex-1">{subName}</code>
                        <span className={`text-[10px] ${(subCfg as any)?.enabled !== false ? 'text-emerald-500' : 'text-slate-600'}`}>
                          {(subCfg as any)?.enabled !== false ? t('common.on', 'on') : t('common.off', 'off')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </SettingsSection>
      )}
    </>
  );
}

export function SettingsGatewayPanel({
  t,
  gatewayStatus,
  gatewayLoading,
  onGatewayAction,
  onLoadLogs,
}: {
  t: TFunction;
  gatewayStatus: 'checking' | 'running' | 'stopped';
  gatewayLoading: boolean;
  onGatewayAction: (action: 'start' | 'stop' | 'restart') => void;
  onLoadLogs: () => void;
}) {
  return (
    <SettingsSection title={(
      <span className="inline-flex items-center gap-2">
        <Cloud size={15} className="text-sky-300" />
        {t('settings.gateway')}
      </span>
    )}>
      <SettingsRow
        label={t('settings.gateway.label', 'OpenClaw Gateway')}
        desc={t(`settings.gateway.status.${gatewayStatus}`)}
      >
        <div className="flex items-center gap-2">
          {gatewayLoading ? (
            <Loader2 size={14} className="animate-spin text-brand-400" />
          ) : (
            <>
              {gatewayStatus === 'stopped' && (
                <button
                  onClick={() => onGatewayAction('start')}
                  className="settings-btn settings-btn-primary"
                >
                  <Play size={10} /> {t('settings.gateway.start')}
                </button>
              )}
              {gatewayStatus === 'running' && (
                <>
                  <button
                    onClick={() => onGatewayAction('restart')}
                    className="settings-btn settings-btn-secondary"
                  >
                    <RotateCw size={10} /> {t('settings.gateway.restart')}
                  </button>
                  <button
                    onClick={() => onGatewayAction('stop')}
                    className="settings-btn settings-btn-danger"
                  >
                    <Square size={10} /> {t('settings.gateway.stop')}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </SettingsRow>
      <SettingsRow label={t('settings.gateway.logs')} desc={t('settings.gateway.logs.desc')}>
        <button
          onClick={onLoadLogs}
          className="settings-btn settings-btn-secondary"
        >
          {t('settings.gateway.viewLogs')} <ChevronRight size={12} />
        </button>
      </SettingsRow>
    </SettingsSection>
  );
}

export function SettingsSystemPanel({
  t,
  autoUpdate,
  autoStart,
  onAutoUpdateChange,
  onAutoStartChange,
  onRunDiagnostic,
  onExport,
  onImport,
  onResetSetup,
}: {
  t: TFunction;
  autoUpdate: boolean;
  autoStart: boolean;
  onAutoUpdateChange: (value: boolean) => void;
  onAutoStartChange: (value: boolean) => void;
  onRunDiagnostic: () => void;
  onExport: () => void;
  onImport: () => void;
  onResetSetup: () => void;
}) {
  return (
    <SettingsSection title={(
      <span className="inline-flex items-center gap-2">
        <Wrench size={15} className="text-slate-300" />
        {t('settings.system')}
      </span>
    )}>
      <SettingsRow label={t('settings.autoUpdate')} desc={t('settings.autoUpdate.desc')}>
        <SettingsToggle checked={autoUpdate} onChange={onAutoUpdateChange} />
      </SettingsRow>
      <SettingsRow label={t('settings.bootStart')} desc={t('settings.bootStart.desc')}>
        <SettingsToggle checked={autoStart} onChange={onAutoStartChange} />
      </SettingsRow>
      <SettingsRow label={t('settings.diagnostic')} desc={t('settings.diagnostic.desc')}>
        <button
          onClick={onRunDiagnostic}
          className="settings-btn settings-btn-secondary"
        >
          {t('settings.diagnostic.run')} <ChevronRight size={12} />
        </button>
      </SettingsRow>
      <SettingsRow label={t('settings.export')} desc={t('settings.export.desc')}>
        <button
          onClick={onExport}
          className="settings-btn settings-btn-secondary"
        >
          <Download size={12} /> {t('settings.export')}
        </button>
      </SettingsRow>
      <SettingsRow label={t('settings.import')} desc={t('settings.import.desc')}>
        <button
          onClick={onImport}
          className="settings-btn settings-btn-secondary"
        >
          <Upload size={12} /> {t('settings.import')}
        </button>
      </SettingsRow>
      <SettingsRow label={t('settings.reset')} desc={t('settings.reset.desc')}>
        <button
          onClick={onResetSetup}
          className="settings-btn settings-btn-danger"
        >
          {t('settings.reset.btn')}
        </button>
      </SettingsRow>
    </SettingsSection>
  );
}

export function SettingsLogsModal({
  t,
  show,
  logs,
  onClose,
}: {
  t: TFunction;
  show: boolean;
  logs: string;
  onClose: () => void;
}) {
  if (!show) return null;

  return (
    <SettingsModalShell
      title={(
        <span className="inline-flex items-center gap-2">
          <Code2 size={16} className="text-slate-300" />
          {t('settings.gateway.logs')}
        </span>
      )}
      onClose={onClose}
      maxWidthClass="max-w-3xl"
      maxHeightClass="max-h-[80vh]"
      paddingClass="p-0"
    >
      <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-slate-300 bg-slate-950/70 whitespace-pre-wrap">{logs}</pre>
    </SettingsModalShell>
  );
}