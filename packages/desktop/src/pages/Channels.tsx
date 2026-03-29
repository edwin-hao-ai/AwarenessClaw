import { useState } from 'react';
import { ChevronRight, ChevronLeft, Check, ExternalLink, Copy, X } from 'lucide-react';

interface Channel {
  id: string;
  name: string;
  emoji: string;
  connected: boolean;
  status?: string;
  description: string;
}

const CHANNELS: Channel[] = [
  { id: 'local', name: '本地聊天', emoji: '💬', connected: true, status: '内置', description: '内置的本地聊天界面' },
  { id: 'telegram', name: 'Telegram', emoji: '📱', connected: false, description: '最流行的即时通讯，配置最简单' },
  { id: 'whatsapp', name: 'WhatsApp', emoji: '💚', connected: false, description: '全球最大的即时通讯应用' },
  { id: 'slack', name: 'Slack', emoji: '💼', connected: false, description: '团队协作工具' },
  { id: 'discord', name: 'Discord', emoji: '🎮', connected: false, description: '游戏和社区' },
  { id: 'feishu', name: '飞书 / Lark', emoji: '🐦', connected: false, description: '字节跳动企业通讯' },
  { id: 'signal', name: 'Signal', emoji: '🔒', connected: false, description: '端到端加密通讯' },
  { id: 'imessage', name: 'iMessage', emoji: '🍎', connected: false, description: 'Apple 生态（仅 macOS）' },
  { id: 'google-chat', name: 'Google Chat', emoji: '💬', connected: false, description: 'Google Workspace' },
];

type WizardStep = 'intro' | 'token' | 'test' | 'done';

export default function Channels() {
  const [activeWizard, setActiveWizard] = useState<string | null>(null);
  const [wizardStep, setWizardStep] = useState<WizardStep>('intro');
  const [tokenInput, setTokenInput] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');

  const openWizard = (channelId: string) => {
    setActiveWizard(channelId);
    setWizardStep('intro');
    setTokenInput('');
    setTestStatus('idle');
  };

  const closeWizard = () => {
    setActiveWizard(null);
  };

  const handleTest = async () => {
    setTestStatus('testing');
    // TODO: Actually test the connection via OpenClaw Gateway
    setTimeout(() => {
      setTestStatus(tokenInput.length > 10 ? 'success' : 'error');
    }, 1500);
  };

  const getTelegramGuide = () => (
    <div className="space-y-4 text-sm">
      <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
        <span className="text-brand-400 font-bold">1</span>
        <div>
          <p className="font-medium">打开 Telegram，搜索 <span className="text-brand-400">@BotFather</span></p>
          <p className="text-slate-400">这是 Telegram 官方的机器人创建工具</p>
        </div>
      </div>
      <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
        <span className="text-brand-400 font-bold">2</span>
        <div>
          <p className="font-medium">发送 <span className="text-brand-400">/newbot</span></p>
          <p className="text-slate-400">按提示给机器人起一个名字和用户名</p>
        </div>
      </div>
      <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
        <span className="text-brand-400 font-bold">3</span>
        <div>
          <p className="font-medium">复制获得的 <span className="text-brand-400">Token</span></p>
          <p className="text-slate-400">格式类似：123456789:ABCdefGHI...</p>
        </div>
      </div>
    </div>
  );

  const getWhatsAppGuide = () => (
    <div className="space-y-4 text-sm text-center">
      <div className="w-48 h-48 mx-auto bg-white rounded-2xl flex items-center justify-center">
        <span className="text-slate-400 text-xs">QR Code 将在此显示</span>
      </div>
      <div className="space-y-2 text-left">
        <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
          <span className="text-brand-400 font-bold">1</span>
          <p>打开 WhatsApp → <span className="text-brand-400">设置</span> → <span className="text-brand-400">关联设备</span></p>
        </div>
        <div className="flex items-start gap-3 p-3 bg-slate-800/50 rounded-lg">
          <span className="text-brand-400 font-bold">2</span>
          <p>扫描上方二维码</p>
        </div>
      </div>
    </div>
  );

  const getGenericGuide = (channelId: string) => {
    const guides: Record<string, string> = {
      slack: '需要创建 Slack App 并获取 Bot Token。',
      discord: '需要在 Discord Developer Portal 创建 Bot 并获取 Token。',
      feishu: '需要在飞书开放平台创建自建应用并获取 AppID 和 AppSecret。',
      signal: '需要安装 signal-cli 并关联你的 Signal 账号。',
      imessage: '仅支持 macOS，需要 BlueBubbles 服务。',
      'google-chat': '需要在 Google Cloud 创建 Chat API 应用。',
    };
    return (
      <div className="p-4 bg-slate-800/50 rounded-xl">
        <p className="text-sm text-slate-300">{guides[channelId] || '按照平台文档配置。'}</p>
        <button
          onClick={() => window.electronAPI?.openExternal(`https://docs.openclaw.ai/channels/${channelId}`)}
          className="mt-3 flex items-center gap-1.5 text-sm text-brand-400 hover:text-brand-300"
        >
          <ExternalLink size={14} />
          查看详细教程
        </button>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <h1 className="text-lg font-semibold">📡 消息通道</h1>
        <p className="text-xs text-slate-500">连接后，你可以通过这些平台和 AI 对话</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Connected */}
        <div className="mb-6">
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">已连接</h3>
          <div className="grid grid-cols-2 gap-3">
            {CHANNELS.filter((c) => c.connected).map((ch) => (
              <div key={ch.id} className="p-4 bg-emerald-600/10 border border-emerald-600/30 rounded-xl">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{ch.emoji}</span>
                  <div>
                    <div className="font-medium text-sm">{ch.name}</div>
                    <div className="text-xs text-emerald-400">✅ {ch.status || '已连接'}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Available */}
        <div>
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">可添加</h3>
          <div className="grid grid-cols-2 gap-3">
            {CHANNELS.filter((c) => !c.connected).map((ch) => (
              <button
                key={ch.id}
                onClick={() => openWizard(ch.id)}
                className="p-4 bg-slate-800/50 border border-slate-700 rounded-xl hover:border-slate-600 transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{ch.emoji}</span>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{ch.name}</div>
                    <div className="text-xs text-slate-500">{ch.description}</div>
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
            {/* Modal header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {CHANNELS.find((c) => c.id === activeWizard)?.emoji}
                连接 {CHANNELS.find((c) => c.id === activeWizard)?.name}
              </h2>
              <button onClick={closeWizard} className="text-slate-500 hover:text-slate-300">
                <X size={20} />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Intro / Guide */}
              {wizardStep === 'intro' && (
                <>
                  {activeWizard === 'telegram' && getTelegramGuide()}
                  {activeWizard === 'whatsapp' && getWhatsAppGuide()}
                  {!['telegram', 'whatsapp'].includes(activeWizard) && getGenericGuide(activeWizard)}

                  <div className="flex justify-end">
                    <button
                      onClick={() => setWizardStep(activeWizard === 'whatsapp' ? 'test' : 'token')}
                      className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm font-medium transition-colors flex items-center gap-1"
                    >
                      {activeWizard === 'whatsapp' ? '开始扫码' : '下一步'} <ChevronRight size={14} />
                    </button>
                  </div>
                </>
              )}

              {/* Token input */}
              {wizardStep === 'token' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-300 mb-2">
                      🔑 粘贴你的 Token
                    </label>
                    <input
                      type="password"
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="粘贴到这里..."
                      className="w-full px-4 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                    />
                  </div>
                  <div className="flex justify-between">
                    <button onClick={() => setWizardStep('intro')} className="px-4 py-2 text-slate-400 hover:text-slate-200 flex items-center gap-1 text-sm">
                      <ChevronLeft size={14} /> 返回
                    </button>
                    <button
                      onClick={() => { handleTest(); setWizardStep('test'); }}
                      disabled={!tokenInput}
                      className="px-5 py-2 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-xl text-sm font-medium transition-colors"
                    >
                      🔗 测试连接
                    </button>
                  </div>
                </>
              )}

              {/* Test result */}
              {wizardStep === 'test' && (
                <>
                  <div className="text-center py-6">
                    {testStatus === 'testing' && (
                      <div className="space-y-3">
                        <div className="w-10 h-10 mx-auto border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
                        <p className="text-slate-300">正在测试连接...</p>
                      </div>
                    )}
                    {testStatus === 'success' && (
                      <div className="space-y-3">
                        <div className="w-16 h-16 mx-auto bg-emerald-600/20 rounded-full flex items-center justify-center">
                          <Check size={32} className="text-emerald-400" />
                        </div>
                        <p className="text-emerald-300 font-medium">连接成功！</p>
                      </div>
                    )}
                    {testStatus === 'error' && (
                      <div className="space-y-3">
                        <p className="text-red-400">连接失败，请检查 Token 是否正确</p>
                        <button
                          onClick={() => setWizardStep('token')}
                          className="text-sm text-brand-400 hover:text-brand-300"
                        >
                          重新输入
                        </button>
                      </div>
                    )}
                  </div>
                  {testStatus === 'success' && (
                    <div className="flex justify-end">
                      <button
                        onClick={closeWizard}
                        className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-sm font-medium transition-colors"
                      >
                        完成 ✓
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
