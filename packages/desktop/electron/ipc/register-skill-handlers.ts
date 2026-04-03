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
  const openclawDir = path.join(deps.home, '.openclaw');
  const workspaceDir = path.join(openclawDir, 'workspace');
  const lockFile = path.join(workspaceDir, '.clawhub', 'lock.json');
  const configPath = path.join(openclawDir, 'openclaw.json');

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
      // nonSuspiciousOnly=false: most third-party skills get flagged by VirusTotal Code Insight,
      // using true would filter out nearly all results
      const res = await fetchJson(`${clawhubApi}/skills?limit=60&sort=downloads`);
      const items = Array.isArray(res?.items) ? res.items : [];
      return { success: true, skills: items.map(mapClawHubListItem), nextCursor: res?.nextCursor || null };
    } catch (err: any) {
      return { success: false, error: err.message, skills: [] };
    }
  });

  ipcMain.handle('skill:search', async (_e, query: string) => {
    try {
      const res = await fetchJson(`${clawhubApi}/search?q=${encodeURIComponent(query)}&limit=20`);
      const results = Array.isArray(res?.results) ? res.results : [];
      // Map search results to the same shape as explore items
      return {
        success: true,
        results: results.map((item: any) => ({
          slug: item.slug,
          name: item.displayName || item.slug,
          displayName: item.displayName || item.slug,
          description: item.summary || '',
          summary: item.summary || '',
          version: item.version,
          score: item.score,
        })),
      };
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
      // Ensure workspace dir exists before clawhub install
      const skillsDir = path.join(workspaceDir, 'skills');
      if (!fs.existsSync(skillsDir)) {
        fs.mkdirSync(skillsDir, { recursive: true });
      }
      // --workdir prevents clawhub from falling back to cwd (which is "/" in packaged Electron)
      await deps.runAsync(
        `npx -y clawhub@latest install ${slug} --force --workdir "${workspaceDir}"`,
        120000,
      );
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 300) };
    }
  });

  ipcMain.handle('skill:uninstall', async (_e, slug: string) => {
    try {
      await deps.runAsync(
        `npx -y clawhub@latest uninstall ${slug} --workdir "${workspaceDir}"`,
        30000,
      );
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 300) };
    }
  });

  // Install missing dependencies for built-in skills (e.g., brew install memo for apple-notes)
  ipcMain.handle('skill:install-deps', async (_e, installSpecs: Array<{ id: string; kind: string; label: string; bins: string[]; package?: string }>) => {
    if (!Array.isArray(installSpecs) || installSpecs.length === 0) {
      return { success: false, error: 'No install specs provided' };
    }
    const errors: string[] = [];
    for (const spec of installSpecs) {
      try {
        if (spec.kind === 'brew') {
          // Homebrew: install the package (package name is typically the bin name or spec.id)
          const pkg = spec.package || spec.bins?.[0] || spec.id;
          await deps.runAsync(`brew install ${pkg}`, 120000);
        } else if (spec.kind === 'node') {
          // npm global install
          const pkg = spec.package || spec.id;
          await deps.runAsync(`npm install -g ${pkg}`, 120000);
        } else if (spec.kind === 'uv') {
          const pkg = spec.package || spec.id;
          await deps.runAsync(`uv tool install ${pkg}`, 120000);
        } else if (spec.kind === 'go') {
          const pkg = spec.package || spec.id;
          await deps.runAsync(`go install ${pkg}@latest`, 120000);
        } else {
          errors.push(`Unsupported installer kind: ${spec.kind} (${spec.label})`);
          continue;
        }
      } catch (err: any) {
        errors.push(`${spec.label}: ${err.message?.slice(0, 200)}`);
      }
    }
    if (errors.length > 0) {
      return { success: false, error: errors.join('\n') };
    }
    return { success: true };
  });

  ipcMain.handle('skill:get-config', async (_e, slug: string) => {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // OpenClaw stores skill config at skills.entries[slug] (not skills[slug])
      const entry = config.skills?.entries?.[slug] || {};
      return {
        success: true,
        config: entry.config || {},
        enabled: entry.enabled !== false,
        apiKey: entry.apiKey || '',
        env: entry.env || {},
      };
    } catch (err: any) {
      return { success: false, error: err.message, config: {} };
    }
  });

  ipcMain.handle('skill:save-config', async (_e, slug: string, newConfig: Record<string, unknown>) => {
    try {
      let config: any = {};
      try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
      // Ensure skills.entries path exists
      if (!config.skills) config.skills = {};
      if (!config.skills.entries) config.skills.entries = {};
      if (!config.skills.entries[slug]) config.skills.entries[slug] = {};
      const entry = config.skills.entries[slug];
      // Merge config, apiKey, enabled, env if provided
      if ('apiKey' in newConfig) {
        entry.apiKey = newConfig.apiKey;
        delete newConfig.apiKey;
      }
      if ('enabled' in newConfig) {
        entry.enabled = newConfig.enabled;
        delete newConfig.enabled;
      }
      if ('env' in newConfig && typeof newConfig.env === 'object') {
        entry.env = { ...entry.env, ...newConfig.env as Record<string, string> };
        delete newConfig.env;
      }
      // Remaining keys go into config
      entry.config = { ...entry.config, ...newConfig };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}