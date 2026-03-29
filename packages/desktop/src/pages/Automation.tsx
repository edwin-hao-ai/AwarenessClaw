import { useState, useEffect } from 'react';
import { Clock, Plus, Trash2, RefreshCw, Loader2, ExternalLink, Play, Pause } from 'lucide-react';

interface CronJob {
  id?: string;
  expression?: string;
  command?: string;
  description?: string;
  raw?: string;
}

export default function Automation() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newExpression, setNewExpression] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(true);
  const [heartbeatInterval, setHeartbeatInterval] = useState(30);

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    setLoading(true);
    if (window.electronAPI) {
      const result = await (window.electronAPI as any).cronList();
      if (result.raw) {
        // Text format
        setJobs(result.jobs.map((line: string, i: number) => ({ id: String(i), raw: line })));
      } else {
        setJobs(result.jobs || []);
      }
    }
    setLoading(false);
  };

  const addJob = async () => {
    if (!newExpression || !newCommand) return;
    if (window.electronAPI) {
      await (window.electronAPI as any).cronAdd(newExpression, newCommand);
      setNewExpression('');
      setNewCommand('');
      setShowAddForm(false);
      loadJobs();
    }
  };

  const removeJob = async (id: string) => {
    if (window.electronAPI) {
      await (window.electronAPI as any).cronRemove(id);
      loadJobs();
    }
  };

  const PRESETS = [
    { label: '每天早上 9 点', expr: '0 9 * * *', cmd: '检查今天的待办事项并给我一个摘要' },
    { label: '每小时', expr: '0 * * * *', cmd: '检查是否有新消息需要回复' },
    { label: '每周一早上', expr: '0 9 * * 1', cmd: '回顾上周的工作并生成周报' },
    { label: '每天晚上 10 点', expr: '0 22 * * *', cmd: '总结今天的对话和学到的东西' },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">⏰ 自动化</h1>
            <p className="text-xs text-slate-500">定时任务和心跳检查</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadJobs}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              刷新
            </button>
            <button
              onClick={() => window.electronAPI?.openExternal('http://localhost:18789')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
            >
              <ExternalLink size={12} /> Dashboard
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">
        {/* Heartbeat */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">💓 心跳检查</h3>
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Heartbeat</div>
                <div className="text-xs text-slate-500">AI 定期检查状态，有需要时主动通知你</div>
              </div>
              <button
                onClick={() => setHeartbeatEnabled(!heartbeatEnabled)}
                className={`w-11 h-6 rounded-full transition-colors relative ${heartbeatEnabled ? 'bg-brand-600' : 'bg-slate-700'}`}
              >
                <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-transform" style={{ transform: heartbeatEnabled ? 'translateX(21px)' : 'translateX(1px)' }} />
              </button>
            </div>
            {heartbeatEnabled && (
              <div className="flex items-center gap-3 border-t border-slate-700/50 pt-3">
                <span className="text-xs text-slate-400">检查间隔</span>
                <input
                  type="range"
                  min={5} max={120} value={heartbeatInterval}
                  onChange={e => setHeartbeatInterval(parseInt(e.target.value))}
                  className="flex-1 accent-brand-500"
                />
                <span className="text-sm text-slate-300 w-16 text-right">{heartbeatInterval} 分钟</span>
              </div>
            )}
          </div>
        </div>

        {/* Cron Jobs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">📋 定时任务</h3>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"
            >
              <Plus size={12} /> 添加任务
            </button>
          </div>

          {/* Add form */}
          {showAddForm && (
            <div className="bg-slate-800/50 rounded-xl border border-brand-600/30 p-4 space-y-3 animate-fade-in">
              <div className="text-sm font-medium">添加定时任务</div>

              {/* Presets */}
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => { setNewExpression(p.expr); setNewCommand(p.cmd); }}
                    className="px-2 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">Cron 表达式</label>
                <input
                  value={newExpression}
                  onChange={e => setNewExpression(e.target.value)}
                  placeholder="0 9 * * *（每天早上9点）"
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">要执行的指令（AI 会执行这段话）</label>
                <textarea
                  value={newCommand}
                  onChange={e => setNewCommand(e.target.value)}
                  placeholder="检查今天的待办事项并给我一个摘要"
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500 resize-none"
                />
              </div>

              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowAddForm(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">取消</button>
                <button
                  onClick={addJob}
                  disabled={!newExpression || !newCommand}
                  className="px-4 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-lg transition-colors"
                >
                  创建
                </button>
              </div>
            </div>
          )}

          {/* Job list */}
          {jobs.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-500">
              <Clock size={32} className="mx-auto mb-3 text-slate-600" />
              <p className="text-sm">暂无定时任务</p>
              <p className="text-xs mt-1">点击"添加任务"创建，或在聊天中让 AI 帮你创建</p>
            </div>
          )}

          {jobs.map((job, i) => (
            <div key={job.id || i} className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 flex items-start justify-between group">
              <div className="flex-1">
                {job.raw ? (
                  <p className="text-sm text-slate-300 font-mono">{job.raw}</p>
                ) : (
                  <>
                    <div className="flex items-center gap-2 mb-1">
                      <code className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-brand-300">{job.expression}</code>
                      {job.description && <span className="text-xs text-slate-500">{job.description}</span>}
                    </div>
                    <p className="text-sm text-slate-300">{job.command}</p>
                  </>
                )}
              </div>
              <button
                onClick={() => job.id && removeJob(job.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-600 text-center pb-4">
          定时任务通过 OpenClaw 的 cron 系统管理。你也可以在聊天中说"每天早上9点提醒我..."来创建。
        </p>
      </div>
    </div>
  );
}
