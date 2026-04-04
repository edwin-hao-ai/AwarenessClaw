import { Cloud, ExternalLink, HardDrive, MessageSquare, Shield, SlidersHorizontal, Trash2, Wrench } from 'lucide-react';
import ChannelIcon from '../ChannelIcon';
import { SettingsToggle } from '../settings/SettingsPrimitives';

type TFunction = (key: string, fallback?: string) => string;

export function MemorySettingsPanel({
  t,
  config,
  cloudMode,
  onToggle,
  onRecallLimitChange,
  onSelectMode,
  onCloudConnect,
  onCloudDisconnect,
  onToggleSource,
  onClearAll,
}: {
  t: TFunction;
  config: Record<string, any>;
  cloudMode: string;
  onToggle: (key: 'autoCapture' | 'autoRecall', value: boolean) => void;
  onRecallLimitChange: (value: number) => void;
  onSelectMode: (mode: 'local' | 'cloud') => void;
  onCloudConnect: () => void;
  onCloudDisconnect: () => void;
  onToggleSource: (id: string, nextAllowed: boolean) => void;
  onClearAll: () => void;
}) {
  const sourceItems = [
    { id: 'desktop', label: t('settings.privacy.desktop', 'Desktop Chat'), icon: <MessageSquare size={14} className="text-slate-300" /> },
    { id: 'openclaw-telegram', label: 'Telegram', icon: <ChannelIcon channelId="telegram" size={16} /> },
    { id: 'openclaw-whatsapp', label: 'WhatsApp', icon: <ChannelIcon channelId="whatsapp" size={16} /> },
    { id: 'openclaw-discord', label: 'Discord', icon: <ChannelIcon channelId="discord" size={16} /> },
    { id: 'openclaw-slack', label: 'Slack', icon: <ChannelIcon channelId="slack" size={16} /> },
    { id: 'openclaw-wechat', label: 'WeChat', icon: <ChannelIcon channelId="wechat" size={16} /> },
    { id: 'mcp', label: t('settings.privacy.devTools', 'Dev Tools (Claude Code / IDE)'), icon: <Wrench size={14} className="text-slate-300" /> },
  ];
  const blockedSources = config.memoryBlockedSources || [];
  const allowedSourceCount = sourceItems.filter(({ id }) => !blockedSources.includes(id)).length;
  const memoryMode = config.memoryMode === 'cloud'
    ? t('settings.memory.cloud', 'Cloud')
    : t('settings.memory.local', 'Local');
  const cloudConnected = cloudMode === 'hybrid' || cloudMode === 'cloud';
  const summaryClass = 'rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4';
  const sectionClass = 'rounded-[24px] border border-slate-700/60 bg-slate-900/55 p-5';
  const rowClass = 'flex items-center justify-between gap-4 rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3.5';

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section className={sectionClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                <SlidersHorizontal size={16} className="text-brand-300" />
                {t('memory.settings.automationCard', 'Capture & Recall')}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {t('memory.settings.automationCard.desc', 'These controls change what gets remembered automatically and how much memory is pulled into each conversation.')}
              </p>
            </div>
            <span className="rounded-full bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-300">{memoryMode}</span>
          </div>

          <div className="mt-5 space-y-3">
            <div className={rowClass}>
              <div>
                <div className="text-sm font-medium text-slate-100">{t('settings.memory.autoCapture')}</div>
                <div className="mt-1 text-xs text-slate-500">{t('settings.memory.autoCapture.desc')}</div>
              </div>
              <SettingsToggle checked={config.autoCapture} onChange={(value) => onToggle('autoCapture', value)} />
            </div>

            <div className={rowClass}>
              <div>
                <div className="text-sm font-medium text-slate-100">{t('settings.memory.autoRecall')}</div>
                <div className="mt-1 text-xs text-slate-500">{t('settings.memory.autoRecall.desc')}</div>
              </div>
              <SettingsToggle checked={config.autoRecall} onChange={(value) => onToggle('autoRecall', value)} />
            </div>

            <div className={summaryClass}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-slate-100">{t('settings.memory.recallCount')}</div>
                  <div className="mt-1 text-xs text-slate-500">{t('settings.memory.recallCount.desc')}</div>
                </div>
                <span className="rounded-full bg-brand-600/15 px-3 py-1 text-xs font-medium text-brand-200">{config.recallLimit}</span>
              </div>
              <input
                type="range"
                min={1}
                max={20}
                value={config.recallLimit}
                onChange={(event) => onRecallLimitChange(parseInt(event.target.value, 10))}
                aria-label={t('settings.memory.recallCount')}
                title={t('settings.memory.recallCount')}
                className="mt-4 w-full accent-brand-500"
              />
            </div>
          </div>
        </section>

        <section className={sectionClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                {cloudConnected ? <Cloud size={16} className="text-sky-300" /> : <HardDrive size={16} className="text-slate-300" />}
                {t('memory.settings.storageCard', 'Storage & Sync')}
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                {t('memory.settings.storageCard.desc', 'Choose whether this desktop session stays local-first or reaches out to Awareness Cloud for shared memory.')}
              </p>
            </div>
            <span className={`rounded-full px-3 py-1 text-[11px] font-medium ${cloudConnected ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-800 text-slate-300'}`}>
              {cloudConnected ? t('memory.settings.cloudConnected', 'Connected') : t('memory.settings.cloudDisconnected', 'Local only')}
            </span>
          </div>

          <div className={`mt-5 ${summaryClass}`}>
            <div className="text-sm font-medium text-slate-100">{t('settings.memory.storage')}</div>
            <div className="mt-1 text-xs text-slate-500">{t('settings.memory.storage.desc')}</div>
            <div className="mt-4 inline-flex rounded-2xl border border-slate-700 bg-slate-900/80 p-1">
              {(['local', 'cloud'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => onSelectMode(mode)}
                  className={`rounded-xl px-4 py-2 text-xs font-medium transition-colors ${config.memoryMode === mode ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  {t(`settings.memory.${mode}`)}
                </button>
              ))}
            </div>
          </div>

          <div className={`mt-3 ${summaryClass}`}>
            <div className="text-sm font-medium text-slate-100">{t('memory.settings.cloudStatus', 'Cloud Sync')}</div>
            <div className="mt-1 text-xs text-slate-500">{t('memory.settings.cloudStatus.desc', 'Connect Awareness Cloud without leaving the Memory page.')}</div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {cloudConnected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
                    <Cloud size={12} /> {t('settings.memory.cloud.connected')}
                  </span>
                  <button
                    onClick={onCloudDisconnect}
                    className="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/20 dark:bg-transparent dark:text-red-300 dark:hover:bg-red-600/10"
                  >
                    {t('settings.memory.cloud.disconnect')}
                  </button>
                </>
              ) : (
                <button
                  onClick={onCloudConnect}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-500"
                >
                  <ExternalLink size={12} /> {t('settings.memory.cloud.connect')}
                </button>
              )}
            </div>
          </div>
        </section>
      </div>

      <section className={sectionClass}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
              <Shield size={16} className="text-sky-300" />
              {t('memory.settings.privacyCard', 'Privacy by source')}
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {t('memory.settings.privacyCard.desc', 'Decide which hosts are allowed to write into durable memory. This keeps product memory separate from noise.')}
            </p>
          </div>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-[11px] font-medium text-slate-300">
            {allowedSourceCount}/{sourceItems.length} {t('memory.settings.sourceAllowance', 'sources allowed')}
          </span>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sourceItems.map(({ id, label, icon }) => {
            const isAllowed = !blockedSources.includes(id);
            return (
              <div key={id} className="flex items-center justify-between rounded-2xl border border-slate-700/70 bg-slate-950/70 p-4">
                <div className="min-w-0 pr-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-100">
                    <span className="inline-flex h-5 w-5 items-center justify-center">{icon}</span>
                    <span className="truncate">{label}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {isAllowed ? t('memory.settings.sourceAllowed', 'Allowed to write memory') : t('memory.settings.sourceBlocked', 'Blocked from writing memory')}
                  </div>
                </div>
                <SettingsToggle checked={isAllowed} onChange={(value) => onToggleSource(id, value)} />
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-[24px] border border-red-300/70 bg-red-50 p-5 dark:border-red-500/20 dark:bg-red-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-red-700 dark:text-red-200">{t('memory.settings.dangerZone', 'Danger zone')}</div>
            <p className="mt-2 text-sm leading-6 text-red-600 dark:text-red-100/70">
              {t('memory.settings.dangerZone.desc', 'Delete local knowledge cards only when you want to reset this machine’s durable memory state.')}
            </p>
          </div>
          <button
            onClick={onClearAll}
            className="inline-flex items-center gap-1.5 rounded-xl border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/30 dark:bg-transparent dark:text-red-200 dark:hover:bg-red-600/10"
          >
            <Trash2 size={12} />
            {t('settings.privacy.clearAll', 'Delete All Knowledge Cards')}
          </button>
        </div>
      </section>
    </div>
  );
}