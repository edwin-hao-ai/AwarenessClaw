import { ChevronRight, Loader2, MessageSquare, Send } from 'lucide-react';
import ChannelIcon from '../ChannelIcon';
import { useI18n } from '../../lib/i18n';

type ChannelSession = {
  sessionKey: string;
  channel: string;
  displayName: string;
};

type ChannelMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
};

export function ChannelConversationView({
  activeChannelKey,
  channelSessions,
  channelLoading,
  channelMessages,
  channelReplyText,
  channelReplying,
  messagesEndRef,
  onBack,
  onReplyTextChange,
  onReplySubmit,
}: {
  activeChannelKey: string;
  channelSessions: ChannelSession[];
  channelLoading: boolean;
  channelMessages: ChannelMessage[];
  channelReplyText: string;
  channelReplying: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onBack: () => void;
  onReplyTextChange: (value: string) => void;
  onReplySubmit: () => void;
}) {
  const { t } = useI18n();
  const currentSession = channelSessions.find((session) => session.sessionKey === activeChannelKey);

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 border-b border-slate-800/50 flex items-center gap-2">
        <button onClick={onBack} className="p-1 text-slate-500 hover:text-slate-200 hover:bg-slate-800 rounded-md transition-colors" title={t('common.back', 'Back')}>
          <ChevronRight size={14} className="rotate-180" />
        </button>
        {currentSession ? (
          <>
            <ChannelIcon channelId={currentSession.channel} size={18} />
            <span className="text-sm text-slate-200 font-medium">{currentSession.displayName || currentSession.channel}</span>
            <span className="text-xs text-slate-500">{currentSession.channel}</span>
          </>
        ) : (
          <span className="text-sm text-slate-400">{activeChannelKey}</span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        <div className="max-w-3xl mx-auto space-y-4 w-full">
          {channelLoading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <Loader2 size={20} className="animate-spin mr-2" />
              <span className="text-sm">{t('channels.loadingHistory', 'Loading history...')}</span>
            </div>
          ) : channelMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-500 space-y-3">
              {currentSession && <ChannelIcon channelId={currentSession.channel} size={32} />}
              <MessageSquare size={24} className="opacity-40" />
              <span className="text-sm">{t('channels.noMessages', 'No messages yet')}</span>
              <span className="text-xs text-slate-600">{t('channels.noMessagesHint', 'Send a message to start the conversation')}</span>
            </div>
          ) : (
            channelMessages.map((message) => (
              message.role === 'user' ? (
                <div key={message.id} className="flex justify-end">
                  <div className="max-w-[75%]">
                    <div className="px-4 py-3 rounded-2xl rounded-br-md text-sm bg-brand-600 text-white">
                      {message.content}
                    </div>
                    {message.timestamp && (
                      <div className="text-right mt-1">
                        <span className="text-[10px] text-slate-600">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div key={message.id} className="flex justify-start gap-2.5">
                  {currentSession && <span className="mt-0.5 flex-shrink-0 opacity-70"><ChannelIcon channelId={currentSession.channel} size={20} /></span>}
                  <div className="max-w-[85%]">
                    <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-slate-800/50 text-sm text-slate-200 whitespace-pre-wrap">
                      {message.content}
                    </div>
                    {message.timestamp && (
                      <div className="mt-1">
                        <span className="text-[10px] text-slate-600">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="px-4 py-3 border-t border-slate-800/50">
        <div className="max-w-3xl mx-auto relative">
          <textarea
            value={channelReplyText}
            onChange={(event) => onReplyTextChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                onReplySubmit();
              }
            }}
            placeholder={t('channels.replyPlaceholder', 'Reply to this channel...')}
            className="w-full pl-4 pr-12 py-3 bg-slate-900 border border-slate-700/50 rounded-2xl text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 resize-none placeholder:text-slate-600"
            style={{ minHeight: '44px', maxHeight: '120px' }}
            disabled={channelReplying}
          />
          <button
            onClick={onReplySubmit}
            disabled={!channelReplyText.trim() || channelReplying}
            className="absolute right-2 bottom-2 p-1.5 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg transition-colors"
          >
            {channelReplying ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}