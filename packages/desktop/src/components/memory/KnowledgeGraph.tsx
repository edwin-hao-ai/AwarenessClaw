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

const CATEGORY_EMOJI: Record<string, string> = {
  decision: '\u{1F4A1}',
  problem_solution: '\u{1F527}',
  workflow: '\u{1F4CB}',
  pitfall: '\u{26A0}',
  insight: '\u{2728}',
  key_point: '\u{1F4CC}',
  personal_preference: '\u{1F464}',
  important_detail: '\u{1F4CE}',
  skill: '\u{1F6E0}',
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
    const fontSize = Math.max(10 / globalScale, 2);
    const nodeRadius = 6;
    const isHovered = hoveredNode?.id === gNode.id;

    // Node circle
    ctx.beginPath();
    ctx.arc(gNode.x, gNode.y, isHovered ? nodeRadius * 1.4 : nodeRadius, 0, 2 * Math.PI);
    ctx.fillStyle = gNode.color;
    ctx.globalAlpha = isHovered ? 1 : 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (isHovered) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / globalScale;
      ctx.stroke();
    }

    // Category emoji above node
    const emoji = CATEGORY_EMOJI[gNode.category] || '\u{1F3F7}';
    ctx.font = `${fontSize * 1.2}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(emoji, gNode.x, gNode.y - nodeRadius - fontSize * 0.4);

    // Label below node
    if (globalScale > 0.6) {
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e2e8f0'; // slate-200
      const maxLen = Math.min(Math.round(20 / Math.max(0.5, 1 / globalScale)), 30);
      const label = gNode.label.length > maxLen ? gNode.label.slice(0, maxLen) + '...' : gNode.label;
      ctx.fillText(label, gNode.x, gNode.y + nodeRadius + fontSize);
    }
  }, [hoveredNode]);

  // Custom link rendering
  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const src = link.source as any;
    const tgt = link.target as any;
    if (!src.x || !tgt.x) return;

    ctx.beginPath();
    ctx.moveTo(src.x, src.y);
    ctx.lineTo(tgt.x, tgt.y);
    ctx.strokeStyle = link.reason === 'session' ? 'rgba(59,130,246,0.2)' : 'rgba(148,163,184,0.15)';
    ctx.lineWidth = Math.max(0.5, link.value * 2) / globalScale;
    ctx.stroke();
  }, []);

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
          ctx.arc(node.x, node.y, 8, 0, 2 * Math.PI);
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
      <div className="absolute top-3 left-3 bg-slate-900/90 backdrop-blur-sm rounded-lg border border-slate-700/50 p-2.5 max-w-[180px]">
        <div className="text-[10px] text-slate-400 font-medium mb-1.5 uppercase tracking-wider">{t('memory.graph.categories', 'Categories')}</div>
        <div className="space-y-1">
          {categoriesInGraph.map(cat => (
            <div key={cat} className="flex items-center gap-1.5">
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: getCategoryColor(cat) }}
              />
              <span className="text-[10px] text-slate-300 truncate">
                {t(`memory.category.${cat}`, cat.replace(/_/g, ' '))}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[9px] text-slate-500 mt-2 border-t border-slate-700/50 pt-1.5">
          {t('memory.graph.stats', '{0} cards · {1} links')
            .replace('{0}', String(graphData.nodes.length))
            .replace('{1}', String(graphData.links.length))}
        </div>
      </div>

      {/* Hover tooltip */}
      {hoveredNode && (
        <div
          className="absolute pointer-events-none z-50 bg-slate-800/95 backdrop-blur-sm border border-slate-600/50 rounded-xl p-3 shadow-xl max-w-[280px]"
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
              <span className="text-[9px] text-slate-500 ml-auto">
                {new Date(hoveredNode.card.created_at).toLocaleDateString()}
              </span>
            )}
          </div>
          <p className="text-xs font-medium text-slate-200 mb-0.5">{hoveredNode.card.title}</p>
          {hoveredNode.card.summary && (
            <p className="text-[10px] text-slate-400 leading-relaxed line-clamp-3">{hoveredNode.card.summary}</p>
          )}
        </div>
      )}
    </div>
  );
}
