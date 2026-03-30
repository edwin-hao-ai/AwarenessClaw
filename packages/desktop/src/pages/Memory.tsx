import { useState, useEffect, useCallback } from 'react';
import { Search, RefreshCw, Loader2, AlertCircle, Zap, HardDrive, Cloud, ChevronDown, ChevronRight, Calendar, Play, Clock, MessageSquare, FileText } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface PerceptionSignal {
  type: string;
  message: string;
}

interface KnowledgeCard {
  id: string;
  category: string;
  title: string;
  summary: string;
  created_at?: string;
  status?: string;
}

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

function MemoryLayerInfo() {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mb-4">
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

type TabView = 'timeline' | 'knowledge';

export default function Memory() {
  const { t } = useI18n();
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

  const loadEvents = useCallback(async (offset = 0, append = false) => {
    if (!api) return;
    try {
      const result = await api.memoryGetEvents({ limit: 50, offset });
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
  }, [api]);

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
          await Promise.all([loadCards(), loadEvents(), loadPerception(), loadDailySummary()]);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [checkHealth, loadCards, loadEvents, loadPerception, loadDailySummary]);

  const handleRefresh = async () => {
    setLoading(true);
    setError(null);
    const connected = await checkHealth();
    if (connected) {
      await Promise.all([loadCards(), loadEvents(0), loadPerception(), loadDailySummary()]);
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
        // Reload everything
        await Promise.all([checkHealth(), loadCards(), loadEvents(0), loadPerception(), loadDailySummary()]);
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

  const filteredCards = cards.filter((card) => {
    if (selectedCategory !== 'all' && card.category !== selectedCategory) return false;
    if (searchQuery && !searchResults && !card.title?.includes(searchQuery) && !card.summary?.includes(searchQuery)) return false;
    return true;
  });

  const displayCards = searchResults && activeTab === 'knowledge' ? searchResults : filteredCards;

  const statsText = daemonHealth?.stats
    ? t('memory.stats', '{memories} memories, {knowledge} cards, {sessions} sessions')
        .replace('{memories}', String(daemonHealth.stats.totalMemories))
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

        {/* Tabs: Timeline / Knowledge Cards */}
        <div className="flex gap-1 mb-3 p-0.5 bg-slate-800/50 rounded-lg w-fit">
          <button
            onClick={() => {
              setActiveTab('timeline');
              setSearchQuery('');
              setSearchResults(null);
              setEvents(fullEvents);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === 'timeline' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock size={12} />
            {t('memory.timeline')}
            {daemonHealth?.stats && <span className="text-[10px] opacity-70">({daemonHealth.stats.totalMemories})</span>}
          </button>
          <button
            onClick={() => {
              setActiveTab('knowledge');
              setSearchQuery('');
              setSearchResults(null);
              setEvents(fullEvents);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === 'knowledge' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText size={12} />
            {t('memory.knowledgeCards')}
            {cards.length > 0 && <span className="text-[10px] opacity-70">({cards.length})</span>}
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder={t('memory.searchHint')}
            className="w-full pl-10 pr-4 py-2.5 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
          {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-brand-400" />}
        </div>

        {/* Category filter — only for knowledge tab */}
        {activeTab === 'knowledge' && (
          <div className="flex gap-2 flex-wrap">
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

            {/* Memory Architecture Info */}
            <MemoryLayerInfo />

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
                {events.length === 0 && (
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

                {events.map((event) => {
                  const src = getSourceDisplay(event.source);
                  const isExpanded = expandedEvent === event.id;
                  const contentPreview = event.fts_content || event.title || '';
                  const hasLongContent = contentPreview.length > 200;

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

                      {/* Event title */}
                      {event.title && (
                        <h4 className="font-medium text-sm mb-1 text-slate-200">{event.title}</h4>
                      )}

                      {/* Event content */}
                      {contentPreview && (
                        <div className="text-sm text-slate-400 leading-relaxed">
                          <p className={isExpanded ? '' : 'line-clamp-3'}>
                            {contentPreview}
                          </p>
                          {hasLongContent && (
                            <button
                              onClick={() => setExpandedEvent(isExpanded ? null : event.id)}
                              className="text-xs text-brand-400 hover:text-brand-300 mt-1"
                            >
                              {isExpanded ? t('memory.collapseContent') : t('memory.expandContent')}
                            </button>
                          )}
                        </div>
                      )}

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
                      className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-colors"
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
                          <span className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-slate-500">{t('memory.superseded')}</span>
                        )}
                      </div>
                      <h4 className="font-medium text-sm mb-1">{card.title}</h4>
                      <p className="text-sm text-slate-400 leading-relaxed">{card.summary}</p>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
