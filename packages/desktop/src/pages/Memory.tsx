import { useState } from 'react';
import { Search, Filter, Lightbulb, AlertTriangle, User, Zap, RefreshCw } from 'lucide-react';

interface KnowledgeCard {
  id: string;
  category: string;
  title: string;
  summary: string;
  date: string;
  tags: string[];
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
};

const MOCK_CARDS: KnowledgeCard[] = [
  { id: '1', category: 'decision', title: '使用 PostgreSQL 作为主数据库', summary: '评估了 MongoDB 和 PostgreSQL，最终选择 PostgreSQL 因为需要 pgvector 支持向量搜索。', date: '2026-03-29', tags: ['数据库', '架构'] },
  { id: '2', category: 'pitfall', title: 'Docker build 必须用 nohup 后台执行', summary: 'SSH 前台执行 docker build 会超时断开，导致部署中断。', date: '2026-03-29', tags: ['部署', 'Docker'] },
  { id: '3', category: 'personal_preference', title: '用中文交流，代码用英文', summary: '用户偏好：推理和回复用中文，但代码、注释、变量名用英文。', date: '2026-03-28', tags: ['沟通'] },
  { id: '4', category: 'problem_solution', title: 'Prisma 不能用 db push', summary: 'prisma db push 会尝试删除 memory_vectors 表（有线上数据），必须手动 SQL 迁移。', date: '2026-03-27', tags: ['数据库', 'Prisma'] },
  { id: '5', category: 'insight', title: '感知信号不需要 LLM', summary: '矛盾检测和模式发现可以纯用 BM25 + 余弦相似度实现，<50ms，零 LLM 成本。', date: '2026-03-26', tags: ['性能', '算法'] },
];

interface PerceptionSignal {
  type: 'contradiction' | 'pattern' | 'resonance' | 'staleness';
  message: string;
}

const MOCK_SIGNALS: PerceptionSignal[] = [
  { type: 'contradiction', message: '你之前说"用 JWT 认证"，但今天说"改用 Session"' },
  { type: 'pattern', message: '最近 3 天都在处理数据库迁移问题' },
];

const SIGNAL_CONFIG = {
  contradiction: { emoji: '⚡', label: '矛盾', color: 'border-red-500/30 bg-red-500/5' },
  pattern: { emoji: '🔄', label: '重复模式', color: 'border-amber-500/30 bg-amber-500/5' },
  resonance: { emoji: '💫', label: '共鸣', color: 'border-purple-500/30 bg-purple-500/5' },
  staleness: { emoji: '⏰', label: '过期', color: 'border-slate-500/30 bg-slate-500/5' },
};

export default function Memory() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const filteredCards = MOCK_CARDS.filter((card) => {
    if (selectedCategory !== 'all' && card.category !== selectedCategory) return false;
    if (searchQuery && !card.title.includes(searchQuery) && !card.summary.includes(searchQuery)) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-lg font-semibold">🧠 AI 记忆</h1>
            <p className="text-xs text-slate-500">AI 从对话中提取的知识和经验</p>
          </div>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors">
            <RefreshCw size={12} />
            刷新
          </button>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索记忆..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
              selectedCategory === 'all' ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            全部
          </button>
          {Object.entries(CATEGORY_CONFIG).map(([key, { emoji, label }]) => (
            <button
              key={key}
              onClick={() => setSelectedCategory(key)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                selectedCategory === key ? 'bg-brand-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {emoji} {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Perception Signals */}
        {MOCK_SIGNALS.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">感知信号</h3>
            {MOCK_SIGNALS.map((signal, i) => {
              const config = SIGNAL_CONFIG[signal.type];
              return (
                <div key={i} className={`p-3 rounded-xl border ${config.color} flex items-start gap-3`}>
                  <span className="text-lg">{config.emoji}</span>
                  <div>
                    <span className="text-xs font-medium text-slate-400">{config.label}</span>
                    <p className="text-sm text-slate-200">{signal.message}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Knowledge Cards */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            知识卡片 ({filteredCards.length})
          </h3>
          {filteredCards.map((card) => {
            const config = CATEGORY_CONFIG[card.category] || CATEGORY_CONFIG.key_point;
            return (
              <div
                key={card.id}
                className="p-4 bg-slate-800/50 rounded-xl border border-slate-700/50 hover:border-slate-600 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span>{config.emoji}</span>
                  <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                  <span className="text-xs text-slate-600">•</span>
                  <span className="text-xs text-slate-500">{card.date}</span>
                </div>
                <h4 className="font-medium text-sm mb-1">{card.title}</h4>
                <p className="text-sm text-slate-400 leading-relaxed">{card.summary}</p>
                {card.tags.length > 0 && (
                  <div className="flex gap-1.5 mt-2">
                    {card.tags.map((tag) => (
                      <span key={tag} className="text-xs px-2 py-0.5 bg-slate-700 rounded-full text-slate-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
