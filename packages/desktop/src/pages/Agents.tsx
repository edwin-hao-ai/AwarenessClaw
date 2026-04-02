import { useState, useEffect, useCallback } from 'react';
import { Bot, Plus, Trash2, Link, Loader2, RefreshCw, Edit3, Check, X, AlertCircle, FileText, ChevronDown, ChevronUp, Save } from 'lucide-react';
import { useI18n } from '../lib/i18n';

interface AgentInfo {
  id: string;
  name?: string;
  emoji?: string;
  model?: string;
  bindings?: string[];
  isDefault?: boolean;
  workspace?: string;
  routes?: string[];
}

const WORKSPACE_FILE_META: Record<string, string> = {
  'SOUL.md': 'agents.file.soul.desc',
  'TOOLS.md': 'agents.file.tools.desc',
  'IDENTITY.md': 'agents.file.identity.desc',
  'USER.md': 'agents.file.user.desc',
  'MEMORY.md': 'agents.file.memory.desc',
  'AGENTS.md': 'agents.file.agents.desc',
  'HEARTBEAT.md': 'agents.file.heartbeat.desc',
};

export default function Agents() {
  const { t } = useI18n();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Create form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentModel, setNewAgentModel] = useState('');
  const [newAgentPrompt, setNewAgentPrompt] = useState('');

  // Identity editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [editAvatar, setEditAvatar] = useState('');
  const [editTheme, setEditTheme] = useState('');

  // Binding
  const [bindingAgentId, setBindingAgentId] = useState<string | null>(null);
  const [bindChannel, setBindChannel] = useState('');
  const [availableChannels, setAvailableChannels] = useState<string[]>([]);

  // Workspace file editing
  const [fileEditAgentId, setFileEditAgentId] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [activeFile, setActiveFile] = useState('');
  const [fileContent, setFileContent] = useState('');
  const [fileOriginal, setFileOriginal] = useState('');
  const [fileListLoading, setFileListLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileSaved, setFileSaved] = useState(false);

  const loadAgents = async () => {
    setLoading(true);
    setError(null);
    if (!window.electronAPI) {
      setAgents([{ id: 'main', name: 'Claw', emoji: '🦞', isDefault: true, bindings: [] }]);
      setLoading(false);
      return;
    }
    try {
      const result = await (window.electronAPI as any).agentsList();
      if (result.success) {
        setAgents(result.agents || []);
      } else {
        setError(result.error || t('agents.loadFailed', 'Failed to load agents'));
      }
    } catch { setError(t('agents.connectFailed', 'Failed to connect')); }
    setLoading(false);
  };

  // Load available channels for binding dropdown
  const loadChannels = async () => {
    if (!window.electronAPI) return;
    try {
      const result = await (window.electronAPI as any).channelListConfigured();
      const supported = await (window.electronAPI as any).channelListSupported?.();
      // Merge configured + supported, dedupe
      const all = new Set<string>([
        ...(result?.configured || []),
        ...(supported?.channels || []),
      ]);
      all.delete('local');
      setAvailableChannels(Array.from(all).sort());
    } catch { /* fallback to empty */ }
  };

  useEffect(() => { loadAgents(); loadChannels(); }, []);

  const handleDelete = async (agentId: string) => {
    if (!window.electronAPI || agentId === 'main') return;
    if (!confirm(t('agents.deleteConfirm', 'Delete this agent? This will remove its workspace and all data.'))) return;
    const result = await (window.electronAPI as any).agentsDelete(agentId);
    if (result.success) loadAgents();
    else setError(result.error || 'Delete failed');
  };

  const handleCreate = async () => {
    if (!newAgentName.trim() || !window.electronAPI) return;
    setCreating(true);
    setError(null);
    try {
      const result = await (window.electronAPI as any).agentsAdd(
        newAgentName.trim(),
        newAgentModel || undefined,
        newAgentPrompt || undefined
      );
      if (result.success) {
        setNewAgentName('');
        setNewAgentModel('');
        setNewAgentPrompt('');
        setShowCreateForm(false);
        loadAgents();
      } else {
        const errMsg = result.error || '';
        if (/permission|access|denied/i.test(errMsg)) {
          setError(t('agents.createPermissionDenied', 'Permission denied. Check your system permissions and try again.'));
        } else if (/already exists|duplicate/i.test(errMsg)) {
          setError(t('agents.createDuplicate', 'Agent "{name}" already exists. Choose a different name.').replace('{name}', newAgentName.trim()));
        } else {
          setError(errMsg || t('agents.createFailed', 'Failed to create agent. Please try again.'));
        }
      }
    } catch {
      setError(t('agents.unexpectedError', 'Unexpected error. Please try again.'));
    }
    setCreating(false);
  };

  const handleSetIdentity = async (agentId: string) => {
    if (!window.electronAPI) return;
    const result = await (window.electronAPI as any).agentsSetIdentity(agentId, editName, editEmoji, editAvatar, editTheme);
    if (result.success) {
      setEditingId(null);
      loadAgents();
    } else {
      setError(result.error || 'Set identity failed');
    }
  };

  const handleBind = async (agentId: string) => {
    if (!window.electronAPI || !bindChannel.trim()) return;
    const result = await (window.electronAPI as any).agentsBind(agentId, bindChannel.trim());
    if (result.success) {
      setBindingAgentId(null);
      setBindChannel('');
      loadAgents();
    } else {
      setError(result.error || 'Bind failed');
    }
  };

  const handleUnbind = async (agentId: string, binding: string) => {
    if (!window.electronAPI) return;
    const result = await (window.electronAPI as any).agentsUnbind(agentId, binding);
    if (result.success) loadAgents();
    else setError(result.error || 'Unbind failed');
  };

  // Workspace file editing
  const loadFile = useCallback(async (agentId: string, fileName: string) => {
    if (!window.electronAPI) return;
    setFileLoading(true);
    setFileSaved(false);
    try {
      if (!(window.electronAPI as any).agentsReadFile) {
        throw new Error('This desktop build does not expose agent file reading yet. Please restart with the latest package.');
      }
      const result = await (window.electronAPI as any).agentsReadFile(agentId, fileName);
      if (result.success) {
        setFileContent(result.content || '');
        setFileOriginal(result.content || '');
      } else {
        throw new Error(result.error || `Failed to load ${fileName}`);
      }
    } catch (err: any) {
      setFileContent('');
      setFileOriginal('');
      setError(err?.message || `Failed to load ${fileName}`);
    }
    setFileLoading(false);
  }, []);

  const loadWorkspaceFiles = useCallback(async (agentId: string) => {
    if (!window.electronAPI) return;
    setFileListLoading(true);
    try {
      if (!(window.electronAPI as any).agentsListFiles) {
        throw new Error('This desktop build does not expose dynamic agent workspace files yet. Please restart with the latest package.');
      }
      const result = await (window.electronAPI as any).agentsListFiles(agentId);
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to load workspace files');
      }
      const files = Array.isArray(result?.files) ? result.files : [];
      setWorkspaceFiles(files);
      if (files.length === 0) {
        setActiveFile('');
        setFileContent('');
        setFileOriginal('');
        return;
      }
      const nextFile = files.includes(activeFile) ? activeFile : files[0];
      setActiveFile(nextFile);
      await loadFile(agentId, nextFile);
    } catch (err: any) {
      setWorkspaceFiles([]);
      setActiveFile('');
      setFileContent('');
      setFileOriginal('');
      setError(err?.message || t('agents.filesLoadFailed', 'Failed to load workspace files'));
    } finally {
      setFileListLoading(false);
    }
  }, [activeFile, loadFile]);

  const handleOpenFiles = (agentId: string) => {
    if (fileEditAgentId === agentId) {
      setFileEditAgentId(null);
      setWorkspaceFiles([]);
      setActiveFile('');
      return;
    }
    setFileEditAgentId(agentId);
    void loadWorkspaceFiles(agentId);
  };

  const handleSaveFile = async () => {
    if (!window.electronAPI || !fileEditAgentId) return;
    setFileSaving(true);
    try {
      const result = await (window.electronAPI as any).agentsWriteFile(fileEditAgentId, activeFile, fileContent);
      if (result.success) {
        setFileOriginal(fileContent);
        setFileSaved(true);
        setTimeout(() => setFileSaved(false), 2000);
      } else {
        setError(result.error || t('agents.saveFailed', 'Save failed'));
      }
    } catch {
      setError(t('agents.fileSaveFailed', 'Failed to save file'));
    }
    setFileSaving(false);
  };

  const fileDirty = fileContent !== fileOriginal;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-lg font-semibold">🤖 {t('agents.title')}</h1>
            <p className="text-xs text-slate-500">{t('agents.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition-colors">
              {showCreateForm ? <X size={12} /> : <Plus size={12} />}
              {showCreateForm ? t('common.cancel', 'Cancel') : t('agents.createAgent')}
            </button>
            <button onClick={loadAgents} disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 rounded-lg">
              {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-600/10 border border-red-600/20 rounded-xl text-xs text-red-400">
            <AlertCircle size={14} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto"><X size={12} /></button>
          </div>
        )}

        {/* Create Form */}
        {showCreateForm && (
          <div className="p-4 bg-slate-800/70 border border-slate-700 rounded-xl space-y-3">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <Plus size={14} className="text-brand-400" /> {t('agents.createAgent')}
            </h3>

            <div className="grid grid-cols-1 gap-2">
              <input value={newAgentName} onChange={(e) => setNewAgentName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleCreate()}
                placeholder={t('agents.newPlaceholder')}
                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-sm focus:outline-none focus:border-brand-500" />

              <input value={newAgentModel} onChange={(e) => setNewAgentModel(e.target.value)}
                placeholder={t('agents.modelPlaceholder')}
                className="px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs text-slate-400 focus:outline-none focus:border-brand-500" />

              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">{t('agents.systemPrompt')}</label>
                <textarea value={newAgentPrompt} onChange={(e) => setNewAgentPrompt(e.target.value)}
                  placeholder={t('agents.systemPromptPlaceholder')}
                  rows={4}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-xs text-slate-300 focus:outline-none focus:border-brand-500 resize-y" />
              </div>
            </div>

            <div className="flex justify-end">
              <button onClick={handleCreate} disabled={!newAgentName.trim() || creating}
                className="px-4 py-2 bg-brand-600 hover:bg-brand-500 disabled:bg-slate-700 text-white rounded-lg text-sm flex items-center gap-1.5 transition-colors">
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                {t('agents.create')}
              </button>
            </div>
          </div>
        )}

        {/* Agent List */}
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 size={24} className="animate-spin text-brand-500" /></div>
        ) : agents.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">{t('agents.empty')}</div>
        ) : (
          <div className="space-y-3">
            {agents.map((agent) => (
              <div key={agent.id} className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
                {/* Agent header */}
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{agent.emoji || '🤖'}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{agent.name || agent.id}</span>
                          {agent.isDefault && <span className="px-1.5 py-0.5 text-[10px] bg-brand-600/20 text-brand-400 rounded">{t('agents.default', 'Default')}</span>}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {t('agents.idLabel', 'ID')}: {agent.id}{agent.model && <span className="ml-2">{t('agents.modelLabel', 'Model')}: {agent.model}</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => handleOpenFiles(agent.id)}
                        className={`p-1.5 rounded transition-colors ${fileEditAgentId === agent.id ? 'text-brand-400 bg-brand-600/10' : 'text-slate-500 hover:text-slate-300'}`}
                        title={t('agents.editDefinition')}>
                        <FileText size={14} />
                      </button>
                      <button onClick={() => { setEditingId(agent.id); setEditName(agent.name || ''); setEditEmoji(agent.emoji || ''); setEditAvatar(''); setEditTheme(''); }}
                        className="p-1.5 text-slate-500 hover:text-slate-300 rounded" title={t('agents.editIdentity', 'Edit identity')}><Edit3 size={14} /></button>
                      <button onClick={() => { setBindingAgentId(agent.id); setBindChannel(''); }}
                        className="p-1.5 text-slate-500 hover:text-emerald-400 rounded" title={t('agents.addBinding', 'Add binding')}><Link size={14} /></button>
                      {!agent.isDefault && (
                        <button onClick={() => handleDelete(agent.id)} title={t('common.delete', 'Delete')} className="p-1.5 text-slate-500 hover:text-red-400 rounded"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>

                  {/* Bindings */}
                  {agent.bindings && agent.bindings.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pl-11">
                      {agent.bindings.map((b, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] bg-emerald-600/15 text-emerald-400 rounded-full">
                          <Link size={9} />{b}
                          <button onClick={() => handleUnbind(agent.id, b)} className="hover:text-red-400 ml-0.5"><X size={9} /></button>
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Inline identity edit */}
                  {editingId === agent.id && (
                    <div className="space-y-2 pl-11 pt-2 border-t border-slate-700/30">
                      <div className="flex items-center gap-2">
                        <input value={editEmoji} onChange={(e) => setEditEmoji(e.target.value)} placeholder="🤖"
                          className="w-10 px-1 py-1 bg-slate-900 border border-slate-600 rounded text-center text-sm" maxLength={4} />
                        <input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder={t('agents.namePlaceholder', 'Name')}
                          className="flex-1 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm" />
                        <button onClick={() => handleSetIdentity(agent.id)} className="p-1 text-emerald-400 hover:text-emerald-300"><Check size={14} /></button>
                        <button onClick={() => setEditingId(null)} className="p-1 text-slate-500 hover:text-slate-300"><X size={14} /></button>
                      </div>
                      <div className="flex items-center gap-2">
                        <input value={editAvatar} onChange={(e) => setEditAvatar(e.target.value)}
                          placeholder={t('agents.avatarPlaceholder', 'Avatar URL (optional)')}
                          className="flex-1 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs text-slate-400" />
                        <select value={editTheme} onChange={(e) => setEditTheme(e.target.value)}
                          className="px-2 py-1 bg-slate-900 border border-slate-600 rounded text-xs text-slate-400">
                          <option value="">{t('agents.theme', 'Theme')}</option>
                          <option value="dark">{t('agents.themeDark', 'Dark')}</option>
                          <option value="light">{t('agents.themeLight', 'Light')}</option>
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Inline bind input */}
                  {bindingAgentId === agent.id && (
                    <div className="flex items-center gap-2 pl-11 pt-1 border-t border-slate-700/30">
                      <select value={bindChannel} onChange={(e) => setBindChannel(e.target.value)}
                        className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-slate-300">
                        <option value="">{t('agents.selectChannel', 'Select a channel...')}</option>
                        {availableChannels.length > 0 ? (
                          availableChannels
                            .filter(ch => !agent.bindings?.includes(ch))
                            .map(ch => <option key={ch} value={ch}>{ch}</option>)
                        ) : (
                          // Fallback: common channel names if API not available
                          ['telegram', 'discord', 'whatsapp', 'slack', 'signal', 'openclaw-weixin', 'feishu', 'line', 'imessage']
                            .filter(ch => !agent.bindings?.includes(ch))
                            .map(ch => <option key={ch} value={ch}>{ch}</option>)
                        )}
                      </select>
                      <button onClick={() => handleBind(agent.id)} disabled={!bindChannel}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 text-white rounded text-xs">
                        {t('agents.bind', 'Bind')}
                      </button>
                      <button onClick={() => setBindingAgentId(null)} className="p-1 text-slate-500 hover:text-slate-300"><X size={14} /></button>
                    </div>
                  )}
                </div>

                {/* Workspace file editor (expanded) */}
                {fileEditAgentId === agent.id && (
                  <div className="border-t border-slate-700/50 bg-slate-900/50">
                    {/* File tabs */}
                    <div className="grid grid-cols-2 gap-1 border-b border-slate-700/30 p-2 sm:grid-cols-3 xl:grid-cols-6">
                      {workspaceFiles.map((fileName) => (
                        <button key={fileName}
                          onClick={() => { setActiveFile(fileName); void loadFile(agent.id, fileName); }}
                          className={`rounded-lg px-3 py-2 text-[11px] text-left transition-colors ${
                            activeFile === fileName
                              ? 'bg-brand-600/10 text-brand-400 ring-1 ring-brand-500/40'
                              : 'text-slate-500 hover:bg-slate-800/70 hover:text-slate-300'
                          }`}>
                          {fileName}
                        </button>
                      ))}
                    </div>

                    {/* File description */}
                    <div className="px-4 pt-2">
                      <p className="text-[10px] text-slate-500">
                        {activeFile
                          ? t(WORKSPACE_FILE_META[activeFile] || 'agents.file.defaultDesc', WORKSPACE_FILE_META[activeFile] ? undefined : 'OpenClaw workspace file: {file}').replace('{file}', activeFile)
                          : t('agents.noWorkspaceFiles', 'No markdown workspace files found for this agent.')}
                      </p>
                    </div>

                    {/* Editor */}
                    <div className="p-4">
                      {fileListLoading || fileLoading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 size={16} className="animate-spin text-slate-500" />
                        </div>
                      ) : !activeFile ? (
                        <div className="rounded-lg border border-dashed border-slate-700 px-4 py-8 text-sm text-slate-500">
                          {t('agents.noTopLevelFiles', 'This agent does not expose any top-level markdown workspace files yet.')}
                        </div>
                      ) : (
                        <textarea
                          value={fileContent}
                          onChange={(e) => setFileContent(e.target.value)}
                          rows={20}
                          className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-slate-300 font-mono leading-relaxed focus:outline-none focus:border-brand-500 resize-y min-h-[300px]"
                          placeholder={activeFile === 'SOUL.md'
                            ? t('agents.placeholder.soul', 'You are a helpful assistant specialized in...\n\n# Personality\n- Friendly and professional\n- Always explain your reasoning\n\n# Rules\n- Never share private information\n- Always cite sources')
                            : activeFile === 'TOOLS.md'
                            ? t('agents.placeholder.tools', '# Available Tools\n- exec: Run shell commands\n- read: Read files\n- write: Write files\n\n# Restrictions\n- Do not delete files without confirmation')
                            : t('agents.placeholder.file', 'Content for {file}...').replace('{file}', activeFile)
                          }
                        />
                      )}

                      {/* Save button */}
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-[10px] text-slate-600">
                          {fileDirty ? t('agents.unsavedChanges', 'Unsaved changes') : ''}
                        </span>
                        <button onClick={handleSaveFile}
                          disabled={!fileDirty || fileSaving}
                          className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${
                            fileSaved
                              ? 'bg-emerald-600/20 text-emerald-400'
                              : fileDirty
                              ? 'bg-brand-600 hover:bg-brand-500 text-white'
                              : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                          }`}>
                          {fileSaving ? <Loader2 size={12} className="animate-spin" /> :
                           fileSaved ? <Check size={12} /> : <Save size={12} />}
                          {fileSaved ? t('agents.saved') : t('agents.save')}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
