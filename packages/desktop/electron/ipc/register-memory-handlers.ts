import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import os from 'os';
import { callMcp, checkMemoryHealth, fetchMemoryEvents, fetchKnowledgeCards, fetchCardEvolution, type MemoryEventQueryOptions } from '../memory-client';
import { buildMemoryInitArgs, buildMemorySearchArgs } from '../memory-protocol';
import { readJsonFileWithBom } from '../json-file';

type FileBackedMemoryEvent = {
  id: string;
  type?: string;
  title?: string;
  source?: string;
  session_id?: string;
  agent_role?: string;
  tags?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  fts_content?: string;
};

function parseFrontmatter(raw: string): { meta: Record<string, any>; body: string } {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: raw.trim() };

  const meta: Record<string, any> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const rawValue = line.slice(idx + 1).trim();
    if (!key) continue;

    try {
      if (
        rawValue === 'null'
        || rawValue === 'true'
        || rawValue === 'false'
        || rawValue.startsWith('[')
        || rawValue.startsWith('{')
        || rawValue.startsWith('"')
      ) {
        meta[key] = JSON.parse(rawValue);
      } else {
        meta[key] = rawValue;
      }
    } catch {
      meta[key] = rawValue.replace(/^"|"$/g, '');
    }
  }

  return { meta, body: match[2].trim() };
}

function buildFallbackTitle(body: string, fileName: string): string {
  const firstLine = body.split('\n').find(line => line.trim())?.trim();
  if (firstLine) return firstLine.slice(0, 120);
  return fileName.replace(/\.md$/i, '');
}

async function loadFileBackedMemoryEvents(opts: MemoryEventQueryOptions = {}) {
  const health = await checkMemoryHealth();
  const projectDir = health?.project_dir;
  if (!projectDir) return null;

  const memoriesDir = path.join(projectDir, '.awareness', 'memories');
  if (!fs.existsSync(memoriesDir)) return null;

  const files = fs.readdirSync(memoriesDir)
    .filter(name => name.endsWith('.md'))
    .map(name => path.join(memoriesDir, name));

  const items: FileBackedMemoryEvent[] = files.map((filePath) => {
    const raw = fs.readFileSync(filePath, 'utf8');
    const { meta, body } = parseFrontmatter(raw);
    const stat = fs.statSync(filePath);
    const tags = Array.isArray(meta.tags) ? meta.tags.join(',') : meta.tags;
    return {
      id: meta.id || path.basename(filePath, '.md'),
      type: meta.type || 'turn_brief',
      title: meta.title || buildFallbackTitle(body, path.basename(filePath)),
      source: meta.source || 'desktop',
      session_id: meta.session_id || undefined,
      agent_role: meta.agent_role || undefined,
      tags,
      status: meta.status || 'active',
      created_at: meta.created_at || stat.mtime.toISOString(),
      updated_at: meta.updated_at || stat.mtime.toISOString(),
      fts_content: body,
    };
  });

  const normalizedSearch = (opts.search || '').trim().toLowerCase();
  const filtered = items
    .filter(item => !opts.type || item.type === opts.type)
    .filter(item => !opts.agent_role || item.agent_role === opts.agent_role)
    .filter(item => !opts.source || item.source === opts.source)
    .filter(item => !opts.source_exclude || item.source !== opts.source_exclude)
    .filter((item) => {
      if (!normalizedSearch) return true;
      const haystack = [item.title, item.fts_content, item.source, item.type].join('\n').toLowerCase();
      return haystack.includes(normalizedSearch);
    })
    .sort((a, b) => {
      const left = new Date(b.created_at || 0).getTime();
      const right = new Date(a.created_at || 0).getTime();
      return left - right;
    });

  const offset = opts.offset || 0;
  const limit = opts.limit || 50;
  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
    source: 'file-fallback',
  };
}

export function registerMemoryHandlers() {
  ipcMain.handle('memory:search', async (_e, query: string) => {
    return callMcp('awareness_recall', buildMemorySearchArgs(query));
  });

  ipcMain.handle('memory:get-cards', async () => {
    return callMcp('awareness_lookup', { type: 'knowledge', limit: 50 });
  });

  ipcMain.handle('memory:get-tasks', async () => {
    return callMcp('awareness_lookup', { type: 'tasks', limit: 20, status: 'open' });
  });

  ipcMain.handle('memory:get-context', async (_e, query?: string) => {
    return callMcp('awareness_init', buildMemoryInitArgs(query));
  });

  ipcMain.handle('memory:get-perception', async () => {
    return callMcp('awareness_lookup', { type: 'perception' });
  });

  ipcMain.handle('memory:get-daily-summary', async () => {
    const cards = await callMcp('awareness_lookup', { type: 'knowledge', limit: 10 });
    const tasks = await callMcp('awareness_lookup', { type: 'tasks', limit: 5, status: 'open' });
    return { cards, tasks };
  });

  ipcMain.handle('memory:get-events', async (_e, opts: MemoryEventQueryOptions) => {
    const result = await fetchMemoryEvents(opts);
    const items = Array.isArray(result?.items) ? result.items : [];
    if (items.length > 0 || (result?.total || 0) > 0 || result?.error) {
      return result;
    }

    const fallback = await loadFileBackedMemoryEvents(opts);
    return fallback || result;
  });

  ipcMain.handle('memory:check-health', async () => {
    return checkMemoryHealth();
  });

  ipcMain.handle('memory:get-cards-rest', async (_e, opts?: { category?: string; limit?: number }) => {
    return fetchKnowledgeCards(opts || {});
  });

  ipcMain.handle('memory:get-card-evolution', async (_e, cardId: string) => {
    return fetchCardEvolution(cardId);
  });

  ipcMain.handle('memory:enable-slot-replacement', async () => {
    // Write plugins.slots.memory = "openclaw-memory" into openclaw.json
    // so OpenClaw uses Awareness Memory instead of memory-core
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    try {
      let config: Record<string, any> = {};
      try { config = readJsonFileWithBom<Record<string, any>>(configPath) || {}; } catch { /* new file */ }

      if (!config.plugins) config.plugins = {};
      if (!config.plugins.slots) config.plugins.slots = {};
      config.plugins.slots.memory = 'openclaw-memory';

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      return { success: true, message: 'Memory slot set to openclaw-memory' };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  ipcMain.handle('memory:get-slot-status', async () => {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    try {
      const config = readJsonFileWithBom<Record<string, any>>(configPath) || {};
      const currentSlot = config?.plugins?.slots?.memory || 'memory-core';
      return { slot: currentSlot, isAwareness: currentSlot === 'openclaw-memory' };
    } catch {
      return { slot: 'memory-core', isAwareness: false };
    }
  });
}