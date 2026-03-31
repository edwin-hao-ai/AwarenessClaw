import { useState, useEffect, useMemo } from 'react';
import { Clock, Plus, Trash2, RefreshCw, Loader2, ExternalLink, ChevronDown, ChevronRight, Calendar, Timer } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface CronJob {
  id?: string;
  expression?: string;
  command?: string;
  description?: string;
  raw?: string;
}

type FrequencyType = 'daily' | 'hourly' | 'weekly' | 'custom';

const WEEKDAYS = [
  { value: 1, label: 'Mon', labelCn: '一' },
  { value: 2, label: 'Tue', labelCn: '二' },
  { value: 3, label: 'Wed', labelCn: '三' },
  { value: 4, label: 'Thu', labelCn: '四' },
  { value: 5, label: 'Fri', labelCn: '五' },
  { value: 6, label: 'Sat', labelCn: '六' },
  { value: 0, label: 'Sun', labelCn: '日' },
];

// Convert visual schedule to cron expression
function buildCronExpression(freq: FrequencyType, hour: number, minute: number, weekdays: number[]): string {
  const mm = String(minute);
  const hh = String(hour);
  switch (freq) {
    case 'hourly': return `${mm} * * * *`;
    case 'daily': return `${mm} ${hh} * * *`;
    case 'weekly': {
      const days = weekdays.length > 0 ? weekdays.sort().join(',') : '*';
      return `${mm} ${hh} * * ${days}`;
    }
    case 'custom': return '';
    default: return `${mm} ${hh} * * *`;
  }
}

// Translate cron expression to human-readable Chinese
function cronToHuman(expr: string): string {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [min, hour, , , dow] = parts;

  // Every minute
  if (min === '*' && hour === '*' && dow === '*') return 'Every minute';

  // Hourly
  if (hour === '*' && dow === '*') {
    return min === '0' ? 'Every hour' : `Every hour at :${min.padStart(2, '0')}`;
  }

  // Format time
  const timeStr = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

  // Daily
  if (dow === '*') return `Daily ${timeStr}`;

  // Weekly
  const dayNames: Record<string, string> = {
    '0': 'Sun', '1': 'Mon', '2': 'Tue', '3': 'Wed', '4': 'Thu', '5': 'Fri', '6': 'Sat',
    '7': 'Sun',
  };
  const days = dow.split(',').map(d => dayNames[d] || d).join(', ');
  return `${days} ${timeStr}`;
}

// Validate a custom cron expression: must have exactly 5 non-empty space-separated fields
function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length === 5 && parts.every(p => p.length > 0);
}

const PRESETS = [
  { label: 'Daily 9 AM', freq: 'daily' as FrequencyType, hour: 9, minute: 0, weekdays: [] as number[], cmd: 'Check my to-do list and give me a summary' },
  { label: 'Every hour', freq: 'hourly' as FrequencyType, hour: 0, minute: 0, weekdays: [] as number[], cmd: 'Check if there are new messages to reply' },
  { label: 'Mon 9 AM', freq: 'weekly' as FrequencyType, hour: 9, minute: 0, weekdays: [1], cmd: 'Review last week and generate a weekly report' },
  { label: 'Daily 10 PM', freq: 'daily' as FrequencyType, hour: 22, minute: 0, weekdays: [] as number[], cmd: 'Summarize today\'s conversations and learnings' },
];

export default function Automation() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [heartbeatEnabled, setHeartbeatEnabled] = useState(() => {
    try { return JSON.parse(localStorage.getItem('awareness-claw-heartbeat-enabled') || 'false'); } catch { return false; }
  });
  const [heartbeatInterval, setHeartbeatInterval] = useState(() => {
    try { return parseInt(localStorage.getItem('awareness-claw-heartbeat-interval') || '30', 10); } catch { return 30; }
  });

  // Persist heartbeat settings
  useEffect(() => {
    localStorage.setItem('awareness-claw-heartbeat-enabled', JSON.stringify(heartbeatEnabled));
    localStorage.setItem('awareness-claw-heartbeat-interval', String(heartbeatInterval));
    // Register/remove heartbeat cron job
    if (window.electronAPI && heartbeatEnabled) {
      (window.electronAPI as any).cronAdd(`*/${heartbeatInterval} * * * *`, 'openclaw heartbeat').catch(() => {});
    }
  }, [heartbeatEnabled, heartbeatInterval]);

  // Visual schedule state
  const [frequency, setFrequency] = useState<FrequencyType>('daily');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);
  const [selectedDays, setSelectedDays] = useState<number[]>([1]); // Monday default
  const [newCommand, setNewCommand] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [customCron, setCustomCron] = useState('');

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null); // job id pending delete
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    loadJobs();
  }, []);

  const loadJobs = async () => {
    setLoading(true);
    if (window.electronAPI) {
      try {
        const result = await (window.electronAPI as any).cronList();
        const jobList = Array.isArray(result.jobs) ? result.jobs : [];
        if (result.raw) {
          setJobs(jobList.map((line: string, i: number) => ({ id: String(i), raw: line })));
        } else {
          setJobs(jobList);
        }
      } catch {
        setJobs([]);
      }
    }
    setLoading(false);
  };

  const cronExpression = useMemo(() => {
    if (frequency === 'custom') return customCron;
    return buildCronExpression(frequency, hour, minute, selectedDays);
  }, [frequency, hour, minute, selectedDays, customCron]);

  const [addError, setAddError] = useState<string | null>(null);

  const addJob = async () => {
    if (!cronExpression || !newCommand) return;
    setAddError(null);
    if (window.electronAPI) {
      const result = await (window.electronAPI as any).cronAdd(cronExpression, newCommand);
      if (result && result.error) {
        setAddError(result.error);
        return;
      }
      resetForm();
      loadJobs();
    }
  };

  const resetForm = () => {
    setFrequency('daily');
    setHour(9);
    setMinute(0);
    setSelectedDays([1]);
    setNewCommand('');
    setCustomCron('');
    setShowAdvanced(false);
    setShowAddForm(false);
  };

  // Performs the actual removal after confirmation
  const doRemoveJob = async (id: string) => {
    setRemoveError(null);
    if (window.electronAPI) {
      const result = await (window.electronAPI as any).cronRemove(id);
      if (result && result.error) {
        setRemoveError(result.error);
        return;
      }
      loadJobs();
    }
  };

  const toggleDay = (day: number) => {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setFrequency(preset.freq);
    setHour(preset.hour);
    setMinute(preset.minute);
    setSelectedDays(preset.weekdays);
    setNewCommand(preset.cmd);
    setShowAdvanced(false);
  };

  // Generate hour options
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

  // Determine if the Create button should be disabled
  const isCreateDisabled = !cronExpression || !newCommand || (frequency === 'custom' && !isValidCron(customCron));

  return (
    <div className="h-full flex flex-col">
      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-xs p-5 space-y-4">
            <p className="text-sm text-slate-200">{t('auto.deleteConfirm', 'Delete this scheduled task?')}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-1.5 text-sm text-slate-400 hover:text-slate-200"
              >
                {t('auto.cancel')}
              </button>
              <button
                onClick={() => { doRemoveJob(deleteConfirm); setDeleteConfirm(null); }}
                className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                {t('common.delete', 'Delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Timer size={20} className="text-brand-400" /> {t('auto.title')}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">{t('auto.subtitle')}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadJobs}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
            >
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {t('common.refresh')}
            </button>
            <button
              onClick={() => window.electronAPI?.openExternal('http://localhost:18789')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg transition-colors"
            >
              <ExternalLink size={12} /> {t('auto.dashboard', 'Dashboard')}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">
        {/* Heartbeat */}
        <div className="space-y-3">
          <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('auto.heartbeat')}</h3>
          <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">{t('auto.heartbeat.title')}</div>
                <div className="text-xs text-slate-500">{t('auto.heartbeat.desc')}</div>
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
                <span className="text-xs text-slate-400">{t('auto.heartbeat.interval')}</span>
                <input
                  type="range"
                  min={5} max={120} value={heartbeatInterval}
                  onChange={e => setHeartbeatInterval(parseInt(e.target.value))}
                  className="flex-1 accent-brand-500"
                />
                <span className="text-sm text-slate-300 w-16 text-right">{heartbeatInterval} min</span>
              </div>
            )}
          </div>
        </div>

        {/* Cron Jobs */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-medium text-slate-500 uppercase tracking-wider">{t('auto.tasks')}</h3>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"
            >
              <Plus size={12} /> {t('auto.addTask')}
            </button>
          </div>

          {/* Add form */}
          {showAddForm && (
            <div className="bg-slate-800/50 rounded-xl border border-brand-600/30 p-4 space-y-4 animate-fade-in">
              <div className="text-sm font-medium">{t('auto.newTask')}</div>

              {/* Quick presets */}
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => applyPreset(p)}
                    className="px-2.5 py-1 text-xs bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Frequency selector */}
              <div>
                <label className="text-xs text-slate-400 block mb-1.5">{t('auto.frequency')}</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {([
                    { key: 'daily', label: t('auto.daily') },
                    { key: 'hourly', label: t('auto.hourly') },
                    { key: 'weekly', label: t('auto.weekly') },
                    { key: 'custom', label: t('auto.custom') },
                  ] as const).map(opt => (
                    <button
                      key={opt.key}
                      onClick={() => setFrequency(opt.key)}
                      className={`py-1.5 text-xs rounded-lg transition-colors ${
                        frequency === opt.key
                          ? 'bg-brand-600 text-white'
                          : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Time picker — show for daily/weekly */}
              {(frequency === 'daily' || frequency === 'weekly') && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">{t('auto.time', 'Time')}</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={hour}
                      onChange={e => setHour(parseInt(e.target.value))}
                      className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500 appearance-none cursor-pointer"
                    >
                      {hours.map(h => (
                        <option key={h} value={h}>{String(h).padStart(2, '0')}</option>
                      ))}
                    </select>
                    <span className="text-slate-500 text-lg font-bold">:</span>
                    <select
                      value={minute}
                      onChange={e => setMinute(parseInt(e.target.value))}
                      className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500 appearance-none cursor-pointer"
                    >
                      {minutes.map(m => (
                        <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Minute picker — show for hourly */}
              {frequency === 'hourly' && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">{t('auto.atMinute', 'At minute')}</label>
                  <select
                    value={minute}
                    onChange={e => setMinute(parseInt(e.target.value))}
                    className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500 appearance-none cursor-pointer"
                  >
                    {minutes.map(m => (
                      <option key={m} value={m}>:{String(m).padStart(2, '0')}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Weekday selector — show for weekly */}
              {frequency === 'weekly' && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1.5">{t('auto.days', 'Days')}</label>
                  <div className="flex gap-1.5">
                    {WEEKDAYS.map(day => (
                      <button
                        key={day.value}
                        onClick={() => toggleDay(day.value)}
                        className={`w-9 h-9 rounded-lg text-xs font-medium transition-colors ${
                          selectedDays.includes(day.value)
                            ? 'bg-brand-600 text-white'
                            : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                        }`}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Custom cron input */}
              {frequency === 'custom' && (
                <div>
                  <label className="text-xs text-slate-400 block mb-1">{t('auto.cronExpression', 'Cron expression')}</label>
                  <input
                    value={customCron}
                    onChange={e => setCustomCron(e.target.value)}
                    placeholder={t('auto.cronPlaceholder', '0 9 * * * (daily at 9 AM)')}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm font-mono focus:outline-none focus:border-brand-500"
                  />
                  {customCron && !isValidCron(customCron) ? (
                    <p className="text-[10px] text-amber-400 mt-1">{t('auto.cronInvalid', 'Needs 5 fields: minute hour day month weekday')}</p>
                  ) : (
                    <p className="text-[10px] text-slate-600 mt-1">{t('auto.cronFormat', 'Format: minute hour day month weekday')}</p>
                  )}
                </div>
              )}

              {/* Preview of generated cron */}
              {frequency !== 'custom' && cronExpression && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {showAdvanced ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                    Cron expression
                  </button>
                  <code className="text-[10px] px-1.5 py-0.5 bg-slate-700/50 rounded text-slate-500 font-mono">{cronExpression}</code>
                  <span className="text-[10px] text-brand-400">{cronToHuman(cronExpression)}</span>
                </div>
              )}

              {/* Advanced: editable cron override */}
              {showAdvanced && frequency !== 'custom' && (
                <div>
                  <input
                    value={cronExpression}
                    readOnly
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm font-mono text-slate-500 focus:outline-none"
                  />
                </div>
              )}

              {/* Command input */}
              <div>
                <label className="text-xs text-slate-400 block mb-1">{t('auto.instruction')}</label>
                <textarea
                  value={newCommand}
                  onChange={e => setNewCommand(e.target.value)}
                  placeholder={t('auto.instruction.placeholder')}
                  rows={2}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500 resize-none"
                />
              </div>

              {addError && (
                <div className="text-xs text-red-400 bg-red-600/10 border border-red-600/20 rounded-lg px-3 py-2">
                  {addError}
                </div>
              )}

              <div className="flex gap-2 justify-end">
                <button onClick={() => { resetForm(); setAddError(null); }} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">{t('auto.cancel')}</button>
                <button
                  onClick={addJob}
                  disabled={isCreateDisabled}
                  className="px-4 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-lg transition-colors"
                >
                  {t('auto.create')}
                </button>
              </div>
            </div>
          )}

          {/* Remove error */}
          {removeError && (
            <div className="text-xs text-red-400 bg-red-600/10 border border-red-600/20 rounded-lg px-3 py-2">
              {removeError}
            </div>
          )}

          {/* Job list */}
          {jobs.length === 0 && !loading && (
            <div className="text-center py-8 text-slate-500">
              <Clock size={32} className="mx-auto mb-3 text-slate-600" />
              <p className="text-sm">{t('auto.noTasks')}</p>
              <p className="text-xs mt-1">{t('auto.noTasks.hint')}</p>
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
                      <code className="text-xs px-1.5 py-0.5 bg-slate-700 rounded text-brand-300 font-mono">{job.expression}</code>
                      <span className="text-xs text-slate-500">{cronToHuman(job.expression || '')}</span>
                    </div>
                    <p className="text-sm text-slate-300">{job.command}</p>
                  </>
                )}
              </div>
              <button
                onClick={() => job.id && setDeleteConfirm(job.id)}
                className="opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400 transition-all p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-600 text-center pb-4">
          {t('auto.footer')}
        </p>
      </div>
    </div>
  );
}
