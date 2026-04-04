import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Search, RefreshCw, Loader2, AlertCircle, Zap, HardDrive, Cloud, ChevronDown, ChevronRight, Calendar, Play, Clock, FileText, Share2, SlidersHorizontal, AlarmClock, Bell, Brain, FileCode, Lightbulb, Sparkles, TriangleAlert } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '../lib/i18n';
import { parseMemoryContextResponse } from '../lib/memory-context';
import { useExternalNavigator } from '../lib/useExternalNavigator';
import { useMemorySettings } from '../hooks/useMemorySettings';
import './memory-graph.css';
import { MemorySettingsPanel } from '../components/memory/MemorySettingsPanel';
import { SettingsCloudAuthModal } from '../components/settings/SettingsCloudAuthModal';
import {
  type PerceptionSignal,
  type KnowledgeCard,
  type MemoryEvent,
  type DaemonHealth,
  type TabView,
  getCategoryDisplay,
  getSourceDisplay,
  parseCodeChangeContent,
  formatRelativeTime,
  parseMcpResponse,
  memoryMarkdownComponents,
} from '../components/memory/memory-helpers.js';

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
  // Card detail + evolution chain
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [cardEvolution, setCardEvolution] = useState<any[] | null>(null);
  const [evolutionLoading, setEvolutionLoading] = useState(false);
  const [graphSize, setGraphSize] = useState({ width: 600, height: 400 });

  // Measure graph container when Graph tab is visible and keep it in sync with viewport changes.
  useEffect(() => {
    if (activeTab !== 'graph') return;

    let frameId: number | null = null;

    const measure = () => {
      const el = graphContainerRef.current;
      if (!el) return;
      const { width, height } = el.getBoundingClientRect();
      const nextWidth = Math.floor(width);
      const nextHeight = Math.floor(height);

      if (nextWidth > 0 && nextHeight > 0) {
        setGraphSize((prev) => (
          prev.width === nextWidth && prev.height === nextHeight
            ? prev
            : { width: nextWidth, height: nextHeight }
        ));
      } else {
        frameId = requestAnimationFrame(measure);
      }
    };

    // First measure after layout
    frameId = requestAnimationFrame(measure);

    const el = graphContainerRef.current;
    if (!el) {
      return () => {
        if (frameId !== null) cancelAnimationFrame(frameId);
      };
    }

    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(el);

    window.addEventListener('resize', measure);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [activeTab]);

  // Daemon connection state
  const [daemonHealth, setDaemonHealth] = useState<DaemonHealth | null>(null);
  const [daemonStarting, setDaemonStarting] = useState(false);
  const [daemonConnected, setDaemonConnected] = useState(false);
  const [learningStatus, setLearningStatus] = useState<{
    pendingCount: number;
    highPriorityPendingCount: number;
    promotionProposalCount: number;
    readyForPromotionCount: number;
    learningsDir?: string;
  } | null>(null);
  const [learningType, setLearningType] = useState<'learning' | 'error' | 'feature'>('learning');
  const [learningSummary, setLearningSummary] = useState('');
  const [learningDetails, setLearningDetails] = useState('');
  const [learningAction, setLearningAction] = useState('');
  const [learningCategory, setLearningCategory] = useState<'correction' | 'insight' | 'knowledge_gap' | 'best_practice'>('insight');
  const [learningArea, setLearningArea] = useState<'frontend' | 'backend' | 'infra' | 'tests' | 'docs' | 'config'>('docs');
  const [learningPriority, setLearningPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [learningSaving, setLearningSaving] = useState(false);
  const [learningFeedback, setLearningFeedback] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [promotionProposals, setPromotionProposals] = useState<Array<{
    id: string;
    status: 'proposed' | 'approved' | 'rejected';
    target: 'AGENTS.md' | 'SOUL.md' | 'TOOLS.md';
    summary: string;
    ruleText: string;
    evidenceCount: number;
    createdAt?: string;
  }>>([]);
  const [promotionLoading, setPromotionLoading] = useState(false);
  const [promotionApplyingId, setPromotionApplyingId] = useState<string | null>(null);
  const [promotionRejectingId, setPromotionRejectingId] = useState<string | null>(null);
  const [promotionApplyingAll, setPromotionApplyingAll] = useState(false);

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

  // Load evolution chain for a card
  const loadEvolution = useCallback(async (cardId: string) => {
    if (!api) return;
    setEvolutionLoading(true);
    try {
      const result = await api.memoryGetCardEvolution(cardId);
      setCardEvolution(Array.isArray(result?.chain) ? result.chain : Array.isArray(result) ? result : []);
    } catch {
      setCardEvolution([]);
    } finally {
      setEvolutionLoading(false);
    }
  }, [api]);

  // Toggle card expansion — load evolution on first expand
  const toggleCardExpand = useCallback((cardId: string) => {
    if (expandedCard === cardId) {
      setExpandedCard(null);
      setCardEvolution(null);
    } else {
      setExpandedCard(cardId);
      loadEvolution(cardId);
    }
  }, [expandedCard, loadEvolution]);

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

  const loadLearningStatus = useCallback(async () => {
    if (!api?.memoryLearningStatus) return;
    try {
      const status = await api.memoryLearningStatus({ agentId: config.selectedAgentId || 'main' });
      if (status?.success) {
        setLearningStatus({
          pendingCount: Number(status.pendingCount || 0),
          highPriorityPendingCount: Number(status.highPriorityPendingCount || 0),
          promotionProposalCount: Number(status.promotionProposalCount || 0),
          readyForPromotionCount: Number(status.readyForPromotionCount || 0),
          learningsDir: status.learningsDir,
        });
      }
    } catch {
      // keep silent: .learnings is optional and should not break memory page
    }
  }, [api, config.selectedAgentId]);

  const loadPromotionProposals = useCallback(async () => {
    if (!api?.memoryPromotionList) return;
    setPromotionLoading(true);
    try {
      const result = await api.memoryPromotionList({ agentId: config.selectedAgentId || 'main' });
      if (result?.success) {
        const items = Array.isArray(result.items) ? result.items : [];
        setPromotionProposals(items.slice(0, 12));
      }
    } catch {
      // keep silent: proposal file is optional
    } finally {
      setPromotionLoading(false);
    }
  }, [api, config.selectedAgentId]);

  const applyPromotionProposal = useCallback(async (proposalId: string) => {
    if (!api?.memoryPromotionApply || !proposalId) return;
    setPromotionApplyingId(proposalId);
    try {
      const result = await api.memoryPromotionApply({
        proposalId,
        agentId: config.selectedAgentId || 'main',
      });
      if (result?.success) {
        setLearningFeedback({
          kind: 'success',
          message: `${t('memory.selfImprovement.proposalApplied', 'Applied proposal to target file.')}${result?.proposal?.target ? ` (${result.proposal.target})` : ''}`,
        });
        await Promise.all([loadLearningStatus(), loadPromotionProposals()]);
      } else {
        setLearningFeedback({
          kind: 'error',
          message: result?.error || t('memory.selfImprovement.proposalApplyFailed', 'Failed to apply promotion proposal.'),
        });
      }
    } catch {
      setLearningFeedback({ kind: 'error', message: t('memory.selfImprovement.proposalApplyFailed', 'Failed to apply promotion proposal.') });
    } finally {
      setPromotionApplyingId(null);
    }
  }, [api, config.selectedAgentId, loadLearningStatus, loadPromotionProposals, t]);

  const rejectPromotionProposal = useCallback(async (proposalId: string) => {
    if (!api?.memoryPromotionReject || !proposalId) return;
    setPromotionRejectingId(proposalId);
    try {
      const result = await api.memoryPromotionReject({
        proposalId,
        agentId: config.selectedAgentId || 'main',
      });
      if (result?.success) {
        setLearningFeedback({
          kind: 'success',
          message: t('memory.selfImprovement.proposalRejected', 'Rejected promotion proposal.'),
        });
        await Promise.all([loadLearningStatus(), loadPromotionProposals()]);
      } else {
        setLearningFeedback({
          kind: 'error',
          message: result?.error || t('memory.selfImprovement.proposalRejectFailed', 'Failed to reject promotion proposal.'),
        });
      }
    } catch {
      setLearningFeedback({ kind: 'error', message: t('memory.selfImprovement.proposalRejectFailed', 'Failed to reject promotion proposal.') });
    } finally {
      setPromotionRejectingId(null);
    }
  }, [api, config.selectedAgentId, loadLearningStatus, loadPromotionProposals, t]);

  const applyAllPromotionProposals = useCallback(async () => {
    if (!api?.memoryPromotionApplyAll) return;
    setPromotionApplyingAll(true);
    try {
      const result = await api.memoryPromotionApplyAll({
        agentId: config.selectedAgentId || 'main',
      });
      if (result?.success) {
        const appliedCount = Number(result?.result?.appliedCount || 0);
        const requestedCount = Number(result?.result?.requestedCount || 0);
        setLearningFeedback({
          kind: 'success',
          message: `${t('memory.selfImprovement.proposalApplyAllDone', 'Applied all proposed entries.')} ${appliedCount}/${requestedCount}`,
        });
        await Promise.all([loadLearningStatus(), loadPromotionProposals()]);
      } else {
        setLearningFeedback({
          kind: 'error',
          message: result?.error || t('memory.selfImprovement.proposalApplyAllFailed', 'Failed to apply all proposals.'),
        });
      }
    } catch {
      setLearningFeedback({ kind: 'error', message: t('memory.selfImprovement.proposalApplyAllFailed', 'Failed to apply all proposals.') });
    } finally {
      setPromotionApplyingAll(false);
    }
  }, [api, config.selectedAgentId, loadLearningStatus, loadPromotionProposals, t]);

  const submitLearningLog = useCallback(async () => {
    if (!api?.memoryLogLearning) return;
    const summary = learningSummary.trim();
    if (!summary) {
      setLearningFeedback({ kind: 'error', message: t('memory.selfImprovement.errorSummaryRequired', 'Please add a short summary first.') });
      return;
    }

    setLearningSaving(true);
    setLearningFeedback(null);
    try {
      const result = await api.memoryLogLearning({
        type: learningType,
        summary,
        details: learningDetails.trim() || undefined,
        suggestedAction: learningAction.trim() || undefined,
        category: learningType === 'learning' ? learningCategory : undefined,
        area: learningArea,
        priority: learningPriority,
        commandName: learningType === 'error' ? 'desktop_chat' : undefined,
        source: 'desktop',
        complexity: learningType === 'feature' ? 'medium' : undefined,
        userContext: learningType === 'feature' ? learningDetails.trim() || undefined : undefined,
        frequency: learningType === 'feature' ? 'first_time' : undefined,
        agentId: config.selectedAgentId || 'main',
      });

      if (result?.success) {
        const generatedPromotions = Number(result?.promotion?.generatedCount || 0);
        setLearningSummary('');
        setLearningDetails('');
        setLearningAction('');
        setLearningFeedback({
          kind: 'success',
          message: generatedPromotions > 0
            ? `${t('memory.selfImprovement.saved', 'Saved to .learnings successfully.')} ${t('memory.selfImprovement.promotionGenerated', 'Generated promotion proposals:')} ${generatedPromotions}`
            : t('memory.selfImprovement.saved', 'Saved to .learnings successfully.'),
        });
        await Promise.all([loadLearningStatus(), loadPromotionProposals()]);
      } else {
        setLearningFeedback({
          kind: 'error',
          message: result?.error || t('memory.selfImprovement.saveFailed', 'Failed to save this learning entry.'),
        });
      }
    } catch {
      setLearningFeedback({ kind: 'error', message: t('memory.selfImprovement.saveFailed', 'Failed to save this learning entry.') });
    } finally {
      setLearningSaving(false);
    }
  }, [
    api,
    config.selectedAgentId,
    learningAction,
    learningArea,
    learningCategory,
    learningDetails,
    learningPriority,
    learningSummary,
    learningType,
    loadLearningStatus,
    loadPromotionProposals,
    t,
  ]);

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
            loadLearningStatus(),
            loadPromotionProposals(),
          ]);
        } else {
          await Promise.all([loadLearningStatus(), loadPromotionProposals()]);
        }
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [checkHealth, loadCards, loadContext, loadEvents, loadPerception, loadDailySummary, loadLearningStatus, loadPromotionProposals]);

  // Reload events when source view changes
  useEffect(() => {
    if (daemonConnected) {
      setEventsOffset(0);
      loadEvents(0, false, sourceView);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceView, daemonConnected]);

  // Auto-refresh when window regains focus (3.3)
  useEffect(() => {
    const onFocus = () => {
      if (daemonConnected) {
        checkHealth();
        loadEvents(0, false, sourceView);
        loadCards();
        loadPerception();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daemonConnected, sourceView]);

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
        loadLearningStatus(),
        loadPromotionProposals(),
      ]);
    } else {
      await Promise.all([loadLearningStatus(), loadPromotionProposals()]);
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
          loadLearningStatus(),
          loadPromotionProposals(),
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
          // Search knowledge cards via MCP semantic recall (structured JSON response)
          const result = await api.memorySearch(searchQuery);
          const content = result?.result?.content;
          const textBlock = content?.[0]?.text || '';
          const metaBlock = content?.[1]?.text || '';

          // Parse structured IDs and metadata from the JSON block
          let parsedMeta: any = {};
          try { parsedMeta = JSON.parse(metaBlock); } catch { /* ignore */ }
          const ids: string[] = parsedMeta._ids || [];

          // Parse readable text to extract titles and summaries (line-based)
          const searchCards: KnowledgeCard[] = [];
          const entries = textBlock.split(/\n\n/).filter((block: string) => /^\d+\.\s/.test(block.trim()));

          for (let i = 0; i < entries.length; i++) {
            const block = entries[i].trim();
            // Extract: "1. [type] title (score, time, tokens)\n   summary"
            const headerMatch = block.match(/^\d+\.\s+\[([^\]]*)\]\s+(.*?)(?:\s+\(([^)]+)\))?\s*$/m);
            const summaryLines = block.split('\n').slice(1).map((l: string) => l.trim()).filter(Boolean);
            const title = headerMatch?.[2] || block.split('\n')[0].replace(/^\d+\.\s*/, '');
            const category = headerMatch?.[1] || 'key_point';
            const meta = headerMatch?.[3] || '';

            // Parse meta: "85%, 2d ago, ~120tok"
            const scoreMatch = meta.match(/(\d+)%/);
            const daysMatch = meta.match(/(\d+)d\s*ago/);
            const todayMatch = meta.match(/\btoday\b/);
            const tokensMatch = meta.match(/~(\d+)tok/);

            searchCards.push({
              id: ids[i] || `search-${i}`,
              category,
              title,
              summary: summaryLines.join(' ') || title,
              status: 'active',
              confidence: scoreMatch ? parseInt(scoreMatch[1]) / 100 : undefined,
              days_ago: todayMatch ? 0 : daysMatch ? parseInt(daysMatch[1]) : undefined,
              tokens_est: tokensMatch ? parseInt(tokensMatch[1]) : undefined,
              tags: '',
            });
          }

          setSearchResults(searchCards.length > 0 ? searchCards : []);
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
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Brain size={18} className="text-brand-300" />
              {t('memory.title')}
            </h1>
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
              const CategoryIcon = display.icon;
              return (
                <button
                  key={cat}
                  onClick={() => { setSelectedCategory(cat); setSearchResults(null); }}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    selectedCategory === cat ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <CategoryIcon size={12} />
                    {t(display.label, display.label)} ({count})
                  </span>
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
                    const CardIcon = cfg.icon;
                    return (
                      <div key={i} className="flex items-start gap-2 text-[11px]">
                        <CardIcon size={13} className="mt-0.5 text-slate-300" />
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
                  const config: Record<string, { icon: typeof Lightbulb; color: string }> = {
                    contradiction: { icon: TriangleAlert, color: 'border-red-500/30 bg-red-500/5' },
                    pattern: { icon: RefreshCw, color: 'border-amber-500/30 bg-amber-500/5' },
                    resonance: { icon: Sparkles, color: 'border-purple-500/30 bg-purple-500/5' },
                    staleness: { icon: AlarmClock, color: 'border-slate-500/30 bg-slate-500/5' },
                  };
                  const c = config[signal.type] || { icon: Lightbulb, color: 'border-brand-500/30 bg-brand-500/5' };
                  const SignalIcon = c.icon;
                  return (
                    <div key={i} className={`p-3 rounded-xl border ${c.color} flex items-start gap-2.5`}>
                      <SignalIcon size={16} className="mt-0.5 text-slate-200/85" />
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
                  const SourceIcon = src.icon;
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
                        <SourceIcon size={16} className="text-slate-300" />
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
                        <h4 className="flex items-center gap-1.5 font-medium text-sm mb-1 text-slate-200">
                          <FileCode size={14} className="text-slate-400" />
                          {parsedCode.shortPath}
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
                  const CategoryIcon = catDisplay.icon;
                  const isExpanded = expandedCard === card.id;
                  const relatedSignal = signals.find(s => s.card_id === card.id || (s.card_title && s.card_title === card.title));
                  const RelatedSignalIcon = relatedSignal?.type === 'staleness'
                    ? AlarmClock
                    : relatedSignal?.type === 'contradiction'
                      ? TriangleAlert
                      : Bell;
                  return (
                    <div
                      key={card.id || i}
                      onClick={() => card.id && toggleCardExpand(card.id)}
                      className={`p-4 rounded-xl border transition-colors cursor-pointer ${
                        card.status === 'superseded'
                          ? 'bg-slate-800/30 border-slate-700/30 opacity-60'
                          : isExpanded
                            ? 'bg-slate-800/70 border-brand-500/50 ring-1 ring-brand-500/20'
                            : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <CategoryIcon size={14} className={catDisplay.color} />
                        <span className={`text-xs font-medium ${catDisplay.color}`}>{t(catDisplay.label, catDisplay.label)}</span>
                        {card.created_at && (
                          <>
                            <span className="text-xs text-slate-600">&middot;</span>
                            <span className="text-xs text-slate-500">{new Date(card.created_at).toLocaleDateString()}</span>
                          </>
                        )}
                        {card.confidence != null && card.confidence > 0 && (
                          <span className="text-xs text-sky-400/70 font-medium">{Math.round(card.confidence * 100)}%</span>
                        )}
                        {card.days_ago != null && (
                          <span className="text-xs text-slate-500">
                            {card.days_ago === 0 ? t('memory.today', 'today') : `${card.days_ago}d ago`}
                          </span>
                        )}
                        {card.tokens_est != null && card.tokens_est > 0 && (
                          <span className="text-[10px] text-slate-600">~{card.tokens_est}tok</span>
                        )}
                        {card.status === 'superseded' && (
                          <span className="text-xs px-1.5 py-0.5 bg-amber-600/20 rounded text-amber-500 border border-amber-600/30">
                            {t('memory.superseded', 'Superseded')}
                          </span>
                        )}
                        {relatedSignal && (
                          <span className="text-xs px-1.5 py-0.5 bg-purple-600/20 rounded text-purple-400 border border-purple-600/30">
                            <RelatedSignalIcon size={11} className="inline mr-1" />{relatedSignal.type}
                          </span>
                        )}
                        <span className="ml-auto text-xs text-slate-600">
                          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </span>
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

                      {/* Expanded detail: tags + evolution chain */}
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-700/50 space-y-2" onClick={(e) => e.stopPropagation()}>
                          {/* Tags */}
                          {card.tags && (() => {
                            const tags = typeof card.tags === 'string' ? (() => { try { return JSON.parse(card.tags); } catch { return []; } })() : card.tags;
                            return Array.isArray(tags) && tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {tags.map((tag: string, j: number) => (
                                  <span key={j} className="text-xs px-1.5 py-0.5 bg-slate-700/60 rounded text-slate-400">{tag}</span>
                                ))}
                              </div>
                            ) : null;
                          })()}

                          {/* Evolution chain */}
                          {evolutionLoading ? (
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                              <Loader2 size={12} className="animate-spin" />
                              {t('memory.loadingEvolution', 'Loading history...')}
                            </div>
                          ) : cardEvolution && cardEvolution.length > 0 ? (
                            <div className="space-y-1.5">
                              <p className="text-xs font-medium text-slate-400">{t('memory.evolutionChain', 'Version History')}</p>
                              {cardEvolution.map((ver: any, j: number) => (
                                <div key={j} className={`text-xs p-2 rounded ${ver.id === card.id ? 'bg-brand-500/10 border border-brand-500/20' : 'bg-slate-800/50'}`}>
                                  <span className="text-slate-500">{ver.created_at ? new Date(ver.created_at).toLocaleDateString() : ''}</span>
                                  {' '}
                                  <span className={ver.status === 'superseded' ? 'line-through text-slate-600' : 'text-slate-300'}>{ver.title || '(no title)'}</span>
                                  {ver.evolution_type && ver.evolution_type !== 'initial' && (
                                    <span className="ml-1 text-amber-400">({ver.evolution_type})</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          ) : cardEvolution !== null ? (
                            <p className="text-xs text-slate-600">{t('memory.noEvolution', 'No version history')}</p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* === KNOWLEDGE GRAPH TAB === */}
            {activeTab === 'graph' && (
              <div ref={graphContainerRef} className="flex-1 -mx-6 -mb-3 memory-graph-container">
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

                <section className="rounded-[24px] border border-slate-700/60 bg-slate-900/55 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{t('memory.selfImprovement.badge', 'Self Improvement')}</div>
                      <h3 className="mt-2 text-base font-semibold text-slate-100">{t('memory.selfImprovement.title', 'Capture Learnings, Errors, and Feature Requests')}</h3>
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
                        {t('memory.selfImprovement.desc', 'Official self-improving-agent workflow writes structured entries into .learnings so patterns can be promoted into AGENTS.md, SOUL.md, and TOOLS.md later.')}
                      </p>
                    </div>
                    <div className="grid min-w-[260px] gap-2 sm:grid-cols-3">
                      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{t('memory.selfImprovement.pending', 'Pending')}</div>
                        <div className="mt-1 text-sm font-medium text-slate-100">{learningStatus?.pendingCount ?? 0}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{t('memory.selfImprovement.highPriority', 'High Priority')}</div>
                        <div className="mt-1 text-sm font-medium text-amber-300">{learningStatus?.highPriorityPendingCount ?? 0}</div>
                      </div>
                      <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3">
                        <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{t('memory.selfImprovement.proposals', 'Promotion Proposals')}</div>
                        <div className="mt-1 text-sm font-medium text-cyan-300">{learningStatus?.promotionProposalCount ?? 0}</div>
                        <div className="mt-1 text-[11px] text-slate-500">
                          {t('memory.selfImprovement.ready', 'Ready')}: {learningStatus?.readyForPromotionCount ?? 0}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 md:grid-cols-3">
                    <label className="space-y-1 text-xs text-slate-400">
                      <span>{t('memory.selfImprovement.type', 'Type')}</span>
                      <select
                        value={learningType}
                        onChange={(event) => setLearningType(event.target.value as 'learning' | 'error' | 'feature')}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
                      >
                        <option value="learning">{t('memory.selfImprovement.type.learning', 'Learning')}</option>
                        <option value="error">{t('memory.selfImprovement.type.error', 'Error')}</option>
                        <option value="feature">{t('memory.selfImprovement.type.feature', 'Feature Request')}</option>
                      </select>
                    </label>

                    <label className="space-y-1 text-xs text-slate-400">
                      <span>{t('memory.selfImprovement.area', 'Area')}</span>
                      <select
                        value={learningArea}
                        onChange={(event) => setLearningArea(event.target.value as 'frontend' | 'backend' | 'infra' | 'tests' | 'docs' | 'config')}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
                      >
                        {['frontend', 'backend', 'infra', 'tests', 'docs', 'config'].map((area) => (
                          <option key={area} value={area}>{area}</option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1 text-xs text-slate-400">
                      <span>{t('memory.selfImprovement.priority', 'Priority')}</span>
                      <select
                        value={learningPriority}
                        onChange={(event) => setLearningPriority(event.target.value as 'low' | 'medium' | 'high' | 'critical')}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
                      >
                        {['low', 'medium', 'high', 'critical'].map((priority) => (
                          <option key={priority} value={priority}>{priority}</option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {learningType === 'learning' && (
                    <label className="mt-3 block space-y-1 text-xs text-slate-400">
                      <span>{t('memory.selfImprovement.category', 'Category')}</span>
                      <select
                        value={learningCategory}
                        onChange={(event) => setLearningCategory(event.target.value as 'correction' | 'insight' | 'knowledge_gap' | 'best_practice')}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 focus:border-brand-500 focus:outline-none"
                      >
                        <option value="correction">correction</option>
                        <option value="insight">insight</option>
                        <option value="knowledge_gap">knowledge_gap</option>
                        <option value="best_practice">best_practice</option>
                      </select>
                    </label>
                  )}

                  <label className="mt-3 block space-y-1 text-xs text-slate-400">
                    <span>{t('memory.selfImprovement.summary', 'Summary')}</span>
                    <input
                      value={learningSummary}
                      onChange={(event) => setLearningSummary(event.target.value)}
                      placeholder={t('memory.selfImprovement.summaryPlaceholder', 'One-line description of what happened')}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
                    />
                  </label>

                  <label className="mt-3 block space-y-1 text-xs text-slate-400">
                    <span>{t('memory.selfImprovement.details', 'Details')}</span>
                    <textarea
                      value={learningDetails}
                      onChange={(event) => setLearningDetails(event.target.value)}
                      rows={3}
                      placeholder={t('memory.selfImprovement.detailsPlaceholder', 'Include context, what was wrong, and what changed.')}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
                    />
                  </label>

                  <label className="mt-3 block space-y-1 text-xs text-slate-400">
                    <span>{t('memory.selfImprovement.action', 'Suggested Action')}</span>
                    <textarea
                      value={learningAction}
                      onChange={(event) => setLearningAction(event.target.value)}
                      rows={2}
                      placeholder={t('memory.selfImprovement.actionPlaceholder', 'What should we do differently next time?')}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none"
                    />
                  </label>

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">
                      {learningStatus?.learningsDir
                        ? `${t('memory.selfImprovement.location', 'Writing to')}: ${learningStatus.learningsDir}`
                        : t('memory.selfImprovement.locationUnknown', 'The .learnings directory will be created automatically.')}
                      <div className="mt-1 text-[11px] text-slate-600">
                        {t('memory.selfImprovement.promotionRule', 'Auto-proposal rule: recurring pattern >= 3 entries in the recent 30-day window.')}
                      </div>
                    </div>
                    <button
                      onClick={() => { void submitLearningLog(); }}
                      disabled={learningSaving}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-brand-600 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {learningSaving ? <Loader2 size={12} className="animate-spin" /> : null}
                      {learningSaving
                        ? t('memory.selfImprovement.saving', 'Saving...')
                        : t('memory.selfImprovement.save', 'Save Entry')}
                    </button>
                  </div>

                  {learningFeedback && (
                    <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${
                      learningFeedback.kind === 'success'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-red-500/40 bg-red-500/10 text-red-200'
                    }`}>
                      {learningFeedback.message}
                    </div>
                  )}

                  <div className="mt-5 rounded-2xl border border-slate-700/70 bg-slate-950/50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{t('memory.selfImprovement.proposalQueue', 'Promotion Queue')}</div>
                        <div className="mt-1 text-[11px] text-slate-500">{t('memory.selfImprovement.proposalQueueDesc', 'Approve proposals to write rules into AGENTS.md, SOUL.md, or TOOLS.md.')}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { void applyAllPromotionProposals(); }}
                          disabled={promotionLoading || promotionApplyingAll || !promotionProposals.some((item) => item.status === 'proposed')}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-600/60 px-2.5 py-1 text-[11px] text-cyan-300 hover:bg-cyan-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {promotionApplyingAll ? <Loader2 size={11} className="animate-spin" /> : null}
                          {promotionApplyingAll
                            ? t('memory.selfImprovement.proposalApplyingAll', 'Applying all...')
                            : t('memory.selfImprovement.proposalApplyAll', 'Apply All Proposed')}
                        </button>
                        <button
                          onClick={() => { void loadPromotionProposals(); }}
                          disabled={promotionLoading || promotionApplyingAll}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-600 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {promotionLoading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                          {t('common.refresh', 'Refresh')}
                        </button>
                      </div>
                    </div>

                    {promotionProposals.length === 0 ? (
                      <div className="mt-3 text-xs text-slate-500">{t('memory.selfImprovement.proposalEmpty', 'No promotion proposals yet.')}</div>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {promotionProposals.map((proposal) => (
                          <div key={proposal.id} className="rounded-xl border border-slate-700/70 bg-slate-900/60 p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <div className="text-xs font-medium text-slate-100">{proposal.id}</div>
                                <div className="mt-1 text-[11px] text-slate-400">{proposal.summary || proposal.ruleText}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-[11px] text-cyan-300">{proposal.target}</div>
                                <div className="text-[11px] text-slate-500">{t('memory.selfImprovement.status', 'Status')}: {proposal.status}</div>
                              </div>
                            </div>
                            {proposal.status === 'proposed' && (
                              <div className="mt-3 flex justify-end gap-2">
                                <button
                                  onClick={() => { void rejectPromotionProposal(proposal.id); }}
                                  disabled={promotionRejectingId === proposal.id || promotionApplyingId === proposal.id || promotionApplyingAll}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/50 px-3 py-1.5 text-[11px] font-medium text-red-200 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {promotionRejectingId === proposal.id ? <Loader2 size={11} className="animate-spin" /> : null}
                                  {promotionRejectingId === proposal.id
                                    ? t('memory.selfImprovement.proposalRejecting', 'Rejecting...')
                                    : t('memory.selfImprovement.proposalReject', 'Reject')}
                                </button>
                                <button
                                  onClick={() => { void applyPromotionProposal(proposal.id); }}
                                  disabled={promotionApplyingId === proposal.id || promotionRejectingId === proposal.id || promotionApplyingAll}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {promotionApplyingId === proposal.id ? <Loader2 size={11} className="animate-spin" /> : null}
                                  {promotionApplyingId === proposal.id
                                    ? t('memory.selfImprovement.proposalApplying', 'Applying...')
                                    : t('memory.selfImprovement.proposalApply', 'Apply to Target')}
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
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
