import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Paperclip, ChevronDown, ChevronRight, ExternalLink, Loader2, Copy, Check, X, File, Image, Plus, Brain, Key, Wrench, Search, BookOpen, Save, Zap, CheckCircle2, Terminal, AlertTriangle, FolderOpen, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppConfig, useDynamicProviders, getProviderProfile, hasProviderCredentials } from '../lib/store';
import { trackUsage } from '../lib/usage';
import { useI18n } from '../lib/i18n';
import BootstrapWizard from '../components/BootstrapWizard';
import ChannelIcon from '../components/ChannelIcon';
import logoUrl from '../assets/logo.png';

// --- Types ---

interface ToolCallInfo {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'approved' | 'recalling' | 'saving' | 'cached' | 'awaiting_approval' | 'failed';
  timestamp: number;
  detail?: string;
  approvalRequestId?: string;
  approvalCommand?: string;
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
  thinking?: string;
}

interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

interface ChannelSession {
  sessionKey: string;
  sessionId: string;
  channel: string;
  displayName: string;
  status: string;
  updatedAt: number;
  model?: string;
}

interface ChannelMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  model?: string;
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

function getToolLabel(name: string, status: string, t: (key: string, fallback?: string) => string) {
  if (status === 'awaiting_approval') return `${name}: ${t('tool.status.awaitingApproval', 'Awaiting approval')}`;
  if (status === 'recalling') return `${name}: ${t('tool.status.recalling', 'Recalling context...')}`;
  if (status === 'saving') return `${name}: ${t('tool.status.saving', 'Saving memory...')}`;
  if (status === 'cached') return `${name}: ${t('tool.status.cached', 'Signals cached')}`;
  if (status === 'approved') return `${name}: ${t('tool.status.approved', 'Approved')}`;
  if (status === 'completed') return `${name}: ${t('tool.status.completed', 'Done')}`;
  if (status === 'failed') return `${name}: ${t('tool.status.failed', 'Failed')}`;
  if (status === 'running' || status === 'in_progress') return `${name}: ${t('tool.status.running', 'Running...')}`;
  return `${name}: ${status}`;
}

// --- Code block with language label + copy button ---

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyCode = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const lang = language?.replace(/^language-/, '') || '';
  return (
    <div className="rounded-xl overflow-hidden border border-slate-700/60 my-2 text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-slate-800/80 border-b border-slate-700/50">
        <span className="text-[10px] text-slate-500 font-mono uppercase tracking-wide">{lang || t('code.label', 'code')}</span>
        <button
          onClick={copyCode}
          className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
        >
          {copied ? <><Check size={10} /> {t('common.copied', 'copied')}</> : <><Copy size={10} /> {t('common.copy', 'copy')}</>}
        </button>
      </div>
      <pre className="bg-slate-950 p-3 overflow-x-auto leading-relaxed">
        <code className={language}>{code}</code>
      </pre>
    </div>
  );
}

// --- Tool calls in message (collapsible with animation) ---

function ToolCallsBlock({
  toolCalls,
  onApprove,
  onCopyApproval,
  onStopRequest,
}: {
  toolCalls: ToolCallInfo[];
  onApprove?: (toolCall: ToolCallInfo) => void;
  onCopyApproval?: (toolCall: ToolCallInfo) => void;
  onStopRequest?: () => void;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!toolCalls || toolCalls.length === 0) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <Wrench size={11} />
        <span>{t('tool.used', '{0} tool(s) used').replace('{0}', String(toolCalls.length))}</span>
      </button>
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: expanded ? '420px' : '0px' }}
      >
        <div className="mt-1.5 ml-4 space-y-1 border-l border-slate-700/50 pl-3">
          {toolCalls.map(tc => (
            <div key={tc.id} className="text-[11px] text-slate-500">
              <div className="flex items-center gap-1.5">
                {tc.status === 'failed' ? (
                  <AlertTriangle size={11} className="text-amber-400/80" />
                ) : tc.status === 'awaiting_approval' ? (
                  <Loader2 size={11} className="animate-spin text-brand-400/70" />
                ) : (
                  <CheckCircle2 size={11} className="text-emerald-500/70" />
                )}
                <span>{getToolLabel(tc.name, tc.status, t)}</span>
              </div>
              {tc.detail && (
                <div className="ml-[17px] mt-0.5 text-[10px] text-slate-500/80 break-all">{tc.detail}</div>
              )}
              {tc.status === 'awaiting_approval' && (
                <div className="ml-[17px] mt-1 flex flex-wrap gap-2">
                  <button
                    onClick={() => onApprove?.(tc)}
                    className="px-2 py-0.5 rounded-md bg-brand-600/20 hover:bg-brand-600/30 border border-brand-500/30 text-brand-200 text-[10px] transition-colors"
                  >
                    {t('chat.approveOnce', 'Approve once')}
                  </button>
                  <button
                    onClick={() => onCopyApproval?.(tc)}
                    className="px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-[10px] transition-colors"
                  >
                    {t('chat.copyApprovalCommand', 'Copy approval command')}
                  </button>
                  <button
                    onClick={() => onStopRequest?.()}
                    className="px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-red-500/10 border border-slate-700/60 hover:border-red-500/30 text-slate-300 hover:text-red-300 text-[10px] transition-colors"
                  >
                    {t('chat.stopRequest', 'Stop request')}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- Thinking block in message (collapsible) ---

function ThinkingBlock({ thinking }: { thinking: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  if (!thinking) return null;

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <Brain size={11} />
        <span>{t('thinking.label', 'Thinking process')}</span>
      </button>
      <div
        className="overflow-hidden transition-all duration-200"
        style={{ maxHeight: expanded ? '400px' : '0px' }}
      >
        <div className="mt-1.5 ml-4 pl-3 border-l border-purple-500/30 max-h-[380px] overflow-y-auto">
          <p className="text-[11px] text-slate-400 leading-relaxed whitespace-pre-wrap">{thinking}</p>
        </div>
      </div>
    </div>
  );
}

function LiveThinkingBlock({
  thinking,
  expanded,
  onToggle,
}: {
  thinking: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  if (!thinking) return null;

  return (
    <div className="mb-2 pb-2 border-b border-slate-700/30">
      <button
        onClick={onToggle}
        className="flex items-center gap-1.5 text-[11px] text-purple-400/80 hover:text-purple-300 transition-colors"
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <Brain size={11} />
        <span>{t('thinking.label', 'Thinking process')}</span>
        <Loader2 size={10} className="animate-spin opacity-70" />
      </button>
      {expanded && (
        <div className="mt-1.5 ml-4 pl-3 border-l border-purple-500/20 max-h-[150px] overflow-y-auto">
          <p className="text-[11px] text-slate-500 leading-relaxed whitespace-pre-wrap">{thinking}</p>
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

// --- Typewriter effect (RAF-based, low CPU) ---

function useTypewriter(text: string, charsPerFrame = 3) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!text) { setDisplayed(''); setDone(true); return; }
    setDone(false);
    let i = 0;
    let cancelled = false;
    let lastTime = 0;
    const minInterval = 30; // ms between updates — ~33 FPS max, gentle on CPU

    const finish = () => { setDisplayed(text); setDone(true); };

    // When app is hidden (user switched to another app), skip animation
    const onVisibility = () => { if (document.hidden) { cancelled = true; finish(); } };
    document.addEventListener('visibilitychange', onVisibility);

    const step = (time: number) => {
      if (cancelled) return;
      if (time - lastTime < minInterval) { requestAnimationFrame(step); return; }
      lastTime = time;
      i += charsPerFrame + Math.floor(Math.random() * 2);
      if (i >= text.length) {
        finish();
      } else {
        setDisplayed(text.slice(0, i));
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [text, charsPerFrame]);

  return { displayed, done };
}

// --- Typewriter Message Component ---

function TypewriterMessage({ content, isNew }: { content: string; isNew: boolean }) {
  const { displayed, done } = useTypewriter(isNew ? content : '', 3);
  const text = isNew ? displayed : content;

  return (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ children, className, ...props }) {
            const isInline = !className;
            if (isInline) {
              return <code className="px-1.5 py-0.5 bg-slate-700/80 rounded text-brand-300 text-[12px]" {...props}>{children}</code>;
            }
            return <CodeBlock code={String(children).replace(/\n$/, '')} language={className} />;
          },
          p({ children }) { return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>; },
          ul({ children }) { return <ul className="list-disc list-inside mb-3 space-y-1.5 pl-1">{children}</ul>; },
          ol({ children }) { return <ol className="list-decimal list-inside mb-3 space-y-1.5 pl-1">{children}</ol>; },
          h1({ children }) { return <h3 className="text-base font-bold mb-2 mt-4 pb-1 border-b border-slate-700/50">{children}</h3>; },
          h2({ children }) { return <h4 className="text-sm font-bold mb-2 mt-3">{children}</h4>; },
          h3({ children }) { return <h5 className="text-sm font-semibold mb-1.5 mt-2">{children}</h5>; },
          blockquote({ children }) { return <blockquote className="border-l-2 border-brand-500/40 pl-3 text-slate-400 italic my-2">{children}</blockquote>; },
          table({ children }) { return <div className="overflow-x-auto my-3"><table className="text-xs w-full border-collapse">{children}</table></div>; },
          th({ children }) { return <th className="px-3 py-1.5 bg-slate-800 text-left font-medium border border-slate-700/50">{children}</th>; },
          td({ children }) { return <td className="px-3 py-1.5 border border-slate-700/30">{children}</td>; },
        }}
      >
        {text}
      </ReactMarkdown>
      {isNew && !done && <span className="animate-pulse text-brand-400 ml-0.5">▊</span>}
    </div>
  );
}

// --- Main Component ---

export default function Dashboard({ isActive = true, onNavigate }: { isActive?: boolean; onNavigate?: (page: 'chat' | 'memory' | 'channels' | 'skills' | 'automation' | 'agents' | 'settings') => void }) {
  const { config, syncConfig, selectModel } = useAppConfig();
  const { t } = useI18n();
  const [sessions, setSessions] = useState<ChatSession[]>(loadSessions);
  const [activeSessionId, setActiveSessionId] = useState<string>(
    localStorage.getItem(ACTIVE_SESSION_KEY) || ''
  );
  const [input, setInput] = useState('');
  const [agentStatus, setAgentStatus] = useState<AgentStatus>('idle');
  const [showModelSelector, setShowModelSelector] = useState(false);
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
  const [thinkingContent, setThinkingContent] = useState('');
  const thinkingRef = useRef('');
  const [liveThinkingExpanded, setLiveThinkingExpanded] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Channel conversations (unified inbox)
  const [channelSessions, setChannelSessions] = useState<ChannelSession[]>([]);
  const [activeChannelKey, setActiveChannelKey] = useState<string | null>(null);
  const [channelMessages, setChannelMessages] = useState<ChannelMessage[]>([]);
  const [channelLoading, setChannelLoading] = useState(false);
  const [channelReplyText, setChannelReplyText] = useState('');
  const [channelReplying, setChannelReplying] = useState(false);
  // Confirm dialog state (replaces native window.confirm)
  const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
  // Stream timeout tracking
  const streamTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const STREAM_TIMEOUT_MS = 60000; // 60s without any chunk = timeout
  // Agent selector state
  const [agents, setAgents] = useState<Array<{ id: string; name: string; emoji: string; isDefault?: boolean }>>([]);
  const [showAgentMenu, setShowAgentMenu] = useState(false);
  const agentMenuRef = useRef<HTMLDivElement>(null);
  // Bootstrap onboarding
  const [showBootstrap, setShowBootstrap] = useState(false);
  // Memory warning toast
  const [memoryWarning, setMemoryWarning] = useState<string | null>(null);
  const memoryWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

    // Debug: forward main-process gateway events to DevTools console
    api.onChatDebug?.((msg: string) => {
      console.log(msg);
    });

    // Thinking content from agent reasoning
    api.onChatThinking?.((text: string) => {
      const hadThinking = !!thinkingRef.current;
      thinkingRef.current = text;
      setThinkingContent(text);
      if (!hadThinking && text) setLiveThinkingExpanded(true);
    });

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
    api.onChatStatus?.((status: { type: string; tool?: string; toolStatus?: string; toolId?: string; message?: string; detail?: string; approvalRequestId?: string; approvalCommand?: string }) => {
      if (status.type === 'gateway') {
        // Gateway auto-start status — show as thinking with a message
        setAgentStatus('thinking');
      } else if (status.type === 'thinking' || status.type === 'generating' || status.type === 'error') {
        setAgentStatus(status.type as AgentStatus);
      } else if ((status.type === 'tool_call' || status.type === 'tool_approval') && status.tool) {
        const tc: ToolCallInfo = {
          id: status.toolId || `tc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: status.tool,
          status: (status.toolStatus as ToolCallInfo['status']) || 'running',
          timestamp: Date.now(),
          detail: status.detail,
          approvalRequestId: status.approvalRequestId,
          approvalCommand: status.approvalCommand,
        };
        const existingIdx = toolCallsRef.current.findIndex(existing => existing.id === tc.id);
        if (existingIdx >= 0) {
          toolCallsRef.current = toolCallsRef.current.map(existing =>
            existing.id === tc.id ? { ...existing, ...tc } : existing
          );
        } else {
          toolCallsRef.current = [...toolCallsRef.current, tc];
        }
        setActiveToolCalls([...toolCallsRef.current]);
      } else if (status.type === 'tool_update' && status.toolId) {
        toolCallsRef.current = toolCallsRef.current.map(tc =>
          tc.id === status.toolId ? {
            ...tc,
            status: (status.toolStatus as ToolCallInfo['status']) || 'completed',
            detail: status.detail || tc.detail,
          } : tc
        );
        setActiveToolCalls([...toolCallsRef.current]);
      }
    });
  }, []);

  useEffect(() => {
    if (!thinkingContent) return;
    if (streamingContent || activeToolCalls.length > 0 || agentStatus === 'generating' || agentStatus === 'idle') {
      setLiveThinkingExpanded(false);
    }
  }, [thinkingContent, streamingContent, activeToolCalls.length, agentStatus]);

  // Listen for tray "New Chat" action
  useEffect(() => {
    if (!window.electronAPI) return;
    (window.electronAPI as any).onTrayNewChat?.(() => handleNewSession());
  }, []);

  // Listen for memory-warning events from main process
  useEffect(() => {
    if (!window.electronAPI) return;
    const api = window.electronAPI as any;
    api.onMemoryWarning?.((payload: { type: string; message: string }) => {
      setMemoryWarning(payload.message || 'Memory save failed');
      if (memoryWarningTimerRef.current) clearTimeout(memoryWarningTimerRef.current);
      memoryWarningTimerRef.current = setTimeout(() => setMemoryWarning(null), 3000);
    });
    return () => {
      if (memoryWarningTimerRef.current) clearTimeout(memoryWarningTimerRef.current);
    };
  }, []);

  // Load channel sessions from Gateway + listen for real-time channel messages
  useEffect(() => {
    if (!window.electronAPI) return;
    const api = window.electronAPI as any;

    // Load channel sessions on mount
    api.channelSessions?.().then((res: any) => {
      if (res?.success && res.sessions?.length > 0) {
        setChannelSessions(res.sessions);
      }
    }).catch(() => {});

    // Real-time channel message listener
    api.onChannelMessage?.((msg: { sessionKey: string; message: any }) => {
      if (!msg.sessionKey) return;
      // Update channel sessions list (bump updatedAt)
      setChannelSessions(prev => prev.map(s =>
        s.sessionKey === msg.sessionKey ? { ...s, updatedAt: Date.now() } : s
      ));
      // If this channel is currently viewed, append the message
      setActiveChannelKey(currentKey => {
        if (currentKey === msg.sessionKey && msg.message) {
          const content = Array.isArray(msg.message.content)
            ? msg.message.content.map((c: any) => c.text || '').join('')
            : (msg.message.content || '');
          const newMsg: ChannelMessage = {
            id: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
            role: msg.message.role || 'assistant',
            content,
            timestamp: msg.message.timestamp || Date.now(),
            model: msg.message.model,
          };
          setChannelMessages(prev => [...prev, newMsg]);
        }
        return currentKey;
      });
    });
  }, []);

  // Load channel history when a channel session is selected
  useEffect(() => {
    if (!activeChannelKey || !window.electronAPI) return;
    setChannelLoading(true);
    const api = window.electronAPI as any;
    api.channelHistory?.(activeChannelKey).then((res: any) => {
      if (res?.success) {
        setChannelMessages(res.messages || []);
      }
    }).catch(() => {}).finally(() => setChannelLoading(false));
  }, [activeChannelKey]);

  // ⌘N / Ctrl+N — new session from anywhere in the chat view
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault();
        handleNewSession();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load agents list + detect bootstrap needed
  useEffect(() => {
    const api = window.electronAPI as any;
    if (!api) return;
    // Load agents
    api.agentsList?.().then((res: any) => {
      if (res?.success && res.agents?.length > 0) {
        setAgents(res.agents.map((a: any) => ({
          id: a.id, name: a.name || a.id, emoji: a.emoji || '🤖', isDefault: a.isDefault,
        })));
      }
    }).catch(() => {});
    // Check if bootstrap has been completed
    if (!config.bootstrapCompleted) {
      // Check if USER.md exists — if so, bootstrap was already done externally
      api.workspaceReadFile?.('USER.md').then((res: any) => {
        if (res?.exists && res.content?.trim()) {
          updateConfig({ bootstrapCompleted: true });
        } else {
          setShowBootstrap(true);
        }
      }).catch(() => setShowBootstrap(true));
    }
  }, []);

  // Close agent menu on outside click
  useEffect(() => {
    if (!showAgentMenu) return;
    const handler = (e: MouseEvent) => {
      if (agentMenuRef.current && !agentMenuRef.current.contains(e.target as Node)) {
        setShowAgentMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAgentMenu]);

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

  // When tab becomes active again, restore focus + scroll to bottom
  useEffect(() => {
    if (!isActive) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    if (agentStatus === 'idle') {
      // Small delay so the hidden→visible transition completes first
      const t = setTimeout(() => textareaRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isActive]);

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

  // --- Send message — Gateway handles queuing via its Command Queue (collect mode) ---

  const sendingRef = useRef(false);
  const [isSending, setIsSending] = useState(false);

  const canSendMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    return trimmed.length > 0 && !sendingRef.current && !isSending && agentStatus === 'idle';
  }, [agentStatus, isSending]);

  const runChatRequest = useCallback(async (
    text: string,
    options?: { userText?: string; files?: AttachedFile[]; clearComposer?: boolean }
  ) => {
    const trimmed = text.trim();
    if (!canSendMessage(trimmed)) return;
    sendingRef.current = true;
    setIsSending(true);

    const pendingFiles = options?.files ?? attachedFiles;
    const userText = options?.userText ?? trimmed;
    const filePaths = pendingFiles.length > 0 ? pendingFiles.map(f => f.path) : undefined;

    // Add user message to session immediately (visible in chat)
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: userText,
      timestamp: Date.now(),
      files: pendingFiles.length > 0 ? [...pendingFiles] : undefined,
    };
    updateSession(activeSessionId, s => ({
      ...s,
      messages: [...s.messages, userMsg],
      title: s.messages.length === 0 ? userText.slice(0, 30) : s.title,
      updatedAt: Date.now(),
    }));
    if (options?.clearComposer !== false) {
      setInput('');
      setAttachedFiles([]);
      if (textareaRef.current) {
        textareaRef.current.style.height = '52px';
      }
    }

    // Reset streaming state
    setAgentStatus('thinking');
    toolCallsRef.current = [];
    setActiveToolCalls([]);
    streamingRef.current = '';
    setStreamingContent('');
    thinkingRef.current = '';
    setThinkingContent('');
    setLiveThinkingExpanded(true);
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = setTimeout(() => { setAgentStatus('error'); }, STREAM_TIMEOUT_MS);

    if (window.electronAPI) {
      try {
      const result = await (window.electronAPI as any).chatSend(trimmed, activeSessionId, {
        thinkingLevel: config.thinkingLevel || 'low',
        files: filePaths,
        workspacePath: projectRoot || undefined,
        agentId: config.selectedAgentId || 'main',
      });
      const responseText = streamingRef.current.trim()
        || result.text
        || result.error
        || (result.awaitingApproval ? t('chat.awaitingApprovalResponse', 'Waiting for tool approval before the agent can continue') : t('chat.noResponse') || 'No response');

      const assistantMsg: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: responseText,
        timestamp: Date.now(),
        model: config.modelId,
        toolCalls: toolCallsRef.current.length > 0 ? [...toolCallsRef.current] : undefined,
        thinking: thinkingRef.current || undefined,
      };

      setNewestMsgId(assistantMsg.id);
      updateSession(activeSessionId, s => ({
        ...s,
        messages: [...s.messages, assistantMsg],
        updatedAt: Date.now(),
      }));
      trackUsage(config.providerKey, config.modelId, trimmed, responseText);
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      streamingRef.current = '';
      setStreamingContent('');
      thinkingRef.current = '';
      setThinkingContent('');
      setLiveThinkingExpanded(false);
      setAgentStatus('idle');
      } finally {
        sendingRef.current = false;
        setIsSending(false);
      }
    }
  }, [activeSessionId, attachedFiles, canSendMessage, config.modelId, config.providerKey, config.selectedAgentId, config.thinkingLevel, projectRoot, t, updateSession]);

  const canSendCurrentMessage = canSendMessage(input);

  const handleSend = async () => {
    if (!canSendCurrentMessage) return;
    await runChatRequest(input);
  };

  const handleApproveTool = useCallback(async (toolCall: ToolCallInfo) => {
    if (!toolCall.approvalCommand) return;
    await runChatRequest(toolCall.approvalCommand, {
      userText: toolCall.approvalCommand,
      files: [],
      clearComposer: false,
    });
  }, [runChatRequest]);

  const handleCopyApproval = useCallback((toolCall: ToolCallInfo) => {
    if (!toolCall.approvalCommand) return;
    navigator.clipboard.writeText(toolCall.approvalCommand);
  }, []);

  const handleStopActiveRequest = useCallback(async () => {
    await (window.electronAPI as any)?.chatAbort?.(activeSessionId);
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
    setAgentStatus('idle');
  }, [activeSessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!canSendMessage((e.currentTarget as HTMLTextAreaElement).value)) return;
    void handleSend();
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

  const handleChannelReply = async () => {
    const text = channelReplyText.trim();
    if (!text || !activeChannelKey || channelReplying) return;
    setChannelReplying(true);
    // Optimistically add the user message
    const userMsg: ChannelMessage = {
      id: `ch-reply-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    setChannelMessages(prev => [...prev, userMsg]);
    setChannelReplyText('');
    try {
      const api = window.electronAPI as any;
      await api.channelReply?.(activeChannelKey, text);
    } catch { /* Gateway will handle delivery */ }
    setChannelReplying(false);
  };

  const handleBackToLocal = () => {
    setActiveChannelKey(null);
    setChannelMessages([]);
  };

  const refreshChannelSessions = () => {
    const api = window.electronAPI as any;
    api.channelSessions?.().then((res: any) => {
      if (res?.success) setChannelSessions(res.sessions || []);
    }).catch(() => {});
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
          <div className="p-2.5 border-b border-slate-800">
            <button
              onClick={handleNewSession}
              title={`${t('chat.newSession')} (⌘N)`}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 text-slate-400 hover:text-slate-200 transition-all group"
            >
              <div className="flex items-center gap-2">
                <div className="w-5 h-5 rounded-md bg-brand-600/20 group-hover:bg-brand-600/30 flex items-center justify-center transition-colors flex-shrink-0">
                  <Plus size={12} className="text-brand-400" />
                </div>
                <span className="text-sm">{t('chat.newSession')}</span>
              </div>
              <kbd className="hidden sm:inline text-[10px] text-slate-600 group-hover:text-slate-500 font-sans px-1.5 py-0.5 rounded bg-slate-700/50 border border-slate-600/50 leading-none">
                ⌘N
              </kbd>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {/* Channel sessions group */}
            {channelSessions.length > 0 && (
              <>
                <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-wider text-slate-600 font-medium">Channels</span>
                  <button onClick={refreshChannelSessions} className="text-slate-600 hover:text-slate-400 p-0.5" title="Refresh">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.76-4.24L10 6h6V0l-2.35 2.35z" fill="currentColor"/></svg>
                  </button>
                </div>
                {channelSessions.map(cs => (
                  <div
                    key={cs.sessionKey}
                    onClick={() => { setActiveChannelKey(cs.sessionKey); setActiveSessionId(''); }}
                    className={`w-full text-left px-3 py-2 text-sm border-b border-slate-800/50 transition-colors cursor-pointer flex items-center gap-2 ${
                      activeChannelKey === cs.sessionKey ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                    }`}
                  >
                    <ChannelIcon channelId={cs.channel} size={16} />
                    <span className="truncate flex-1 text-xs">{cs.displayName || cs.channel}</span>
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cs.status === 'running' ? 'bg-green-400 animate-pulse' : 'bg-slate-600'}`} />
                  </div>
                ))}
                <div className="px-3 pt-2.5 pb-1">
                  <span className="text-[10px] uppercase tracking-wider text-slate-600 font-medium">Local</span>
                </div>
              </>
            )}
            {/* Local sessions */}
            {sessions.map(s => (
              <div
                key={s.id}
                onClick={() => { setActiveSessionId(s.id); setActiveChannelKey(null); setNewestMsgId(null); }}
                onDoubleClick={() => { setRenamingId(s.id); setRenameValue(s.title); }}
                className={`w-full text-left px-3 py-2.5 text-sm border-b border-slate-800/50 transition-colors group flex items-center justify-between cursor-pointer ${
                  s.id === activeSessionId && !activeChannelKey ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
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
                    aria-label={t('chat.renameSession', 'Rename session')}
                    title={t('chat.renameSession', 'Rename session')}
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
        {/* Header — compact single-row layout */}
        <div className="px-3 py-1.5 border-b border-slate-800/80 flex items-center gap-1.5 flex-shrink-0 h-10">
          <button onClick={() => setShowSidebar(!showSidebar)}
            className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors"
            title={t('chat.sessionList', 'Session list')}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="1.5" rx="0.75" fill="currentColor"/><rect x="2" y="7.25" width="12" height="1.5" rx="0.75" fill="currentColor"/><rect x="2" y="11.5" width="12" height="1.5" rx="0.75" fill="currentColor"/></svg>
          </button>

          <img src={logoUrl} alt="AwarenessClaw" className="w-5 h-5 rounded" />

          {/* Project folder — single line, compact */}
          <button
            onClick={handleSelectProjectRoot}
            aria-label={projectRoot ? t('chat.workspace.change', 'Change folder') : t('chat.workspace.select', 'Choose folder')}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left transition-colors hover:bg-slate-800 max-w-[200px]"
            title={projectRoot || t('chat.workspace.select', 'Choose folder')}
          >
            <FolderOpen size={11} className="shrink-0 text-sky-400/70" />
            <span className="truncate text-xs text-slate-400">{projectRootName || t('chat.workspace.none', 'No folder')}</span>
          </button>

          <div className="flex-1" />

          {/* Model selector — compact pill */}
          <div className="relative">
            <button onClick={() => setShowModelSelector(!showModelSelector)}
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] hover:bg-slate-800 rounded-md text-slate-500 transition-colors"
            >
              {currentProvider?.emoji} {config.modelId?.split('/').pop() || t('chat.selectModel', 'Select model')}
              <ChevronDown size={9} />
            </button>
            {showModelSelector && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModelSelector(false)} />
                <div className="absolute top-full left-0 mt-1 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl z-50 max-h-[400px] overflow-y-auto">
                  {allProviders.map(provider => {
                    const providerProfile = getProviderProfile(config, provider.key);
                    const isConfigured = hasProviderCredentials(config, provider.key, provider.needsKey);
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
                                setShowModelSelector(false);
                                onNavigate?.('settings');
                                return;
                              }

                              selectModel(provider.key, model.id, allProviders);
                              void syncConfig(allProviders);
                              setShowModelSelector(false);
                            }}
                            className={`w-full text-left px-4 py-1.5 text-xs transition-colors ${
                              provider.needsKey && !isConfigured ? 'text-slate-500 hover:bg-slate-850' : 'hover:bg-slate-800'
                            } ${
                              config.providerKey === provider.key && config.modelId === model.id ? 'text-brand-400' : 'text-slate-300'
                            }`}
                            title={provider.needsKey && !isConfigured ? t('chat.configureInSettings', 'Configure this provider in Settings first') : undefined}
                          >
                            {model.label}
                            {config.providerKey === provider.key && config.modelId === model.id && (
                              <span className="ml-1 text-brand-400 font-medium">✓ {t('chat.active', 'Active')}</span>
                            )}
                            {provider.needsKey && !isConfigured && (
                              <span className="ml-1 text-[10px] text-amber-500">{t('chat.setupInSettings', 'Set up in Settings')}</span>
                            )}
                          </button>
                        ))}
                        {provider.needsKey && !isConfigured && (
                          <button
                            onClick={() => {
                              setShowModelSelector(false);
                              onNavigate?.('settings');
                            }}
                            className="w-full text-left px-4 py-2 text-[11px] text-sky-400 hover:bg-slate-800 transition-colors border-t border-slate-800"
                          >
                            {t('chat.openSettingsToConfigure', 'Open Settings to configure API Key / Base URL')}
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

          <button onClick={() => window.electronAPI?.openExternal('http://localhost:18789')}
            className="p-1 text-slate-600 hover:text-slate-300 rounded-md transition-colors"
            title={t('chat.openclawDashboard', 'OpenClaw Dashboard')}
          >
            <ExternalLink size={12} />
          </button>
        </div>
        {/* Channel conversation view (when a channel session is selected) */}
        {activeChannelKey ? (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Channel header */}
            <div className="px-4 py-2 border-b border-slate-800/50 flex items-center gap-2">
              <button onClick={handleBackToLocal} className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors" title="Back">
                <ChevronRight size={14} className="rotate-180" />
              </button>
              {(() => {
                const cs = channelSessions.find(s => s.sessionKey === activeChannelKey);
                return cs ? (
                  <>
                    <ChannelIcon channelId={cs.channel} size={18} />
                    <span className="text-sm text-slate-200 font-medium">{cs.displayName || cs.channel}</span>
                    <span className="text-xs text-slate-500">{cs.channel}</span>
                  </>
                ) : <span className="text-sm text-slate-400">{activeChannelKey}</span>;
              })()}
            </div>

            {/* Channel messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              <div className="max-w-3xl mx-auto space-y-4 w-full">
                {channelLoading ? (
                  <div className="flex items-center justify-center py-12 text-slate-500">
                    <Loader2 size={20} className="animate-spin mr-2" />
                    <span className="text-sm">Loading history...</span>
                  </div>
                ) : channelMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                    <span className="text-sm">No messages yet</span>
                  </div>
                ) : (
                  channelMessages.map(m => (
                    m.role === 'user' ? (
                      <div key={m.id} className="flex justify-end">
                        <div className="max-w-[75%] px-4 py-3 rounded-2xl rounded-br-md text-sm bg-brand-600 text-white">
                          {m.content}
                        </div>
                      </div>
                    ) : (
                      <div key={m.id} className="flex justify-start">
                        <div className="max-w-[85%] text-sm text-slate-200">
                          <TypewriterMessage content={m.content} isNew={false} />
                        </div>
                      </div>
                    )
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            {/* Channel reply input */}
            <div className="px-4 py-3 border-t border-slate-800/50">
              <div className="max-w-3xl mx-auto relative">
                <textarea
                  value={channelReplyText}
                  onChange={e => setChannelReplyText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleChannelReply(); } }}
                  placeholder="Reply to this channel..."
                  className="w-full pl-4 pr-12 py-3 bg-slate-900 border border-slate-700/50 rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none placeholder:text-slate-600"
                  style={{ minHeight: '44px', maxHeight: '120px' }}
                  disabled={channelReplying}
                />
                <button
                  onClick={handleChannelReply}
                  disabled={!channelReplyText.trim() || channelReplying}
                  className="absolute right-2 bottom-2 p-1.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
                >
                  {channelReplying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </div>
        ) : (
        <>
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
              /* AI message — full-width with subtle background */
              <div key={msg.id} className="group -mx-4 px-4 py-3 rounded-xl hover:bg-slate-800/30 transition-colors">
                <div className="flex gap-3">
                  <img src={logoUrl} alt="" className="w-6 h-6 rounded-md mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {/* Meta line */}
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] text-slate-500 font-medium">AwarenessClaw</span>
                      {msg.model && <span className="text-[10px] text-slate-600">{msg.model.split('/').pop()}</span>}
                      <span className="text-[10px] text-slate-600">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>

                    {/* Thinking process */}
                    {msg.thinking && (
                      <ThinkingBlock thinking={msg.thinking} />
                    )}

                    {/* Tool calls */}
                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <ToolCallsBlock
                        toolCalls={msg.toolCalls}
                        onApprove={handleApproveTool}
                        onCopyApproval={handleCopyApproval}
                        onStopRequest={handleStopActiveRequest}
                      />
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
                        {copiedId === msg.id ? <><Check size={10} /> {t('common.copied', 'Copied')}</> : <><Copy size={10} /> {t('common.copy', 'Copy')}</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          ))}

          {/* Streaming response or status indicator */}
          {agentStatus !== 'idle' && (
            <div className="group -mx-4 px-4 py-3 bg-slate-800/20 rounded-xl">
              <div className="flex gap-3">
                <img src={logoUrl} alt="" className={`w-6 h-6 rounded-md mt-0.5 flex-shrink-0 ${agentStatus !== 'error' ? 'animate-pulse' : ''}`} />
                <div className="flex-1 min-w-0">
                  {/* Meta line */}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-slate-500 font-medium">{t('app.name', 'AwarenessClaw')}</span>
                    {config.modelId && <span className="text-[10px] text-slate-600">{config.modelId.split('/').pop()}</span>}
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
                          thinkingRef.current = '';
                          setThinkingContent('');
                          setAgentStatus('idle');
                        }}
                        className="ml-2 px-2 py-0.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                      >
                        {t('chat.dismiss', 'Dismiss')}
                      </button>
                    </div>
                  )}

                  {/* Live thinking content */}
                  {agentStatus !== 'error' && thinkingContent && (
                    <LiveThinkingBlock
                      thinking={thinkingContent}
                      expanded={liveThinkingExpanded}
                      onToggle={() => setLiveThinkingExpanded(v => !v)}
                    />
                  )}

                  {/* Tool calls section */}
                  {agentStatus !== 'error' && activeToolCalls.length > 0 && (
                    <div className="mb-2 space-y-1 pb-2 border-b border-slate-700/30">
                      {activeToolCalls.slice(-5).map(tc => (
                        <div key={tc.id} className="text-[11px] text-slate-500">
                          <div className="flex items-center gap-1.5">
                          {tc.status === 'running' || tc.status === 'recalling' || tc.status === 'saving' || tc.status === 'awaiting_approval' ? (
                            <Loader2 size={11} className="animate-spin text-brand-400/70" />
                          ) : tc.status === 'failed' ? (
                            <AlertTriangle size={11} className="text-amber-400/80" />
                          ) : (
                            <span className="text-emerald-500/70">{getToolIcon(tc.name)}</span>
                          )}
                          <span className="truncate max-w-[300px]">{getToolLabel(tc.name, tc.status, t)}</span>
                          </div>
                          {tc.detail && (
                            <div className="ml-[17px] mt-0.5 truncate max-w-[320px] text-[10px] text-slate-500/80">{tc.detail}</div>
                          )}
                          {tc.status === 'awaiting_approval' && (
                            <div className="ml-[17px] mt-1 flex flex-wrap gap-2">
                              <button
                                onClick={() => handleApproveTool(tc)}
                                className="px-2 py-0.5 rounded-md bg-brand-600/20 hover:bg-brand-600/30 border border-brand-500/30 text-brand-200 text-[10px] transition-colors"
                              >
                                {t('chat.approveOnce', 'Approve once')}
                              </button>
                              <button
                                onClick={() => handleCopyApproval(tc)}
                                className="px-2 py-0.5 rounded-md bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 text-[10px] transition-colors"
                              >
                                {t('chat.copyApprovalCommand', 'Copy approval command')}
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Streaming text content — no bubble */}
                  {agentStatus !== 'error' && streamingContent ? (
                    <div className="text-sm text-slate-200 leading-relaxed">
                      <div className="prose prose-invert prose-sm max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                          code({ children, className }) {
                            const isInline = !className;
                            if (isInline) return <code className="px-1.5 py-0.5 bg-slate-700/80 rounded text-brand-300 text-[12px]">{children}</code>;
                            return <CodeBlock code={String(children).replace(/\n$/, '')} language={className} />;
                          },
                          p({ children }) { return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>; },
                        }}>
                          {streamingContent}
                        </ReactMarkdown>
                        <span className="animate-pulse text-brand-400 ml-0.5">▊</span>
                      </div>
                    </div>
                  ) : agentStatus !== 'error' ? (
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Loader2 size={14} className="animate-spin text-brand-400" />
                      <span>{statusLabel}</span>
                    </div>
                  ) : null}

                  {/* Stop button — abort the running agent */}
                  {agentStatus !== 'error' && (
                    <button
                      onClick={async () => {
                          await handleStopActiveRequest();
                      }}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1 text-xs text-slate-400 hover:text-red-400 bg-slate-800/60 hover:bg-red-500/10 border border-slate-700/50 hover:border-red-500/30 rounded-lg transition-colors"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1.5" /></svg>
                      {t('chat.stop', 'Stop')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Memory warning toast */}
        {memoryWarning && (
          <div className="px-4 pb-1">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-900/30 border border-amber-700/40 text-amber-300 text-xs animate-in fade-in slide-in-from-bottom-2">
                <AlertTriangle size={14} className="flex-shrink-0" />
                <span className="truncate">Memory save failed: {memoryWarning}</span>
                <button onClick={() => setMemoryWarning(null)} className="ml-auto flex-shrink-0 text-amber-400 hover:text-amber-200">
                  <X size={12} />
                </button>
              </div>
            </div>
          </div>
        )}

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

        {/* Input — Claude-style: buttons inside a unified input container */}
        <div className="px-4 py-3">
          <div className="max-w-3xl mx-auto">
            <div className="relative bg-slate-800 rounded-2xl border border-slate-700/60 focus-within:border-brand-500/50 focus-within:ring-1 focus-within:ring-brand-500/20 transition-all">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={
                  agentStatus === 'thinking' || agentStatus === 'generating'
                    ? t('chat.input.canQueue', 'AI is working... you can still type')
                    : t('chat.input.placeholder')
                }
                rows={1}
                className="w-full pl-4 pr-4 pt-3 pb-10 bg-transparent rounded-2xl text-sm focus:outline-none resize-none placeholder:text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ minHeight: '52px', maxHeight: '160px', height: input.includes('\n') ? 'auto' : '52px' }}
                disabled={false}
              />
              <input ref={fileInputRef} type="file" multiple className="hidden" aria-label={t('chat.attachFile', 'Attach file')}
                onChange={e => { const files = Array.from(e.target.files || []).map(f => ({ name: f.name, path: (f as any).path || f.name })); attachFiles(files); }}
              />
              {/* Bottom toolbar inside the input box */}
              <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button onClick={() => fileInputRef.current?.click()}
                    aria-label={t('chat.attachFile', 'Attach file')}
                    className="p-1.5 text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded-lg transition-colors" title={t('chat.attachFile', 'Attach file')}
                  >
                    <Paperclip size={14} />
                  </button>
                  {/* Agent selector */}
                  {agents.length > 1 && (
                    <div className="relative" ref={agentMenuRef}>
                      <button
                        onClick={() => setShowAgentMenu(!showAgentMenu)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] text-slate-500 hover:text-slate-300 hover:bg-slate-700 rounded-lg transition-colors"
                        title={t('chat.agent.switch')}
                      >
                        <span>{agents.find(a => a.id === config.selectedAgentId)?.emoji || '🤖'}</span>
                        <span className="max-w-[80px] truncate">{agents.find(a => a.id === config.selectedAgentId)?.name || t('chat.agent.default')}</span>
                        <ChevronDown size={10} />
                      </button>
                      {showAgentMenu && (
                        <div className="absolute bottom-full left-0 mb-1 min-w-[180px] bg-slate-800 border border-slate-700 rounded-xl shadow-lg overflow-hidden z-50">
                          {agents.map(a => (
                            <button
                              key={a.id}
                              onClick={() => { updateConfig({ selectedAgentId: a.id }); setShowAgentMenu(false); }}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                                a.id === config.selectedAgentId ? 'bg-brand-600/20 text-brand-300' : 'text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              <span>{a.emoji}</span>
                              <span className="flex-1 truncate">{a.name}</span>
                              {a.id === config.selectedAgentId && <Check size={12} className="text-brand-400" />}
                            </button>
                          ))}
                          {onNavigate && (
                            <button
                              onClick={() => { setShowAgentMenu(false); onNavigate('agents'); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-slate-500 hover:text-slate-300 hover:bg-slate-700 border-t border-slate-700 transition-colors"
                            >
                              <Bot size={12} />
                              <span>{t('chat.agent.manage', 'Manage Agents')}</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <button onClick={handleSend}
                  disabled={!canSendCurrentMessage}
                  className="p-1.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
                >
                  {!canSendCurrentMessage && agentStatus !== 'idle' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                </button>
              </div>
            </div>
          </div>
        </div>
        </>
        )}
      </div>

      {/* Bootstrap onboarding wizard (first-time users) */}
      {showBootstrap && (
        <BootstrapWizard
          onComplete={() => { setShowBootstrap(false); updateConfig({ bootstrapCompleted: true }); }}
          onSkip={() => { setShowBootstrap(false); updateConfig({ bootstrapCompleted: true }); }}
        />
      )}
    </div>
  );
}
