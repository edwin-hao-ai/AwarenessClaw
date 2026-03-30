import { useState, useEffect, useRef } from 'react';
import { ChevronRight, ChevronLeft, Check, ExternalLink, X, Loader2 } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import PasswordInput from '../components/PasswordInput';
import ChannelIcon from '../components/ChannelIcon';

interface Channel {
  id: string;
  connected: boolean;
  supported: boolean;
}

const CHANNELS: Channel[] = [
  { id: 'local', connected: true, supported: true },
  { id: 'telegram', connected: false, supported: true },
  { id: 'discord', connected: false, supported: true },
  { id: 'whatsapp', connected: false, supported: true },
  { id: 'wechat', connected: false, supported: true },
  { id: 'slack', connected: false, supported: true },
  { id: 'signal', connected: false, supported: true },
  { id: 'imessage', connected: false, supported: true },
  { id: 'feishu', connected: false, supported: true },
  { id: 'line', connected: false, supported: true },
  { id: 'matrix', connected: false, supported: true },
  { id: 'google-chat', connected: false, supported: true },
];

type WizardStep = 'intro' | 'token' | 'test';

// Channels where user just clicks "Connect" — no credentials needed
const ONE_CLICK_CHANNELS = ['whatsapp', 'wechat', 'signal', 'imessage'];

export default function Channels() {
  const { t } = useI18n();
  const [activeWizard, setActiveWizard] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<WizardStep>('intro');
  // Simple token (Telegram, Discord, LINE)
  const [tokenInput, setTokenInput] = useState('');
  // Slack
  const [slackBotToken, setSlackBotToken] = useState('');
  const [slackAppToken, setSlackAppToken] = useState('');
  // Feishu
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  // Matrix (like a login form)
  const [matrixServer, setMatrixServer] = useState('');
  const [matrixUser, setMatrixUser] = useState('');
  const [matrixPass, setMatrixPass] = useState('');
  // Google Chat (file path selected via file picker)
  const [gchatKeyFile, setGchatKeyFile] = useState('');

  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testError, setTestError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [configuredChannels, setConfiguredChannels] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<Channel[]>(CHANNELS);
  const [loadingChannels, setLoadingChannels] = useState(true);
  const hasLoadedOnce = useRef(false);

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
    try {
      const supported = await (window.electronAPI as any).channelListSupported?.();
      if (supported?.success && supported.channels?.length > 0) {
        const knownIds = new Set(CHANNELS.map(c => c.id));
        const extra: Channel[] = [];
        for (const ch of supported.channels) {
          if (!knownIds.has(ch)) extra.push({ id: ch, connected: false, supported: true });
        }
        if (extra.length > 0) setChannels([...CHANNELS, ...extra]);
      }
    } catch { /* fallback */ }
    setLoadingChannels(false);
    hasLoadedOnce.current = true;
  };

  useEffect(() => { loadConfiguredChannels(); }, []);

  const openWizard = async (channelId: string) => {
    setActiveWizard(channelId);
    setWizardStep('intro');
    setTokenInput(''); setSlackBotToken(''); setSlackAppToken('');
    setFeishuAppId(''); setFeishuAppSecret('');
    setMatrixServer(''); setMatrixUser(''); setMatrixPass('');
    setGchatKeyFile('');
    setTestStatus('idle'); setTestError(null); setLastError(null);

    // Pre-fill if already configured
    if (window.electronAPI && configuredChannels.has(channelId)) {
      try {
        const res = await (window.electronAPI as any).channelReadConfig(channelId);
        if (res?.success && res.config) {
          if (channelId === 'feishu') { setFeishuAppId(res.config.appId || ''); setFeishuAppSecret(res.config.appSecret || ''); }
          else if (channelId === 'slack') { setSlackBotToken(res.config.botToken || res.config.bot_token || ''); setSlackAppToken(res.config.appToken || res.config.app_token || ''); }
          else if (channelId === 'matrix') { setMatrixServer(res.config.homeserver || ''); setMatrixUser(res.config.userId || res.config.user_id || ''); }
          else if (channelId === 'google-chat') { setGchatKeyFile(res.config.serviceAccountFile || ''); }
          else if (res.config.token) { setTokenInput(res.config.token); }
        }
      } catch { /* start fresh */ }
    }
  };

  const closeWizard = () => { setActiveWizard(null); loadConfiguredChannels(false); };

  // Build config for save — only the essentials, backend handles defaults
  const buildConfig = (): Record<string, string> | null => {
    if (!activeWizard) return null;
    switch (activeWizard) {
      case 'feishu': return (feishuAppId && feishuAppSecret) ? { appId: feishuAppId, appSecret: feishuAppSecret } : null;
      case 'slack': return (slackBotToken && slackAppToken) ? { botToken: slackBotToken, appToken: slackAppToken } : null;
      case 'matrix': return (matrixServer && matrixUser && matrixPass) ? { homeserver: matrixServer, userId: matrixUser, password: matrixPass } : null;
      case 'google-chat': return gchatKeyFile ? { serviceAccountFile: gchatKeyFile } : null;
      default: return tokenInput ? { token: tokenInput } : null;
    }
  };

  const isFormValid = (): boolean => {
    if (!activeWizard) return false;
    if (ONE_CLICK_CHANNELS.includes(activeWizard)) return true;
    return buildConfig() !== null;
  };

  const handleConnect = async () => {
    if (!activeWizard) return;
    setTestStatus('testing'); setTestError(null);

    if (!window.electronAPI) {
      setTimeout(() => setTestStatus(isFormValid() ? 'success' : 'error'), 1500);
      return;
    }

    if (ONE_CLICK_CHANNELS.includes(activeWizard)) {
      // One-click: backend handles install + login + config
      const result = await (window.electronAPI as any).channelSetup(activeWizard);
      setTestStatus(result.success ? 'success' : 'error');
      if (!result.success) setTestError(result.error || t('channels.setupFailed', 'Setup failed. Make sure Gateway is running in Settings.'));
    } else {
      // Save config via CLI, then test
      const config = buildConfig()!;
      const saveResult = await (window.electronAPI as any).channelSave(activeWizard, config);
      if (!saveResult.success) { setTestStatus('error'); setTestError(saveResult.error || t('channels.saveFailed', 'Could not save. Please try again.')); return; }

      const testResult = await (window.electronAPI as any).channelTest(activeWizard);
      setTestStatus(testResult.success ? 'success' : 'error');
      if (!testResult.success) setTestError(testResult.error || testResult.output || null);
    }
  };

  // --- Guide content per channel ---

  const oneClickGuide = (steps: string[]) => (
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
    if (!activeWizard) return null;

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
            ] as any)}
          </div>
        );
      default:
        return (
          <div className="p-4 bg-slate-800/50 rounded-xl">
            <p className="text-sm text-slate-300">{t(`channels.guide.${activeWizard}`, t('channels.guide.default'))}</p>
            <button onClick={() => {
              // Map frontend IDs to real doc slugs
              const docSlugs: Record<string, string> = {
                'google-chat': 'googlechat', 'wechat': 'googlechat', // wechat has no doc page, fallback
                'feishu': 'googlechat', // feishu is plugin, no dedicated doc
              };
              const slug = docSlugs[activeWizard!] || activeWizard;
              window.electronAPI?.openExternal(`https://docs.openclaw.ai/channels/${slug}`);
            }}
              className="mt-3 flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300">
              <ExternalLink size={14} /> {t('channels.viewTutorial')}
            </button>
          </div>
        );
    }
  };

  // --- Token/credential form per channel ---
  const getTokenForm = () => {
    if (!activeWizard) return null;

    switch (activeWizard) {
      case 'slack':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.slack.botToken', 'Bot Token')}</label>
              <PasswordInput value={slackBotToken} onChange={(e) => setSlackBotToken(e.target.value)}
                placeholder="xoxb-..." className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
              <p className="mt-1.5 text-xs text-slate-500">{t('channels.slackBotHint', 'Slack App → OAuth & Permissions → Bot User OAuth Token')}</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.slack.appToken', 'App Token')}</label>
              <PasswordInput value={slackAppToken} onChange={(e) => setSlackAppToken(e.target.value)}
                placeholder="xapp-..." className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
              <p className="mt-1.5 text-xs text-slate-500">{t('channels.slackAppHint', 'Slack App → Basic Information → App-Level Tokens')}</p>
            </div>
          </div>
        );
      case 'feishu':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.feishu.appId', 'App ID')}</label>
              <PasswordInput value={feishuAppId} onChange={(e) => setFeishuAppId(e.target.value)}
                placeholder="cli_xxxxxxxxxx" className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.feishu.appSecret', 'App Secret')}</label>
              <PasswordInput value={feishuAppSecret} onChange={(e) => setFeishuAppSecret(e.target.value)}
                placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
            </div>
          </div>
        );
      case 'matrix':
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.matrix.server', 'Server address')}</label>
              <input value={matrixServer} onChange={(e) => setMatrixServer(e.target.value)}
                placeholder="https://matrix.org" className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.matrix.user', 'Username')}</label>
              <input value={matrixUser} onChange={(e) => setMatrixUser(e.target.value)}
                placeholder="@mybot:matrix.org" className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.matrix.password', 'Password')}</label>
              <PasswordInput value={matrixPass} onChange={(e) => setMatrixPass(e.target.value)}
                placeholder="••••••••" className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
            </div>
          </div>
        );
      case 'google-chat':
        return (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">{t('channels.gchat.desc', 'You need a Google Cloud service account key file (JSON). Create one in Google Cloud Console → IAM → Service Accounts → Keys.')}</p>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.gchat.keyFile', 'Service Account Key')}</label>
              <div className="flex gap-2">
                <input value={gchatKeyFile} readOnly
                  placeholder={t('channels.gchat.noFile', 'No file selected')}
                  className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm text-slate-400" />
                <button onClick={async () => {
                  if (window.electronAPI) {
                    const result = await (window.electronAPI as any).selectFile?.({ filters: [{ name: 'JSON', extensions: ['json'] }] });
                    if (result?.filePath) setGchatKeyFile(result.filePath);
                  }
                }} className="px-4 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-lg text-sm text-white whitespace-nowrap">
                  {t('channels.gchat.browse', 'Browse...')}
                </button>
              </div>
            </div>
          </div>
        );
      case 'line':
        return (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.lineToken', 'Channel Access Token')}</label>
            <PasswordInput value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
              placeholder={t('channels.paste')} className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
            <p className="mt-1.5 text-xs text-slate-500">{t('channels.lineHint', 'LINE Developers Console → Messaging API → Channel Access Token')}</p>
          </div>
        );
      default:
        // Telegram, Discord — simple single token
        return (
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">{t('channels.token')}</label>
            <PasswordInput value={tokenInput} onChange={(e) => setTokenInput(e.target.value)}
              placeholder={t('channels.paste')} className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />
          </div>
        );
    }
  };

  const isOneClick = activeWizard ? ONE_CLICK_CHANNELS.includes(activeWizard) : false;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-slate-800">
        <h1 className="text-lg font-semibold">📡 {t('channels.title')}</h1>
        <p className="text-xs text-slate-500">{t('channels.subtitleConnected')}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Loading indicator */}
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
            {channels.filter((c) => c.connected || configuredChannels.has(c.id)).map((ch) => (
              <button key={ch.id} onClick={() => ch.id !== 'local' && openWizard(ch.id)} disabled={ch.id === 'local'}
                className={`p-4 bg-emerald-600/10 border border-emerald-600/30 rounded-xl text-left ${ch.id !== 'local' ? 'hover:border-emerald-500/50 cursor-pointer' : ''} transition-colors`}>
                <div className="flex items-center gap-3">
                  <ChannelIcon channelId={ch.id} size={28} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{t(`channels.channel.${ch.id}`, ch.id)}</div>
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
            {channels.filter((c) => !c.connected && !configuredChannels.has(c.id)).map((ch) => (
              <button key={ch.id} onClick={() => openWizard(ch.id)}
                className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl hover:border-slate-600 transition-colors text-left group">
                <div className="flex items-center gap-3">
                  <ChannelIcon channelId={ch.id} size={28} />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{t(`channels.channel.${ch.id}`)}</div>
                    <div className="text-xs text-slate-500">{t(`channels.channel.${ch.id}.desc`)}</div>
                  </div>
                  <ChevronRight size={16} className="text-slate-600 group-hover:text-slate-400 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Wizard Modal */}
      {activeWizard && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ChannelIcon channelId={activeWizard} size={24} />
                {t('channels.connectPrefix')} {t(`channels.channel.${activeWizard}`)}
              </h2>
              <button onClick={closeWizard} className="text-slate-500 hover:text-slate-300"><X size={20} /></button>
            </div>

            <div className="p-5 space-y-5">
              {/* Step 1: Guide (one-click channels stay here; token channels proceed) */}
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
                        ? <>{t('channels.connectBtn', 'Connect')} <Loader2 size={0} /></>
                        : <>{t('channels.next')} <ChevronRight size={14} /></>}
                    </button>
                  </div>
                </>
              )}

              {/* Step 2: Credentials (only for non one-click channels) */}
              {wizardStep === 'token' && (
                <>
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
                  <div className="text-center py-6">
                    {testStatus === 'testing' && (
                      <div className="space-y-3">
                        <div className="w-10 h-10 mx-auto border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-slate-300">{t('channels.testing')}</p>
                        {isOneClick && <p className="text-xs text-slate-500">{t('channels.oneclick.wait', 'This may take a moment...')}</p>}
                      </div>
                    )}
                    {testStatus === 'success' && (
                      <div className="space-y-3">
                        <div className="w-16 h-16 mx-auto bg-emerald-600/20 rounded-full flex items-center justify-center">
                          <Check size={32} className="text-emerald-400" />
                        </div>
                        <p className="text-emerald-300 font-medium">{t('channels.success')}</p>
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
                        <button onClick={() => { setTestError(null); setWizardStep(isOneClick ? 'intro' : 'token'); }}
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
