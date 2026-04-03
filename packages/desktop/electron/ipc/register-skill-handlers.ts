import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { ipcMain, BrowserWindow } from 'electron';

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

type SkillInstallSpec = {
  id: string;
  kind: string;
  label: string;
  bins?: string[];
  package?: string;
  command?: string;
};

function sanitizePackageName(input?: string) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9@._/:+-]+$/.test(trimmed)) return null;
  return trimmed;
}

function extractPrimaryBinary(command: string) {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  let idx = 0;
  while (idx < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[idx])) {
    idx += 1;
  }
  if (parts[idx] === 'sudo' || parts[idx] === 'doas') {
    idx += 1;
    while (idx < parts.length && parts[idx].startsWith('-')) {
      idx += 1;
    }
    while (idx < parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[idx])) {
      idx += 1;
    }
  }
  return (parts[idx] || '').replace(/["']/g, '');
}

function buildInstallCommands(spec: SkillInstallSpec) {
  if (spec.command && spec.command.trim()) {
    return [spec.command.trim()];
  }

  const pkg = sanitizePackageName(spec.package || spec.bins?.[0] || spec.id);
  if (!pkg) return [];

  const linuxCommands = [
    `sudo -n apt-get update && sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg}`,
    `sudo -n dnf install -y ${pkg}`,
    `sudo -n yum install -y ${pkg}`,
    `sudo -n pacman -S --noconfirm ${pkg}`,
    `sudo -n zypper install -y ${pkg}`,
    `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${pkg}`,
    `dnf install -y ${pkg}`,
    `yum install -y ${pkg}`,
    `pacman -S --noconfirm ${pkg}`,
    `zypper install -y ${pkg}`,
  ];

  const kind = (spec.kind || 'auto').toLowerCase();
  switch (kind) {
    case 'brew':
      return ['brew install ' + pkg];
    case 'winget':
      return [
        `winget install --id ${pkg} -e --accept-source-agreements --accept-package-agreements --disable-interactivity`,
        `winget install ${pkg} --accept-source-agreements --accept-package-agreements --disable-interactivity`,
      ];
    case 'choco':
    case 'chocolatey':
      return [`choco install ${pkg} -y`];
    case 'scoop':
      return [`scoop install ${pkg}`];
    case 'apt':
    case 'apt-get':
    case 'dnf':
    case 'yum':
    case 'pacman':
    case 'zypper':
      return linuxCommands;
    case 'npm':
      return [`npm install -g ${pkg}`];
    case 'pnpm':
      return [`pnpm add -g ${pkg}`];
    case 'yarn':
      return [`yarn global add ${pkg}`];
    case 'pip':
      return [`pip install ${pkg}`, `pip3 install ${pkg}`];
    case 'cargo':
      return [`cargo install ${pkg}`];
    case 'auto':
    default:
      if (process.platform === 'win32') {
        return [
          `winget install --id ${pkg} -e --accept-source-agreements --accept-package-agreements --disable-interactivity`,
          `choco install ${pkg} -y`,
          `scoop install ${pkg}`,
          `npm install -g ${pkg}`,
        ];
      }
      if (process.platform === 'darwin') {
        return [`brew install ${pkg}`, `npm install -g ${pkg}`];
      }
      return [...linuxCommands, `npm install -g ${pkg}`];
  }
}

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
  function sendProgress(stage: string, detail?: string) {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('skill:install-progress', { stage, detail });
    }
  }

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

  // Fetch detailed local skill info including install specs from OpenClaw CLI
  ipcMain.handle('skill:local-info', async (_e, name: string) => {
    try {
      const raw = await deps.runAsync(`openclaw skills info ${name} --json`, 30000);
      const parsed = JSON.parse(extractJsonPayload(raw));
      return { success: true, info: parsed };
    } catch (err: any) {
      return { success: false, error: err.message?.slice(0, 300) };
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
      sendProgress('downloading', slug);
      // --workdir prevents clawhub from falling back to cwd (which is "/" in packaged Electron)
      await deps.runAsync(
        `npx -y clawhub@latest install ${slug} --force --workdir "${workspaceDir}"`,
        120000,
      );
      sendProgress('verifying', slug);
      return { success: true };
    } catch (err: any) {
      sendProgress('error', err.message?.slice(0, 200));
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

  // Install deps is kept for backward compat but no longer auto-executes brew/npm.
  // This now supports silent cross-platform auto-install for built-in skill deps.
  ipcMain.handle('skill:install-deps', async (_e, installSpecs: unknown) => {
    const specs = Array.isArray(installSpecs) ? installSpecs as SkillInstallSpec[] : [];
    if (specs.length === 0) {
      return { success: false, error: 'No dependency install specs provided' };
    }

    const failures: Array<{ id: string; label: string; error: string }> = [];
    const installed: Array<{ id: string; label: string; command: string }> = [];

    const isCommandAvailable = async (binary: string) => {
      if (!binary) return false;
      const probe = process.platform === 'win32' ? `where ${binary}` : `command -v ${binary}`;
      try {
        await deps.runAsync(probe, 5000);
        return true;
      } catch {
        return false;
      }
    };

    for (const spec of specs) {
      const commands = buildInstallCommands(spec);
      if (commands.length === 0) {
        failures.push({
          id: spec.id || 'unknown',
          label: spec.label || spec.id || 'unknown',
          error: 'No safe install command generated',
        });
        continue;
      }

      let ok = false;
      let lastError = '';

      for (const command of commands) {
        const binary = extractPrimaryBinary(command);
        if (!(await isCommandAvailable(binary))) {
          continue;
        }
        sendProgress('installing', spec.label || spec.id || binary);
        try {
          await deps.runAsync(command, 300000);
          installed.push({ id: spec.id || binary, label: spec.label || spec.id || binary, command });
          ok = true;
          break;
        } catch (err: any) {
          lastError = err?.message?.slice(0, 200) || 'Install command failed';
        }
      }

      if (!ok) {
        failures.push({
          id: spec.id || 'unknown',
          label: spec.label || spec.id || 'unknown',
          error: lastError || 'No available installer found on this system',
        });
      }
    }

    if (failures.length > 0) {
      const first = failures[0];
      sendProgress('error', `${first.label}: ${first.error}`);
      return {
        success: false,
        error: `Failed to install ${failures.length} dependency item(s). First error: ${first.label} - ${first.error}`,
        installed,
        failures,
      };
    }

    sendProgress('verifying', 'dependencies installed');
    return { success: true, installed };
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