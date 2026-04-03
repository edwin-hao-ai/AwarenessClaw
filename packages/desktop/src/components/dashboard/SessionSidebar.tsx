import { Plus, X } from 'lucide-react';
import ChannelIcon from '../ChannelIcon';

type ChatSession = {
  id: string;
  title: string;
};

type ChannelSession = {
  sessionKey: string;
  channel: string;
  displayName: string;
  status: string;
};

export function SessionSidebar({
  t,
  visible,
  sessions,
  activeSessionId,
  channelSessions,
  activeChannelKey,
  renamingId,
  renameValue,
  onRenameValueChange,
  onRenameStart,
  onRenameCancel,
  onRenameCommit,
  onNewSession,
  onRefreshChannels,
  onSelectChannel,
  onSelectSession,
  onDeleteSession,
}: {
  t: (key: string, fallback?: string) => string;
  visible: boolean;
  sessions: ChatSession[];
  activeSessionId: string;
  channelSessions: ChannelSession[];
  activeChannelKey: string | null;
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onRenameStart: (sessionId: string, title: string) => void;
  onRenameCancel: () => void;
  onRenameCommit: (sessionId: string) => void;
  onNewSession: () => void;
  onRefreshChannels: () => void;
  onSelectChannel: (sessionKey: string) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
}) {
  if (!visible) return null;

  return (
    <div className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col flex-shrink-0">
      <div className="p-2.5 border-b border-slate-800">
        <button
          onClick={onNewSession}
          title={`${t('chat.newSession')} (⌘N)`}
          className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 hover:border-slate-600 text-slate-400 hover:text-slate-200 transition-all group"
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-brand-600/20 group-hover:bg-brand-600/30 flex items-center justify-center transition-colors flex-shrink-0">
              <Plus size={12} className="text-brand-400" />
            </div>
            <span className="text-sm">{t('chat.newSession')}</span>
          </div>
          <kbd className="hidden sm:inline text-[10px] text-slate-600 group-hover:text-slate-500 font-sans px-1.5 py-0.5 rounded bg-slate-700/50 border border-slate-600/50 leading-none">
            ⌘N
          </kbd>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {channelSessions.length > 0 && (
          <>
            <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider text-slate-600 font-medium">{t('nav.channels', 'Channels')}</span>
              <button onClick={onRefreshChannels} className="text-slate-600 hover:text-slate-400 p-0.5" title={t('common.refresh', 'Refresh')}>
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M13.65 2.35A8 8 0 1 0 16 8h-2a6 6 0 1 1-1.76-4.24L10 6h6V0l-2.35 2.35z" fill="currentColor"/></svg>
              </button>
            </div>
            {channelSessions.map((channelSession) => (
              <div
                key={channelSession.sessionKey}
                onClick={() => onSelectChannel(channelSession.sessionKey)}
                className={`w-full text-left px-3 py-2 text-sm border-b border-slate-800/50 transition-colors cursor-pointer flex items-center gap-2 ${
                  activeChannelKey === channelSession.sessionKey ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                <ChannelIcon channelId={channelSession.channel} size={16} />
                <span className="truncate flex-1 text-xs">{channelSession.displayName || channelSession.channel}</span>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${channelSession.status === 'running' ? 'bg-green-400 animate-pulse' : 'bg-slate-400'}`} />
              </div>
            ))}
            <div className="px-3 pt-2.5 pb-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-600 font-medium">{t('chat.sidebar.local', 'Local')}</span>
            </div>
          </>
        )}

        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelectSession(session.id)}
            onDoubleClick={() => onRenameStart(session.id, session.title)}
            className={`w-full text-left px-3 py-2.5 text-sm border-b border-slate-800/50 transition-colors group flex items-center justify-between cursor-pointer ${
              session.id === activeSessionId && !activeChannelKey ? 'bg-slate-800 text-slate-100' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
            }`}
          >
            {renamingId === session.id ? (
              <input
                value={renameValue}
                onChange={(event) => onRenameValueChange(event.target.value)}
                onBlur={() => onRenameCommit(session.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') onRenameCancel();
                }}
                onClick={(event) => event.stopPropagation()}
                aria-label={t('chat.renameSession', 'Rename session')}
                title={t('chat.renameSession', 'Rename session')}
                className="flex-1 bg-slate-700 px-1.5 py-0.5 rounded text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                autoFocus
              />
            ) : (
              <span className="truncate flex-1">{session.title}</span>
            )}
            <button
              onClick={(event) => {
                event.stopPropagation();
                onDeleteSession(session.id);
              }}
              aria-label={t('chat.deleteSession', 'Delete this session?')}
              title={t('chat.deleteSession', 'Delete this session?')}
              className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 p-0.5 ml-1"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}