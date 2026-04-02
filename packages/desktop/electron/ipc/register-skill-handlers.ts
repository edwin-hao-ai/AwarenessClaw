import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { ipcMain } from 'electron';

const ANSI_REGEX = new RegExp(String.raw`\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`, 'g');

type LocalSkillStatus = {
  name: string;
  description: string;
  source: string;
  skillKey?: string;
  emoji?: string;
  homepage?: string;
  primaryEnv?: string;
  bundled?: boolean;
  eligible: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  missing?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
  install?: Array<{
    id: string;
    kind: string;
    label: string;
    bins: string[];
  }>;
};

type LocalSkillStatusReport = {
  workspaceDir?: string;
  managedSkillsDir?: string;
  skills: LocalSkillStatus[];
};

function stripAnsi(text: string) {
  return text.replace(ANSI_REGEX, '');
}

function extractJsonPayload(raw: string) {
  const cleaned = stripAnsi(raw).trim();
  const objectStart = cleaned.indexOf('{');
  const arrayStart = cleaned.indexOf('[');
  const startCandidates = [objectStart, arrayStart].filter((value) => value >= 0);
  if (startCandidates.length === 0) {
    throw new Error('No JSON payload found');
  }
  const start = Math.min(...startCandidates);
  const objectEnd = cleaned.lastIndexOf('}');
  const arrayEnd = cleaned.lastIndexOf(']');
  const end = Math.max(objectEnd, arrayEnd);
  if (end < start) {
    throw new Error('Incomplete JSON payload');
  }
  return cleaned.slice(start, end + 1);
}

function normalizeInstalledSkills(report: LocalSkillStatusReport) {
  return Object.fromEntries(
    (report.skills || [])
      .filter((skill) => !skill.bundled)
      .map((skill) => [skill.skillKey || skill.name, {
        slug: skill.skillKey || skill.name,
        version: 'local',
        installedAt: 0,
      }]),
  );
}

async function loadOfficialSkillStatus(runAsync: (cmd: string, timeoutMs?: number) => Promise<string>) {
  const raw = await runAsync('openclaw skills list --json', 60000);
  const parsed = JSON.parse(extractJsonPayload(raw)) as LocalSkillStatusReport;
  return {
    workspaceDir: parsed.workspaceDir,
    managedSkillsDir: parsed.managedSkillsDir,
    skills: Array.isArray(parsed.skills) ? parsed.skills : [],
  } satisfies LocalSkillStatusReport;
}

function mapClawHubListItem(item: any) {
  return {
    slug: item.slug,
    name: item.displayName || item.slug,
    displayName: item.displayName || item.slug,
    description: item.summary || '',
    summary: item.summary || '',
    version: item.latestVersion?.version,
    downloads: item.stats?.downloads,
    score: item.stats?.stars,
  };
}

function mapClawHubDetail(detail: any) {
  return {
    slug: detail?.skill?.slug,
    name: detail?.skill?.displayName || detail?.skill?.slug,
    displayName: detail?.skill?.displayName || detail?.skill?.slug,
    description: detail?.skill?.summary || '',
    summary: detail?.skill?.summary || '',
    owner: detail?.owner?.handle || detail?.owner?.displayName,
    version: detail?.latestVersion?.version,
    readme: detail?.version?.readme || '',
    skillMd: detail?.version?.skillMd || '',
  };
}

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON response')); }
      });
    }).on('error', reject).on('timeout', function(this: any) { this.destroy(); reject(new Error('Request timeout')); });
  });
}

export function registerSkillHandlers(deps: {
  home: string;
  runAsync: (cmd: string, timeoutMs?: number) => Promise<string>;
  readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null>;
}) {
  const clawhubApi = 'https://clawhub.ai/api/v1';
  const workspaceDir = path.join(deps.home, '.openclaw', 'workspace');
  const lockFile = path.join(workspaceDir, '.clawhub', 'lock.json');

  ipcMain.handle('skill:list-installed', async () => {
    try {
      let report: LocalSkillStatusReport;
      const combined = await deps.readShellOutputAsync('openclaw skills list --json', 60000);
      if (combined && combined.trim()) {
        const parsed = JSON.parse(extractJsonPayload(combined)) as LocalSkillStatusReport;
        report = {
          workspaceDir: parsed.workspaceDir,
          managedSkillsDir: parsed.managedSkillsDir,
          skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        };
      } else {
        report = await loadOfficialSkillStatus(deps.runAsync);
      }
      return {
        success: true,
        report,
        skills: normalizeInstalledSkills(report),
      };
    } catch (statusErr: any) {
      try {
        const raw = fs.readFileSync(lockFile, 'utf8');
        const lock = JSON.parse(raw);
        return {
          success: true,
          skills: lock.skills || {},
          report: { skills: [] },
          error: statusErr?.message || 'Fell back to lockfile because official OpenClaw skills status could not be loaded',
        };
      } catch {
        return { success: false, skills: {}, report: { skills: [] }, error: statusErr?.message || 'Failed to load skills' };
      }
    }
  });

  ipcMain.handle('skill:explore', async () => {
    try {
      const res = await fetchJson(`${clawhubApi}/skills?limit=60&sort=downloads&nonSuspiciousOnly=true`);
      const items = Array.isArray(res?.items) ? res.items : [];
      return { success: true, skills: items.map(mapClawHubListItem), nextCursor: res?.nextCursor || null };
    } catch (err: any) {
      return { success: false, error: err.message, skills: [] };
    }
  });

  ipcMain.handle('skill:search', async (_e, query: string) => {
    try {
      const res = await fetchJson(`${clawhubApi}/search?q=${encodeURIComponent(query)}&limit=20&nonSuspiciousOnly=true`);
      return { success: true, results: res?.results || [] };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('skill:detail', async (_e, slug: string) => {
    try {
      const res = await fetchJson(`${clawhubApi}/skills/${encodeURIComponent(slug)}`);
      return { success: true, skill: mapClawHubDetail(res) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('skill:install', async (_e, slug: string) => {
    try {
      await deps.runAsync(`npx -y clawhub@latest install ${slug} --force`, 60000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 300) };
    }
  });

  ipcMain.handle('skill:uninstall', async (_e, slug: string) => {
    try {
      await deps.runAsync(`npx -y clawhub@latest uninstall ${slug}`, 30000);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 300) };
    }
  });

  ipcMain.handle('skill:get-config', async (_e, slug: string) => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const skillConfig = config.skills?.[slug]?.config || {};
      return { success: true, config: skillConfig };
    } catch (err: any) {
      return { success: false, error: err.message, config: {} };
    }
  });

  ipcMain.handle('skill:save-config', async (_e, slug: string, newConfig: Record<string, unknown>) => {
    try {
      const configPath = path.join(deps.home, '.openclaw', 'openclaw.json');
      let config: any = {};
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      if (!config.skills) config.skills = {};
      if (!config.skills[slug]) config.skills[slug] = {};
      config.skills[slug].config = { ...config.skills[slug].config, ...newConfig };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}