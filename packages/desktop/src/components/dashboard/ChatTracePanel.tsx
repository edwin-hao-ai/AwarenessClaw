import { useState } from 'react';
import { AlertTriangle, BookOpen, Brain, CheckCircle2, ChevronRight, Loader2, Save, Search, Terminal, Wrench, Zap } from 'lucide-react';

export interface ChatTraceEvent {
  id: string;
  kind: 'status' | 'debug' | 'thinking' | 'stream';
  label: string;
  detail?: string;
  raw?: string;
  timestamp: number;
  mergeKey?: string;
}

type ToolCallInfo = {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'approved' | 'recalling' | 'saving' | 'cached' | 'awaiting_approval' | 'failed';
  timestamp: number;
  detail?: string;
  approvalRequestId?: string;
  approvalCommand?: string;
};

function getToolIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('exec') || lower.includes('bash') || lower.includes('shell') || lower.includes('command')) return <Terminal size={11} />;
  if (lower.includes('recall') || lower.includes('search') || lower.includes('memory')) return <Search size={11} />;
  if (lower.includes('perception') || lower.includes('signal')) return <Zap size={11} />;
  if (lower.includes('capture') || lower.includes('save') || lower.includes('record')) return <Save size={11} />;
  if (lower.includes('read') || lower.includes('file') || lower.includes('doc')) return <BookOpen size={11} />;
  return <Wrench size={11} />;
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

function getTraceIcon(event: ChatTraceEvent) {
  if (event.kind === 'thinking') return <Brain size={11} className="text-purple-300" />;
  if (event.kind === 'stream') return <Loader2 size={11} className="animate-spin text-brand-300" />;
  if (event.kind === 'debug') return <Terminal size={11} className="text-sky-300" />;
  if (event.label.toLowerCase().includes('error') || event.detail?.toLowerCase().includes('error')) {
    return <AlertTriangle size={11} className="text-amber-300" />;
  }
  return <CheckCircle2 size={11} className="text-emerald-300" />;
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ChatTracePanel({
  t,
  thinking,
  toolCalls,
  traceEvents,
  onApprove,
  onCopyApproval,
  onStopRequest,
  defaultExpanded = false,
  live = false,
}: {
  t: (key: string, fallback?: string) => string;
  thinking?: string;
  toolCalls?: ToolCallInfo[];
  traceEvents?: ChatTraceEvent[];
  onApprove?: (toolCall: ToolCallInfo) => void;
  onCopyApproval?: (toolCall: ToolCallInfo) => void;
  onStopRequest?: () => void;
  defaultExpanded?: boolean;
  live?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasThinking = Boolean(thinking);
  const hasTools = Boolean(toolCalls && toolCalls.length > 0);
  const hasTrace = Boolean(traceEvents && traceEvents.length > 0);
  if (!hasThinking && !hasTools && !hasTrace) return null;

  const sectionCount = [hasThinking, hasTools, hasTrace].filter(Boolean).length;

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-1.5 text-[11px] transition-colors ${live ? 'text-sky-300/80 hover:text-sky-200' : 'text-slate-500 hover:text-slate-300'}`}
      >
        <ChevronRight size={12} className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} />
        <Terminal size={11} />
        <span>{t('chat.trace.title', 'Run trace')}</span>
        <span className="text-[10px] opacity-70">{sectionCount}</span>
      </button>

      <div className="overflow-hidden transition-all duration-200" style={{ maxHeight: expanded ? '720px' : '0px' }}>
        <div className="mt-1.5 ml-4 space-y-3 border-l border-slate-700/50 pl-3">
          {hasThinking && (
            <div>
              <div className="flex items-center gap-1.5 text-[11px] text-purple-300/90">
                <Brain size={11} />
                <span>{t('thinking.label', 'Thinking process')}</span>
              </div>
              <div className="mt-1 text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed rounded-lg bg-slate-900/50 px-3 py-2 border border-slate-800/80">
                {thinking}
              </div>
            </div>
          )}

          {hasTools && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Wrench size={11} />
                <span>{t('tool.used', '{0} tool(s) used').replace('{0}', String(toolCalls?.length || 0))}</span>
              </div>
              {toolCalls?.map((tc) => (
                <div key={tc.id} className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    {tc.status === 'failed' ? (
                      <AlertTriangle size={11} className="text-amber-400/80" />
                    ) : tc.status === 'awaiting_approval' || tc.status === 'running' || tc.status === 'recalling' || tc.status === 'saving' ? (
                      <Loader2 size={11} className="animate-spin text-brand-400/70" />
                    ) : (
                      <span className="text-emerald-500/70">{getToolIcon(tc.name)}</span>
                    )}
                    <span>{getToolLabel(tc.name, tc.status, t)}</span>
                  </div>
                  {tc.detail && (
                    <div className="ml-[17px] mt-1 text-[10px] text-slate-500/90 whitespace-pre-wrap break-all">{tc.detail}</div>
                  )}
                  {tc.status === 'awaiting_approval' && (
                    <div className="ml-[17px] mt-2 flex flex-wrap gap-2">
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
          )}

          {hasTrace && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Terminal size={11} />
                <span>{t('chat.trace.timeline', 'Timeline')}</span>
              </div>
              {traceEvents?.map((event) => (
                <div key={event.id} className="rounded-lg border border-slate-800/80 bg-slate-900/40 px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-slate-300">
                    {getTraceIcon(event)}
                    <span className="flex-1 min-w-0 truncate">{event.label}</span>
                    <span className="text-[10px] text-slate-600">{formatTimestamp(event.timestamp)}</span>
                  </div>
                  {event.detail && (
                    <div className="mt-1 ml-[19px] whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-500/90">
                      {event.detail}
                    </div>
                  )}
                  {event.raw && event.raw !== event.detail && (
                    <pre className="mt-1 ml-[19px] overflow-x-auto whitespace-pre-wrap rounded-md bg-slate-950 px-2 py-1 text-[10px] leading-relaxed text-slate-500">
                      {event.raw}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}