import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronLeft, Check, ExternalLink, X, Loader2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import PasswordInput from '../components/PasswordInput';
import ChannelIcon from '../components/ChannelIcon';
import {
  getAllChannels, getChannel, isOneClick as isOneClickChannel,
  type ChannelDef, type ConfigField, loadFromSerialized,
} from '../lib/channel-registry';

type WizardStep = 'intro' | 'token' | 'test';

// ---------------------------------------------------------------------------
// DynamicConfigForm — renders config fields from registry definition
// ---------------------------------------------------------------------------

function DynamicConfigForm({ fields, values, onChange, t }: {
  fields: ConfigField[];
  values: Record<string, string>;
  onChange: (key: string, val: string) => void;
  t: (key: string, fallback?: string) => string;
}) {
  const inputClass = 'w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500';
  return (
    <div className="space-y-4">
      {fields.map(field => (
        <div key={field.key}>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            {t(field.label, field.label)}
          </label>
          {field.type === 'file' ? (
            <div className="flex gap-2">
              <input value={values[field.key] || ''} readOnly
                placeholder={t('channels.gchat.noFile', 'No file selected')}
                className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-400" />
              <button onClick={async () => {
                if (window.electronAPI) {
                  const result = await (window.electronAPI as any).selectFile?.({ filters: [{ name: 'JSON', extensions: ['json'] }] });
                  if (result?.filePath) onChange(field.key, result.filePath);
                }
              }} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-slate-100 whitespace-nowrap">
                {t('channels.gchat.browse', 'Browse...')}
              </button>
            </div>
          ) : field.type === 'password' ? (
            <PasswordInput value={values[field.key] || ''} onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder || ''} className={inputClass} />
          ) : (
            <input value={values[field.key] || ''} onChange={(e) => onChange(field.key, e.target.value)}
              placeholder={field.placeholder || ''} className={inputClass} />
          )}
          {field.hint && (
            <p className="mt-1.5 text-xs text-slate-500">{t(field.hint, field.hint)}</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Channels page
// ---------------------------------------------------------------------------

export default function Channels() {
  const { t } = useI18n();

  const translateStatus = (statusKey: string): string => {
    const [key, param] = statusKey.split('::');
    const translated = t(key, '');
    if (!translated) return statusKey;
    return param ? translated.replace('{0}', param) : translated;
  };

  const [activeWizard, setActiveWizard] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<WizardStep>('intro');
  // Single state for all config fields (replaces 9 separate useState)
  const [formValues, setFormValues] = useState<Record<string, string>>({});

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [testNotice, setTestNotice] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [asciiQR, setAsciiQR] = useState<string | null>(null);
  const [channelProgress, setChannelProgress] = useState<string | null>(null);
  const [configuredChannels, setConfiguredChannels] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<ChannelDef[]>(getAllChannels());
  const [loadingChannels, setLoadingChannels] = useState(true);
  const hasLoadedOnce = useRef(false);

  // Get the active channel definition from registry
  const activeChannel = activeWizard ? getChannel(activeWizard) : undefined;
  const isOneClick = activeChannel?.connectionType === 'one-click';

  const loadConfiguredChannels = async (showLoading = true) => {
    if (!window.electronAPI) { setLoadingChannels(false); return; }
    if (showLoading) setLoadingChannels(true);
    try {
      const result = await (window.electronAPI as any).channelListConfigured();
      const configured = new Set<string>(result.configured || []);
      configured.add('local');
      setConfiguredChannels(configured);
    } catch {
      setConfiguredChannels(new Set(['local']));
    }
    // Load dynamic channel registry from backend (OpenClaw catalog discovery)
    try {
      const api = window.electronAPI as any;
      console.log('[Channels] channelGetRegistry exists:', typeof api?.channelGetRegistry);
      const regResult = await api?.channelGetRegistry?.();
      console.log('[Channels] registry result:', regResult?.channels?.length, 'channels');
      if (regResult?.channels?.length > 0) {
        loadFromSerialized(regResult.channels);
        setChannels(getAllChannels());
        console.log('[Channels] loaded', getAllChannels().length, 'total channels');
      }
    } catch (e) { console.error('[Channels] registry error:', e); }
    setLoadingChannels(false);
    hasLoadedOnce.current = true;
  };

  useEffect(() => { loadConfiguredChannels(); }, []);

  // Listen for ASCII QR and progress status from backend
  useEffect(() => {
    if (!window.electronAPI) return;
    (window.electronAPI as any).onChannelQR?.((art: string) => {
      setAsciiQR(art);
      setChannelProgress(null);
    });
    (window.electronAPI as any).onChannelStatus?.((statusKey: string) => {
      setChannelProgress(statusKey);
    });
  }, []);

  const openWizard = async (channelId: string) => {
    setActiveWizard(channelId);
    setWizardStep('intro');
    setFormValues({});
    setAsciiQR(null); setChannelProgress(null);
    setTestStatus('idle'); setTestError(null); setTestNotice(null); setLastError(null);

    // Pre-fill from existing config
    if (window.electronAPI && configuredChannels.has(channelId)) {
      try {
        const res = await (window.electronAPI as any).channelReadConfig(channelId);
        if (res?.success && res.config) {
          const ch = getChannel(channelId);
          if (ch) {
            const prefilled: Record<string, string> = {};
            for (const field of ch.configFields) {
              // Try exact key, then snake_case variant
              const val = res.config[field.key]
                || res.config[field.key.replace(/[A-Z]/g, (c: string) => '_' + c.toLowerCase())];
              if (val) prefilled[field.key] = val;
            }
            // Also try generic 'token' field
            if (Object.keys(prefilled).length === 0 && res.config.token) {
              prefilled.token = res.config.token;
            }
            setFormValues(prefilled);
          }
        }
      } catch { /* start fresh */ }
    }
  };

  const closeWizard = () => { setActiveWizard(null); loadConfiguredChannels(false); };

  // Build config from form values — driven by channel definition
  const buildConfig = (): Record<string, string> | null => {
    if (!activeChannel) return null;
    const config: Record<string, string> = {};
    for (const field of activeChannel.configFields) {
      const val = formValues[field.key]?.trim();
      if (field.required && !val) return null;
      if (val) config[field.key] = val;
    }
    return Object.keys(config).length > 0 ? config : null;
  };

  const isFormValid = (): boolean => {
    if (!activeChannel) return false;
    if (isOneClick) return true;
    return buildConfig() !== null;
  };

  const handleConnect = async () => {
    if (!activeWizard || !activeChannel) return;
    setTestStatus('testing'); setTestError(null); setTestNotice(null);

    if (!window.electronAPI) {
      setTimeout(() => setTestStatus(isFormValid() ? 'success' : 'error'), 1500);
      return;
    }

    if (isOneClick) {
      const result = await (window.electronAPI as any).channelSetup(activeWizard);
      setTestStatus(result.success ? 'success' : 'error');
      if (result.success && result.pendingConfirmation) {
        setTestNotice(t('channels.pendingConfirmation', 'Login completed. OpenClaw is still confirming the channel. This can take a few seconds.'));
      }
      if (!result.success) {
        setTestError(result.error || t('channels.setupFailed', 'Setup failed. Check Gateway in Settings.'));
      }
    } else {
      const config = buildConfig()!;
      const saveResult = await (window.electronAPI as any).channelSave(activeWizard, config);
      if (!saveResult.success) { setTestStatus('error'); setTestError(saveResult.error || t('channels.saveFailed', 'Could not save. Please try again.')); return; }

      const testResult = await (window.electronAPI as any).channelTest(activeWizard);
      setTestStatus(testResult.success ? 'success' : 'error');
      if (!testResult.success) setTestError(testResult.error || testResult.output || null);
    }
  };

  // --- Guide content —  rich guides for known channels, generic for dynamic ---

  const oneClickGuide = (steps: (string | React.ReactNode)[]) => (
    <div className="space-y-2 text-sm">
      {steps.map((step, i) => (
        <div key={i} className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
          <span className="text-brand-400 font-bold">{i + 1}</span>
          <p>{step}</p>
        </div>
      ))}
    </div>
  );

  const getGuide = () => {
    if (!activeWizard || !activeChannel) return null;

    // Rich guides for known channels (preserved from original)
    switch (activeWizard) {
      case 'whatsapp':
        return oneClickGuide([
          t('channels.guide.oneclick.gateway', 'Make sure Gateway is running (Settings page)'),
          t('channels.guide.oneclick.click', 'Click "Connect" below — everything is automatic'),
          t('channels.guide.whatsapp.scan', 'Open WhatsApp on your phone → Settings → Linked Devices → Scan the QR code'),
        ]);
      case 'wechat':
        return oneClickGuide([
          t('channels.guide.oneclick.gateway', 'Make sure Gateway is running (Settings page)'),
          t('channels.guide.oneclick.click', 'Click "Connect" below — we\'ll install the plugin automatically'),
          t('channels.guide.wechat.scan', 'Open WeChat on your phone → Scan the QR code'),
        ]);
      case 'signal':
        return oneClickGuide([
          t('channels.guide.oneclick.gateway', 'Make sure Gateway is running (Settings page)'),
          t('channels.guide.oneclick.click', 'Click "Connect" — we\'ll set up Signal automatically'),
          t('channels.guide.signal.scan', 'Open Signal on your phone → Settings → Linked Devices → Scan QR code'),
        ]);
      case 'imessage':
        return (
          <div className="space-y-3 text-sm">
            <div className="p-3 bg-blue-600/10 border border-blue-600/20 rounded-lg text-xs text-blue-300">
              {t('channels.guide.imessage.macOnly', 'Only works on Mac. You may need to allow "Full Disk Access" in System Settings when prompted.')}
            </div>
            {oneClickGuide([
              t('channels.guide.oneclick.gateway', 'Make sure Gateway is running (Settings page)'),
              t('channels.guide.oneclick.click', 'Click "Connect" — we\'ll detect your Messages automatically'),
            ])}
          </div>
        );
      case 'telegram':
        return (
          <div className="space-y-3 text-sm">
            {oneClickGuide([
              <>{t('channels.guide.telegram.step1')} <span className="text-brand-400 font-medium">@BotFather</span></>,
              <>{t('channels.guide.telegram.step2')} <span className="text-brand-400 font-medium">/newbot</span> — {t('channels.guide.telegram.step2.desc')}</>,
              <>{t('channels.guide.telegram.step3')} <span className="text-brand-400 font-medium">Token</span> — {t('channels.guide.telegram.step3.desc')}</>,
            ])}
          </div>
        );
      default: {
        // Generic guide: try i18n key, fallback to channel description + docs link
        const guideText = t(`channels.guide.${activeWizard}`, '') || activeChannel.description || t('channels.guide.default', 'Follow the steps below to connect this channel.');
        const docsSlug = activeChannel.docsSlug || activeChannel.openclawId;
        return (
          <div className="p-4 bg-slate-800/50 rounded-xl">
            <p className="text-sm text-slate-300">{guideText}</p>
            <button onClick={() => {
              window.electronAPI?.openExternal(`https://docs.openclaw.ai/channels/${docsSlug}`);
            }}
              className="mt-3 flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300">
              <ExternalLink size={14} /> {t('channels.viewTutorial')}
            </button>
          </div>
        );
      }
    }
  };

  // --- Config form — now fully driven by registry ---
  const getTokenForm = () => {
    if (!activeChannel || activeChannel.configFields.length === 0) return null;
    return (
      <DynamicConfigForm
        fields={activeChannel.configFields}
        values={formValues}
        onChange={(key, val) => setFormValues(prev => ({ ...prev, [key]: val }))}
        t={t}
      />
    );
  };

  // Channel display helpers
  const getChannelLabel = (ch: ChannelDef) => t(`channels.channel.${ch.id}`, ch.label);
  const getChannelDesc = (ch: ChannelDef) => t(`channels.channel.${ch.id}.desc`, ch.description || '');

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-slate-800">
        <h1 className="text-lg font-semibold">📡 {t('channels.title')}</h1>
        <p className="text-xs text-slate-500">{t('channels.subtitleConnected')}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loadingChannels && (
          <div className="flex items-center gap-2 mb-4 p-3 bg-slate-800/30 rounded-lg text-xs text-slate-400">
            <Loader2 size={12} className="animate-spin" />
            {t('channels.loading', 'Loading channel status...')}
          </div>
        )}

        {/* Connected */}
        <div className="mb-6">
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">{t('channels.connected')}</h3>
          <div className="grid grid-cols-2 gap-3">
            {channels.filter((c) => c.id === 'local' || configuredChannels.has(c.id)).map((ch) => (
              <button key={ch.id} onClick={() => ch.id !== 'local' && openWizard(ch.id)} disabled={ch.id === 'local'}
                className={`p-4 bg-emerald-600/10 border border-emerald-600/30 rounded-xl text-left ${ch.id !== 'local' ? 'hover:border-emerald-500/50 cursor-pointer' : ''} transition-colors`}>
                <div className="flex items-center gap-3">
                  <ChannelIcon channelId={ch.id} size={28} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{getChannelLabel(ch)}</div>
                    <div className="text-xs text-emerald-400">✅ {ch.id === 'local' ? t('channels.builtIn') : t('channels.configured')}</div>
                  </div>
                  {ch.id !== 'local' && <ChevronRight size={14} className="text-slate-600" />}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Available */}
        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">{t('channels.available')}</h3>
          <div className="grid grid-cols-2 gap-3">
            {channels.filter((c) => c.id !== 'local' && !configuredChannels.has(c.id)).map((ch) => (
              <button key={ch.id} onClick={() => openWizard(ch.id)}
                className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl hover:border-slate-600 transition-colors text-left group">
                <div className="flex items-center gap-3">
                  <ChannelIcon channelId={ch.id} size={28} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{getChannelLabel(ch)}</div>
                    <div className="text-xs text-slate-500">{getChannelDesc(ch)}</div>
                  </div>
                  <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Wizard Modal */}
      {activeWizard && activeChannel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ChannelIcon channelId={activeWizard} size={24} />
                {t('channels.connectPrefix')} {getChannelLabel(activeChannel)}
                {configuredChannels.has(activeWizard) && (
                  <span className="text-xs font-normal px-2 py-0.5 bg-amber-600/20 border border-amber-600/30 text-amber-400 rounded-full">
                    ✏️ {t('channels.editingBadge', 'Editing')}
                  </span>
                )}
              </h2>
              <button onClick={closeWizard} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-5">
              {/* Step 1: Guide */}
              {wizardStep === 'intro' && (
                <>
                  {getGuide()}

                  {configuredChannels.has(activeWizard) && (
                    <div className="p-3 bg-amber-600/10 border border-amber-600/20 rounded-lg text-xs text-amber-400">
                      {t('channels.alreadyConfigured', 'Already connected. You can reconnect or update credentials.')}
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      onClick={() => {
                        if (isOneClick) { handleConnect(); setWizardStep('test'); }
                        else { setWizardStep('token'); }
                      }}
                      className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5"
                    >
                      {isOneClick
                        ? t('channels.connectBtn', 'Connect')
                        : <>{t('channels.next')} <ChevronRight size={14} /></>}
                    </button>
                  </div>
                </>
              )}

              {/* Step 2: Credentials */}
              {wizardStep === 'token' && (
                <>
                  {lastError && (
                    <div className="p-3 bg-red-900/20 border border-red-600/30 rounded-lg text-xs text-red-400 break-words">
                      <span className="font-medium">{t('channels.lastErrorPrefix', 'Last attempt failed:')}</span>{' '}
                      {lastError}
                      {!lastError.trim() || lastError === t('channels.setupFailed', 'Setup failed. Check Gateway in Settings.') ? null : (
                        <span className="block mt-1 text-red-400/70">{t('channels.checkGatewayHint', 'If the issue persists, check Gateway in Settings.')}</span>
                      )}
                    </div>
                  )}
                  {getTokenForm()}
                  <div className="flex justify-between">
                    <button onClick={() => setWizardStep('intro')} className="px-4 py-2 text-slate-400 hover:text-slate-200 flex items-center gap-1 text-sm">
                      <ChevronLeft size={14} /> {t('channels.back')}
                    </button>
                    <button onClick={() => { handleConnect(); setWizardStep('test'); }}
                      disabled={!isFormValid()}
                      className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-xl text-sm font-medium transition-colors">
                      {t('channels.connectBtn', 'Connect')}
                    </button>
                  </div>
                </>
              )}

              {/* Step 3: Result */}
              {wizardStep === 'test' && (
                <>
                  <div className={asciiQR ? 'py-2' : 'text-center py-6'}>
                    {testStatus === 'testing' && (
                      <div>
                        {asciiQR ? (
                          <div className="space-y-3">
                            <p className="text-sm text-slate-300 text-center font-medium">
                              {activeWizard === 'whatsapp'
                                ? t('channels.whatsapp.scanHint', 'Open WhatsApp → Linked Devices → Link a Device')
                                : activeWizard === 'wechat'
                                  ? t('channels.guide.wechat.scan', 'Scan QR with WeChat to link')
                                  : t('channels.signal.scanHint', 'Open Signal → Settings → Linked Devices → Link New Device')}
                            </p>
                            <div className="bg-white rounded-xl p-3 overflow-x-auto">
                              <pre className="text-black text-[10px] leading-none font-mono whitespace-pre select-text">{asciiQR}</pre>
                            </div>
                            <p className="text-xs text-slate-500 text-center">{t('channels.qr.waiting', 'Waiting for scan...')}</p>
                          </div>
                        ) : (
                          <div className="text-center space-y-4">
                            <div className="w-10 h-10 mx-auto border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                            <div className="space-y-2">
                              <p className="text-slate-300">{t('channels.testing')}</p>
                              {isOneClick && (
                                <p className="text-xs text-slate-500 animate-pulse">{channelProgress ? translateStatus(channelProgress) : t('channels.oneclick.wait', 'Initializing...')}</p>
                              )}
                              {isOneClick && !asciiQR && (
                                <p className="text-[11px] text-slate-600 mt-3">
                                  {t('channels.oneclick.patience', 'First time may take 15-20s to load')}
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {testStatus === 'success' && (
                      <div className="space-y-3">
                        <div className="w-16 h-16 mx-auto bg-emerald-600/20 rounded-full flex items-center justify-center">
                          <Check size={32} className="text-emerald-400" />
                        </div>
                        <p className="text-emerald-300 font-medium">{t('channels.success')}</p>
                        {testNotice && (
                          <p className="text-xs text-slate-400 bg-slate-800/60 rounded-lg px-3 py-2 max-w-sm mx-auto">
                            {testNotice}
                          </p>
                        )}
                      </div>
                    )}
                    {testStatus === 'error' && (
                      <div className="space-y-3">
                        <p className="text-red-400">{t('channels.failed')}</p>
                        {testError && (
                          <p className="text-xs text-red-400/70 bg-red-900/20 rounded-lg px-3 py-2 text-left break-words max-h-24 overflow-y-auto">
                            {testError}
                          </p>
                        )}
                        <button onClick={() => {
                          if (!isOneClick && testError) setLastError(testError);
                          setTestError(null);
                          setWizardStep(isOneClick ? 'intro' : 'token');
                        }}
                          className="text-sm text-brand-400 hover:text-brand-300">
                          {t('channels.tryAgain', 'Try again')}
                        </button>
                      </div>
                    )}
                  </div>
                  {testStatus === 'success' && (
                    <div className="flex justify-end">
                      <button onClick={closeWizard}
                        className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm font-medium transition-colors">
                        {t('channels.done')} ✓
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
