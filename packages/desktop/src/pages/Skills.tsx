import { useState } from 'react';
import { Search, Download, Check, ExternalLink, Star } from 'lucide-react';

interface Skill {
  id: string;
  name: string;
  emoji: string;
  description: string;
  author: string;
  rating: number;
  installed: boolean;
  version: string;
}

const MOCK_SKILLS: Skill[] = [
  { id: 'awareness-memory', name: 'Awareness Memory', emoji: '🧠', description: '跨会话持久记忆，自动回忆和捕获', author: 'awareness-sdk', rating: 5, installed: true, version: '0.5.15' },
  { id: 'web-search', name: 'Web Search', emoji: '🌐', description: '让 AI 搜索互联网获取最新信息', author: 'openclaw', rating: 5, installed: true, version: '1.2.3' },
  { id: 'file-manager', name: 'File Manager', emoji: '📁', description: '读写本地文件和目录', author: 'openclaw', rating: 4, installed: true, version: '2.0.1' },
  { id: 'email', name: 'Email', emoji: '📧', description: '发送和读取邮件', author: 'community', rating: 4, installed: false, version: '1.0.0' },
  { id: 'calendar', name: 'Calendar', emoji: '📅', description: '管理日历事件和提醒', author: 'community', rating: 4, installed: false, version: '0.8.0' },
  { id: 'code-runner', name: 'Code Runner', emoji: '💻', description: '执行代码片段（Python, JS, Shell）', author: 'openclaw', rating: 5, installed: false, version: '1.5.0' },
  { id: 'image-gen', name: 'Image Generation', emoji: '🎨', description: '使用 DALL-E/SD 生成图片', author: 'community', rating: 4, installed: false, version: '0.5.0' },
  { id: 'translator', name: 'Translator', emoji: '🌍', description: '多语言翻译', author: 'community', rating: 3, installed: false, version: '1.1.0' },
];

export default function Skills() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'installed'>('all');

  const filtered = MOCK_SKILLS.filter((s) => {
    if (filter === 'installed' && !s.installed) return false;
    if (searchQuery && !s.name.toLowerCase().includes(searchQuery.toLowerCase()) && !s.description.includes(searchQuery)) return false;
    return true;
  });

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-lg font-semibold">🧩 技能市场</h1>
            <p className="text-xs text-slate-500">为你的 AI 添加更多能力</p>
          </div>
          <button
            onClick={() => window.electronAPI?.openExternal('https://clawhub.ai')}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
          >
            <ExternalLink size={12} />
            ClawHub
          </button>
        </div>

        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索技能..."
              className="w-full pl-10 pr-4 py-2.5 bg-slate-800 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/50"
            />
          </div>
          <div className="flex bg-slate-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setFilter('all')}
              className={`px-4 py-2 text-xs transition-colors ${filter === 'all' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              全部
            </button>
            <button
              onClick={() => setFilter('installed')}
              className={`px-4 py-2 text-xs transition-colors ${filter === 'installed' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
            >
              已安装
            </button>
          </div>
        </div>
      </div>

      {/* Skills grid */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((skill) => (
            <div
              key={skill.id}
              className="p-4 bg-slate-800/50 border border-slate-700/50 rounded-xl hover:border-slate-600 transition-colors"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl">{skill.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-sm truncate">{skill.name}</h4>
                    <span className="text-xs text-slate-600">v{skill.version}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{skill.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <div className="flex">
                      {[...Array(5)].map((_, i) => (
                        <Star
                          key={i}
                          size={10}
                          className={i < skill.rating ? 'text-amber-400 fill-amber-400' : 'text-slate-600'}
                        />
                      ))}
                    </div>
                    <span className="text-xs text-slate-500">{skill.author}</span>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex justify-end">
                {skill.installed ? (
                  <span className="flex items-center gap-1 text-xs text-emerald-400">
                    <Check size={12} /> 已安装
                  </span>
                ) : (
                  <button className="flex items-center gap-1 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors">
                    <Download size={12} /> 安装
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
