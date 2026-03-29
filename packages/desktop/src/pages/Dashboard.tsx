import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Paperclip, ChevronDown, ExternalLink, Loader2, Copy, Check, X, File, Image, Plus, Brain, Key } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppConfig, MODEL_PROVIDERS } from '../lib/store';
import logoUrl from '../assets/logo.png';

// --- Types ---

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  files?: { name: string; path: string }[];
  model?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

type AgentStatus = 'idle' | 'thinking' | 'generating' | 'error';

// --- Persistence ---

const SESSIONS_KEY = 'awareness-claw-sessions';
const ACTIVE_SESSION_KEY = 'awareness-claw-active-session';

function loadSessions(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function createSession(): ChatSession {
  return {
    id: `session-${Date.now()}`,
    title: '新对话',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

// --- Typewriter effect ---

function useTypewriter(text: string, speed = 15) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!text) { setDisplayed(''); setDone(true); return; }
    setDone(false);
    let i = 0;
    setDisplayed('');
    const interval = setInterval(() => {
      i += 1 + Math.floor(Math.random() * 2); // 1-2 chars at a time for natural feel
      if (i >= text.length) {
        setDisplayed(text);
        setDone(true);
        clearInterval(interval);
      } else {
        setDisplayed(text.slice(0, i));
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed]);

  return { displayed, done };
}

// --- Typewriter Message Component ---

function TypewriterMessage({ content, isNew }: { content: string; isNew: boolean }) {
  const { displayed, done } = useTypewriter(isNew ? content : '', 12);
  const text = isNew ? displayed : content;

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ children, className, ...props }) {
            const isInline = !className;
            if (isInline) {
              return <code className="px-1.5 py-0.5 bg-slate-700 rounded text-brand-300 text-xs" {...props}>{children}</code>;
            }
            return (
              <pre className="bg-slate-950 rounded-lg p-3 overflow-x-auto text-xs">
                <code className={className} {...props}>{children}</code>
              </pre>
            );
          },
          p({ children }) { return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>; },
          ul({ children }) { return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>; },
          ol({ children }) { return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>; },
          h1({ children }) { return <h3 className="text-base font-bold mb-2 mt-3">{children}</h3>; },
          h2({ children }) { return <h4 className="text-sm font-bold mb-1.5 mt-2">{children}</h4>; },
          h3({ children }) { return <h5 className="text-sm font-semibold mb-1 mt-2">{children}</h5>; },
        }}
      >
        {text}
      </ReactMarkdown>
      {isNew && !done && <span className="animate-pulse text-brand-400">▊</span>}
    </div>
  );
}

// --- Main Component ---

export default function Dashboard() {
  const { config } = useAppConfig();
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(
    localStorage.getItem(ACTIVE_SESSION_KEY) || ''
  );
  const [input, setInput] = useState('');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showApiKeyInput, setShowApiKeyInput] = useState<string | null>(null); // provider key needing API key
  const [tempApiKey, setTempApiKey] = useState('');
  const [showSidebar, setShowSidebar] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; path: string }[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newestMsgId, setNewestMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentProvider = MODEL_PROVIDERS.find(p => p.key === config.providerKey);

  // Ensure active session exists
  useEffect(() => {
    if (!activeSessionId || !sessions.find(s => s.id === activeSessionId)) {
      if (sessions.length > 0) {
        setActiveSessionId(sessions[0].id);
      } else {
        const s = createSession();
        setSessions([s]);
        setActiveSessionId(s.id);
      }
    }
  }, []);

  // Listen for status events
  useEffect(() => {
    if (window.electronAPI) {
      (window.electronAPI as any).onChatStatus?.((status: { type: string }) => {
        setAgentStatus(status.type as AgentStatus);
      });
    }
  }, []);

  // Persist sessions
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
  }, [activeSessionId]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, agentStatus]);

  const activeSession = sessions.find(s => s.id === activeSessionId);
  const messages = activeSession?.messages || [];

  const updateSession = (id: string, updater: (s: ChatSession) => ChatSession) => {
    setSessions(prev => prev.map(s => s.id === id ? updater(s) : s));
  };

  const handleNewSession = () => {
    const s = createSession();
    setSessions(prev => [s, ...prev]);
    setActiveSessionId(s.id);
    setShowSidebar(false);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || agentStatus !== 'idle') return;

    let fullMessage = text;
    if (attachedFiles.length > 0) {
      fullMessage += '\n\n[附件: ' + attachedFiles.map(f => f.path).join(', ') + ']';
    }

    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
      files: attachedFiles.length > 0 ? [...attachedFiles] : undefined,
    };

    updateSession(activeSessionId, s => ({
      ...s,
      messages: [...s.messages, userMsg],
      title: s.messages.length === 0 ? text.slice(0, 30) : s.title,
      updatedAt: Date.now(),
    }));

    setInput('');
    setAttachedFiles([]);
    setAgentStatus('thinking');

    if (window.electronAPI) {
      const result = await (window.electronAPI as any).chatSend(fullMessage, activeSessionId);
      const responseText = result.text || result.error || 'No response';

      const assistantMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        model: config.modelId,
      };

      setNewestMsgId(assistantMsg.id);
      updateSession(activeSessionId, s => ({
        ...s,
        messages: [...s.messages, assistantMsg],
        updatedAt: Date.now(),
      }));
    } else {
      // Dev mock
      await new Promise(r => setTimeout(r, 1500));
      const mockMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: `这是一个演示回复。你说的是: "${text}"\n\n## 功能预览\n- **Markdown** 渲染\n- \`代码\` 高亮\n- 列表支持\n\n\`\`\`python\nprint("Hello AwarenessClaw!")\n\`\`\``,
        timestamp: Date.now(),
        model: 'demo',
      };
      setNewestMsgId(mockMsg.id);
      updateSession(activeSessionId, s => ({
        ...s,
        messages: [...s.messages, mockMsg],
        updatedAt: Date.now(),
      }));
    }

    setAgentStatus('idle');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    setAttachedFiles(prev => [...prev, ...files.map(f => ({ name: f.name, path: (f as any).path || f.name }))]);
  };

  const copyMessage = (msg: Message) => {
    navigator.clipboard.writeText(msg.content);
    setCopiedId(msg.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const deleteSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      if (remaining.length > 0) setActiveSessionId(remaining[0].id);
      else handleNewSession();
    }
  };

  const statusLabel = agentStatus === 'thinking' ? '🤔 思考中...' :
    agentStatus === 'generating' ? '✍️ 生成中...' :
    agentStatus === 'error' ? '❌ 出错了' : null;

  return (
    <div className="h-full flex" onDragOver={e => e.preventDefault()} onDrop={handleFileDrop}>
      {/* Session sidebar */}
      {showSidebar && (
        <div className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-slate-800">
            <button onClick={handleNewSession} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm text-white transition-colors">
              <Plus size={14} /> 新对话
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => { setActiveSessionId(s.id); setNewestMsgId(null); }}
                onDoubleClick={() => { setRenamingId(s.id); setRenameValue(s.title); }}
                className={`w-full text-left px-3 py-2.5 text-sm border-b border-slate-800/50 transition-colors group flex items-center justify-between cursor-pointer ${
                  s.id === activeSessionId ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                {renamingId === s.id ? (
                  <input
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => {
                      if (renameValue.trim()) updateSession(s.id, ss => ({ ...ss, title: renameValue.trim() }));
                      setRenamingId(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.currentTarget.blur(); }
                      if (e.key === 'Escape') { setRenamingId(null); }
                    }}
                    onClick={e => e.stopPropagation()}
                    className="flex-1 bg-slate-700 px-1.5 py-0.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                    autoFocus
                  />
                ) : (
                  <span className="truncate flex-1">{s.title}</span>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 p-0.5 ml-1"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowSidebar(!showSidebar)}
            className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            title="会话列表"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor"/><rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="currentColor"/><rect x="2" y="11.5" width="12" height="1.5" rx="0.75" fill="currentColor"/></svg>
          </button>

          <img src={logoUrl} alt="AwarenessClaw" className="w-6 h-6 rounded" />
          <h1 className="text-sm font-semibold">AwarenessClaw</h1>

          {/* Model selector */}
          <div className="relative ml-2">
            <button onClick={() => setShowModelSelector(!showModelSelector)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 transition-colors"
            >
              {currentProvider?.emoji} {config.modelId || '选择模型'}
              <ChevronDown size={10} />
            </button>
            {showModelSelector && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelSelector(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-[400px] overflow-y-auto">
                  {MODEL_PROVIDERS.map(provider => {
                    const isConfigured = config.providerKey === provider.key && config.apiKey;
                    return (
                      <div key={provider.key}>
                        <div className="px-3 py-1.5 text-[10px] font-medium border-b border-slate-800 sticky top-0 bg-slate-900 flex items-center justify-between">
                          <span className="text-slate-500">{provider.emoji} {provider.name}</span>
                          {isConfigured ? <span className="text-emerald-500">✅</span> : provider.needsKey ? <span className="text-amber-500">🔑</span> : <span className="text-slate-600">免费</span>}
                        </div>
                        {provider.models.map(model => (
                          <button key={model.id}
                            onClick={() => {
                              if (provider.needsKey && !isConfigured) {
                                // Need API key first
                                setShowApiKeyInput(provider.key);
                                setTempApiKey('');
                                setShowModelSelector(false);
                              } else {
                                // Switch model
                                updateConfig({ providerKey: provider.key, modelId: model.id });
                                syncConfig(MODEL_PROVIDERS);
                                setShowModelSelector(false);
                              }
                            }}
                            className={`w-full text-left px-4 py-1.5 text-xs hover:bg-slate-800 transition-colors ${
                              config.providerKey === provider.key && config.modelId === model.id ? 'text-brand-400' : 'text-slate-300'
                            }`}
                          >
                            {model.label}
                            {config.providerKey === provider.key && config.modelId === model.id && ' ✓'}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          <div className="flex-1" />

          <button onClick={() => window.electronAPI?.openExternal('http://localhost:18789')}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300 bg-slate-800/50 rounded-lg transition-colors">
            <ExternalLink size={10} /> Dashboard
          </button>
        </div>

        {/* API Key Input Modal */}
        {showApiKeyInput && (() => {
          const provider = MODEL_PROVIDERS.find(p => p.key === showApiKeyInput);
          return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-8">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-6 space-y-4">
                <div className="text-center">
                  <span className="text-2xl">{provider?.emoji}</span>
                  <h3 className="text-sm font-bold mt-2">配置 {provider?.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">输入 API Key 后即可使用</p>
                </div>
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={e => setTempApiKey(e.target.value)}
                  placeholder="粘贴你的 API Key..."
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => setShowApiKeyInput(null)} className="flex-1 py-2 text-sm text-slate-400 hover:text-slate-200">取消</button>
                  <button
                    onClick={() => {
                      if (tempApiKey && provider) {
                        updateConfig({
                          providerKey: provider.key,
                          modelId: provider.models[0]?.id || '',
                          apiKey: tempApiKey,
                          baseUrl: provider.baseUrl,
                        });
                        syncConfig(MODEL_PROVIDERS);
                        setShowApiKeyInput(null);
                      }
                    }}
                    disabled={!tempApiKey}
                    className="flex-1 py-2 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-lg text-sm transition-colors"
                  >
                    保存并切换
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {messages.length === 0 && agentStatus === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-6">
              <img src={logoUrl} alt="" className="w-16 h-16 opacity-30" />
              <div className="text-center">
                <p className="text-base mb-1">和你的 AI 助手聊点什么</p>
                <p className="text-xs text-slate-600">AI 拥有持久记忆，会记住每次对话</p>
              </div>
              <div className="flex flex-wrap gap-2 max-w-lg justify-center">
                {['帮我制定一个学习计划', '回顾一下最近的工作', '帮我分析一个技术问题'].map(q => (
                  <button key={q} onClick={() => setInput(q)}
                    className="px-3 py-1.5 text-xs bg-slate-800/80 hover:bg-slate-700 rounded-xl text-slate-300 border border-slate-700/50 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} group`}>
              <div className={`max-w-[75%] ${msg.role === 'user' ? '' : 'flex gap-3'}`}>
                {/* AI avatar */}
                {msg.role === 'assistant' && (
                  <img src={logoUrl} alt="" className="w-7 h-7 rounded-lg mt-0.5 flex-shrink-0" />
                )}

                <div>
                  {/* Meta line */}
                  {msg.role === 'assistant' && (
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-slate-500 font-medium">AwarenessClaw</span>
                      <span className="text-[10px] text-slate-600">{msg.model || ''}</span>
                      <span className="text-[10px] text-slate-700">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}

                  {/* Bubble */}
                  <div className={`px-4 py-3 rounded-2xl text-sm ${
                    msg.role === 'user'
                      ? 'bg-brand-600 text-white rounded-br-md'
                      : 'bg-slate-800/80 text-slate-200 border border-slate-700/30 rounded-bl-md'
                  }`}>
                    {msg.files && msg.files.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {msg.files.map((f, i) => (
                          <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-black/20 rounded text-[10px]">
                            <File size={10} /> {f.name}
                          </span>
                        ))}
                      </div>
                    )}

                    {msg.role === 'assistant' ? (
                      <TypewriterMessage content={msg.content} isNew={msg.id === newestMsgId} />
                    ) : (
                      <span className="whitespace-pre-wrap">{msg.content}</span>
                    )}
                  </div>

                  {/* Copy button */}
                  {msg.role === 'assistant' && (
                    <button onClick={() => copyMessage(msg)}
                      className="mt-1 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-slate-300 transition-all text-[10px] flex items-center gap-1"
                    >
                      {copiedId === msg.id ? <><Check size={10} /> 已复制</> : <><Copy size={10} /> 复制</>}
                    </button>
                  )}

                  {/* User timestamp */}
                  {msg.role === 'user' && (
                    <div className="text-right mt-0.5">
                      <span className="text-[10px] text-slate-600">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Status indicator */}
          {agentStatus !== 'idle' && (
            <div className="flex justify-start">
              <div className="flex gap-3">
                <img src={logoUrl} alt="" className="w-7 h-7 rounded-lg mt-0.5 flex-shrink-0 animate-pulse" />
                <div className="bg-slate-800/80 border border-slate-700/30 px-4 py-3 rounded-2xl rounded-bl-md">
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 size={14} className="animate-spin text-brand-400" />
                    <span>{statusLabel}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Attachments */}
        {attachedFiles.length > 0 && (
          <div className="px-4 py-1.5 border-t border-slate-800/50 flex gap-1.5 flex-wrap">
            {attachedFiles.map((f, i) => (
              <span key={i} className="flex items-center gap-1 px-2 py-1 bg-slate-800 rounded-lg text-[10px] text-slate-300">
                <File size={10} /> <span className="max-w-[120px] truncate">{f.name}</span>
                <button onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400"><X size={10} /></button>
              </span>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-slate-800">
          <div className="flex items-end gap-2 max-w-3xl mx-auto">
            <button onClick={() => fileInputRef.current?.click()}
              className="p-2.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-xl transition-colors" title="附加文件"
            >
              <Paperclip size={16} />
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden"
              onChange={e => { const files = Array.from(e.target.files || []); setAttachedFiles(prev => [...prev, ...files.map(f => ({ name: f.name, path: (f as any).path || f.name }))]); }}
            />

            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息...（Shift+Enter 换行，拖拽文件附加）"
                rows={1}
                className="w-full px-4 py-2.5 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-brand-500/50 resize-none transition-all placeholder:text-slate-600"
                style={{ minHeight: '42px', maxHeight: '120px', height: input.includes('\n') ? 'auto' : '42px' }}
                disabled={agentStatus !== 'idle'}
              />
            </div>

            <button onClick={handleSend}
              disabled={(!input.trim() && attachedFiles.length === 0) || agentStatus !== 'idle'}
              className="p-2.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-xl transition-colors"
            >
              {agentStatus !== 'idle' ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
