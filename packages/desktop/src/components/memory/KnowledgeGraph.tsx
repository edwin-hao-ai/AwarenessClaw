import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { useI18n } from '../../lib/i18n';

// ── Types ──────────────────────────────────────────────────────────────────

interface KnowledgeCard {
  id: string;
  category: string;
  title: string;
  summary: string;
  created_at?: string;
  status?: string;
}

interface MemoryEvent {
  id: string;
  type?: string;
  title?: string;
  source?: string;
  session_id?: string;
  tags?: string;
  created_at?: string;
}

interface Props {
  cards: KnowledgeCard[];
  events: MemoryEvent[];
  width: number;
  height: number;
  onCardClick?: (card: KnowledgeCard) => void;
}

// ── Category palette ───────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  decision: '#f59e0b',         // amber
  problem_solution: '#10b981', // emerald
  workflow: '#3b82f6',         // blue
  pitfall: '#ef4444',          // red
  insight: '#a855f7',          // purple
  key_point: '#06b6d4',        // cyan
  personal_preference: '#ec4899', // pink
  important_detail: '#f97316', // orange
  skill: '#6366f1',            // indigo
};

function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] || '#64748b';
}

// ── Keyword extraction (lightweight, client-side) ──────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'up', 'down',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too',
  'very', 'just', 'because', 'if', 'when', 'where', 'how', 'what',
  'which', 'who', 'whom', 'this', 'that', 'these', 'those', 'it', 'its',
  'then', 'also', 'about', 'over', 'use', 'used', 'using', 'new',
]);

function extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, ' ').split(/\s+/);
  const kw = new Set<string>();
  for (const w of words) {
    if (w.length >= 3 && !STOP_WORDS.has(w)) kw.add(w);
  }
  return kw;
}

function keywordOverlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  const minSize = Math.min(a.size, b.size);
  return minSize > 0 ? shared / minSize : 0;
}

// ── Graph data builder ─────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  category: string;
  color: string;
  val: number; // node size
  card: KnowledgeCard;
}

interface GraphLink {
  source: string;
  target: string;
  value: number; // strength 0-1
  reason: string;
}

function buildGraphData(cards: KnowledgeCard[], events: MemoryEvent[]) {
  if (cards.length === 0) return { nodes: [], links: [] };

  // Build nodes
  const nodes: GraphNode[] = cards
    .filter(c => c.status !== 'superseded')
    .map((card) => ({
      id: card.id,
      label: card.title || card.summary?.slice(0, 40) || card.id,
      category: card.category,
      color: getCategoryColor(card.category),
      val: 1,
      card,
    }));

  const nodeIds = new Set(nodes.map(n => n.id));

  // Extract keywords for each card
  const cardKeywords = new Map<string, Set<string>>();
  for (const card of cards) {
    if (card.status === 'superseded') continue;
    const text = `${card.title || ''} ${card.summary || ''}`;
    cardKeywords.set(card.id, extractKeywords(text));
  }

  // Build keyword-based links
  const links: GraphLink[] = [];
  const nodeList = nodes;
  for (let i = 0; i < nodeList.length; i++) {
    for (let j = i + 1; j < nodeList.length; j++) {
      const a = nodeList[i];
      const b = nodeList[j];
      const kwA = cardKeywords.get(a.id);
      const kwB = cardKeywords.get(b.id);
      if (!kwA || !kwB) continue;

      const overlap = keywordOverlap(kwA, kwB);
      // Threshold: at least 20% keyword overlap
      if (overlap >= 0.2) {
        links.push({
          source: a.id,
          target: b.id,
          value: overlap,
          reason: 'keyword',
        });
      }
    }
  }

  // Build session-based links from events
  // Map: session_id -> [card IDs that were created in that session's time window]
  const sessionCards = new Map<string, string[]>();
  for (const event of events) {
    if (!event.session_id || !event.created_at) continue;
    const eventTime = new Date(event.created_at).getTime();
    // Find cards created within 5 minutes of this event
    for (const card of cards) {
      if (card.status === 'superseded' || !card.created_at) continue;
      if (!nodeIds.has(card.id)) continue;
      const cardTime = new Date(card.created_at).getTime();
      if (Math.abs(cardTime - eventTime) < 5 * 60 * 1000) {
        const arr = sessionCards.get(event.session_id) || [];
        if (!arr.includes(card.id)) arr.push(card.id);
        sessionCards.set(event.session_id, arr);
      }
    }
  }

  // Create session links
  const existingLinks = new Set(links.map(l => `${l.source}|${l.target}`));
  for (const [, cardIds] of sessionCards) {
    for (let i = 0; i < cardIds.length; i++) {
      for (let j = i + 1; j < cardIds.length; j++) {
        const key1 = `${cardIds[i]}|${cardIds[j]}`;
        const key2 = `${cardIds[j]}|${cardIds[i]}`;
        if (!existingLinks.has(key1) && !existingLinks.has(key2)) {
          links.push({
            source: cardIds[i],
            target: cardIds[j],
            value: 0.5,
            reason: 'session',
          });
          existingLinks.add(key1);
        }
      }
    }
  }

  return { nodes, links };
}

// ── Component ──────────────────────────────────────────────────────────────

export default function KnowledgeGraph({ cards, events, width, height, onCardClick }: Props) {
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === 'undefined') return true;
    return document.documentElement.classList.contains('dark');
  });
  const { t } = useI18n();

  const graphData = useMemo(() => buildGraphData(cards, events), [cards, events]);

  // Re-fit when data or viewport size changes
  useEffect(() => {
    if (!graphRef.current || graphData.nodes.length === 0) return;
    const id = setTimeout(() => {
      graphRef.current?.zoomToFit(400, 60);
    }, 500);
    return () => clearTimeout(id);
  }, [graphData, width, height]);

  // Track light/dark mode so canvas text/links stay readable in both themes.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const syncTheme = () => setIsDark(root.classList.contains('dark'));
    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  // Increase graph spacing and reduce overlap.
  useEffect(() => {
    const fg = graphRef.current;
    if (!fg || graphData.nodes.length === 0) return;

    const charge = fg.d3Force('charge') as any;
    if (charge && typeof charge.strength === 'function') {
      charge.strength(-420);
    }

    const link = fg.d3Force('link') as any;
    if (link) {
      if (typeof link.distance === 'function') {
        link.distance((l: any) => {
          const base = l?.reason === 'session' ? 230 : 180;
          const score = typeof l?.value === 'number' ? l.value : 0.4;
          return base + Math.round((1 - Math.min(1, score)) * 70);
        });
      }
      if (typeof link.strength === 'function') {
        link.strength((l: any) => (l?.reason === 'session' ? 0.55 : 0.85));
      }
    }
  }, [graphData.nodes.length, graphData.links.length]);

  const handleNodeHover = useCallback((node: any, prevNode: any) => {
    if (node) {
      setHoveredNode(node as GraphNode);
    } else {
      setHoveredNode(null);
    }
  }, []);

  const handleNodeClick = useCallback((node: any) => {
    const gNode = node as GraphNode;
    if (gNode.card && onCardClick) {
      onCardClick(gNode.card);
    }
  }, [onCardClick]);

  // Custom node rendering
  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const gNode = node as GraphNode & { x: number; y: number };
    const fontSize = Math.max(11 / globalScale, 2);
    const nodeRadius = 7;
    const isHovered = hoveredNode?.id === gNode.id;
    const radius = isHovered ? nodeRadius * 1.45 : nodeRadius;

    // Hollow node ring
    ctx.beginPath();
    ctx.arc(gNode.x, gNode.y, radius, 0, 2 * Math.PI);
    ctx.strokeStyle = gNode.color;
    ctx.lineWidth = (isHovered ? 3.2 : 2.4) / globalScale;
    ctx.stroke();

    if (isHovered) {
      ctx.beginPath();
      ctx.arc(gNode.x, gNode.y, radius + 2.8 / globalScale, 0, 2 * Math.PI);
      ctx.strokeStyle = isDark ? 'rgba(226,232,240,0.65)' : 'rgba(15,23,42,0.45)';
      ctx.lineWidth = 1.4 / globalScale;
      ctx.stroke();
    }

    // Small center dot improves hit readability when zoomed out.
    ctx.beginPath();
    ctx.arc(gNode.x, gNode.y, 1.25 / globalScale, 0, 2 * Math.PI);
    ctx.fillStyle = gNode.color;
    ctx.fill();

    // Label below node
    if (globalScale > 0.55) {
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = isDark ? '#e2e8f0' : '#334155';
      const maxLen = Math.min(Math.round(20 / Math.max(0.5, 1 / globalScale)), 30);
      const label = gNode.label.length > maxLen ? gNode.label.slice(0, maxLen) + '...' : gNode.label;
      ctx.fillText(label, gNode.x, gNode.y + radius + fontSize + 1);
    }
  }, [hoveredNode, isDark]);

  // Custom link rendering
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const src = link.source as any;
    const tgt = link.target as any;
    if (!src.x || !tgt.x) return;

    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = link.reason === 'session'
      ? (isDark ? 'rgba(96,165,250,0.52)' : 'rgba(59,130,246,0.46)')
      : (isDark ? 'rgba(148,163,184,0.34)' : 'rgba(71,85,105,0.30)');
    ctx.lineWidth = Math.max(0.95, 0.95 + (link.value || 0.3) * 1.8) / globalScale;
    ctx.stroke();
  }, [isDark]);

  // Build legend data
  const categoriesInGraph = useMemo(() => {
    const cats = new Set(graphData.nodes.map(n => n.category));
    return Array.from(cats).sort();
  }, [graphData]);

  if (graphData.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-slate-500 space-y-2">
        <p className="text-sm">{t('memory.graph.empty', 'No knowledge cards to visualize')}</p>
        <p className="text-xs">{t('memory.graph.emptyHint', 'Cards will appear here as the AI learns from your conversations')}</p>
      </div>
    );
  }

  return (
    <div className="relative" style={{ width, height }}>
      {/* Force Graph */}
      <ForceGraph2D
        ref={graphRef as any}
        width={width}
        height={height}
        graphData={graphData}
        backgroundColor="transparent"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node: any, color, ctx) => {
          ctx.beginPath();
          ctx.arc(node.x, node.y, 12, 0, 2 * Math.PI);
          ctx.fillStyle = color;
          ctx.fill();
        }}
        linkCanvasObject={paintLink}
        onNodeHover={handleNodeHover}
        onNodeClick={handleNodeClick}
        cooldownTicks={100}
        d3AlphaDecay={0.03}
        d3VelocityDecay={0.3}
        enableNodeDrag={true}
        enableZoomInteraction={true}
        enablePanInteraction={true}
      />

      {/* Legend */}
      <div className={`absolute top-3 left-3 rounded-lg border p-2.5 max-w-[180px] backdrop-blur-sm ${
        isDark
          ? 'bg-slate-900/90 border-slate-700/50'
          : 'bg-white/90 border-slate-300/80 shadow-sm'
      }`}>
        <div className={`text-[10px] font-medium mb-1.5 uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          {t('memory.graph.categories', 'Categories')}
        </div>
        <div className="space-y-1">
          {categoriesInGraph.map(cat => (
            <div key={cat} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full border-2 bg-transparent flex-shrink-0"
                style={{ borderColor: getCategoryColor(cat) }}
              />
              <span className={`text-[10px] truncate ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                {t(`memory.category.${cat}`, cat.replace(/_/g, ' '))}
              </span>
            </div>
          ))}
        </div>
        <div className={`text-[9px] mt-2 pt-1.5 border-t ${isDark ? 'text-slate-500 border-slate-700/50' : 'text-slate-500 border-slate-300/70'}`}>
          {t('memory.graph.stats', '{0} cards · {1} links')
            .replace('{0}', String(graphData.nodes.length))
            .replace('{1}', String(graphData.links.length))}
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredNode && (
        <div
          className={`absolute pointer-events-none z-50 rounded-xl p-3 backdrop-blur-sm max-w-[280px] ${
            isDark
              ? 'bg-slate-800/95 border border-slate-600/50 shadow-xl'
              : 'bg-white/96 border border-slate-300 shadow-lg'
          }`}
          style={{ top: 60, right: 12 }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: hoveredNode.color }}
            />
            <span className="text-[10px] font-medium" style={{ color: hoveredNode.color }}>
              {hoveredNode.category.replace(/_/g, ' ')}
            </span>
            {hoveredNode.card.created_at && (
              <span className={`text-[9px] ml-auto ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                {new Date(hoveredNode.card.created_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className={`text-xs font-medium mb-0.5 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{hoveredNode.card.title}</p>
          {hoveredNode.card.summary && (
            <p className={`text-[10px] leading-relaxed line-clamp-3 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{hoveredNode.card.summary}</p>
          )}
        </div>
      )}
    </div>
  );
}
