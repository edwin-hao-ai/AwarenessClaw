import { useState, useEffect } from 'react';
import { Search, RefreshCw, Loader2, AlertCircle, Zap } from 'lucide-react';

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

const CATEGORY_CONFIG: Record<string, { emoji: string; label: string; color: string }> = {
  decision: { emoji: '💡', label: '决策', color: 'text-amber-400' },
  problem_solution: { emoji: '🔧', label: '经验教训', color: 'text-emerald-400' },
  workflow: { emoji: '📋', label: '工作流', color: 'text-blue-400' },
  pitfall: { emoji: '⚠️', label: '陷阱', color: 'text-red-400' },
  insight: { emoji: '✨', label: '洞察', color: 'text-purple-400' },
  key_point: { emoji: '📌', label: '要点', color: 'text-cyan-400' },
  personal_preference: { emoji: '👤', label: '偏好', color: 'text-pink-400' },
  important_detail: { emoji: '📎', label: '细节', color: 'text-orange-400' },
  skill: { emoji: '🛠️', label: '技能', color: 'text-indigo-400' },
};

/** Parse MCP JSON-RPC response into knowledge cards */
function parseMcpResponse(result: any): { cards: KnowledgeCard[]; error?: string } {
  if (result?.error) return { cards: [], error: '记忆服务未连接' };

  const text = result?.result?.content?.[0]?.text;
  if (!text) return { cards: [], error: '响应为空' };

  try {
    const parsed = JSON.parse(text);
    if (parsed.error) return { cards: [], error: parsed.error };

    // awareness_lookup returns { knowledge_cards: [...], total, mode }
    const items = parsed.knowledge_cards || parsed.items || parsed.cards || [];
    if (Array.isArray(items)) return { cards: items };

    return { cards: [] };
  } catch {
    return { cards: [], error: '解析失败' };
  }
}

export default function Memory() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[] | null>(null);
  const [signals, setSignals] = useState<PerceptionSignal[]>([]);
  const [searching, setSearching] = useState(false);

  // Load cards on mount
  useEffect(() => {
    loadCards();
    loadPerception();
  }, []);

  const loadCards = async () => {
    setLoading(true);
    setError(null);

    if (!window.electronAPI) {
      // Dev mode: use mock data
      setCards(MOCK_CARDS);
      setLoading(false);
      return;
    }

    try {
      const result = await (window.electronAPI as any).memoryGetCards();
      const parsed = parseMcpResponse(result);
      if (parsed.error) {
        setError(parsed.error);
        setCards(MOCK_CARDS);
      } else if (parsed.cards.length > 0) {
        setCards(parsed.cards);
      } else {
        setCards(MOCK_CARDS);
        setError('暂无记忆数据（显示示例）');
      }
    } catch {
      setError('无法连接到记忆服务');
      setCards(MOCK_CARDS);
    }

    setLoading(false);
  };

  const loadPerception = async () => {
    if (!window.electronAPI) return;
    try {
      const result = await (window.electronAPI as any).memoryGetPerception();
      const text = result?.result?.content?.[0]?.text;
      if (text) {
        const parsed = JSON.parse(text);
        setSignals(parsed.signals || []);
      }
    } catch { /* no perception data */ }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    setSearching(true);
    if (window.electronAPI) {
      try {
        const result = await (window.electronAPI as any).memorySearch(searchQuery);
        // Recall returns plain text, not JSON knowledge cards
        const text = result?.result?.content?.[0]?.text || '';
        if (text) {
          // Parse recall text into pseudo-cards for display
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

  const displayCards = searchResults || filteredCards;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold">🧠 AI 记忆</h1>
            <p className="text-xs text-slate-500">
              {error ? <span className="text-amber-500">{error}</span> : 'AI 从对话中提取的知识和经验'}
            </p>
          </div>
          <button
            onClick={loadCards}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            刷新
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索记忆（按回车语义搜索）..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
          {searching && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-brand-400" />}
        </div>

        {/* Category filter */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => { setSelectedCategory('all'); setSearchResults(null); }}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              selectedCategory === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            全部 ({cards.length})
          </button>
          {Object.entries(CATEGORY_CONFIG).map(([key, { emoji, label }]) => {
            const count = cards.filter(c => c.category === key).length;
            if (count === 0) return null;
            return (
              <button
                key={key}
                onClick={() => { setSelectedCategory(key); setSearchResults(null); }}
                className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                  selectedCategory === key ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                }`}
              >
                {emoji} {label} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-3">
        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-brand-500" />
          </div>
        )}

        {/* Perception Signals */}
        {signals.length > 0 && (
          <div className="space-y-2 mb-4">
            <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider flex items-center gap-1">
              <Zap size={12} /> 感知信号
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

        {!loading && displayCards.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <p>暂无记忆数据</p>
            <p className="text-xs mt-1">和 AI 对话后，记忆会自动出现在这里</p>
          </div>
        )}

        {!loading && displayCards.map((card: any, i: number) => {
          const config = CATEGORY_CONFIG[card.category] || { emoji: '📎', label: card.category, color: 'text-slate-400' };
          return (
            <div
              key={card.id || i}
              className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                <span>{config.emoji}</span>
                <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                {card.created_at && (
                  <>
                    <span className="text-xs text-slate-600">•</span>
                    <span className="text-xs text-slate-500">{new Date(card.created_at).toLocaleDateString()}</span>
                  </>
                )}
                {card.status === 'superseded' && (
                  <span className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-slate-500">已过时</span>
                )}
              </div>
              <h4 className="font-medium text-sm mb-1">{card.title}</h4>
              <p className="text-sm text-slate-400 leading-relaxed">{card.summary}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Fallback mock data when daemon is not connected
const MOCK_CARDS: KnowledgeCard[] = [
  { id: '1', category: 'decision', title: '使用 PostgreSQL 作为主数据库', summary: '评估了 MongoDB 和 PostgreSQL，选择 PostgreSQL 因为需要 pgvector 支持。', created_at: '2026-03-29' },
  { id: '2', category: 'pitfall', title: 'Docker build 必须用 nohup', summary: 'SSH 前台执行 docker build 会超时断开，导致部署中断。', created_at: '2026-03-29' },
  { id: '3', category: 'personal_preference', title: '中文交流，代码用英文', summary: '用户偏好推理和回复用中文，代码用英文。', created_at: '2026-03-28' },
];
