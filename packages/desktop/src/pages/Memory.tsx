import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Search, RefreshCw, Loader2, AlertCircle, Zap, HardDrive, Cloud, ChevronDown, ChevronRight, Calendar, Play, Clock, FileText, Share2, SlidersHorizontal } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '../lib/i18n';
import { parseMemoryContextResponse, type MemoryKnowledgeCard } from '../lib/memory-context';
import { useExternalNavigator } from '../lib/useExternalNavigator';
import { useMemorySettings } from '../hooks/useMemorySettings';
import { MemorySettingsPanel } from '../components/memory/MemorySettingsPanel';
import { SettingsCloudAuthModal } from '../components/settings/SettingsCloudAuthModal';

interface PerceptionSignal {
  type: string;
  message: string;
}

type KnowledgeCard = MemoryKnowledgeCard;

/** A raw memory event from the daemon REST API */
interface MemoryEvent {
  id: string;
  type?: string;
  title?: string;
  source?: string;
  session_id?: string;
  agent_role?: string;
  tags?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  fts_content?: string;
}

interface DaemonHealth {
  status: string;
  version?: string;
  search_mode?: string;
  uptime?: number;
  stats?: {
    totalMemories: number;
    totalKnowledge: number;
    totalTasks: number;
    totalSessions: number;
  };
  error?: string;
}

// Known categories with curated icons/colors. Unknown categories get a generic fallback.
const CATEGORY_CONFIG: Record<string, { emoji: string; labelKey: string; color: string }> = {
  decision: { emoji: '💡', labelKey: 'memory.category.decision', color: 'text-amber-400' },
  problem_solution: { emoji: '🔧', labelKey: 'memory.category.problem_solution', color: 'text-emerald-400' },
  workflow: { emoji: '📋', labelKey: 'memory.category.workflow', color: 'text-blue-400' },
  pitfall: { emoji: '⚠️', labelKey: 'memory.category.pitfall', color: 'text-red-400' },
  insight: { emoji: '✨', labelKey: 'memory.category.insight', color: 'text-purple-400' },
  key_point: { emoji: '📌', labelKey: 'memory.category.key_point', color: 'text-cyan-400' },
  personal_preference: { emoji: '👤', labelKey: 'memory.category.personal_preference', color: 'text-pink-400' },
  important_detail: { emoji: '📎', labelKey: 'memory.category.important_detail', color: 'text-orange-400' },
  skill: { emoji: '🛠️', labelKey: 'memory.category.skill', color: 'text-indigo-400' },
};

const SOURCE_CONFIG: Record<string, { emoji: string; label: string }> = {
  'claude-code': { emoji: '🤖', label: 'Claude Code' },
  'openclaw': { emoji: '🦞', label: 'OpenClaw' },
  'desktop': { emoji: '🖥️', label: 'Desktop' },
  'wechat': { emoji: '💬', label: 'WeChat' },
  'whatsapp': { emoji: '📱', label: 'WhatsApp' },
  'telegram': { emoji: '✈️', label: 'Telegram' },
  'manual': { emoji: '✍️', label: 'Manual' },
};

function getCategoryDisplay(category: string): { emoji: string; label: string; color: string } {
  const known = CATEGORY_CONFIG[category];
  if (known) return { emoji: known.emoji, label: known.labelKey, color: known.color };
  const humanized = category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { emoji: '🏷️', label: humanized, color: 'text-slate-400' };
}

function getSourceDisplay(source: string | undefined): { emoji: string; label: string } {
  if (!source) return { emoji: '📝', label: 'Unknown' };
  return SOURCE_CONFIG[source] || { emoji: '📝', label: source };
}

/** Parse code_change fts_content into structured parts */
function parseCodeChangeContent(content: string): { filepath: string; shortPath: string; diffLines: string[] } {
  const lines = content.split('\n');
  let filepath = '';
  const diffLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (i === 0 && line.startsWith('File changed:')) {
      filepath = line.replace('File changed:', '').trim();
    } else if (line.trim()) {
      diffLines.push(line);
    }
  }

  // If no "File changed:" prefix, treat the whole content as diff
  if (!filepath && lines.length > 0) {
    filepath = lines[0].trim();
  }

  // shortPath: last 2 path segments
  const parts = filepath.replace(/\\/g, '/').split('/').filter(Boolean);
  const shortPath = parts.length >= 2 ? parts.slice(-2).join('/') : filepath;

  return { filepath, shortPath, diffLines };
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/** Parse MCP JSON-RPC response into knowledge cards */
function parseMcpResponse(result: any): { cards: KnowledgeCard[]; errorKey?: string } {
  if (result?.error) return { cards: [], errorKey: 'memory.serviceDisconnected' };
  const text = result?.result?.content?.[0]?.text;
  if (!text) return { cards: [], errorKey: 'memory.emptyResponse' };
  try {
    const parsed = JSON.parse(text);
    if (parsed.error) return { cards: [], errorKey: 'memory.serviceDisconnected' };
    const items = parsed.knowledge_cards || parsed.items || parsed.cards || [];
    if (Array.isArray(items)) return { cards: items };
    return { cards: [] };
  } catch {
    return { cards: [], errorKey: 'memory.parseFailed' };
  }
}

function MemoryLayerInfo({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={className}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-slate-300 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{t('memory.architecture')}</span>
      </button>
      {expanded && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="p-3 rounded-xl border border-blue-500/20 bg-blue-500/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Cloud size={12} className="text-blue-400" />
              <span className="text-xs font-medium text-blue-400">{t('memory.awareness.title')}</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">{t('memory.awareness.desc')}</p>
          </div>
          <div className="p-3 rounded-xl border border-slate-500/20 bg-slate-500/5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <HardDrive size={12} className="text-slate-400" />
              <span className="text-xs font-medium text-slate-400">{t('memory.openclaw.title')}</span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">{t('memory.openclaw.desc')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

const KnowledgeGraph = lazy(() => import('../components/memory/KnowledgeGraph'));

/** Shared markdown components for memory content rendering */
const memoryMarkdownComponents = {
  p({ children }: any) { return <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>; },
  strong({ children }: any) { return <strong className="text-slate-200 font-semibold">{children}</strong>; },
  em({ children }: any) { return <em className="text-slate-300">{children}</em>; },
  code({ children, className }: any) {
    const isInline = !className;
    if (isInline) return <code className="px-1 py-0.5 bg-slate-700/80 rounded text-brand-300 text-xs">{children}</code>;
    return <pre className="bg-slate-800/80 rounded p-2 my-1.5 overflow-x-auto text-xs"><code>{children}</code></pre>;
  },
  h1({ children }: any) { return <h3 className="text-sm font-bold text-slate-300 mb-1 mt-2">{children}</h3>; },
  h2({ children }: any) { return <h4 className="text-sm font-bold text-slate-300 mb-1 mt-1.5">{children}</h4>; },
  h3({ children }: any) { return <h5 className="text-sm font-semibold text-slate-300 mb-1 mt-1">{children}</h5>; },
  ul({ children }: any) { return <ul className="list-disc list-inside mb-1.5 space-y-0.5 pl-1">{children}</ul>; },
  ol({ children }: any) { return <ol className="list-decimal list-inside mb-1.5 space-y-0.5 pl-1">{children}</ol>; },
  blockquote({ children }: any) { return <blockquote className="border-l-2 border-brand-500/40 pl-2 text-slate-500 italic my-1">{children}</blockquote>; },
  a({ children, href }: any) { return <a href={href} className="text-brand-400 hover:text-brand-300 underline" target="_blank" rel="noopener noreferrer">{children}</a>; },
};

type TabView = 'timeline' | 'knowledge' | 'graph' | 'settings';

/** Highlight matching search terms in text */
function HighlightText({ text, query }: { text: string; query: string }) {
  if (!query.trim() || !text) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="bg-amber-500/30 text-amber-200 rounded-sm px-0.5">{part}</mark>
          : part
      )}
    </>
  );
}

export default function Memory() {
  const { t } = useI18n();
  const { openExternal, isOpening } = useExternalNavigator();
  const {
    config,
    cloudMode,
    showCloudAuth,
    cloudAuthStep,
    cloudUserCode,
    cloudVerifyUrl,
    cloudMemories,
    setCloudAuthStep,
    openCloudAuth,
    closeCloudAuth,
    startCloudAuth,
    selectCloudMemory,
    disconnectCloud,
    selectMemoryMode,
    toggleMemoryOption,
    setRecallLimit,
    setBlockedSourceAllowed,
    clearAllMemories,
  } = useMemorySettings();
  const [activeTab, setActiveTab] = useState<TabView>('timeline');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [events, setEvents] = useState<MemoryEvent[]>([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsOffset, setEventsOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [fullEvents, setFullEvents] = useState<MemoryEvent[]>([]);
  const [signals, setSignals] = useState<PerceptionSignal[]>([]);
  const [searching, setSearching] = useState(false);
  const [dailySummary, setDailySummary] = useState<{ recentCards: KnowledgeCard[]; openTasks: number } | null>(null);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [selectedEventType, setSelectedEventType] = useState<string>('all');
  // Source filter: 'chat' = OpenClaw conversations only (default), 'dev' = Claude Code, 'all' = everything
  const [sourceView, setSourceView] = useState<'chat' | 'dev' | 'all'>('chat');
  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ width: 600, height: 400 });

  // Measure graph container for responsive sizing
  useEffect(() => {
    const el = graphContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) setGraphSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Daemon connection state
  const [daemonHealth, setDaemonHealth] = useState<DaemonHealth | null>(null);
  const [daemonStarting, setDaemonStarting] = useState(false);
  const [daemonConnected, setDaemonConnected] = useState(false);

  const api = window.electronAPI as any;

  // Check daemon health on mount
  const checkHealth = useCallback(async () => {
    if (!api) return;
    try {
      const health = await api.memoryCheckHealth();
      if (health?.status === 'ok') {
        setDaemonHealth(health);
        setDaemonConnected(true);
        // Notify watchdog that daemon is alive
        if (window.electronAPI) (window.electronAPI as any).daemonMarkConnected?.();
        return true;
      }
      setDaemonConnected(false);
      return false;
    } catch {
      setDaemonConnected(false);
      return false;
    }
  }, [api]);

  const loadCards = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.memoryGetCards();
      const parsed = parseMcpResponse(result);
      if (parsed.errorKey) {
        setError(t(parsed.errorKey));
        setCards([]);
      } else {
        setCards(parsed.cards);
        setError(null);
      }
    } catch {
      setError(t('memory.cannotConnect', 'Cannot connect to Local Daemon.'));
      setCards([]);
    }
  }, [api, t]);

  const loadContext = useCallback(async () => {
    if (!api) return false;
    try {
      const result = await api.memoryGetContext();
      const parsed = parseMemoryContextResponse(result);
      if (!parsed.hasStructuredContext) {
        return false;
      }
      setCards(parsed.cards);
      setDailySummary(
        parsed.cards.length > 0 || parsed.openTasks > 0
          ? { recentCards: parsed.cards.slice(0, 5), openTasks: parsed.openTasks }
          : null,
      );
      setError(null);
      return true;
    } catch {
      return false;
    }
  }, [api]);

  const loadEvents = useCallback(async (offset = 0, append = false, currentSourceView?: 'chat' | 'dev' | 'all') => {
    if (!api) return;
    try {
      // Translate sourceView to API-level filter for efficiency
      const view = currentSourceView ?? sourceView;
      const opts: Record<string, unknown> = { limit: 50, offset };
      if (view === 'chat') opts.source_exclude = 'mcp';
      else if (view === 'dev') opts.source = 'mcp';
      const result = await api.memoryGetEvents(opts);
      if (result?.error) return;
      const items = result?.items || [];
      setEvents(prev => append ? [...prev, ...items] : items);
      if (!append) {
        setFullEvents(items);
      } else {
        setFullEvents(prev => [...prev, ...items]);
      }
      setEventsTotal(result?.total || 0);
      setEventsOffset(offset + items.length);
    } catch {
      setLoading(false);
    }
  }, [api, sourceView]);

  const loadPerception = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.memoryGetPerception();
      const text = result?.result?.content?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        setSignals(parsed.signals || []);
      }
    } catch { /* no perception data */ }
  }, [api]);

  const loadDailySummary = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.memoryGetDailySummary();
      const cardsText = result?.cards?.result?.content?.[0]?.text;
      const tasksText = result?.tasks?.result?.content?.[0]?.text;
      let recentCards: KnowledgeCard[] = [];
      let openTasks = 0;
      if (cardsText) {
        try {
          const parsed = JSON.parse(cardsText);
          recentCards = (parsed.knowledge_cards || []).slice(0, 5);
        } catch { /* ignore */ }
      }
      if (tasksText) {
        try {
          const parsed = JSON.parse(tasksText);
          openTasks = (parsed.action_items || parsed.items || []).length;
        } catch { /* ignore */ }
      }
      if (recentCards.length > 0 || openTasks > 0) {
        setDailySummary({ recentCards, openTasks });
      } else {
        setDailySummary(null);
      }
    } catch { /* daemon not running */ }
  }, [api]);

  // Initial load
  useEffect(() => {
    const init = async () => {
      setLoading(true);
      try {
        const connected = await checkHealth();
        if (connected) {
          const contextLoaded = await loadContext();
          await Promise.all([
            contextLoaded ? Promise.resolve() : loadCards(),
            loadEvents(),
            loadPerception(),
            contextLoaded ? Promise.resolve() : loadDailySummary(),
          ]);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [checkHealth, loadCards, loadContext, loadEvents, loadPerception, loadDailySummary]);

  // Reload events when source view changes
  useEffect(() => {
    if (daemonConnected) {
      setEventsOffset(0);
      loadEvents(0, false, sourceView);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceView, daemonConnected]);

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    const connected = await checkHealth();
    if (connected) {
      const contextLoaded = await loadContext();
      await Promise.all([
        contextLoaded ? Promise.resolve() : loadCards(),
        loadEvents(0),
        loadPerception(),
        contextLoaded ? Promise.resolve() : loadDailySummary(),
      ]);
    }
    setLoading(false);
  };

  const handleStartDaemon = async () => {
    if (!api) return;
    setError(null);
    setDaemonStarting(true);
    try {
      const result = await api.startDaemon();
      if (result?.success) {
        setDaemonConnected(true);
        if (window.electronAPI) (window.electronAPI as any).daemonMarkConnected?.();
        // Reload everything
        await checkHealth();
        const contextLoaded = await loadContext();
        await Promise.all([
          contextLoaded ? Promise.resolve() : loadCards(),
          loadEvents(0),
          loadPerception(),
          contextLoaded ? Promise.resolve() : loadDailySummary(),
        ]);
        setError(null);
      } else {
        setError(result?.error || t('memory.daemonStartFailed'));
      }
    } catch {
      setError(t('memory.daemonStartFailed'));
    }
    setDaemonStarting(false);
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    if (activeTab !== 'timeline' && activeTab !== 'knowledge') {
      return;
    }
    setSearching(true);
    if (api) {
      try {
        if (activeTab === 'timeline') {
          // Search timeline events via REST API
          const result = await api.memoryGetEvents({ limit: 50, search: searchQuery });
          if (result?.items) {
            setEvents(result.items);
            setEventsTotal(result.total || result.items.length);
          }
          setSearchResults([]); // marker that search is active
        } else {
          // Search knowledge cards via MCP semantic search
          const result = await api.memorySearch(searchQuery);
          const text = result?.result?.content?.[0]?.text || '';
          if (text) {
            const lines = text.split('\n').filter((l: string) => l.trim());
            const searchCards = lines
              .filter((l: string) => l.match(/^\d+\.\s/))
              .map((l: string, i: number) => {
                const match = l.match(/^\d+\.\s\[(\w+)\]\s(.+)/);
                return {
                  id: `search-${i}`,
                  category: match?.[1] || 'key_point',
                  title: match?.[2]?.split('\n')[0] || l.replace(/^\d+\.\s/, ''),
                  summary: l,
                };
              });
            setSearchResults(searchCards.length > 0 ? searchCards : []);
          } else {
            setSearchResults([]);
          }
        }
      } catch {
        setSearchResults([]);
      }
    }
    setSearching(false);
  };

  // Compute filtered event list based on selectedEventType only
  // (source filtering is now done at the API level via source_exclude param)
  const displayedEvents = events.filter((event) => {
    if (selectedEventType === 'all') return true;
    return event.type === selectedEventType;
  });

  const filteredCards = cards.filter((card) => {
    if (selectedCategory !== 'all' && card.category !== selectedCategory) return false;
    if (searchQuery && !searchResults && !card.title?.includes(searchQuery) && !card.summary?.includes(searchQuery)) return false;
    return true;
  });

  const displayCards = searchResults && activeTab === 'knowledge' ? searchResults : filteredCards;

  // Stats reflect the current source view, not the global total
  const filteredEventCount = events.filter(e => {
    if (sourceView === 'chat') return e.source !== 'mcp';
    if (sourceView === 'dev') return e.source === 'mcp';
    return true;
  }).length;
  const showSearchControls = activeTab === 'timeline' || activeTab === 'knowledge';
  const memoryTabItems: Array<{
    id: TabView;
    label: string;
    hint: string;
    icon: typeof Clock;
    count?: number;
  }> = [
    {
      id: 'timeline',
      label: t('memory.timeline'),
      hint: t('memory.timelineHint', 'Sessions and raw events'),
      icon: Clock,
      count: daemonHealth?.stats?.totalMemories,
    },
    {
      id: 'knowledge',
      label: t('memory.knowledgeCards'),
      hint: t('memory.knowledgeHint', 'Durable cards and signals'),
      icon: FileText,
      count: cards.length,
    },
    {
      id: 'graph',
      label: t('memory.graph', 'Graph'),
      hint: t('memory.graphHint', 'Relationships across memories'),
      icon: Share2,
    },
    {
      id: 'settings',
      label: t('memory.settingsTab', 'Settings'),
      hint: t('memory.settingsTabHint', 'Capture, sync, privacy'),
      icon: SlidersHorizontal,
    },
  ];
  const switchTab = (tab: TabView) => {
    setActiveTab(tab);
    setSearchQuery('');
    setSearchResults(null);
    if (tab !== 'timeline') {
      setEvents(fullEvents);
      setSelectedEventType('all');
    }
    if (tab !== 'knowledge') {
      setSelectedCategory('all');
    }
  };
  const activeModeText = config.memoryMode === 'cloud'
    ? t('settings.memory.cloud', 'Cloud')
    : t('settings.memory.local', 'Local');
  const cloudStateText = cloudMode === 'hybrid' || cloudMode === 'cloud'
    ? t('memory.settings.cloudConnected', 'Connected')
    : t('memory.settings.cloudDisconnected', 'Local only');
  const statsText = daemonHealth?.stats
    ? t('memory.stats', '{memories} memories, {knowledge} cards, {sessions} sessions')
        .replace('{memories}', String(sourceView === 'all' ? daemonHealth.stats.totalMemories : filteredEventCount))
        .replace('{knowledge}', String(daemonHealth.stats.totalKnowledge))
        .replace('{sessions}', String(daemonHealth.stats.totalSessions))
    : null;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-semibold">🧠 {t('memory.title')}</h1>
            <p className="text-xs text-slate-500">
              {error ? <span className="text-amber-500">{error}</span>
                : statsText ? <span className="text-slate-400">{statsText}</span>
                : t('memory.subtitle')}
            </p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            {t('common.refresh')}
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {memoryTabItems.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                className={`group inline-flex min-w-[168px] items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-all ${
                  active
                    ? 'border-brand-500/60 bg-brand-600/12 shadow-[0_0_0_1px_rgba(59,130,246,0.12)]'
                    : 'border-slate-700/60 bg-slate-900/30 hover:border-slate-600/80 hover:bg-slate-800/45'
                }`}
              >
                <div className={`flex h-9 w-9 flex-none items-center justify-center rounded-xl ${active ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-300 group-hover:bg-slate-700'}`}>
                    <Icon size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="truncate text-sm font-medium text-slate-100">{tab.label}</div>
                    {typeof tab.count === 'number' && (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${active ? 'bg-brand-500/20 text-brand-200' : 'bg-slate-800 text-slate-400'}`}>
                        {tab.count}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">{tab.hint}</div>
                </div>
              </button>
            );
          })}
        </div>

        {showSearchControls && (
          <div className="relative mt-4">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder={t('memory.searchHint')}
              className="w-full rounded-2xl border border-slate-700/60 bg-slate-900/50 py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
            {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-brand-400" />}
          </div>
        )}

        {activeTab === 'knowledge' && (
          <div className="mt-3 flex gap-2 flex-wrap">
            <button
              onClick={() => { setSelectedCategory('all'); setSearchResults(null); }}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                selectedCategory === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {t('memory.all')} ({cards.length})
            </button>
            {[...new Set(cards.map(c => c.category).filter(Boolean))].map((cat) => {
              const count = cards.filter(c => c.category === cat).length;
              const display = getCategoryDisplay(cat);
              return (
                <button
                  key={cat}
                  onClick={() => { setSelectedCategory(cat); setSearchResults(null); }}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    selectedCategory === cat ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {display.emoji} {t(display.label, display.label)} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {/* Daemon offline state */}
        {!loading && !daemonConnected && (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-800 flex items-center justify-center">
              <HardDrive size={28} className="text-slate-500" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium text-slate-300">{t('memory.daemonOffline')}</p>
              <p className="text-xs text-slate-500 max-w-xs">{t('memory.daemonOffline.hint')}</p>
            </div>
            <button
              onClick={handleStartDaemon}
              disabled={daemonStarting}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
            >
              {daemonStarting ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
              {daemonStarting ? t('memory.startingDaemon') : t('memory.startDaemon')}
            </button>
            <p className="text-[11px] text-slate-600 font-mono select-all">
              npx @awareness-sdk/local start
            </p>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-brand-500" />
          </div>
        )}

        {/* Connected content */}
        {!loading && daemonConnected && (
          <>
            {/* Search degradation notice — shown when vector search is unavailable */}
            {daemonHealth?.search_mode && daemonHealth.search_mode !== 'hybrid' && (
              <div className="flex items-start gap-2.5 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 mb-3">
                <AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-xs font-medium text-amber-400">{t('memory.searchDegraded', 'Semantic search unavailable')}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {t('memory.searchDegraded.hint', 'Text search is active, but vector similarity is disabled. This usually means the embedding model failed to load. Restart the daemon to retry.')}
                  </p>
                </div>
              </div>
            )}

            {/* Daily Summary */}
            {dailySummary && activeTab === 'knowledge' && (
              <div className="p-4 bg-brand-500/5 border border-brand-500/20 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Calendar size={14} className="text-brand-400" />
                  <span className="text-xs font-medium text-brand-400">{t('memory.dailySummary') || 'Daily Summary'}</span>
                  {dailySummary.openTasks > 0 && (
                    <span className="ml-auto text-[10px] text-amber-400">{dailySummary.openTasks} {t('memory.openTasks') || 'open tasks'}</span>
                  )}
                </div>
                <div className="space-y-1">
                  {dailySummary.recentCards.map((card, i) => {
                    const cfg = getCategoryDisplay(card.category);
                    return (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <span>{cfg.emoji}</span>
                        <span className="text-slate-300 line-clamp-1">{card.title || card.summary}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Perception Signals */}
            {signals.length > 0 && activeTab === 'knowledge' && (
              <div className="space-y-2 mb-4">
                <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  <Zap size={12} /> {t('memory.perception')}
                </h3>
                {signals.map((signal, i) => {
                  const config: Record<string, { emoji: string; color: string }> = {
                    contradiction: { emoji: '⚡', color: 'border-red-500/30 bg-red-500/5' },
                    pattern: { emoji: '🔄', color: 'border-amber-500/30 bg-amber-500/5' },
                    resonance: { emoji: '💫', color: 'border-purple-500/30 bg-purple-500/5' },
                    staleness: { emoji: '⏰', color: 'border-slate-500/30 bg-slate-500/5' },
                  };
                  const c = config[signal.type] || { emoji: '💡', color: 'border-brand-500/30 bg-brand-500/5' };
                  return (
                    <div key={i} className={`p-3 rounded-xl border ${c.color} flex items-start gap-2.5`}>
                      <span className="text-base">{c.emoji}</span>
                      <p className="text-sm text-slate-200">{signal.message}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* === TIMELINE TAB === */}
            {activeTab === 'timeline' && (
              <>
                {/* Source view toggle — separate conversations from dev memories */}
                <div className="flex gap-1.5 mb-2">
                  {([['chat', 'Conversations'], ['dev', 'Dev Logs'], ['all', 'All']] as const).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setSourceView(key)}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                        sourceView === key
                          ? 'bg-brand-600/20 text-brand-400 border border-brand-500/40'
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {/* Event type filter chips — dynamically generated from actual event types */}
                <div className="flex gap-2 flex-wrap mb-2">
                  {['all', ...[...new Set(events.map(e => e.type).filter(Boolean))].sort()].map((filterType) => {
                    const typeLabels: Record<string, string> = {
                      all: `All (${events.length})`,
                      code_change: 'Code',
                      conversation: 'Chat',
                      task: 'Task',
                      note: 'Note',
                    };
                    const label = typeLabels[filterType!] ?? filterType!;
                    const count = filterType === 'all' ? null : events.filter(e => e.type === filterType).length;
                    return (
                      <button
                        key={filterType}
                        onClick={() => setSelectedEventType(filterType!)}
                        className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                          selectedEventType === filterType
                            ? 'bg-brand-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                      >
                        {label}{count !== null ? ` (${count})` : ''}
                      </button>
                    );
                  })}
                </div>

                {displayedEvents.length === 0 && (
                  <div className="text-center py-12 text-slate-500 space-y-2">
                    {searchQuery && searchResults !== null ? (
                      <p className="text-sm">{t('memory.noResults', 'No results for "{query}"').replace('{query}', searchQuery)}</p>
                    ) : (
                      <>
                        <p>{t('memory.noData')}</p>
                        <p className="text-xs mt-1">{t('memory.noData.hint')}</p>
                      </>
                    )}
                  </div>
                )}

                {displayedEvents.map((event) => {
                  const src = getSourceDisplay(event.source);
                  const isExpanded = expandedEvent === event.id;
                  const isCodeChange = event.type === 'code_change';

                  // For code_change events, parse the content for a cleaner display
                  const parsedCode = isCodeChange && event.fts_content
                    ? parseCodeChangeContent(event.fts_content)
                    : null;

                  const contentPreview = event.fts_content || event.title || '';
                  const hasLongContent = isCodeChange
                    ? (parsedCode ? parsedCode.diffLines.length > 3 : false)
                    : contentPreview.length > 200;

                  return (
                    <div
                      key={event.id}
                      className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-colors"
                    >
                      {/* Event header */}
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className="text-base">{src.emoji}</span>
                        <span className="text-xs font-medium text-slate-300">{src.label}</span>
                        {event.type && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-700 rounded text-slate-400">
                            {event.type}
                          </span>
                        )}
                        {event.session_id && (
                          <span className="text-[10px] text-slate-600 truncate max-w-[120px]" title={event.session_id}>
                            {event.session_id.slice(0, 12)}...
                          </span>
                        )}
                        {event.agent_role && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/10 rounded text-blue-400">
                            {event.agent_role}
                          </span>
                        )}
                        {event.created_at && (
                          <span className="ml-auto text-[11px] text-slate-500" title={new Date(event.created_at).toLocaleString()}>
                            {formatRelativeTime(event.created_at)}
                          </span>
                        )}
                      </div>

                      {/* Event title — for code_change show parsed shortPath */}
                      {isCodeChange && parsedCode ? (
                        <h4 className="font-medium text-sm mb-1 text-slate-200">
                          📄 {parsedCode.shortPath}
                        </h4>
                      ) : event.title ? (
                        <h4 className="font-medium text-sm mb-1 text-slate-200">
                          <HighlightText text={event.title} query={searchQuery} />
                        </h4>
                      ) : null}

                      {/* Event content */}
                      {isCodeChange && parsedCode ? (
                        // code_change: show diff lines in monospace, max 3 lines unless expanded
                        parsedCode.diffLines.length > 0 && (
                          <div className="text-slate-400 leading-relaxed">
                            <div className="space-y-0.5">
                              {(isExpanded ? parsedCode.diffLines : parsedCode.diffLines.slice(0, 3)).map((line, i) => (
                                <p key={i} className="text-xs font-mono truncate">{line}</p>
                              ))}
                            </div>
                            {hasLongContent && (
                              <button
                                onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
                                className="text-xs text-brand-400 hover:text-brand-300 mt-1"
                              >
                                {isExpanded ? t('memory.collapseContent') : t('memory.expandContent')}
                              </button>
                            )}
                          </div>
                        )
                      ) : contentPreview ? (
                        <div className="text-sm text-slate-400 leading-relaxed">
                          <div className={isExpanded ? '' : 'line-clamp-3'}>
                            {searchQuery ? (
                              <p><HighlightText text={contentPreview} query={searchQuery} /></p>
                            ) : (
                              <ReactMarkdown remarkPlugins={[remarkGfm]} components={memoryMarkdownComponents}>
                                {contentPreview}
                              </ReactMarkdown>
                            )}
                          </div>
                          {hasLongContent && (
                            <button
                              onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
                              className="text-xs text-brand-400 hover:text-brand-300 mt-1"
                            >
                              {isExpanded ? t('memory.collapseContent') : t('memory.expandContent')}
                            </button>
                          )}
                        </div>
                      ) : null}

                      {/* Tags */}
                      {event.tags && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {event.tags.split(',').map((tag, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-700/50 rounded text-slate-500">
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Load More */}
                {events.length > 0 && events.length < eventsTotal && (
                  <button
                    onClick={() => loadEvents(eventsOffset, true)}
                    className="w-full py-2.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800/50 rounded-xl transition-colors"
                  >
                    {t('memory.loadMore')} ({events.length}/{eventsTotal})
                  </button>
                )}
              </>
            )}

            {/* === KNOWLEDGE CARDS TAB === */}
            {activeTab === 'knowledge' && (
              <>
                {displayCards.length === 0 && !loading && (
                  <div className="text-center py-12 text-slate-500 space-y-2">
                    {searchQuery && searchResults !== null ? (
                      <>
                        <p className="text-sm">{t('memory.noResults', 'No results for "{query}"').replace('{query}', searchQuery)}</p>
                        <p className="text-xs text-slate-600">{t('memory.noData.hint')}</p>
                      </>
                    ) : selectedCategory !== 'all' ? (
                      <>
                        <p className="text-sm">{t('memory.noCategoryCards', 'No cards in this category')}</p>
                        <button
                          onClick={() => setSelectedCategory('all')}
                          className="text-xs text-brand-400 hover:text-brand-300 underline underline-offset-2"
                        >
                          {t('memory.clearFilter', 'Clear filter')}
                        </button>
                      </>
                    ) : (
                      <>
                        <p>{t('memory.noData')}</p>
                        <p className="text-xs mt-1">{t('memory.noData.hint')}</p>
                      </>
                    )}
                  </div>
                )}

                {displayCards.map((card: any, i: number) => {
                  const catDisplay = getCategoryDisplay(card.category);
                  return (
                    <div
                      key={card.id || i}
                      className={`p-4 rounded-xl border transition-colors ${
                        card.status === 'superseded'
                          ? 'bg-slate-800/30 border-slate-700/30 opacity-60'
                          : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span>{catDisplay.emoji}</span>
                        <span className={`text-xs font-medium ${catDisplay.color}`}>{t(catDisplay.label, catDisplay.label)}</span>
                        {card.created_at && (
                          <>
                            <span className="text-xs text-slate-600">&middot;</span>
                            <span className="text-xs text-slate-500">{new Date(card.created_at).toLocaleDateString()}</span>
                          </>
                        )}
                        {card.status === 'superseded' && (
                          <span className="text-xs px-1.5 py-0.5 bg-amber-600/20 rounded text-amber-500 border border-amber-600/30">
                            ⚠️ {t('memory.superseded', 'Superseded')}
                          </span>
                        )}
                      </div>
                      <h4 className={`font-medium text-sm mb-1 ${card.status === 'superseded' ? 'line-through text-slate-500' : ''}`}>
                        <HighlightText text={card.title} query={searchQuery} />
                      </h4>
                      <div className="text-sm text-slate-400 leading-relaxed">
                        {searchQuery ? (
                          <p><HighlightText text={card.summary} query={searchQuery} /></p>
                        ) : (
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={memoryMarkdownComponents}>
                            {card.summary}
                          </ReactMarkdown>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {/* === KNOWLEDGE GRAPH TAB === */}
            {activeTab === 'graph' && (
              <div ref={graphContainerRef} className="flex-1 -mx-6 -mb-3 min-h-[400px]" style={{ height: 'calc(100vh - 280px)' }}>
                <Suspense fallback={
                  <div className="flex items-center justify-center h-full">
                    <Loader2 size={24} className="animate-spin text-brand-500" />
                  </div>
                }>
                  <KnowledgeGraph
                    cards={cards}
                    events={fullEvents}
                    width={graphSize.width}
                    height={graphSize.height}
                  />
                </Suspense>
              </div>
            )}

            {activeTab === 'settings' && (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-700/60 bg-slate-900/55 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">{t('memory.settingsTab', 'Settings')}</div>
                      <h2 className="mt-2 text-lg font-semibold text-slate-100">{t('memory.settings.heroTitle', 'Tune how memory behaves')}</h2>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                        {t('memory.settings.heroDesc', 'Keep capture, sync, and privacy controls separate from the timeline so each memory pane stays focused.')}
                      </p>
                    </div>
                    <div className="grid min-w-[220px] gap-2 sm:grid-cols-3">
                      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{t('memory.settings.activeMode', 'Active mode')}</div>
                        <div className="mt-1 text-sm font-medium text-slate-100">{activeModeText}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{t('settings.memory.recallCount')}</div>
                        <div className="mt-1 text-sm font-medium text-slate-100">{config.recallLimit}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{t('memory.settings.cloudState', 'Cloud state')}</div>
                        <div className="mt-1 text-sm font-medium text-slate-100">{cloudStateText}</div>
                      </div>
                    </div>
                  </div>

                  <MemoryLayerInfo className="mt-4" />
                </div>

                <MemorySettingsPanel
                  t={t}
                  config={config}
                  cloudMode={cloudMode}
                  onToggle={toggleMemoryOption}
                  onRecallLimitChange={setRecallLimit}
                  onSelectMode={selectMemoryMode}
                  onCloudConnect={openCloudAuth}
                  onCloudDisconnect={disconnectCloud}
                  onToggleSource={setBlockedSourceAllowed}
                  onClearAll={() => {
                    void clearAllMemories(
                      t('settings.privacy.clearConfirm', 'Delete ALL local memories? This cannot be undone.'),
                      t('settings.privacy.cleared', 'All knowledge cards deleted.'),
                      t('settings.privacy.clearFailed', 'Failed to clear memories. Is the daemon running?'),
                    );
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>

      <SettingsCloudAuthModal
        t={t}
        open={showCloudAuth}
        step={cloudAuthStep}
        userCode={cloudUserCode}
        verifyUrl={cloudVerifyUrl}
        memories={cloudMemories}
        onClose={closeCloudAuth}
        onOpenBrowser={() => { void openExternal(cloudVerifyUrl, 'memory-cloud-auth'); }}
        browserOpening={isOpening('memory-cloud-auth')}
        onRefreshCode={() => {
          closeCloudAuth();
          openCloudAuth();
        }}
        onSelectMemory={selectCloudMemory}
        onRetry={() => {
          setCloudAuthStep('init');
          void startCloudAuth();
        }}
      />
    </div>
  );
}
