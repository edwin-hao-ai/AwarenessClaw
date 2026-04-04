/**
 * Shared types, constants, and utility functions for Memory page components.
 * Extracted from Memory.tsx to reduce file size and improve reusability.
 */

import type { MemoryKnowledgeCard } from '../../lib/memory-context';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerceptionSignal {
  type: string;
  message: string;
  card_id?: string;
  card_title?: string;
}

export type KnowledgeCard = MemoryKnowledgeCard;

export interface MemoryEvent {
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

export interface DaemonHealth {
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

export type TabView = 'timeline' | 'knowledge' | 'graph' | 'settings';

// ---------------------------------------------------------------------------
// Category & Source display config
// ---------------------------------------------------------------------------

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

export function getCategoryDisplay(category: string): { emoji: string; label: string; color: string } {
  const known = CATEGORY_CONFIG[category];
  if (known) return { emoji: known.emoji, label: known.labelKey, color: known.color };
  const humanized = category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return { emoji: '🏷️', label: humanized, color: 'text-slate-400' };
}

export function getSourceDisplay(source: string | undefined): { emoji: string; label: string } {
  if (!source) return { emoji: '📝', label: 'Unknown' };
  return SOURCE_CONFIG[source] || { emoji: '📝', label: source };
}

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

export function parseCodeChangeContent(content: string): { filepath: string; shortPath: string; diffLines: string[] } {
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

  if (!filepath && lines.length > 0) {
    filepath = lines[0].trim();
  }

  const parts = filepath.replace(/\\/g, '/').split('/').filter(Boolean);
  const shortPath = parts.length >= 2 ? parts.slice(-2).join('/') : filepath;

  return { filepath, shortPath, diffLines };
}

export function formatRelativeTime(dateStr: string): string {
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

export function parseMcpResponse(result: any): { cards: KnowledgeCard[]; errorKey?: string } {
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

/** Shared markdown components for memory content rendering */
export const memoryMarkdownComponents = {
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
