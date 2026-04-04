import { MessageCircle, Brain, Radio, Puzzle, Settings, Clock, Bot, Cpu, Target } from 'lucide-react';
import logoUrl from '../assets/logo.png';
import { useI18n } from '../lib/i18n';

export type Page = 'chat' | 'memory' | 'channels' | 'models' | 'skills' | 'automation' | 'agents' | 'taskCenter' | 'settings';

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
}

const navItems: { id: Page; icon: typeof MessageCircle; i18nKey: string }[] = [
  { id: 'chat', icon: MessageCircle, i18nKey: 'nav.chat' },
  { id: 'memory', icon: Brain, i18nKey: 'nav.memory' },
  { id: 'channels', icon: Radio, i18nKey: 'nav.channels' },
  { id: 'models', icon: Cpu, i18nKey: 'nav.models' },
  { id: 'skills', icon: Puzzle, i18nKey: 'nav.skills' },
  { id: 'automation', icon: Clock, i18nKey: 'nav.automation' },
  { id: 'agents', icon: Bot, i18nKey: 'nav.agents' },
  { id: 'taskCenter', icon: Target, i18nKey: 'nav.taskCenter' },
  { id: 'settings', icon: Settings, i18nKey: 'nav.settings' },
];

export default function Sidebar({ currentPage, onNavigate }: SidebarProps) {
  const { t } = useI18n();

  return (
    <aside className="w-20 bg-slate-950 border-r border-slate-800 flex flex-col items-center pt-12 pb-4 gap-1">
      {/* Logo */}
      <div className="mb-6">
        <img src={logoUrl} alt="AwarenessClaw" className="w-8 h-8 rounded-lg" />
      </div>

      {/* Nav items */}
      {navItems.map(({ id, icon: Icon, i18nKey }) => (
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
          <span>{t(i18nKey)}</span>
        </button>
      ))}
    </aside>
  );
}
