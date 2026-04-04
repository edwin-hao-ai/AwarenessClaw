import React from 'react';
import { AlertTriangle, Check, Copy, File, FolderOpen, Loader2 } from 'lucide-react';
import { ChatTracePanel, type ChatTraceEvent } from './ChatTracePanel';

type ToolCallInfo = {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'approved' | 'recalling' | 'saving' | 'cached' | 'awaiting_approval' | 'failed';
  timestamp: number;
  detail?: string;
  args?: unknown;
  output?: string;
  approvalRequestId?: string;
  approvalCommand?: string;
};

type AttachedFile = {
  name: string;
  path: string;
};

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  files?: AttachedFile[];
  model?: string;
  toolCalls?: ToolCallInfo[];
  thinking?: string;
  traceEvents?: ChatTraceEvent[];
  contentBlocks?: Array<Record<string, unknown>>;
};

export function ChatMessagesPane({
  t,
  logoUrl,
  config,
  messages,
  agentStatus,
  thinkingContent,
  traceEvents,
  activeToolCalls,
  streamingContent,
  newestMsgId,
  copiedId,
  projectRoot,
  messagesEndRef,
  liveThinkingExpanded,
  onToggleLiveThinking,
  onSelectProjectRoot,
  onSelectModel,
  onSuggestionSelect,
  onCopyMessage,
  onApproveTool,
  onCopyApproval,
  onStopRequest,
  onDismissError,
  renderStreamingContent,
  TypewriterMessage,
  ThinkingBlock,
  LiveThinkingBlock,
}: {
  t: (key: string, fallback?: string) => string;
  logoUrl: string;
  config: Record<string, any>;
  messages: Message[];
  agentStatus: 'idle' | 'thinking' | 'generating' | 'error';
  thinkingContent: string;
  traceEvents: ChatTraceEvent[];
  activeToolCalls: ToolCallInfo[];
  streamingContent: string;
  newestMsgId: string | null;
  copiedId: string | null;
  projectRoot: string;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  liveThinkingExpanded: boolean;
  onToggleLiveThinking: () => void;
  onSelectProjectRoot: () => void;
  onSelectModel: () => void;
  onSuggestionSelect: (text: string) => void;
  onCopyMessage: (message: Message) => void;
  onApproveTool: (toolCall: ToolCallInfo) => void | Promise<void>;
  onCopyApproval: (toolCall: ToolCallInfo) => void;
  onStopRequest: () => void | Promise<void>;
  onDismissError: () => void;
  renderStreamingContent: (content: string) => React.ReactNode;
  TypewriterMessage: ({ content, isNew }: { content: string; isNew: boolean }) => React.ReactNode;
  ThinkingBlock: ({ thinking }: { thinking: string }) => React.ReactNode;
  LiveThinkingBlock: ({ thinking, expanded, onToggle }: { thinking: string; expanded: boolean; onToggle: () => void }) => React.ReactNode;
}) {
  const statusLabel = agentStatus === 'thinking'
    ? t('chat.status.thinking')
    : agentStatus === 'generating'
      ? t('chat.status.generating')
      : agentStatus === 'error'
        ? t('chat.status.error')
        : null;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
      <div className="max-w-3xl mx-auto space-y-5 w-full">
        {messages.length === 0 && agentStatus === 'idle' && (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 space-y-6">
            <img src={logoUrl} alt="" className="w-16 h-16 opacity-30" />
            {!config.modelId ? (
              <div className="text-center space-y-3">
                <p className="text-base mb-1">{t('chat.selectModel') || 'Select a model to start chatting'}</p>
                <button onClick={onSelectModel} className="px-4 py-2 text-sm bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors">
                  {t('chat.selectModelBtn') || 'Choose Model'}
                </button>
              </div>
            ) : (
              <>
                <div className="text-center">
                  <p className="text-base mb-1">{t('chat.empty.title')}</p>
                  <p className="text-xs text-slate-600">{t('chat.empty.subtitle')}</p>
                </div>
                <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-left">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-sky-500/10 p-2 text-sky-400">
                      <FolderOpen size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{t('chat.workspace.current', 'Project folder')}</div>
                      <div className="mt-1 truncate text-sm text-slate-200">{projectRoot || t('chat.workspace.none', 'No project folder selected')}</div>
                      <p className="mt-1 text-xs text-slate-500">{t('chat.workspace.hint', 'AI file edits will run inside this local project folder')}</p>
                    </div>
                    <button onClick={onSelectProjectRoot} className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-700">
                      {projectRoot ? t('chat.workspace.change', 'Change folder') : t('chat.workspace.select', 'Choose folder')}
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 max-w-lg justify-center">
                  {[t('chat.suggest.plan'), t('chat.suggest.review'), t('chat.suggest.analyze')].map((question) => (
                    <button key={question} onClick={() => onSuggestionSelect(question)} className="px-3 py-1.5 text-xs bg-slate-800/80 hover:bg-slate-700 rounded-xl text-slate-300 border border-slate-700/50 transition-colors">
                      {question}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {messages.map((message) => (
          message.role === 'user' ? (
            <div key={message.id} className="flex justify-end group">
              <div className="max-w-[75%]">
                <div className="px-4 py-3 rounded-2xl rounded-br-md text-sm bg-brand-600 text-white">
                  {message.files && message.files.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {message.files.map((file, index) => (
                        <span key={index} className="flex items-center gap-1 px-2 py-0.5 bg-black/20 rounded text-[10px]">
                          <File size={10} /> {file.name}
                        </span>
                      ))}
                    </div>
                  )}
                  <span className="whitespace-pre-wrap">{message.content}</span>
                </div>
                <div className="text-right mt-1">
                  <span className="text-[10px] text-slate-600">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            </div>
          ) : (
            <div key={message.id} className="group -mx-4 px-4 py-3 rounded-xl hover:bg-slate-800/30 transition-colors">
              <div className="flex gap-3">
                <img src={logoUrl} alt="" className="w-6 h-6 rounded-md mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] text-slate-500 font-medium">AwarenessClaw</span>
                    {message.model && <span className="text-[10px] text-slate-600">{message.model.split('/').pop()}</span>}
                    <span className="text-[10px] text-slate-600">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>

                  {message.thinking && !message.traceEvents?.length && <ThinkingBlock thinking={message.thinking} />}

                  <ChatTracePanel
                    t={t}
                    thinking={message.thinking}
                    toolCalls={message.toolCalls}
                    traceEvents={message.traceEvents}
                    onApprove={onApproveTool}
                    onCopyApproval={onCopyApproval}
                    onStopRequest={onStopRequest}
                  />

                  <div className="text-sm text-slate-200 leading-relaxed">
                    <TypewriterMessage content={message.content} isNew={message.id === newestMsgId} />
                  </div>

                  <div className="mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-3">
                    <button onClick={() => onCopyMessage(message)} className="text-slate-600 hover:text-slate-300 text-[10px] flex items-center gap-1 transition-colors">
                      {copiedId === message.id ? <><Check size={10} /> {t('common.copied', 'Copied')}</> : <><Copy size={10} /> {t('common.copy', 'Copy')}</>}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )
        ))}

        {agentStatus !== 'idle' && (
          <div className="group -mx-4 px-4 py-3 bg-slate-800/20 rounded-xl">
            <div className="flex gap-3">
              <img src={logoUrl} alt="" className={`w-6 h-6 rounded-md mt-0.5 flex-shrink-0 ${agentStatus !== 'error' ? 'animate-pulse' : ''}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] text-slate-500 font-medium">{t('app.name', 'AwarenessClaw')}</span>
                  {config.modelId && <span className="text-[10px] text-slate-600">{config.modelId.split('/').pop()}</span>}
                </div>

                {agentStatus !== 'error' && thinkingContent && !traceEvents.length && (
                  <LiveThinkingBlock thinking={thinkingContent} expanded={liveThinkingExpanded} onToggle={onToggleLiveThinking} />
                )}

                <ChatTracePanel
                  t={t}
                  thinking={thinkingContent}
                  toolCalls={activeToolCalls}
                  traceEvents={traceEvents}
                  onApprove={onApproveTool}
                  onCopyApproval={onCopyApproval}
                  onStopRequest={onStopRequest}
                  defaultExpanded={true}
                  live={true}
                />

                {agentStatus === 'error' && (
                  <div className="flex items-center gap-2 text-sm text-red-400">
                    <AlertTriangle size={14} />
                    <span>{t('chat.status.error', 'Response timed out or failed')}</span>
                    <button onClick={onDismissError} className="ml-2 px-2 py-0.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors">
                      {t('chat.dismiss', 'Dismiss')}
                    </button>
                  </div>
                )}

                {agentStatus !== 'error' && streamingContent ? (
                  <div className="text-sm text-slate-200 leading-relaxed">{renderStreamingContent(streamingContent)}</div>
                ) : agentStatus !== 'error' ? (
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <Loader2 size={14} className="animate-spin text-brand-400" />
                    <span>{statusLabel}</span>
                  </div>
                ) : null}

                {agentStatus !== 'error' && (
                  <button
                    onClick={() => { void onStopRequest(); }}
                    className="mt-2 flex items-center gap-1.5 px-3 py-1 text-xs text-slate-400 hover:text-red-400 bg-slate-800/60 hover:bg-red-500/10 border border-slate-700/50 hover:border-red-500/30 rounded-lg transition-colors"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect width="10" height="10" rx="1.5" /></svg>
                    {t('chat.stop', 'Stop')}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}