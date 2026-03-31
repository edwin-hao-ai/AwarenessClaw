import { useState, useEffect, useCallback } from 'react';
import { Search, Download, Check, ExternalLink, Loader2, Trash2, RefreshCw, Package, AlertCircle, X, Save } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface InstalledSkill {
  slug: string;
  version: string;
  installedAt: number;
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
}

export default function Skills() {
  const { t } = useI18n();
  const [installed, setInstalled] = useState<Record<string, InstalledSkill>>({});
  const [remoteSkills, setRemoteSkills] = useState<RemoteSkill[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RemoteSkill[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'installed'>('all');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [actionSlug, setActionSlug] = useState<string | null>(null); // slug being installed/uninstalled
  const [actionError, setActionError] = useState<string | null>(null);
  const [detailSkill, setDetailSkill] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [skillConfig, setSkillConfig] = useState<Record<string, string>>({});
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const api = window.electronAPI as any;

  const loadData = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    const [installedRes, exploreRes] = await Promise.all([
      api.skillListInstalled(),
      api.skillExplore(),
    ]);
    if (installedRes.success) {
      setInstalled(installedRes.skills);
    }
    if (exploreRes.success && Array.isArray(exploreRes.skills)) {
      setRemoteSkills(exploreRes.skills);
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSearch = async () => {
    if (!searchQuery.trim() || !api) return;
    setSearching(true);
    setSearchResults(null);
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
    const res = await api.skillInstall(slug);
    if (res.success) {
      // Refresh installed list
      const r = await api.skillListInstalled();
      if (r.success) setInstalled(r.skills);
    } else {
      setActionError(res.error || 'Install failed');
    }
    setActionSlug(null);
  };

  const handleUninstall = async (slug: string) => {
    if (!api) return;
    setActionSlug(slug);
    setActionError(null);
    const res = await api.skillUninstall(slug);
    if (res.success) {
      const r = await api.skillListInstalled();
      if (r.success) setInstalled(r.skills);
    } else {
      setActionError(res.error || 'Uninstall failed');
    }
    setActionSlug(null);
  };

  const openDetail = async (slug: string) => {
    if (!api) return;
    setDetailLoading(true);
    setDetailSkill(null);
    setConfigDirty(false);
    const [detailRes, configRes] = await Promise.all([
      api.skillDetail(slug),
      api.skillGetConfig?.(slug).catch(() => ({ success: false, config: {} })),
    ]);
    if (detailRes.success && detailRes.skill) {
      setDetailSkill(detailRes.skill);
    } else {
      // Fallback: use basic info from the list
      const basic = displayList.find(s => s.slug === slug);
      if (basic) setDetailSkill({ slug, name: basic.name, displayName: basic.displayName, description: basic.description, summary: basic.summary, owner: basic.owner, version: basic.version, emoji: basic.emoji });
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

  // Determine which list to show
  const displayList: RemoteSkill[] = (() => {
    if (searchResults !== null) return searchResults;
    if (filter === 'installed') {
      return Object.entries(installed).map(([slug, info]) => ({
        slug,
        version: info.version,
        name: slug,
      }));
    }
    return remoteSkills;
  })();

  const installedSlugs = new Set(Object.keys(installed));

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
              {Object.keys(installed).length} {t('skills.installedCount')}
              {remoteSkills.length > 0 && ` · ${remoteSkills.length} ${t('skills.availableCount')}`}
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
              onClick={() => api?.openExternal('https://clawhub.ai')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
            >
              <ExternalLink size={12} /> ClawHub
            </button>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder={t('skills.search.placeholder')}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
          </div>
          {searching && <Loader2 size={16} className="animate-spin text-brand-400 self-center" />}
          <div className="flex bg-slate-800 rounded-xl overflow-hidden">
            <button
              onClick={() => { setFilter('all'); setSearchResults(null); setSearchQuery(''); }}
              className={`px-4 py-2 text-xs transition-colors ${filter === 'all' && !searchResults ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {t('skills.explore')}
            </button>
            <button
              onClick={() => { setFilter('installed'); setSearchResults(null); setSearchQuery(''); }}
              className={`px-4 py-2 text-xs transition-colors ${filter === 'installed' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
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

      {/* Skills grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-slate-500">
            <Loader2 size={20} className="animate-spin mr-2" /> {t('skills.loading')}
          </div>
        ) : displayList.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Package size={32} className="mx-auto mb-3 text-slate-600" />
            <p className="text-sm">{searchResults !== null ? t('skills.noResults') : filter === 'installed' ? t('skills.noInstalled') : t('skills.noSkills')}</p>
          </div>
        ) : (
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
                          onClick={() => handleUninstall(skill.slug)}
                          disabled={isActioning}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-600/10 rounded-lg transition-colors"
                        >
                          {isActioning ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                          {t('skills.uninstall')}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleInstall(skill.slug)}
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
                {/* Description */}
                {(detailSkill.description || detailSkill.summary) && (
                  <p className="text-sm text-slate-300">{detailSkill.description || detailSkill.summary}</p>
                )}

                {/* SKILL.md / README content */}
                {(detailSkill.skillMd || detailSkill.readme) && (
                  <div className="bg-slate-800/50 rounded-xl p-4 border border-slate-700/50">
                    <h4 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">{t('skills.documentation', 'Documentation')}</h4>
                    <pre className="text-xs text-slate-300 whitespace-pre-wrap font-mono max-h-60 overflow-y-auto">
                      {detailSkill.skillMd || detailSkill.readme}
                    </pre>
                  </div>
                )}

                {/* Configuration */}
                {installedSlugs.has(detailSkill.slug) && (
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
                    {/* Add new config key */}
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
                {installedSlugs.has(detailSkill.slug) ? (
                  <>
                    <span className="flex items-center gap-1 text-xs text-emerald-400 mr-auto">
                      <Check size={12} /> Installed
                    </span>
                    <button
                      onClick={async () => { await handleUninstall(detailSkill.slug); setDetailSkill(null); }}
                      disabled={actionSlug === detailSkill.slug}
                      className="flex items-center gap-1 px-4 py-2 text-sm text-red-400 hover:bg-red-600/10 rounded-xl transition-colors"
                    >
                      {actionSlug === detailSkill.slug ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                      Uninstall
                    </button>
                  </>
                ) : (
                  <button
                    onClick={async () => { await handleInstall(detailSkill.slug); setDetailSkill(null); }}
                    disabled={actionSlug === detailSkill.slug}
                    className="flex items-center gap-1 px-5 py-2 text-sm bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-xl transition-colors"
                  >
                    {actionSlug === detailSkill.slug ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {actionSlug === detailSkill.slug ? 'Installing...' : 'Install'}
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
