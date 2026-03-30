import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Paperclip, ChevronDown, ChevronRight, ExternalLink, Loader2, Copy, Check, X, File, Image, Plus, Brain, Key, Wrench, Search, BookOpen, Save, Zap, CheckCircle2, Terminal, AlertTriangle, FolderOpen } from 'lucide-react';
import PasswordInput from '../components/PasswordInput';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppConfig, MODEL_PROVIDERS, useDynamicProviders } from '../lib/store';
import { trackUsage } from '../lib/usage';
import { useI18n } from '../lib/i18n';
import logoUrl from '../assets/logo.png';

// --- Types ---

interface ToolCallInfo {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'approved' | 'recalling' | 'saving' | 'cached';
  timestamp: number;
}

interface FilePreview {
  type: 'text' | 'image' | 'error';
  content?: string;
  dataUri?: string;
  size?: number;
  lines?: number;
  truncated?: boolean;
  error?: string;
}

interface AttachedFile {
  name: string;
  path: string;
  preview?: FilePreview;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  files?: AttachedFile[];
  model?: string;
  toolCalls?: ToolCallInfo[];
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

type AgentStatus = 'idle' | 'thinking' | 'generating' | 'error';

// --- Tool call display helpers ---

function getToolIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('exec') || lower.includes('bash') || lower.includes('shell') || lower.includes('command')) return <Terminal size={12} />;
  if (lower.includes('recall') || lower.includes('search') || lower.includes('memory')) return <Search size={12} />;
  if (lower.includes('perception') || lower.includes('signal')) return <Zap size={12} />;
  if (lower.includes('capture') || lower.includes('save') || lower.includes('record')) return <Save size={12} />;
  if (lower.includes('read') || lower.includes('file') || lower.includes('doc')) return <BookOpen size={12} />;
  return <Wrench size={12} />;
}

function getToolLabel(name: string, status: string) {
  if (status === 'recalling') return `${name}: Recalling context...`;
  if (status === 'saving') return `${name}: Saving memory...`;
  if (status === 'cached') return `${name}: Signals cached`;
  if (status === 'approved') return `${name}: Approved`;
  if (status === 'completed') return `${name}: Done`;
  if (status === 'running' || status === 'in_progress') return `${name}: Running...`;
  return `${name}: ${status}`;
}

// --- Tool calls in message (collapsible) ---

function ToolCallsBlock({ toolCalls }: { toolCalls: ToolCallInfo[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Wrench size={11} />
        <span>{toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''} used</span>
      </button>
      {expanded && (
        <div className="mt-1.5 ml-4 space-y-1 border-l border-slate-700/50 pl-3">
          {toolCalls.map(tc => (
            <div key={tc.id} className="flex items-center gap-1.5 text-[11px] text-slate-500">
              <CheckCircle2 size={11} className="text-emerald-500/70" />
              <span>{tc.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Persistence ---

const SESSIONS_KEY = 'awareness-claw-sessions';
const ACTIVE_SESSION_KEY = 'awareness-claw-active-session';
const PROJECT_ROOT_KEY = 'awareness-claw-project-root';

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
  const { config, updateConfig, syncConfig } = useAppConfig();
  const { t } = useI18n();
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
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [projectRoot, setProjectRoot] = useState(() => localStorage.getItem(PROJECT_ROOT_KEY) || '');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [newestMsgId, setNewestMsgId] = useState<string | null>(null);
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallInfo[]>([]);
  const toolCallsRef = useRef<ToolCallInfo[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const streamingRef = useRef('');
  const [isDragOver, setIsDragOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Confirm dialog state (replaces native window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // Stream timeout tracking
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const STREAM_TIMEOUT_MS = 60000; // 60s without any chunk = timeout

  const { providers: allProviders } = useDynamicProviders();
  const currentProvider = allProviders.find(p => p.key === config.providerKey);
  const projectRootName = projectRoot.split(/[/\\]/).filter(Boolean).pop() || '';

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

  // Listen for streaming chunks + status events
  useEffect(() => {
    if (!window.electronAPI) return;
    const api = window.electronAPI as any;

    // Stream text chunks from agent response
    api.onChatStream?.((chunk: string) => {
      streamingRef.current += chunk;
      setStreamingContent(streamingRef.current);
      // Switch to generating status when we start receiving text
      setAgentStatus('generating');
      // Reset stream timeout on each chunk
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      streamTimeoutRef.current = setTimeout(() => {
        // No chunk received for STREAM_TIMEOUT_MS — treat as stalled
        setAgentStatus('error');
      }, STREAM_TIMEOUT_MS);
    });

    // Status events (agent lifecycle + tool calls + gateway auto-start)
    api.onChatStatus?.((status: { type: string; tool?: string; toolStatus?: string; toolId?: string; message?: string }) => {
      if (status.type === 'gateway') {
        // Gateway auto-start status — show as thinking with a message
        setAgentStatus('thinking');
      } else if (status.type === 'thinking' || status.type === 'generating' || status.type === 'error') {
        setAgentStatus(status.type as AgentStatus);
      } else if (status.type === 'tool_call' && status.tool) {
        const tc: ToolCallInfo = {
          id: status.toolId || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: status.tool,
          status: (status.toolStatus as ToolCallInfo['status']) || 'running',
          timestamp: Date.now(),
        };
        toolCallsRef.current = [...toolCallsRef.current, tc];
        setActiveToolCalls([...toolCallsRef.current]);
      } else if (status.type === 'tool_update' && status.toolId) {
        toolCallsRef.current = toolCallsRef.current.map(tc =>
          tc.id === status.toolId ? { ...tc, status: (status.toolStatus as ToolCallInfo['status']) || 'completed' } : tc
        );
        setActiveToolCalls([...toolCallsRef.current]);
      }
    });
  }, []);

  // Listen for tray "New Chat" action
  useEffect(() => {
    if (!window.electronAPI) return;
    (window.electronAPI as any).onTrayNewChat?.(() => handleNewSession());
  }, []);

  // Persist sessions
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    if (activeSessionId) localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    if (projectRoot) localStorage.setItem(PROJECT_ROOT_KEY, projectRoot);
    else localStorage.removeItem(PROJECT_ROOT_KEY);
  }, [projectRoot]);

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

  const handleSelectProjectRoot = async () => {
    const result = await (window.electronAPI as any)?.selectDirectory?.();
    if (result?.directoryPath) setProjectRoot(result.directoryPath);
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || agentStatus !== 'idle') return;

    const fullMessage = text;
    const filePaths = attachedFiles.length > 0 ? attachedFiles.map(f => f.path) : undefined;

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
    toolCallsRef.current = [];
    setActiveToolCalls([]);
    streamingRef.current = '';
    setStreamingContent('');
    // Start overall stream timeout from first send
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = setTimeout(() => {
      setAgentStatus('error');
    }, STREAM_TIMEOUT_MS);

    if (window.electronAPI) {
      // Model is configured via openclaw.json (synced by store.ts), not passed per-message.
      const result = await (window.electronAPI as any).chatSend(fullMessage, activeSessionId, {
        thinkingLevel: config.thinkingLevel || 'low',
        files: filePaths,
        workspacePath: projectRoot || undefined,
      });
      // Prefer streamed content if available, fallback to full response
      const responseText = streamingRef.current.trim() || result.text || result.error || t('chat.noResponse') || 'No response';

      const assistantMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        model: config.modelId,
        toolCalls: toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined,
      };

      setNewestMsgId(assistantMsg.id);
      updateSession(activeSessionId, s => ({
        ...s,
        messages: [...s.messages, assistantMsg],
        updatedAt: Date.now(),
      }));
      // Track usage for cost estimation
      trackUsage(config.providerKey, config.modelId, text, responseText);
      // Clear streaming state and timeout
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      streamingRef.current = '';
      setStreamingContent('');
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

  const attachFiles = useCallback(async (newFiles: { name: string; path: string }[]) => {
    const withPreviews: AttachedFile[] = await Promise.all(
      newFiles.map(async f => {
        if (window.electronAPI) {
          const preview = await (window.electronAPI as any).filePreview(f.path);
          return { ...f, preview };
        }
        return f;
      })
    );
    setAttachedFiles(prev => [...prev, ...withPreviews]);
  }, []);

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).map(f => ({ name: f.name, path: (f as any).path || f.name }));
    attachFiles(files);
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

  const statusLabel = agentStatus === 'thinking' ? t('chat.status.thinking') :
    agentStatus === 'generating' ? t('chat.status.generating') :
    agentStatus === 'error' ? t('chat.status.error') : null;

  return (
    <div className="h-full flex relative"
      onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={e => { if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false); }}
      onDrop={e => { handleFileDrop(e); setIsDragOver(false); }}
    >
      {/* Custom confirm dialog */}
      {confirmDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] p-8">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xs p-5 space-y-4">
            <p className="text-sm text-slate-200">{confirmDialog.message}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmDialog(null)}
                className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200"
              >
                {t('common.cancel', 'Cancel')}
              </button>
              <button
                onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                {t('common.delete', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Session sidebar */}
      {showSidebar && (
        <div className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col flex-shrink-0">
          <div className="p-3 border-b border-slate-800">
            <button onClick={handleNewSession} className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-brand-600 hover:bg-brand-500 rounded-lg text-sm text-white transition-colors">
              <Plus size={14} /> {t('chat.newSession')}
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
                    aria-label="Rename session"
                    title="Rename session"
                    className="flex-1 bg-slate-700 px-1.5 py-0.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                    autoFocus
                  />
                ) : (
                  <span className="truncate flex-1">{s.title}</span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDialog({ message: t('chat.deleteSession', 'Delete this session?'), onConfirm: () => deleteSession(s.id) });
                  }}
                  aria-label={t('chat.deleteSession', 'Delete this session?')}
                  title={t('chat.deleteSession', 'Delete this session?')}
                  className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 p-0.5 ml-1"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Drop zone overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-brand-600/10 border-2 border-dashed border-brand-500/50 rounded-xl flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-2 text-brand-400">
            <Paperclip size={32} />
            <span className="text-sm font-medium">{t('chat.dropFiles')}</span>
          </div>
        </div>
      )}

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-4 py-2.5 border-b border-slate-800 flex items-center gap-2 flex-shrink-0">
          <button onClick={() => setShowSidebar(!showSidebar)}
            className="p-1.5 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-lg transition-colors"
            title={t('chat.sessionList', 'Session list')}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor"/><rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="currentColor"/><rect x="2" y="11.5" width="12" height="1.5" rx="0.75" fill="currentColor"/></svg>
          </button>

          <img src={logoUrl} alt="AwarenessClaw" className="w-6 h-6 rounded" />
          <h1 className="text-sm font-semibold">AwarenessClaw</h1>

          <button
            onClick={handleSelectProjectRoot}
            aria-label={projectRoot ? t('chat.workspace.change', 'Change folder') : t('chat.workspace.select', 'Choose folder')}
            className="ml-2 flex min-w-0 max-w-[280px] items-center gap-2 rounded-lg border border-slate-700/70 bg-slate-900 px-2.5 py-1.5 text-left transition-colors hover:border-slate-500 hover:bg-slate-800"
            title={projectRoot || t('chat.workspace.select', 'Choose folder')}
          >
            <FolderOpen size={12} className="shrink-0 text-sky-400" />
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">{t('chat.workspace.current', 'Project folder')}</div>
              <div className="truncate text-xs text-slate-200">{projectRootName || t('chat.workspace.none', 'No project folder selected')}</div>
            </div>
          </button>

          {/* Model selector */}
          <div className="relative ml-2">
            <button onClick={() => setShowModelSelector(!showModelSelector)}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-400 transition-colors"
            >
              {currentProvider?.emoji} {config.modelId || t('chat.selectModel', 'Select model')}
              <ChevronDown size={10} />
            </button>
            {showModelSelector && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelSelector(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-[400px] overflow-y-auto">
                  {allProviders.map(provider => {
                    const isConfigured = config.providerKey === provider.key && config.apiKey;
                    return (
                      <div key={provider.key}>
                        <div className="px-3 py-1.5 text-[10px] font-medium border-b border-slate-800 sticky top-0 bg-slate-900 flex items-center justify-between">
                          <span className="text-slate-500">{provider.emoji} {provider.name}</span>
                          {isConfigured ? <span className="text-emerald-500">✅</span> : provider.needsKey ? <span className="text-amber-500">🔑</span> : <span className="text-slate-600">{t('chat.free', 'Free')}</span>}
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
                                syncConfig(allProviders);
                                setShowModelSelector(false);
                              }
                            }}
                            className={`w-full text-left px-4 py-1.5 text-xs hover:bg-slate-800 transition-colors ${
                              config.providerKey === provider.key && config.modelId === model.id ? 'text-brand-400' : 'text-slate-300'
                            }`}
                          >
                            {model.label}
                            {config.providerKey === provider.key && config.modelId === model.id && (
                              <span className="ml-1 text-brand-400 font-medium">✓ {t('chat.active', 'Active')}</span>
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

          <div className="flex-1" />

          <button onClick={() => window.electronAPI?.openExternal('http://localhost:18789')}
            className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-500 hover:text-slate-300 bg-slate-800/50 rounded-lg transition-colors">
            <ExternalLink size={10} /> Dashboard
          </button>
        </div>

        {/* API Key Input Modal */}
        {showApiKeyInput && (() => {
          const provider = allProviders.find(p => p.key === showApiKeyInput);
          return (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-8">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-sm p-6 space-y-4">
                <div className="text-center">
                  <span className="text-2xl">{provider?.emoji}</span>
                  <h3 className="text-sm font-bold mt-2">{t('chat.configModel', 'Configure')} {provider?.name}</h3>
                  <p className="text-xs text-slate-500 mt-1">{t('chat.configModelHint', 'Enter your API Key to start')}</p>
                </div>
                <PasswordInput
                  value={tempApiKey}
                  onChange={e => setTempApiKey(e.target.value)}
                  placeholder="Paste your API Key..."
                  className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={() => setShowApiKeyInput(null)} className="flex-1 py-2 text-sm text-slate-400 hover:text-slate-200">{t('common.cancel', 'Cancel')}</button>
                  <button
                    onClick={() => {
                      if (tempApiKey && provider) {
                        updateConfig({
                          providerKey: provider.key,
                          modelId: provider.models[0]?.id || '',
                          apiKey: tempApiKey,
                          baseUrl: provider.baseUrl,
                        });
                        syncConfig(allProviders);
                        setShowApiKeyInput(null);
                      }
                    }}
                    disabled={!tempApiKey}
                    className="flex-1 py-2 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-lg text-sm transition-colors"
                  >
                    {t('setup.saveAndSwitch', 'Save & Switch')}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div className="max-w-3xl mx-auto space-y-5 w-full">
          {messages.length === 0 && agentStatus === 'idle' && (
            <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-6">
              <img src={logoUrl} alt="" className="w-16 h-16 opacity-30" />
              {!config.modelId ? (
                <div className="text-center space-y-3">
                  <p className="text-base mb-1">{t('chat.selectModel') || 'Select a model to start chatting'}</p>
                  <button
                    onClick={() => setShowModelSelector(true)}
                    className="px-4 py-2 text-sm bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors"
                  >
                    {t('chat.selectModelBtn') || 'Choose Model'}
                  </button>
                </div>
              ) : (
                <>
                  <div className="text-center">
                    <p className="text-base mb-1">{t('chat.empty.title')}</p>
                    <p className="text-xs text-slate-600">{t('chat.empty.subtitle')}</p>
                  </div>
                  <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-sky-500/10 p-2 text-sky-400">
                        <FolderOpen size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{t('chat.workspace.current', 'Project folder')}</div>
                        <div className="mt-1 truncate text-sm text-slate-200">{projectRoot || t('chat.workspace.none', 'No project folder selected')}</div>
                        <p className="mt-1 text-xs text-slate-500">{t('chat.workspace.hint', 'AI file edits will run inside this local project folder')}</p>
                      </div>
                      <button
                        onClick={handleSelectProjectRoot}
                        className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-700"
                      >
                        {projectRoot ? t('chat.workspace.change', 'Change folder') : t('chat.workspace.select', 'Choose folder')}
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 max-w-lg justify-center">
                    {[t('chat.suggest.plan'), t('chat.suggest.review'), t('chat.suggest.analyze')].map(q => (
                      <button key={q} onClick={() => setInput(q)}
                        className="px-3 py-1.5 text-xs bg-slate-800/80 hover:bg-slate-700 rounded-xl text-slate-300 border border-slate-700/50 transition-colors"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {messages.map(msg => (
            msg.role === 'user' ? (
              /* User message — right-aligned bubble */
              <div key={msg.id} className="flex justify-end group">
                <div className="max-w-[75%]">
                  <div className="px-4 py-3 rounded-2xl rounded-br-md text-sm bg-brand-600 text-white">
                    {msg.files && msg.files.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {msg.files.map((f, i) => (
                          <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-black/20 rounded text-[10px]">
                            <File size={10} /> {f.name}
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  </div>
                  <div className="text-right mt-1">
                    <span className="text-[10px] text-slate-600">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </div>
            ) : (
              /* AI message — full-width row layout (Claude/ChatGPT style) */
              <div key={msg.id} className="group">
                <div className="flex gap-3">
                  <img src={logoUrl} alt="" className="w-7 h-7 rounded-lg mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {/* Meta line */}
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs text-slate-400 font-medium">AwarenessClaw</span>
                      {msg.model && <span className="text-[10px] text-slate-600">{msg.model}</span>}
                      <span className="text-[10px] text-slate-600">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    {/* Tool calls */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <ToolCallsBlock toolCalls={msg.toolCalls} />
                    )}

                    {/* Content — no bubble, direct text */}
                    <div className="text-sm text-slate-200 leading-relaxed">
                      <TypewriterMessage content={msg.content} isNew={msg.id === newestMsgId} />
                    </div>

                    {/* Action buttons */}
                    <div className="mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-3">
                      <button onClick={() => copyMessage(msg)}
                        className="text-slate-600 hover:text-slate-300 text-[10px] flex items-center gap-1 transition-colors"
                      >
                        {copiedId === msg.id ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          ))}

          {/* Streaming response or status indicator */}
          {agentStatus !== 'idle' && (
            <div className="group">
              <div className="flex gap-3">
                <img src={logoUrl} alt="" className={`w-7 h-7 rounded-lg mt-0.5 flex-shrink-0 ${agentStatus !== 'error' ? 'animate-pulse' : ''}`} />
                <div className="flex-1 min-w-0">
                  {/* Meta line */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-xs text-slate-400 font-medium">AwarenessClaw</span>
                    {config.modelId && <span className="text-[10px] text-slate-600">{config.modelId}</span>}
                  </div>

                  {/* Error / stalled state */}
                  {agentStatus === 'error' && (
                    <div className="flex items-center gap-2 text-sm text-red-400">
                      <AlertTriangle size={14} />
                      <span>{t('chat.status.error', 'Response timed out or failed')}</span>
                      <button
                        onClick={() => {
                          if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
                          streamingRef.current = '';
                          setStreamingContent('');
                          setAgentStatus('idle');
                        }}
                        className="ml-2 px-2 py-0.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                      >
                        {t('chat.dismiss', 'Dismiss')}
                      </button>
                    </div>
                  )}

                  {/* Tool calls section */}
                  {agentStatus !== 'error' && activeToolCalls.length > 0 && (
                    <div className="mb-2 space-y-1 pb-2 border-b border-slate-700/30">
                      {activeToolCalls.slice(-5).map(tc => (
                        <div key={tc.id} className="flex items-center gap-1.5 text-[11px] text-slate-500">
                          {tc.status === 'running' || tc.status === 'recalling' ? (
                            <Loader2 size={11} className="animate-spin text-brand-400/70" />
                          ) : (
                            <span className="text-emerald-500/70">{getToolIcon(tc.name)}</span>
                          )}
                          <span className="truncate max-w-[300px]">{getToolLabel(tc.name, tc.status)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Streaming text content — no bubble */}
                  {agentStatus !== 'error' && streamingContent ? (
                    <div className="text-sm text-slate-200 leading-relaxed">
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                          code({ children, className, ...props }) {
                            const isInline = !className;
                            if (isInline) return <code className="px-1.5 py-0.5 bg-slate-700 rounded text-brand-300 text-xs" {...props}>{children}</code>;
                            return <pre className="bg-slate-950 rounded-lg p-3 overflow-x-auto text-xs"><code className={className} {...props}>{children}</code></pre>;
                          },
                          p({ children }) { return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>; },
                        }}>
                          {streamingContent}
                        </ReactMarkdown>
                        <span className="animate-pulse text-brand-400">▊</span>
                      </div>
                    </div>
                  ) : agentStatus !== 'error' ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Loader2 size={14} className="animate-spin text-brand-400" />
                      <span>{statusLabel}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Attachments with preview */}
        {attachedFiles.length > 0 && (
          <div className="px-4 py-2 border-t border-slate-800/50 space-y-2 max-w-3xl mx-auto">
            <div className="flex gap-2 flex-wrap">
              {attachedFiles.map((f, i) => (
                <div key={i} className="bg-slate-800 rounded-lg border border-slate-700/50 overflow-hidden max-w-[240px]">
                  {/* Image preview */}
                  {f.preview?.type === 'image' && f.preview.dataUri && (
                    <div className="w-full h-24 bg-slate-900 flex items-center justify-center">
                      <img src={f.preview.dataUri} alt={f.name} className="max-w-full max-h-24 object-contain" />
                    </div>
                  )}
                  {/* Text preview */}
                  {f.preview?.type === 'text' && f.preview.content && (
                    <div className="px-2 py-1.5 bg-slate-900 max-h-20 overflow-hidden">
                      <pre className="text-[9px] text-slate-500 font-mono leading-tight whitespace-pre-wrap">{f.preview.content.slice(0, 200)}</pre>
                      {f.preview.truncated && <span className="text-[9px] text-slate-600">...</span>}
                    </div>
                  )}
                  {/* File info bar */}
                  <div className="flex items-center gap-1.5 px-2 py-1">
                    {f.preview?.type === 'image' ? <Image size={10} className="text-brand-400" /> : <File size={10} className="text-slate-400" />}
                    <span className="text-[10px] text-slate-300 truncate flex-1">{f.name}</span>
                    {f.preview?.size && <span className="text-[9px] text-slate-600">{(f.preview.size / 1024).toFixed(0)}KB</span>}
                    <button
                      onClick={() => setAttachedFiles(prev => prev.filter((_, j) => j !== i))}
                      aria-label={`Remove ${f.name}`}
                      title={`Remove ${f.name}`}
                      className="text-slate-500 hover:text-red-400 flex-shrink-0"
                    >
                      <X size={10} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-slate-800">
          <div className="flex items-end gap-2 max-w-3xl mx-auto">
            <button onClick={() => fileInputRef.current?.click()}
              aria-label={t('chat.attachFile', 'Attach file')}
              className="p-2.5 text-slate-500 hover:text-slate-300 hover:bg-slate-800 rounded-xl transition-colors" title={t('chat.attachFile', 'Attach file')}
            >
              <Paperclip size={16} />
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden" aria-label={t('chat.attachFile', 'Attach file')}
              onChange={e => { const files = Array.from(e.target.files || []).map(f => ({ name: f.name, path: (f as any).path || f.name })); attachFiles(files); }}
            />

            <div className="flex-1 relative">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  agentStatus === 'thinking' ? t('chat.input.waiting', 'Agent is thinking...') :
                  agentStatus === 'generating' ? t('chat.input.generating', 'Generating response...') :
                  t('chat.input.placeholder')
                }
                rows={1}
                className="w-full px-4 py-2.5 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-brand-500/50 resize-none transition-all placeholder:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
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
