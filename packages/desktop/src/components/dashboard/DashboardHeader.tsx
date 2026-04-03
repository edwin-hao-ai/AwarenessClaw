import { ChevronDown, ExternalLink, FolderOpen, Loader2 } from 'lucide-react';
import { getProviderProfile, hasProviderCredentials } from '../../lib/store';

type Provider = {
  key: string;
  name: string;
  emoji: string;
  needsKey?: boolean;
  models: Array<{ id: string; label: string }>;
};

type AppConfig = {
  providerKey: string;
  modelId: string;
};

export function DashboardHeader({
  t,
  logoUrl,
  showSidebar,
  projectRoot,
  projectRootName,
  config,
  allProviders,
  showModelSelector,
  onToggleSidebar,
  onSelectProjectRoot,
  onToggleModelSelector,
  onCloseModelSelector,
  onNavigateModels,
  onSelectModel,
  onSyncConfig,
  onOpenDashboard,
  dashboardOpening,
}: {
  t: (key: string, fallback?: string) => string;
  logoUrl: string;
  showSidebar: boolean;
  projectRoot: string;
  projectRootName: string;
  config: AppConfig & Record<string, any>;
  allProviders: Provider[];
  showModelSelector: boolean;
  onToggleSidebar: () => void;
  onSelectProjectRoot: () => void;
  onToggleModelSelector: () => void;
  onCloseModelSelector: () => void;
  onNavigateModels: () => void;
  onSelectModel: (providerKey: string, modelId: string) => void;
  onSyncConfig: () => void;
  onOpenDashboard: () => void;
  dashboardOpening: boolean;
}) {
  const currentProvider = allProviders.find((provider) => provider.key === config.providerKey);

  return (
    <div className="px-3 py-1.5 border-b border-slate-800/80 flex items-center gap-1.5 flex-shrink-0 h-10">
      <button
        onClick={onToggleSidebar}
        className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
        title={t('chat.sessionList', 'Session list')}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor"/><rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="currentColor"/><rect x="2" y="11.5" width="12" height="1.5" rx="0.75" fill="currentColor"/></svg>
      </button>

      <img src={logoUrl} alt="AwarenessClaw" className="w-5 h-5 rounded" />

      <button
        onClick={onSelectProjectRoot}
        aria-label={projectRoot ? t('chat.workspace.change', 'Change folder') : t('chat.workspace.select', 'Choose folder')}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-800 max-w-[200px]"
        title={projectRoot || t('chat.workspace.select', 'Choose folder')}
      >
        <FolderOpen size={11} className="shrink-0 text-sky-400/70" />
        <span className="truncate text-xs text-slate-400">{projectRootName || t('chat.workspace.none', 'No folder')}</span>
      </button>

      <div className="flex-1" />

      <div className="relative">
        <button
          onClick={onToggleModelSelector}
          className="flex items-center gap-1 px-2 py-0.5 text-[11px] hover:bg-slate-800 rounded-md text-slate-500 transition-colors"
        >
          {currentProvider?.emoji} {config.modelId?.split('/').pop() || t('chat.selectModel', 'Select model')}
          <ChevronDown size={9} />
        </button>
        {showModelSelector && (
          <>
            <div className="fixed inset-0 z-40" onClick={onCloseModelSelector} />
            <div className="absolute top-full left-0 mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-[400px] overflow-y-auto">
              {allProviders.map((provider) => {
                const isConfigured = hasProviderCredentials(config as any, provider.key, provider.needsKey ?? false);
                getProviderProfile(config as any, provider.key);

                return (
                  <div key={provider.key}>
                    <div className="px-3 py-1.5 text-[10px] font-medium border-b border-slate-800 sticky top-0 bg-slate-900 flex items-center justify-between">
                      <span className="text-slate-500">{provider.emoji} {provider.name}</span>
                      {isConfigured ? <span className="text-emerald-500">✅</span> : provider.needsKey ? <span className="text-amber-500">🔑</span> : <span className="text-slate-600">{t('chat.free', 'Free')}</span>}
                    </div>
                    {provider.models.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          if (provider.needsKey && !isConfigured) {
                            onCloseModelSelector();
                            onNavigateModels();
                            return;
                          }
                          onSelectModel(provider.key, model.id);
                          onSyncConfig();
                          onCloseModelSelector();
                        }}
                        className={`w-full text-left px-4 py-1.5 text-xs transition-colors ${
                          provider.needsKey && !isConfigured ? 'text-slate-500 hover:bg-slate-850' : 'hover:bg-slate-800'
                        } ${
                          config.providerKey === provider.key && config.modelId === model.id ? 'text-brand-400' : 'text-slate-300'
                        }`}
                        title={provider.needsKey && !isConfigured ? t('chat.configureInModels', 'Configure this provider in Models first') : undefined}
                      >
                        {model.label}
                        {config.providerKey === provider.key && config.modelId === model.id && (
                          <span className="ml-1 text-brand-400 font-medium">✓ {t('chat.active', 'Active')}</span>
                        )}
                        {provider.needsKey && !isConfigured && (
                          <span className="ml-1 text-[10px] text-amber-500">{t('chat.setupInModels', 'Set up in Models')}</span>
                        )}
                      </button>
                    ))}
                    {provider.needsKey && !isConfigured && (
                      <button
                        onClick={() => {
                          onCloseModelSelector();
                          onNavigateModels();
                        }}
                        className="w-full text-left px-4 py-2 text-[11px] text-sky-400 hover:bg-slate-800 transition-colors border-t border-slate-800"
                      >
                        {t('chat.openModelsToConfigure', 'Open Models to configure API Key / Base URL')}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex-1" />

      <button
        onClick={onOpenDashboard}
        disabled={dashboardOpening}
        className="p-1 text-slate-600 hover:text-slate-300 disabled:text-slate-700 rounded-md transition-colors"
        title={t('chat.openclawDashboard', 'OpenClaw Dashboard')}
      >
        {dashboardOpening ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
      </button>
    </div>
  );
}