import { useState, useEffect, useRef } from 'react';
import { Send, Paperclip, Image, ChevronDown, ExternalLink, RefreshCw, Loader2, AlertCircle, Copy, Check, X, File } from 'lucide-react';
import { useAppConfig, MODEL_PROVIDERS } from '../lib/store';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  files?: { name: string; path: string; type: string }[];
  model?: string;
  loading?: boolean;
}

type GatewayStatus = 'checking' | 'online' | 'offline';

export default function Dashboard() {
  const { config, updateConfig, syncConfig } = useAppConfig();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<GatewayStatus>('checking');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; path: string; type: string }[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentProvider = MODEL_PROVIDERS.find(p => p.key === config.providerKey);
  const currentModel = currentProvider?.models.find(m => m.id === config.modelId);

  useEffect(() => {
    checkGateway();
    // Listen for streaming chunks
    if (window.electronAPI) {
      (window.electronAPI as any).onChatStream?.((chunk: string) => {
        setStreamingText(prev => prev + chunk);
      });
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText]);

  const checkGateway = async () => {
    try {
      await fetch('http://localhost:18789', { mode: 'no-cors', signal: AbortSignal.timeout(3000) });
      setStatus('online');
    } catch {
      // Even without gateway, we can use --local mode
      setStatus('online');
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text && attachedFiles.length === 0) return;
    if (isLoading) return;

    // Build message with file references
    let fullMessage = text;
    if (attachedFiles.length > 0) {
      const filePaths = attachedFiles.map(f => f.path).join('\n');
      fullMessage = `${text}\n\n[Attached files:\n${filePaths}]`;
    }

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
      files: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachedFiles([]);
    setIsLoading(true);
    setStreamingText('');

    // Send via IPC
    if (window.electronAPI) {
      const result = await (window.electronAPI as any).chatSend(fullMessage);
      const responseText = result.data?.reply || result.data?.message || result.text || result.error || 'No response';

      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: responseText,
        timestamp: new Date(),
        model: config.modelId,
      };
      setMessages(prev => [...prev, assistantMsg]);
    } else {
      // Dev mode mock
      await new Promise(r => setTimeout(r, 1000));
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `这是一个演示回复。在 Electron 环境中，消息会通过 \`openclaw agent\` CLI 发送到 AI。\n\n你说的是: "${text}"`,
        timestamp: new Date(),
        model: 'demo',
      }]);
    }

    setIsLoading(false);
    setStreamingText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const newFiles = files.map(f => ({
      name: f.name,
      path: (f as any).path || f.name,
      type: f.type.startsWith('image/') ? 'image' : 'file',
    }));
    setAttachedFiles(prev => [...prev, ...newFiles]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const newFiles = files.map(f => ({
      name: f.name,
      path: (f as any).path || f.name,
      type: f.type.startsWith('image/') ? 'image' : 'file',
    }));
    setAttachedFiles(prev => [...prev, ...newFiles]);
  };

  const copyMessage = (msg: Message) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const selectModel = (providerKey: string, modelId: string) => {
    updateConfig({ providerKey, modelId });
    syncConfig(MODEL_PROVIDERS);
    setShowModelSelector(false);
  };

  return (
    <div
      className="h-full flex flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleFileDrop}
    >
      {/* Header */}
      <div className="px-6 py-3 border-b border-slate-800 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">💬 聊天</h1>

          {/* Model selector */}
          <div className="relative">
            <button
              onClick={() => setShowModelSelector(!showModelSelector)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"
            >
              {currentProvider?.emoji} {config.modelId || '选择模型'}
              <ChevronDown size={12} />
            </button>

            {showModelSelector && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelSelector(false)} />
                <div className="absolute top-full left-0 mt-1 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-xl z-50 max-h-[400px] overflow-y-auto">
                  {MODEL_PROVIDERS.map(provider => {
                    const isConfigured = config.providerKey === provider.key && config.apiKey;
                    return (
                      <div key={provider.key}>
                        <div className="px-3 py-2 text-xs font-medium border-b border-slate-800 sticky top-0 bg-slate-900 flex items-center justify-between">
                          <span className="text-slate-500">{provider.emoji} {provider.name}</span>
                          {isConfigured ? (
                            <span className="text-emerald-500 text-[10px]">✅ 已配置</span>
                          ) : provider.needsKey ? (
                            <span className="text-amber-500 text-[10px]">🔑 需配置</span>
                          ) : (
                            <span className="text-slate-600 text-[10px]">免费</span>
                          )}
                        </div>
                        {provider.models.map(model => (
                          <button
                            key={model.id}
                            onClick={() => selectModel(provider.key, model.id)}
                            className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-800 transition-colors flex items-center justify-between ${
                              config.providerKey === provider.key && config.modelId === model.id ? 'text-brand-400' : 'text-slate-300'
                            }`}
                          >
                            <span>{model.label}</span>
                            {config.providerKey === provider.key && config.modelId === model.id && (
                              <Check size={14} className="text-brand-400" />
                            )}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <button
          onClick={() => window.electronAPI?.openExternal('http://localhost:18789')}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
        >
          <ExternalLink size={12} />
          Dashboard
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-6">
            <div className="text-5xl">🧠</div>
            <div className="text-center">
              <p className="text-lg mb-2">和你的 AI 助手聊点什么吧</p>
              <p className="text-sm text-slate-600">AI 拥有持久记忆，会记住你们的每次对话</p>
            </div>
            <div className="flex flex-wrap gap-2 max-w-lg justify-center">
              {['帮我制定一个学习计划', '回顾一下最近的工作', '帮我分析一个技术问题'].map((q) => (
                <button
                  key={q}
                  onClick={() => setInput(q)}
                  className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-300 transition-colors border border-slate-700"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in group`}
          >
            <div className={`max-w-[80%] relative ${msg.role === 'user' ? '' : ''}`}>
              {/* Avatar + role */}
              {msg.role === 'assistant' && (
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm">🧠</span>
                  <span className="text-xs text-slate-500">{msg.model || 'AI'}</span>
                  <span className="text-xs text-slate-600">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}

              <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-800 text-slate-200 border border-slate-700/50'
              }`}>
                {/* Attached files */}
                {msg.files && msg.files.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.files.map((f, i) => (
                      <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-black/20 rounded-lg text-xs">
                        {f.type === 'image' ? <Image size={12} /> : <File size={12} />}
                        {f.name}
                      </div>
                    ))}
                  </div>
                )}
                {msg.content}
              </div>

              {/* Copy button */}
              {msg.role === 'assistant' && (
                <button
                  onClick={() => copyMessage(msg)}
                  className="absolute -right-8 top-6 opacity-0 group-hover:opacity-100 transition-opacity text-slate-600 hover:text-slate-300"
                >
                  {copiedId === msg.id ? <Check size={14} /> : <Copy size={14} />}
                </button>
              )}

              {msg.role === 'user' && (
                <div className="text-right mt-1">
                  <span className="text-xs text-slate-600">{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading / Streaming */}
        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="max-w-[80%]">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">🧠</span>
                <span className="text-xs text-slate-500">{config.modelId || 'AI'}</span>
              </div>
              <div className="bg-slate-800 border border-slate-700/50 px-4 py-3 rounded-2xl text-sm">
                {streamingText ? (
                  <span className="whitespace-pre-wrap">{streamingText}<span className="animate-pulse">▊</span></span>
                ) : (
                  <div className="flex gap-1.5 py-1">
                    <div className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-slate-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Attached files preview */}
      {attachedFiles.length > 0 && (
        <div className="px-6 py-2 border-t border-slate-800 flex gap-2 flex-wrap">
          {attachedFiles.map((f, i) => (
            <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 rounded-lg text-xs text-slate-300">
              {f.type === 'image' ? <Image size={12} /> : <File size={12} />}
              <span className="max-w-[150px] truncate">{f.name}</span>
              <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="px-4 py-3 border-t border-slate-800">
        <div className="flex items-end gap-2">
          {/* Attachment buttons */}
          <div className="flex gap-1 pb-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-2 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-lg transition-colors"
              title="附加文件"
            >
              <Paperclip size={18} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileSelect}
            />
          </div>

          {/* Text input */}
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息...（拖拽文件到此处）"
              rows={1}
              className="w-full px-4 py-3 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50 resize-none max-h-32 transition-all"
              style={{ minHeight: '44px', height: input.split('\n').length > 1 ? 'auto' : '44px' }}
            />
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={(!input.trim() && attachedFiles.length === 0) || isLoading}
            className="p-3 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl transition-colors flex-shrink-0"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
