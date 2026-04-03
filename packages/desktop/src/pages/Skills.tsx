import { useState, useEffect, useCallback } from 'react';
import { Search, Download, Check, ExternalLink, Loader2, Trash2, RefreshCw, Package, AlertCircle, X, Save } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useExternalNavigator } from '../lib/useExternalNavigator';

interface InstalledSkill {
  slug: string;
  version: string;
  installedAt: number;
}

interface InstallSpec {
  id: string;
  kind: string;
  label: string;
  bins: string[];
  package?: string;
}

interface LocalSkillStatus {
  name: string;
  description: string;
  source: string;
  skillKey?: string;
  emoji?: string;
  homepage?: string;
  primaryEnv?: string;
  bundled?: boolean;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  missing?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
  install?: InstallSpec[];
}

interface RemoteSkill {
  slug: string;
  name?: string;
  displayName?: string;
  description?: string;
  summary?: string;
  owner?: string;
  version?: string;
  emoji?: string;
  downloads?: number;
  score?: number;
}

interface SkillDetail {
  slug: string;
  name?: string;
  displayName?: string;
  description?: string;
  summary?: string;
  owner?: string;
  version?: string;
  emoji?: string;
  readme?: string;
  skillMd?: string;
  source?: string;
  bundled?: boolean;
  eligible?: boolean;
  disabled?: boolean;
  blockedByAllowlist?: boolean;
  homepage?: string;
  primaryEnv?: string;
  missing?: LocalSkillStatus['missing'];
  install?: InstallSpec[];
}

const PAGE_SIZE = 20;
const LOCAL_STATUS_TABS = ['all', 'ready', 'needs-setup', 'disabled'] as const;

type LocalStatusFilter = (typeof LOCAL_STATUS_TABS)[number];
type TranslateFunc = (key: string, fallback?: string) => string;

function summarizeMissing(skill: LocalSkillStatus) {
  const missing = skill.missing || {};
  const parts = [
    ...(missing.bins || []).map(bin => `bin:${bin}`),
    ...(missing.env || []).map(env => `env:${env}`),
    ...(missing.config || []).map(config => `config:${config}`),
    ...(missing.os || []).map(os => `os:${os}`),
  ];
  return parts.slice(0, 3).join(' · ');
}

function getSkillStatusLabel(skill: Pick<LocalSkillStatus, 'eligible' | 'disabled' | 'blockedByAllowlist'>, t: TranslateFunc) {
  if (skill.disabled) return { label: t('skills.status.disabled', 'Disabled'), className: 'text-slate-400 bg-slate-700/60' };
  if (skill.blockedByAllowlist) return { label: t('skills.status.blocked', 'Blocked'), className: 'text-amber-300 bg-amber-500/10' };
  if (skill.eligible) return { label: t('skills.status.ready', 'Ready'), className: 'text-emerald-300 bg-emerald-500/10' };
  return { label: t('skills.status.needsSetup', 'Needs Setup'), className: 'text-amber-300 bg-amber-500/10' };
}

function buildLocalDetail(skill: LocalSkillStatus): SkillDetail {
  return {
    slug: skill.skillKey || skill.name,
    name: skill.name,
    displayName: skill.name,
    description: skill.description,
    emoji: skill.emoji,
    source: skill.source,
    bundled: skill.bundled,
    eligible: skill.eligible,
    disabled: skill.disabled,
    blockedByAllowlist: skill.blockedByAllowlist,
    homepage: skill.homepage,
    primaryEnv: skill.primaryEnv,
    missing: skill.missing,
    install: skill.install,
  };
}

function buildFallbackInstallSpecs(skill: SkillDetail): InstallSpec[] {
  const bins = skill.missing?.bins || [];
  return bins.map((bin, idx) => ({
    id: `${skill.slug}-bin-${idx}`,
    kind: 'auto',
    label: `Install ${bin}`,
    bins: [bin],
    package: bin,
  }));
}

function matchesLocalStatus(skill: LocalSkillStatus, filter: LocalStatusFilter) {
  if (filter === 'all') return true;
  if (filter === 'disabled') return skill.disabled;
  if (filter === 'ready') return skill.eligible && !skill.disabled;
  return !skill.eligible && !skill.disabled && !skill.blockedByAllowlist;
}

function getLocalGroupLabel(source: string, t: TranslateFunc) {
  if (source === 'openclaw-bundled') return t('skills.group.builtin', 'Built-in Skills');
  if (source.includes('workspace')) return t('skills.group.workspace', 'Workspace Skills');
  if (source.includes('managed')) return t('skills.group.managed', 'Managed Skills');
  return source;
}

export default function Skills() {
  const { t } = useI18n();
  const { openExternal, isOpening } = useExternalNavigator();
  const [installed, setInstalled] = useState<Record<string, InstalledSkill>>({});
  const [localSkills, setLocalSkills] = useState<LocalSkillStatus[]>([]);
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RemoteSkill[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'installed' | 'builtin'>('all');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [actionSlug, setActionSlug] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<string | null>(null);
  const [installResult, setInstallResult] = useState<{ success: boolean; message: string } | null>(null);
  const [detailSkill, setDetailSkill] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [skillConfig, setSkillConfig] = useState<Record<string, string>>({});
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [localStatusFilter, setLocalStatusFilter] = useState<LocalStatusFilter>('all');

  const api = window.electronAPI as any;

  const loadData = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    const [installedRes, exploreRes] = await Promise.all([
      api.skillListInstalled(),
      api.skillExplore(),
    ]);
    if (installedRes.success) {
      setInstalled(installedRes.skills || {});
      setLocalSkills(Array.isArray(installedRes.report?.skills) ? installedRes.report.skills : []);
    }
    if (exploreRes.success && Array.isArray(exploreRes.skills)) {
      setRemoteSkills(exploreRes.skills);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    const progressLabels: Record<string, string> = {
      downloading: t('skills.progress.downloading', 'Downloading from ClawHub...'),
      installing: t('skills.progress.installing', 'Installing...'),
      verifying: t('skills.progress.verifying', 'Verifying installation...'),
      error: t('skills.progress.error', 'Error'),
    };
    api?.onSkillInstallProgress?.((data: { stage: string; detail?: string }) => {
      const label = progressLabels[data.stage] || data.stage;
      setInstallProgress(data.detail ? `${label} ${data.detail}` : label);
      if (data.stage === 'verifying' || data.stage === 'error') {
        setTimeout(() => setInstallProgress(null), 2000);
      }
    });
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !api) return;
    setSearching(true);
    setSearchResults(null);
    setVisibleCount(PAGE_SIZE);
    const res = await api.skillSearch(searchQuery.trim());
    if (res.success) {
      setSearchResults(Array.isArray(res.results) ? res.results : []);
    }
    setSearching(false);
  };

  const handleInstall = async (slug: string) => {
    if (!api) return;
    setActionSlug(slug);
    setActionError(null);
    setInstallResult(null);
    setInstallProgress(t('skills.progress.downloading', 'Downloading from ClawHub...'));
    const res = await api.skillInstall(slug);
    setInstallProgress(null);
    if (res.success) {
      setInstallResult({ success: true, message: t('skills.installed', 'Installed') });
      const r = await api.skillListInstalled();
      if (r.success) {
        setInstalled(r.skills || {});
        setLocalSkills(Array.isArray(r.report?.skills) ? r.report.skills : []);
      }
    } else {
      setActionError(res.error || t('skills.installFailed', 'Install failed'));
      setInstallResult({ success: false, message: res.error || t('skills.installFailed', 'Install failed') });
    }
    setActionSlug(null);
  };

  const handleUninstall = async (slug: string) => {
    if (!api) return;
    setActionSlug(slug);
    setActionError(null);
    setInstallResult(null);
    const res = await api.skillUninstall(slug);
    if (res.success) {
      setInstallResult({ success: true, message: t('skills.uninstall', 'Uninstall') });
      const r = await api.skillListInstalled();
      if (r.success) {
        setInstalled(r.skills || {});
        setLocalSkills(Array.isArray(r.report?.skills) ? r.report.skills : []);
      }
    } else {
      setActionError(res.error || t('skills.uninstallFailed', 'Uninstall failed'));
      setInstallResult({ success: false, message: res.error || t('skills.uninstallFailed', 'Uninstall failed') });
    }
    setActionSlug(null);
  };

  const handleInstallDeps = async (skill: SkillDetail) => {
    if (!api) return;
    const specs = (skill.install && skill.install.length > 0) ? skill.install : buildFallbackInstallSpecs(skill);
    if (specs.length === 0) {
      setActionError(t('skills.installDepsNoop', 'No installable dependencies found.'));
      return;
    }

    setActionSlug(skill.slug);
    setActionError(null);
    setInstallResult(null);
    setInstallProgress(t('skills.progress.installingDeps', 'Installing dependencies...'));

    const res = await api.skillInstallDeps(specs);
    setInstallProgress(null);

    if (res?.success) {
      setInstallResult({ success: true, message: t('skills.installDepsSuccess', 'Dependencies installed') });
      const listRes = await api.skillListInstalled();
      if (listRes?.success) {
        setInstalled(listRes.skills || {});
        setLocalSkills(Array.isArray(listRes.report?.skills) ? listRes.report.skills : []);
      }
    } else {
      const msg = res?.error || t('skills.installDepsFailed', 'Dependency install failed');
      setActionError(msg);
      setInstallResult({ success: false, message: msg });
    }

    setActionSlug(null);
  };

  const openDetail = async (slug: string, localSkill?: LocalSkillStatus) => {
    if (!api) return;
    setDetailLoading(true);
    setInstallResult(null);
    setDetailSkill(localSkill ? buildLocalDetail(localSkill) : null);
    setConfigDirty(false);

    // Fetch ClawHub detail + config + local info (for install specs) in parallel
    const [detailRes, configRes, localInfoRes] = await Promise.all([
      api.skillDetail(slug),
      api.skillGetConfig?.(slug).catch(() => ({ success: false, config: {} })),
      localSkill?.bundled && !localSkill.eligible
        ? api.skillLocalInfo?.(localSkill.name).catch(() => ({ success: false }))
        : Promise.resolve(null),
    ]);
    if (detailRes.success && detailRes.skill) {
      setDetailSkill(prev => ({ ...prev, ...detailRes.skill }));
    } else {
      const basic = fullList.find(s => s.slug === slug);
      if (basic) {
        setDetailSkill(prev => ({
          ...prev,
          slug,
          name: basic.name,
          displayName: basic.displayName,
          description: basic.description,
          summary: basic.summary,
          owner: basic.owner,
          version: basic.version,
          emoji: basic.emoji,
        }));
      }
    }
    // Merge install specs from openclaw skills info --json
    if (localInfoRes?.success && localInfoRes.info?.install) {
      setDetailSkill(prev => prev ? {
        ...prev,
        install: localInfoRes.info.install,
        homepage: localInfoRes.info.homepage || prev.homepage,
      } : prev);
    }
    setSkillConfig(configRes?.config || {});
    setDetailLoading(false);
  };

  const saveSkillConfig = async () => {
    if (!api || !detailSkill) return;
    setConfigSaving(true);
    await api.skillSaveConfig(detailSkill.slug, skillConfig);
    setConfigDirty(false);
    setConfigSaving(false);
  };

  const localInstalledSkills = localSkills.filter(skill => !skill.bundled);
  const localBuiltinSkills = localSkills.filter(skill => Boolean(skill.bundled || skill.source.includes('bundled')));
  const localStatusCounts = {
    all: localSkills.length,
    ready: localSkills.filter(skill => skill.eligible && !skill.disabled).length,
    needsSetup: localSkills.filter(skill => !skill.eligible && !skill.disabled && !skill.blockedByAllowlist).length,
    disabled: localSkills.filter(skill => skill.disabled).length,
  };
  const filteredLocalSkills = localSkills.filter(skill => matchesLocalStatus(skill, localStatusFilter));
  const localSkillGroups = Object.entries(
    filteredLocalSkills.reduce<Record<string, LocalSkillStatus[]>>((acc, skill) => {
      const key = getLocalGroupLabel(skill.source, t);
      if (!acc[key]) acc[key] = [];
      acc[key].push(skill);
      return acc;
    }, {}),
  );

  // Full list (before pagination)
  const fullList: RemoteSkill[] = (() => {
    if (searchResults !== null) return searchResults;
    if (filter === 'installed') {
      return [];
    }
    return remoteSkills;
  })();

  // Paginated display list
  const displayList = fullList.slice(0, visibleCount);
  const hasMore = fullList.length > visibleCount;

  const installedSlugs = new Set(Object.keys(installed));

  const recommendedList = remoteSkills
    .filter(skill => !installedSlugs.has(skill.slug))
    .slice(0, 4);

  const showRecommended = filter === 'all' && !searchResults && recommendedList.length > 0;
  const showBuiltin = filter === 'builtin';
  const showInstalled = filter === 'installed' && searchResults === null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Package size={20} className="text-brand-400" /> {t('skills.title')}
            </h1>
            <p className="text-xs text-slate-500">
              {t('skills.localSummary', '{count} local skills').replace('{count}', String(localStatusCounts.all))}
              {remoteSkills.length > 0 && ` · ${t('skills.remoteSummary', '{count} popular ClawHub skills').replace('{count}', String(remoteSkills.length))}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {t('skills.refresh')}
            </button>
            <button
              onClick={() => { void openExternal('https://clawhub.ai', 'skills-clawhub'); }}
              disabled={isOpening('skills-clawhub')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 disabled:text-slate-600 bg-slate-800 rounded-lg transition-colors"
            >
              {isOpening('skills-clawhub') ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />} ClawHub
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); if (!e.target.value) { setSearchResults(null); setVisibleCount(PAGE_SIZE); } }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder={t('skills.search.placeholder')}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
          </div>
          {searching && <Loader2 size={16} className="animate-spin text-brand-400 self-center" />}
          <div className="flex bg-slate-800 rounded-xl overflow-hidden">
            <button
              onClick={() => { setFilter('all'); setSearchResults(null); setSearchQuery(''); setVisibleCount(PAGE_SIZE); }}
              className={`px-3 py-2 text-xs transition-colors ${filter === 'all' && !searchResults ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t('skills.explore')}
            </button>
            <button
              onClick={() => { setFilter('builtin'); setSearchResults(null); setSearchQuery(''); }}
              className={`px-3 py-2 text-xs transition-colors ${filter === 'builtin' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t('skills.showBuiltin')}
            </button>
            <button
              onClick={() => { setFilter('installed'); setSearchResults(null); setSearchQuery(''); setVisibleCount(PAGE_SIZE); }}
              className={`px-3 py-2 text-xs transition-colors ${filter === 'installed' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t('skills.installed')}
            </button>
          </div>
        </div>
      </div>

      {/* Error banner */}
      {actionError && (
        <div className="mx-6 mt-3 p-3 bg-red-600/10 border border-red-600/20 rounded-xl text-xs text-red-400 flex items-start gap-2">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1">{actionError}</div>
          <button onClick={() => setActionError(null)} className="text-red-500 hover:text-red-300">×</button>
        </div>
      )}

      {/* Install progress banner */}
      {installProgress && !actionError && (
        <div className="mx-6 mt-3 p-3 bg-brand-600/10 border border-brand-500/20 rounded-xl text-xs text-brand-300 flex items-center gap-2">
          <Loader2 size={14} className="animate-spin flex-shrink-0" />
          <span>{installProgress}</span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {filter === 'all' && searchResults === null && localSkills.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-1">{t('skills.localSectionTitle', 'OpenClaw Local Skills')}</h2>
            <p className="text-xs text-slate-500 mb-4">{t('skills.localSectionDesc', 'Official local skill status from openclaw skills list --json, aligned with the Control UI.')}</p>
            <div className="grid grid-cols-4 gap-3 mb-4">
              <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{t('skills.status.all', 'All')}</div>
                <div className="mt-1 text-xl font-semibold">{localStatusCounts.all}</div>
              </div>
              <div className="p-3 bg-slate-800/50 border border-emerald-500/20 rounded-xl">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{t('skills.status.ready', 'Ready')}</div>
                <div className="mt-1 text-xl font-semibold text-emerald-300">{localStatusCounts.ready}</div>
              </div>
              <div className="p-3 bg-slate-800/50 border border-amber-500/20 rounded-xl">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{t('skills.status.needsSetup', 'Needs Setup')}</div>
                <div className="mt-1 text-xl font-semibold text-amber-300">{localStatusCounts.needsSetup}</div>
              </div>
              <div className="p-3 bg-slate-800/50 border border-slate-700/50 rounded-xl">
                <div className="text-[11px] uppercase tracking-wide text-slate-500">{t('skills.status.disabled', 'Disabled')}</div>
                <div className="mt-1 text-xl font-semibold text-slate-300">{localStatusCounts.disabled}</div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap mb-4">
              {LOCAL_STATUS_TABS.map(tab => {
                const count = tab === 'all'
                  ? localStatusCounts.all
                  : tab === 'ready'
                    ? localStatusCounts.ready
                    : tab === 'needs-setup'
                      ? localStatusCounts.needsSetup
                      : localStatusCounts.disabled;
                return (
                  <button
                    key={tab}
                    onClick={() => setLocalStatusFilter(tab)}
                    className={`px-3 py-2 text-xs rounded-xl transition-colors ${localStatusFilter === tab ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                  >
                    {t(`skills.status.${tab === 'needs-setup' ? 'needsSetup' : tab}`, tab)} <span className="opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>
            {localSkillGroups.length === 0 ? (
              <div className="text-center py-10 text-slate-500 bg-slate-800/20 rounded-2xl border border-slate-800">
                <p className="text-sm">{t('skills.localEmpty', 'No local skills in this status.')}</p>
              </div>
            ) : (
              <div className="space-y-4">
                {localSkillGroups.map(([groupLabel, skills]) => (
                  <div key={groupLabel} className="rounded-2xl border border-slate-800 overflow-hidden bg-slate-900/40">
                    <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                      <h3 className="text-sm font-medium text-slate-200">{groupLabel}</h3>
                      <span className="text-[11px] text-slate-500">{skills.length}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3 p-4">
                      {skills.map(skill => {
                        const status = getSkillStatusLabel(skill, t);
                        return (
                          <div
                            key={skill.skillKey || skill.name}
                            onClick={() => openDetail(skill.skillKey || skill.name, skill)}
                            className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl hover:border-slate-600 transition-colors cursor-pointer"
                          >
                            <div className="flex items-start gap-3">
                              <div className="text-2xl leading-none">{skill.emoji || '🧩'}</div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <h4 className="text-sm font-medium text-slate-200 truncate">{skill.name}</h4>
                                  {skill.bundled && <span className="text-[10px] text-slate-500">{t('skills.builtInBadge', 'Built-in')}</span>}
                                </div>
                                <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{skill.description}</p>
                              </div>
                            </div>
                            <div className="mt-3 flex items-center justify-between gap-2">
                              <span className={`px-2 py-1 rounded-md text-[10px] ${status.className}`}>{status.label}</span>
                              <span className="text-[10px] text-slate-600 truncate">{summarizeMissing(skill) || skill.source}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Built-in section */}
        {showBuiltin && (
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-1">{t('skills.builtin')}</h2>
            <p className="text-xs text-slate-500 mb-4">{t('skills.builtinSectionDesc', 'Bundled OpenClaw skills from the official local status report.')}</p>
            <div className="grid grid-cols-2 gap-3">
              {localBuiltinSkills.map(skill => {
                const status = getSkillStatusLabel(skill, t);
                return (
                  <div
                    key={skill.skillKey || skill.name}
                    onClick={() => openDetail(skill.skillKey || skill.name, skill)}
                    className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl hover:border-slate-600 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{skill.emoji || '🧩'}</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-slate-200 truncate">{skill.name}</h4>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{skill.description}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className={`px-2 py-1 rounded-md text-[10px] ${status.className}`}>{status.label}</span>
                      <span className="text-[10px] text-slate-600 truncate">{summarizeMissing(skill) || skill.source}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Installed local skills section */}
        {showInstalled && (
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-1">{t('skills.installed')}</h2>
            <p className="text-xs text-slate-500 mb-4">{t('skills.installedSectionDesc', 'Workspace and managed skills visible to the current OpenClaw workspace.')}</p>
            {localInstalledSkills.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Package size={32} className="mx-auto mb-3 text-slate-600" />
                <p className="text-sm">{t('skills.noInstalled')}</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {localInstalledSkills.map(skill => {
                  const status = getSkillStatusLabel(skill, t);
                  return (
                    <div
                      key={skill.skillKey || skill.name}
                      onClick={() => openDetail(skill.skillKey || skill.name, skill)}
                      className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl hover:border-slate-600 transition-colors cursor-pointer"
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{skill.emoji || '🧩'}</span>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-medium text-sm truncate">{skill.name}</h4>
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{skill.description}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className={`px-2 py-1 rounded-md text-[10px] ${status.className}`}>{status.label}</span>
                        <span className="text-[10px] text-slate-600 truncate">{skill.source}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Popular Skills section (only on Explore tab, not during search) */}
        {showRecommended && (
          <div>
            <h2 className="text-sm font-semibold text-slate-300 mb-1">{t('skills.popular', 'Popular on ClawHub')}</h2>
            <p className="text-xs text-slate-500 mb-4">{t('skills.popular.desc', 'Official ClawHub list sorted by downloads with nonSuspiciousOnly=true.')}</p>
            <div className="grid grid-cols-2 gap-3">
              {recommendedList.map(skill => {
                const isInstalled = installedSlugs.has(skill.slug);
                const isActioning = actionSlug === skill.slug;
                return (
                  <div
                    key={skill.slug}
                    onClick={() => openDetail(skill.slug)}
                    className="p-4 bg-gradient-to-br from-brand-600/5 to-transparent border border-brand-500/20 rounded-xl hover:border-brand-500/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{skill.emoji || '⭐'}</span>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">{skill.displayName || skill.name || skill.slug}</h4>
                        <p className="text-xs text-brand-300/70 mt-0.5">{t('skills.popular.rankHint', 'Ranked from official ClawHub popularity data')}</p>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-1">{skill.summary || skill.description}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end">
                      {isInstalled ? (
                        <span className="flex items-center gap-1 text-xs text-emerald-400">
                          <Check size={12} /> {t('skills.installed')}
                        </span>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); handleInstall(skill.slug); }}
                          disabled={isActioning}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-lg transition-colors"
                        >
                          {isActioning ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                          {isActioning ? t('skills.installing') : t('skills.install')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Skills grid (explore / installed / search results) */}
        {!showBuiltin && !showInstalled && (
          <>
            {showRecommended && displayList.length > 0 && (
              <h2 className="text-sm font-semibold text-slate-300">{t('skills.explore')}</h2>
            )}
            {loading ? (
              <div className="flex items-center justify-center h-40 text-slate-500">
                <Loader2 size={20} className="animate-spin mr-2" /> {t('skills.loading')}
              </div>
            ) : displayList.length === 0 && !showRecommended ? (
              <div className="text-center py-12 text-slate-500">
                <Package size={32} className="mx-auto mb-3 text-slate-600" />
                <p className="text-sm">{searchResults !== null ? t('skills.noResults') : filter === 'installed' ? t('skills.noInstalled') : t('skills.noSkills')}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {displayList.map(skill => {
                    const isInstalled = installedSlugs.has(skill.slug);
                    const isActioning = actionSlug === skill.slug;
                    const installedInfo = installed[skill.slug];

                    return (
                      <div
                        key={skill.slug}
                        onClick={() => openDetail(skill.slug)}
                        className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl hover:border-slate-600 transition-colors cursor-pointer"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-2xl">{skill.emoji || '🧩'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-sm truncate">{skill.displayName || skill.name || skill.slug}</h4>
                              <span className="text-[10px] text-slate-600">
                                v{isInstalled ? installedInfo?.version : skill.version || '?'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">
                              {skill.summary || skill.description || skill.slug}
                            </p>
                            {skill.owner && (
                              <span className="text-[10px] text-slate-600 mt-1 inline-block">{skill.owner}</span>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 flex justify-end gap-2">
                          {isInstalled ? (
                            <>
                              <span className="flex items-center gap-1 text-xs text-emerald-400 mr-auto">
                                <Check size={12} /> {t('skills.installed')}
                              </span>
                              <button
                                onClick={e => { e.stopPropagation(); handleUninstall(skill.slug); }}
                                disabled={isActioning}
                                className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-600/10 rounded-lg transition-colors"
                              >
                                {isActioning ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                                {t('skills.uninstall')}
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); handleInstall(skill.slug); }}
                              disabled={isActioning}
                              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-lg transition-colors"
                            >
                              {isActioning ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                              {isActioning ? t('skills.installing') : t('skills.install')}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Load More button */}
                {hasMore && (
                  <div className="text-center pt-2">
                    <button
                      onClick={() => setVisibleCount(prev => prev + PAGE_SIZE)}
                      className="px-6 py-2 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors"
                    >
                      {t('skills.loadMore')} ({t('skills.loadMoreCount', '{count} more').replace('{count}', String(fullList.length - visibleCount))})
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Skill Detail Modal */}
      {(detailSkill || detailLoading) && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-8">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              {detailLoading ? (
                <div className="flex items-center gap-2 text-slate-400">
                  <Loader2 size={16} className="animate-spin" /> {t('common.loading', 'Loading...')}
                </div>
              ) : (
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-2xl">{detailSkill?.emoji || '🧩'}</span>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{detailSkill?.displayName || detailSkill?.name || detailSkill?.slug}</h2>
                    <p className="text-xs text-slate-500">
                      v{detailSkill?.version || '?'}
                      {detailSkill?.owner && ` · ${detailSkill.owner}`}
                    </p>
                  </div>
                </div>
              )}
              <button onClick={() => setDetailSkill(null)} className="text-slate-500 hover:text-slate-300 flex-shrink-0">
                <X size={20} />
              </button>
            </div>

            {/* Content */}
            {detailSkill && (
              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {(detailSkill.description || detailSkill.summary) && (
                  <p className="text-sm text-slate-300">{detailSkill.description || detailSkill.summary}</p>
                )}

                {(detailSkill.source || detailSkill.homepage || detailSkill.primaryEnv || detailSkill.missing) && (
                  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50 space-y-2">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('skills.openclawStatus', 'OpenClaw Status')}</h4>
                    {detailSkill.source && <p className="text-xs text-slate-400">{t('skills.sourceLabel', 'Source')}: {detailSkill.source}</p>}
                    {(typeof detailSkill.eligible === 'boolean' || typeof detailSkill.disabled === 'boolean') && (
                      <p className="text-xs text-slate-400">{t('skills.statusLabel', 'Status')}: {getSkillStatusLabel({ eligible: Boolean(detailSkill.eligible), disabled: Boolean(detailSkill.disabled), blockedByAllowlist: Boolean(detailSkill.blockedByAllowlist) }, t).label}</p>
                    )}
                    {detailSkill.primaryEnv && <p className="text-xs text-slate-400">{t('skills.primaryEnvLabel', 'Primary env')}: {detailSkill.primaryEnv}</p>}
                    {detailSkill.homepage && (
                      <button
                        onClick={() => { void openExternal(detailSkill.homepage || '', `skill-homepage-${detailSkill.slug}`); }}
                        disabled={isOpening(`skill-homepage-${detailSkill.slug}`)}
                        className="text-xs text-brand-300 hover:text-brand-200"
                      >
                        {t('skills.openHomepage', 'Open homepage')}
                      </button>
                    )}
                    {detailSkill.missing && summarizeMissing({
                      name: detailSkill.name || detailSkill.slug,
                      description: detailSkill.description || '',
                      source: detailSkill.source || '',
                      eligible: Boolean(detailSkill.eligible),
                      disabled: Boolean(detailSkill.disabled),
                      blockedByAllowlist: Boolean(detailSkill.blockedByAllowlist),
                      missing: detailSkill.missing,
                    }) && (
                      <p className="text-xs text-amber-300">{t('skills.missingLabel', 'Missing')}: {summarizeMissing({
                        name: detailSkill.name || detailSkill.slug,
                        description: detailSkill.description || '',
                        source: detailSkill.source || '',
                        eligible: Boolean(detailSkill.eligible),
                        disabled: Boolean(detailSkill.disabled),
                        blockedByAllowlist: Boolean(detailSkill.blockedByAllowlist),
                        missing: detailSkill.missing,
                      })}</p>
                    )}
                  </div>
                )}

                {(detailSkill.skillMd || detailSkill.readme) && (
                  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">{t('skills.documentation', 'Documentation')}</h4>
                    <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
                      {detailSkill.skillMd || detailSkill.readme}
                    </pre>
                  </div>
                )}

                {(installedSlugs.has(detailSkill.slug) || !!detailSkill.primaryEnv || (detailSkill.missing?.env?.length ?? 0) > 0 || (detailSkill.missing?.config?.length ?? 0) > 0) && (
                  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">{t('skills.configuration', 'Configuration')}</h4>
                    {Object.keys(skillConfig).length === 0 ? (
                      <p className="text-xs text-slate-600">{t('skills.noConfigOptions', 'No configuration options. Add key-value pairs below.')}</p>
                    ) : null}
                    <div className="space-y-2">
                      {Object.entries(skillConfig).map(([key, val]) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs font-mono text-slate-400 w-32 truncate flex-shrink-0">{key}</span>
                          <input
                            value={val}
                            onChange={e => { setSkillConfig(prev => ({ ...prev, [key]: e.target.value })); setConfigDirty(true); }}
                            className="flex-1 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs font-mono focus:outline-none focus:border-brand-500"
                          />
                          <button
                            onClick={() => { const next = { ...skillConfig }; delete next[key]; setSkillConfig(next); setConfigDirty(true); }}
                            className="text-slate-600 hover:text-red-400"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        placeholder={t('skills.configKeyPlaceholder', 'key')}
                        id="new-config-key"
                        className="flex-1 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs font-mono focus:outline-none focus:border-brand-500"
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            const input = e.target as HTMLInputElement;
                            const k = input.value.trim();
                            if (k && !(k in skillConfig)) { setSkillConfig(prev => ({ ...prev, [k]: '' })); setConfigDirty(true); input.value = ''; }
                          }
                        }}
                      />
                      <button
                        onClick={() => {
                          const input = document.getElementById('new-config-key') as HTMLInputElement;
                          const k = input?.value.trim();
                          if (k && !(k in skillConfig)) { setSkillConfig(prev => ({ ...prev, [k]: '' })); setConfigDirty(true); input.value = ''; }
                        }}
                        className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded text-slate-300"
                      >
                        {t('skills.addConfig', '+ Add')}
                      </button>
                    </div>
                    {configDirty && (
                      <button
                        onClick={saveSkillConfig}
                        disabled={configSaving}
                        className="mt-3 flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-lg transition-colors"
                      >
                        {configSaving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                        {t('skills.saveConfig', 'Save Config')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Footer actions */}
            {detailSkill && (
              <div className="flex justify-end gap-2 p-5 border-t border-slate-800">
                {detailSkill.eligible ? (
                  /* Skill is ready — show installed badge */
                  <span className="flex items-center gap-1 text-xs text-emerald-400 mr-auto">
                    <Check size={12} /> {t('skills.status.ready', 'Ready')}
                  </span>
                ) : detailSkill.bundled && !detailSkill.eligible ? (
                  /* Built-in skill needs setup — show install guidance */
                  <div className="flex items-center gap-2 w-full">
                    <div className="flex-1 space-y-1">
                      {(detailSkill.install && detailSkill.install.length > 0) ? (
                        detailSkill.install.map((spec: InstallSpec) => (
                          <div key={spec.id} className="flex items-center gap-2 text-xs text-slate-300">
                            <span className="px-1.5 py-0.5 bg-slate-700 rounded text-[10px] uppercase">{spec.kind}</span>
                            <span>{spec.label}</span>
                          </div>
                        ))
                      ) : (detailSkill.missing?.bins?.length ?? 0) > 0 ? (
                        <p className="text-xs text-slate-400">
                          {t('skills.missingBinsHint', 'Install the required tools: {bins}').replace('{bins}', (detailSkill.missing?.bins || []).join(', '))}
                        </p>
                      ) : (detailSkill.missing?.env?.length ?? 0) > 0 ? (
                        <p className="text-xs text-slate-400">
                          {t('skills.missingEnvHint', 'Set required environment variables: {env}').replace('{env}', (detailSkill.missing?.env || []).join(', '))}
                        </p>
                      ) : null}
                      {installResult && (
                        <p className={`text-xs ${installResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                          {installResult.message}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={async () => { await handleInstallDeps(detailSkill); }}
                      disabled={actionSlug === detailSkill.slug}
                      className="flex items-center gap-1 px-4 py-2 text-sm bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-xl transition-colors flex-shrink-0"
                    >
                      {actionSlug === detailSkill.slug ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                      {actionSlug === detailSkill.slug ? t('skills.installing', 'Installing...') : t('skills.installDeps', 'Auto Install')}
                    </button>
                    {detailSkill.homepage && (
                      <button
                        onClick={() => { void openExternal(detailSkill.homepage || '', `skill-install-${detailSkill.slug}`); }}
                        disabled={isOpening(`skill-install-${detailSkill.slug}`)}
                        className="flex items-center gap-1 px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-colors flex-shrink-0"
                      >
                        <ExternalLink size={14} />
                        {t('skills.openInstallGuide', 'Install Guide')}
                      </button>
                    )}
                  </div>
                ) : installedSlugs.has(detailSkill.slug) ? (
                  /* ClawHub installed skill — show uninstall */
                  <>
                    <span className="flex items-center gap-1 text-xs text-emerald-400 mr-auto">
                      <Check size={12} /> {t('skills.installed')}
                    </span>
                    <button
                      onClick={async () => { await handleUninstall(detailSkill.slug); }}
                      disabled={actionSlug === detailSkill.slug}
                      className="flex items-center gap-1 px-4 py-2 text-sm text-red-400 hover:bg-red-600/10 rounded-xl transition-colors"
                    >
                      {actionSlug === detailSkill.slug ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      {t('skills.uninstall')}
                    </button>
                  </>
                ) : (
                  /* ClawHub skill — install from registry */
                  <button
                    onClick={async () => { await handleInstall(detailSkill.slug); }}
                    disabled={actionSlug === detailSkill.slug}
                    className="flex items-center gap-1 px-5 py-2 text-sm bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-xl transition-colors"
                  >
                    {actionSlug === detailSkill.slug ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {actionSlug === detailSkill.slug ? (installProgress || t('skills.installing')) : t('skills.install')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
