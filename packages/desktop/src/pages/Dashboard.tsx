import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ChevronRight, Loader2, Copy, Check, X, Brain, Key, Wrench, Search, BookOpen, Save, Zap, CheckCircle2, Terminal, Paperclip } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAppConfig, useDynamicProviders, getProviderProfile, hasProviderCredentials } from '../lib/store';
import { trackUsage } from '../lib/usage';
import { useI18n } from '../lib/i18n';
import { useExternalNavigator } from '../lib/useExternalNavigator';
import BootstrapWizard from '../components/BootstrapWizard';
import { ChannelConversationView } from '../components/dashboard/ChannelConversationView';
import { ChatComposer } from '../components/dashboard/ChatComposer';
import { ChatMessagesPane } from '../components/dashboard/ChatMessagesPane';
import { ChatTracePanel, type ChatTraceEvent } from '../components/dashboard/ChatTracePanel';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { SessionSidebar } from '../components/dashboard/SessionSidebar';
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
  traceEvents?: ChatTraceEvent[];
}

function finalizeToolCalls(toolCalls: ToolCallInfo[], shouldFinalize: boolean): ToolCallInfo[] | undefined {
  if (toolCalls.length === 0) return undefined;
  if (!shouldFinalize) return [...toolCalls];

  return toolCalls.map((toolCall) => {
    if (
      toolCall.status === 'running' ||
      toolCall.status === 'recalling' ||
      toolCall.status === 'saving' ||
      toolCall.status === 'cached' ||
      toolCall.status === 'approved'
    ) {
      return { ...toolCall, status: 'completed' };
    }
    return toolCall;
  });
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
type ExecApprovalSecurity = 'deny' | 'allowlist' | 'full';
type ExecApprovalAsk = 'off' | 'on-miss' | 'always';

type PermissionState = {
  alsoAllow: string[];
  denied: string[];
  execSecurity: ExecApprovalSecurity;
  execAsk: ExecApprovalAsk;
  execAskFallback: ExecApprovalSecurity;
  execAutoAllowSkills: boolean;
};

type ChatPermissionPresetKey = 'safe' | 'standard' | 'developer' | 'custom';

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

const BASE_REQUIRED_TOOLS = ['awareness_init', 'awareness_get_agent_prompt'] as const;
const STANDARD_ALLOWED_TOOLS = ['exec', 'awareness_recall', 'awareness_record', 'awareness_lookup'] as const;
const DEVELOPER_EXTRA_TOOLS = ['awareness_perception'] as const;

const CHAT_PERMISSION_PRESETS = {
  safe: {
    labelKey: 'chat.permission.safe',
    labelFallback: 'Safe',
    descKey: 'chat.permission.safe.desc',
    descFallback: 'Minimal tool allowlist. File-changing host exec stays blocked by default.',
    alsoAllow: [...BASE_REQUIRED_TOOLS] as string[],
    denied: ['exec', 'bash', 'shell', 'camera.snap', 'screen.record', 'contacts.add', 'calendar.add', 'sms.send'],
    execSecurity: 'deny' as const,
    execAsk: 'on-miss' as const,
    execAskFallback: 'deny' as const,
    execAutoAllowSkills: false,
  },
  standard: {
    labelKey: 'chat.permission.standard',
    labelFallback: 'Standard',
    descKey: 'chat.permission.standard.desc',
    descFallback: 'Coding + Awareness tools, with host exec still going through OpenClaw approvals.',
    alsoAllow: [...BASE_REQUIRED_TOOLS, ...STANDARD_ALLOWED_TOOLS] as string[],
    denied: ['camera.snap', 'screen.record', 'contacts.add', 'calendar.add', 'sms.send'],
    execSecurity: 'allowlist' as const,
    execAsk: 'on-miss' as const,
    execAskFallback: 'deny' as const,
    execAutoAllowSkills: false,
  },
  developer: {
    labelKey: 'chat.permission.developer',
    labelFallback: 'Developer',
    descKey: 'chat.permission.developer.desc',
    descFallback: 'Broad tool access. Host exec is fully opened for trusted local automation.',
    alsoAllow: [...BASE_REQUIRED_TOOLS, ...STANDARD_ALLOWED_TOOLS, ...DEVELOPER_EXTRA_TOOLS] as string[],
    denied: [] as string[],
    execSecurity: 'full' as const,
    execAsk: 'off' as const,
    execAskFallback: 'full' as const,
    execAutoAllowSkills: true,
  },
} as const;

function loadSessions(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  } catch { return []; }
}

function saveSessions(sessions: ChatSession[]) {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}

function createSession(title = 'New Chat'): ChatSession {
  return {
    id: `session-${Date.now()}`,
    title,
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function detectChatPermissionPreset(permissions: PermissionState | null): ChatPermissionPresetKey {
  if (!permissions) return 'safe';

  for (const [key, preset] of Object.entries(CHAT_PERMISSION_PRESETS) as Array<[Exclude<ChatPermissionPresetKey, 'custom'>, typeof CHAT_PERMISSION_PRESETS.safe]>) {
    const allowMatch = JSON.stringify([...preset.alsoAllow].sort()) === JSON.stringify([...permissions.alsoAllow].sort());
    const denyMatch = JSON.stringify([...preset.denied].sort()) === JSON.stringify([...permissions.denied].sort());
    const execMatch =
      preset.execSecurity === permissions.execSecurity &&
      preset.execAsk === permissions.execAsk &&
      preset.execAskFallback === permissions.execAskFallback &&
      preset.execAutoAllowSkills === permissions.execAutoAllowSkills;
    if (allowMatch && denyMatch && execMatch) return key;
  }

  return 'custom';
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

export default function Dashboard({ isActive = true, onNavigate }: { isActive?: boolean; onNavigate?: (page: 'chat' | 'memory' | 'channels' | 'models' | 'skills' | 'automation' | 'agents' | 'settings') => void }) {
  const { config, syncConfig, selectModel, updateConfig } = useAppConfig();
  const { t } = useI18n();
  const { openDashboard, isOpening } = useExternalNavigator();
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
  const streamChunkCountRef = useRef(0);
  const activeRunRef = useRef(false);
  const [thinkingContent, setThinkingContent] = useState('');
  const thinkingRef = useRef('');
  const [traceEvents, setTraceEvents] = useState<ChatTraceEvent[]>([]);
  const traceEventsRef = useRef<ChatTraceEvent[]>([]);
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
  const [permissions, setPermissions] = useState<PermissionState | null>(null);
  const [showPermissionMenu, setShowPermissionMenu] = useState(false);
  const [permissionUpdating, setPermissionUpdating] = useState(false);
  const permissionMenuRef = useRef<HTMLDivElement>(null);
  // Bootstrap onboarding
  const [showBootstrap, setShowBootstrap] = useState(false);
  // Memory warning toast
  const [memoryWarning, setMemoryWarning] = useState<string | null>(null);
  const memoryWarningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetChatActivityTimeout = useCallback(() => {
    if (!activeRunRef.current) return;
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
    streamTimeoutRef.current = setTimeout(() => {
      setAgentStatus('error');
    }, STREAM_TIMEOUT_MS);
  }, []);

  const recordTraceEvent = useCallback((event: Omit<ChatTraceEvent, 'id' | 'timestamp'> & { mergeKey?: string }) => {
    const nextEvent: ChatTraceEvent = {
      ...event,
      id: event.mergeKey || `trace-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
    };
    const current = traceEventsRef.current;
    const existingIndex = event.mergeKey ? current.findIndex((item) => item.mergeKey === event.mergeKey) : -1;
    const updated = existingIndex >= 0
      ? current.map((item, index) => (index === existingIndex ? { ...item, ...nextEvent, id: item.id } : item))
      : [...current, nextEvent];
    traceEventsRef.current = updated.slice(-60);
    setTraceEvents([...traceEventsRef.current]);
  }, []);

  const { providers: allProviders } = useDynamicProviders();
  const currentProvider = allProviders.find(p => p.key === config.providerKey);
  const projectRootName = projectRoot.split(/[/\\]/).filter(Boolean).pop() || '';

  // Ensure active session exists
  useEffect(() => {
    if (!activeSessionId || !sessions.find(s => s.id === activeSessionId)) {
      if (sessions.length > 0) {
        setActiveSessionId(sessions[0].id);
      } else {
        const s = createSession(t('chat.newSession', 'New Chat'));
        setSessions([s]);
        setActiveSessionId(s.id);
      }
    }
  }, [sessions, activeSessionId, t]);

  // Listen for streaming chunks + status events
  useEffect(() => {
    if (!window.electronAPI) return;
    const api = window.electronAPI as any;

    // Debug: forward main-process gateway events to DevTools console
    api.onChatDebug?.((msg: string) => {
      if (!activeRunRef.current) return;
      console.log(msg);
      resetChatActivityTimeout();
    });

    // Thinking content from agent reasoning
    api.onChatThinking?.((text: string) => {
      if (!activeRunRef.current) return;
      const hadThinking = !!thinkingRef.current;
      thinkingRef.current = text;
      setThinkingContent(text);
      if (!hadThinking && text) setLiveThinkingExpanded(true);
      resetChatActivityTimeout();
      recordTraceEvent({
        kind: 'thinking',
        label: t('chat.trace.thinkingUpdated', 'Thinking updated'),
        detail: text,
        raw: text,
        mergeKey: 'live-thinking',
      });
    });

    // Stream text chunks from agent response
    api.onChatStream?.((chunk: string) => {
      if (!activeRunRef.current) return;
      streamingRef.current += chunk;
      streamChunkCountRef.current += 1;
      setStreamingContent(streamingRef.current);
      // Switch to generating status when we start receiving text
      setAgentStatus('generating');
      resetChatActivityTimeout();
      recordTraceEvent({
        kind: 'stream',
        label: t('chat.trace.streaming', 'Assistant streaming'),
        detail: t('chat.trace.streamingDetail', '{0} chunk(s), {1} chars received')
          .replace('{0}', String(streamChunkCountRef.current))
          .replace('{1}', String(streamingRef.current.length)),
        mergeKey: 'live-stream',
      });
    });

    // Status events (agent lifecycle + tool calls + gateway auto-start)
    api.onChatStatus?.((status: { type: string; tool?: string; toolStatus?: string; toolId?: string; message?: string; detail?: string; approvalRequestId?: string; approvalCommand?: string }) => {
      if (!activeRunRef.current) return;
      resetChatActivityTimeout();
      if (status.type === 'gateway') {
        // Gateway auto-start status — show as thinking with a message
        setAgentStatus('thinking');
        recordTraceEvent({
          kind: 'status',
          label: t('chat.trace.gatewayStatus', 'Gateway status'),
          detail: status.message || t('chat.trace.gatewayStarting', 'Starting Gateway'),
        });
      } else if (status.type === 'thinking' || status.type === 'generating' || status.type === 'error') {
        setAgentStatus(status.type as AgentStatus);
        recordTraceEvent({
          kind: 'status',
          label: t('chat.trace.agentStatus', 'Agent status'),
          detail: status.message || status.type,
        });
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
        recordTraceEvent({
          kind: 'status',
          label: status.type === 'tool_approval'
            ? t('chat.trace.toolApproval', 'Tool approval requested')
            : t('chat.trace.toolStarted', 'Tool started'),
          detail: `${status.tool}${status.detail ? ` — ${status.detail}` : ''}`,
        });
      } else if (status.type === 'tool_update' && status.toolId) {
        toolCallsRef.current = toolCallsRef.current.map(tc =>
          tc.id === status.toolId ? {
            ...tc,
            status: (status.toolStatus as ToolCallInfo['status']) || 'completed',
            detail: status.detail || tc.detail,
          } : tc
        );
        setActiveToolCalls([...toolCallsRef.current]);
        const updatedTool = toolCallsRef.current.find((tc) => tc.id === status.toolId);
        recordTraceEvent({
          kind: 'status',
          label: t('chat.trace.toolUpdated', 'Tool updated'),
          detail: `${updatedTool?.name || status.toolId}${status.detail ? ` — ${status.detail}` : ''}`,
        });
      }
    });
  }, [recordTraceEvent, resetChatActivityTimeout, t]);

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
    api.permissionsGet?.().then((res: any) => {
      if (res?.success) {
        setPermissions({
          alsoAllow: Array.isArray(res.alsoAllow) ? res.alsoAllow : [],
          denied: Array.isArray(res.denied) ? res.denied : [],
          execSecurity: res.execSecurity || 'deny',
          execAsk: res.execAsk || 'on-miss',
          execAskFallback: res.execAskFallback || 'deny',
          execAutoAllowSkills: Boolean(res.execAutoAllowSkills),
        });
      }
    }).catch(() => {});
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
      const readBootstrapUserFile = api.agentsReadFile
        ? api.agentsReadFile('main', 'USER.md')
        : api.workspaceReadFile?.('USER.md');

      Promise.resolve(readBootstrapUserFile).then((res: any) => {
        if (res?.success && res.content?.trim()) {
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

  useEffect(() => {
    if (!showPermissionMenu) return;
    const handler = (e: MouseEvent) => {
      if (permissionMenuRef.current && !permissionMenuRef.current.contains(e.target as Node)) {
        setShowPermissionMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPermissionMenu]);

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

  const handleNewSession = useCallback(() => {
    const s = createSession(t('chat.newSession', 'New Chat'));
    setSessions(prev => [s, ...prev]);
    setActiveSessionId(s.id);
    setShowSidebar(false);
  }, [t]);

  const handleSelectProjectRoot = async () => {
    const api = window.electronAPI as any;
    const result = await api?.selectDirectory?.();
    if (!result?.directoryPath) return;

    setProjectRoot(result.directoryPath);
  };

  const activePermissionPreset = detectChatPermissionPreset(permissions);
  const permissionOptions = (Object.entries(CHAT_PERMISSION_PRESETS) as Array<[Exclude<ChatPermissionPresetKey, 'custom'>, typeof CHAT_PERMISSION_PRESETS.safe]>).map(([key, preset]) => ({
    key,
    label: t(preset.labelKey, preset.labelFallback),
    desc: t(preset.descKey, preset.descFallback),
  }));
  const selectedPermissionLabel = activePermissionPreset === 'custom'
    ? t('settings.permissions.custom', 'Custom')
    : t(CHAT_PERMISSION_PRESETS[activePermissionPreset].labelKey, CHAT_PERMISSION_PRESETS[activePermissionPreset].labelFallback);

  const applyChatPermissionPreset = useCallback(async (presetKey: string) => {
    if (!window.electronAPI) return;
    if (presetKey !== 'safe' && presetKey !== 'standard' && presetKey !== 'developer') return;
    const preset = CHAT_PERMISSION_PRESETS[presetKey];
    const shouldStartFreshChat = Boolean(activeSession && activeSession.messages.length > 0);
    setPermissionUpdating(true);
    setShowPermissionMenu(false);
    try {
      await (window.electronAPI as any).permissionsUpdate({
        alsoAllow: [...preset.alsoAllow],
        denied: [...preset.denied],
        execSecurity: preset.execSecurity,
        execAsk: preset.execAsk,
        execAskFallback: preset.execAskFallback,
        execAutoAllowSkills: preset.execAutoAllowSkills,
      });
      setPermissions({
        alsoAllow: [...preset.alsoAllow],
        denied: [...preset.denied],
        execSecurity: preset.execSecurity,
        execAsk: preset.execAsk,
        execAskFallback: preset.execAskFallback,
        execAutoAllowSkills: preset.execAutoAllowSkills,
      });
      if (shouldStartFreshChat) {
        handleNewSession();
      }
    } finally {
      setPermissionUpdating(false);
    }
  }, [activeSession, handleNewSession]);

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
    activeRunRef.current = true;

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
    streamChunkCountRef.current = 0;
    setStreamingContent('');
    thinkingRef.current = '';
    setThinkingContent('');
    traceEventsRef.current = [];
    setTraceEvents([]);
    setLiveThinkingExpanded(true);
    resetChatActivityTimeout();
    recordTraceEvent({
      kind: 'status',
      label: t('chat.trace.requestSent', 'Request sent'),
      detail: trimmed,
    });

    if (window.electronAPI) {
      try {
      const result = await (window.electronAPI as any).chatSend(trimmed, activeSessionId, {
        thinkingLevel: config.thinkingLevel || 'low',
        reasoningDisplay: config.reasoningDisplay || 'on',
        files: filePaths,
        workspacePath: projectRoot || undefined,
        agentId: config.selectedAgentId || 'main',
      });
      const finalizedToolCalls = finalizeToolCalls(
        toolCallsRef.current,
        Boolean(result?.success && !result?.awaitingApproval),
      );
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
        toolCalls: finalizedToolCalls,
        thinking: thinkingRef.current || undefined,
        traceEvents: traceEventsRef.current.length > 0 ? [...traceEventsRef.current] : undefined,
      };

      setNewestMsgId(assistantMsg.id);
      updateSession(activeSessionId, s => ({
        ...s,
        messages: [...s.messages, assistantMsg],
        updatedAt: Date.now(),
      }));
      trackUsage(config.providerKey, config.modelId, trimmed, responseText);
      activeRunRef.current = false;
      if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
      toolCallsRef.current = [];
      setActiveToolCalls([]);
      streamingRef.current = '';
      setStreamingContent('');
      thinkingRef.current = '';
      setThinkingContent('');
      traceEventsRef.current = [];
      setTraceEvents([]);
      setLiveThinkingExpanded(false);
      setAgentStatus('idle');
      } finally {
        activeRunRef.current = false;
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
    activeRunRef.current = false;
    if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
    traceEventsRef.current = [];
    setTraceEvents([]);
    setAgentStatus('idle');
  }, [activeSessionId]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Escape key stops the active request
    if (e.key === 'Escape' && (agentStatus === 'thinking' || agentStatus === 'generating')) {
      e.preventDefault();
      void handleStopActiveRequest();
      return;
    }
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

  const renderStreamingContent = useCallback((content: string) => (
    <div className="prose prose-invert prose-sm max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        code({ children, className }) {
          const isInline = !className;
          if (isInline) return <code className="px-1.5 py-0.5 bg-slate-700/80 rounded text-brand-300 text-[12px]">{children}</code>;
          return <CodeBlock code={String(children).replace(/\n$/, '')} language={className} />;
        },
        p({ children }) { return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>; },
      }}>
        {content}
      </ReactMarkdown>
      <span className="animate-pulse text-brand-400 ml-0.5">▊</span>
    </div>
  ), []);

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
      <SessionSidebar
        t={t}
        visible={showSidebar}
        sessions={sessions}
        activeSessionId={activeSessionId}
        channelSessions={channelSessions}
        activeChannelKey={activeChannelKey}
        renamingId={renamingId}
        renameValue={renameValue}
        onRenameValueChange={setRenameValue}
        onRenameStart={(sessionId, title) => {
          setRenamingId(sessionId);
          setRenameValue(title);
        }}
        onRenameCancel={() => setRenamingId(null)}
        onRenameCommit={(sessionId) => {
          if (renameValue.trim()) updateSession(sessionId, (session) => ({ ...session, title: renameValue.trim() }));
          setRenamingId(null);
        }}
        onNewSession={handleNewSession}
        onRefreshChannels={refreshChannelSessions}
        onSelectChannel={(sessionKey) => {
          setActiveChannelKey(sessionKey);
          setActiveSessionId('');
        }}
        onSelectSession={(sessionId) => {
          setActiveSessionId(sessionId);
          setActiveChannelKey(null);
          setNewestMsgId(null);
        }}
        onDeleteSession={(sessionId) => {
          setConfirmDialog({ message: t('chat.deleteSession', 'Delete this session?'), onConfirm: () => deleteSession(sessionId) });
        }}
      />

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
        <DashboardHeader
          t={t}
          logoUrl={logoUrl}
          showSidebar={showSidebar}
          projectRoot={projectRoot}
          projectRootName={projectRootName}
          config={config}
          allProviders={allProviders}
          showModelSelector={showModelSelector}
          onToggleSidebar={() => setShowSidebar(!showSidebar)}
          onSelectProjectRoot={handleSelectProjectRoot}
          onToggleModelSelector={() => setShowModelSelector(!showModelSelector)}
          onCloseModelSelector={() => setShowModelSelector(false)}
          onNavigateModels={() => onNavigate?.('models')}
          onSelectModel={(providerKey, modelId) => selectModel(providerKey, modelId, allProviders)}
          onSyncConfig={() => { void syncConfig(allProviders); }}
          onOpenDashboard={() => { void openDashboard('chat-dashboard'); }}
          dashboardOpening={isOpening('chat-dashboard')}
        />
        {/* Channel conversation view (when a channel session is selected) */}
        {activeChannelKey ? (
          <ChannelConversationView
            activeChannelKey={activeChannelKey}
            channelSessions={channelSessions}
            channelLoading={channelLoading}
            channelMessages={channelMessages}
            channelReplyText={channelReplyText}
            channelReplying={channelReplying}
            messagesEndRef={messagesEndRef}
            onBack={handleBackToLocal}
            onReplyTextChange={setChannelReplyText}
            onReplySubmit={handleChannelReply}
          />
        ) : (
        <>
        <ChatMessagesPane
          t={t}
          logoUrl={logoUrl}
          config={config}
          messages={messages}
          agentStatus={agentStatus}
          thinkingContent={thinkingContent}
          traceEvents={traceEvents}
          activeToolCalls={activeToolCalls}
          streamingContent={streamingContent}
          newestMsgId={newestMsgId}
          copiedId={copiedId}
          projectRoot={projectRoot}
          messagesEndRef={messagesEndRef}
          liveThinkingExpanded={liveThinkingExpanded}
          onToggleLiveThinking={() => setLiveThinkingExpanded((value) => !value)}
          onSelectProjectRoot={handleSelectProjectRoot}
          onSelectModel={() => setShowModelSelector(true)}
          onSuggestionSelect={setInput}
          onCopyMessage={copyMessage}
          onApproveTool={handleApproveTool}
          onCopyApproval={handleCopyApproval}
          onStopRequest={handleStopActiveRequest}
          onDismissError={() => {
            if (streamTimeoutRef.current) clearTimeout(streamTimeoutRef.current);
            streamingRef.current = '';
            setStreamingContent('');
            thinkingRef.current = '';
            setThinkingContent('');
            traceEventsRef.current = [];
            setTraceEvents([]);
            setAgentStatus('idle');
          }}
          renderStreamingContent={renderStreamingContent}
          TypewriterMessage={TypewriterMessage}
          ThinkingBlock={ThinkingBlock}
          LiveThinkingBlock={LiveThinkingBlock}
        />

        <ChatComposer
          t={t}
          input={input}
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          attachedFiles={attachedFiles}
          agents={agents}
          showAgentMenu={showAgentMenu}
          agentMenuRef={agentMenuRef}
          selectedAgentId={config.selectedAgentId}
          permissionOptions={permissionOptions}
          showPermissionMenu={showPermissionMenu}
          permissionMenuRef={permissionMenuRef}
          selectedPermissionLabel={selectedPermissionLabel}
          permissionUpdating={permissionUpdating}
          canSendCurrentMessage={canSendCurrentMessage}
          agentStatus={agentStatus}
          memoryWarning={memoryWarning}
          onInputChange={setInput}
          onKeyDown={handleKeyDown}
          onOpenFilePicker={() => fileInputRef.current?.click()}
          onFilesSelected={(files) => {
            const nextFiles = Array.from(files || []).map((file) => ({ name: file.name, path: (file as any).path || file.name }));
            attachFiles(nextFiles);
          }}
          onRemoveFile={(index) => setAttachedFiles((prev) => prev.filter((_, currentIndex) => currentIndex !== index))}
          onToggleAgentMenu={() => setShowAgentMenu(!showAgentMenu)}
          onSelectAgent={(agentId) => {
            updateConfig({ selectedAgentId: agentId });
            setShowAgentMenu(false);
          }}
          onTogglePermissionMenu={() => setShowPermissionMenu(!showPermissionMenu)}
          onSelectPermission={applyChatPermissionPreset}
          onManageAgents={onNavigate ? () => { setShowAgentMenu(false); onNavigate('agents'); } : undefined}
          onManagePermissions={onNavigate ? () => { setShowPermissionMenu(false); onNavigate('settings'); } : undefined}
          onDismissMemoryWarning={() => setMemoryWarning(null)}
          onSend={() => { void handleSend(); }}
          onStop={() => { void handleStopActiveRequest(); }}
        />
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
