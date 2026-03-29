import { MessageCircle, Brain, Radio, Puzzle, Settings } from 'lucide-react';

type Page = 'chat' | 'memory' | 'channels' | 'skills' | 'settings';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; icon: typeof MessageCircle; label: string }[] = [
  { id: 'chat', icon: MessageCircle, label: '聊天' },
  { id: 'memory', icon: Brain, label: '记忆' },
  { id: 'channels', icon: Radio, label: '通道' },
  { id: 'skills', icon: Puzzle, label: '技能' },
  { id: 'settings', icon: Settings, label: '设置' },
];

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  return (
    <aside className="w-20 bg-slate-950 border-r border-slate-800 flex flex-col items-center pt-12 pb-4 gap-1">
      {/* Logo */}
      <div className="mb-6 text-2xl">🧠</div>

      {/* Nav items */}
      {navItems.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onNavigate(id)}
          className={`
            titlebar-no-drag w-16 h-16 rounded-xl flex flex-col items-center justify-center gap-1
            transition-all duration-200 text-xs
            ${currentPage === id
              ? 'bg-brand-600/20 text-brand-400'
              : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
            }
          `}
        >
          <Icon size={22} strokeWidth={currentPage === id ? 2.5 : 1.5} />
          <span>{label}</span>
        </button>
      ))}
    </aside>
  );
}
