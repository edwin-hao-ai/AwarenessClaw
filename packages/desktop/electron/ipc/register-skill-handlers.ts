import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import { ipcMain, BrowserWindow } from 'electron';

const ANSI_REGEX = new RegExp(String.raw`\u001b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])`, 'g');

// --- Verified bins persistence ---
// OpenClaw's `openclaw skills list --json` checks binaries via `which` in a limited PATH.
// After we install a binary (e.g., `brew install op`), it may still report "missing" because
// Electron's spawned process PATH doesn't include all install locations.
// We maintain a verified-bins file to remember binaries we've confirmed exist via enhanced PATH.
// See: https://github.com/openclaw/openclaw/issues/6152
type VerifiedBinsData = Record<string, { verifiedAt: number; path?: string }>;

function getVerifiedBinsPath(home: string): string {
  return path.join(home, '.awareness', 'verified-bins.json');
}

function loadVerifiedBins(home: string): VerifiedBinsData {
  try {
    const filePath = getVerifiedBinsPath(home);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch {}
  return {};
}

function saveVerifiedBins(home: string, data: VerifiedBinsData): void {
  try {
    const filePath = getVerifiedBinsPath(home);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[skill] Failed to save verified-bins:', err);
  }
}

function patchMissingBins(skills: LocalSkillStatus[], verifiedBins: VerifiedBinsData): LocalSkillStatus[] {
  if (Object.keys(verifiedBins).length === 0) return skills;
  return skills.map((skill) => {
    if (!skill.missing?.bins || skill.missing.bins.length === 0) return skill;
    const stillMissing = skill.missing.bins.filter((bin) => !verifiedBins[bin]);
    if (stillMissing.length === skill.missing.bins.length) return skill;
    const patched = { ...skill, missing: { ...skill.missing, bins: stillMissing } };
    // If no missing items left at all, mark as eligible
    const hasAnyMissing = (patched.missing.bins?.length || 0) > 0
      || (patched.missing.anyBins?.length || 0) > 0
      || (patched.missing.env?.length || 0) > 0
      || (patched.missing.config?.length || 0) > 0
      || (patched.missing.os?.length || 0) > 0;
    if (!hasAnyMissing) {
      patched.eligible = true;
      patched.missing = undefined;
    }
    return patched;
  });
}

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

// Parse install specs from SKILL.md YAML frontmatter to recover formula/module/package
// that OpenClaw CLI strips from `openclaw skills info --json` output.
function parseInstallSpecsFromSkillMd(content: string): SkillInstallSpec[] {
  // Extract YAML frontmatter between --- delimiters
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return [];
  const frontmatter = match[1];

  // The metadata field in OpenClaw SKILL.md uses JSON-in-YAML format.
  // Find the metadata block and extract the openclaw.install array.
  const metaMatch = frontmatter.match(/metadata:\s*\n\s*(\{[\s\S]*\})\s*$/m);
  if (!metaMatch) return [];

  try {
    // OpenClaw uses JSON5-ish format (trailing commas) — strip them for JSON.parse
    const cleaned = metaMatch[1].replace(/,(\s*[}\]])/g, '$1');
    const metadata = JSON.parse(cleaned);
    const install = metadata?.openclaw?.install;
    return Array.isArray(install) ? install : [];
  } catch {
    return [];
  }
}

type SkillInstallSpec = {
  id: string;
  kind: string;
  label: string;
  bins?: string[];
  package?: string;
  formula?: string;   // brew formula name (e.g., "1password-cli")
  module?: string;    // go module path (e.g., "github.com/.../cmd/foo@latest")
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

// Allowlist of known safe package manager binaries for spec.command validation
const ALLOWED_INSTALL_BINARIES = new Set([
  'brew', 'apt-get', 'apt', 'dnf', 'yum', 'pacman', 'zypper',
  'npm', 'pnpm', 'yarn', 'pip', 'pip3', 'cargo',
  'go', 'uv',
  'winget', 'choco', 'scoop',
  'sudo', 'doas',
]);

function buildInstallCommands(spec: SkillInstallSpec) {
  if (spec.command && spec.command.trim()) {
    // SECURITY: Validate that spec.command only uses known package manager binaries.
    // Third-party skills could set command to arbitrary shell commands (RCE risk).
    const binary = extractPrimaryBinary(spec.command);
    if (!binary || !ALLOWED_INSTALL_BINARIES.has(binary)) {
      console.warn(`[skill:install-deps] Blocked unsafe spec.command with binary "${binary}": ${spec.command.slice(0, 100)}`);
      return [];
    }
    return [spec.command.trim()];
  }

  const kind = (spec.kind || 'auto').toLowerCase();

  // Use kind-specific fields first, matching OpenClaw's install spec format:
  // - brew: spec.formula (e.g., "1password-cli")
  // - go:   spec.module  (e.g., "github.com/.../cmd/foo@latest")
  // - node: spec.package (e.g., "typescript")
  // - uv:   spec.package (e.g., "ruff")
  // Fallback: spec.package || spec.bins[0] || spec.id
  const brewFormula = sanitizePackageName(spec.formula || spec.package || spec.bins?.[0] || spec.id);
  const nodePkg = sanitizePackageName(spec.package || spec.bins?.[0] || spec.id);
  const goModule = spec.module?.trim();
  const fallbackPkg = sanitizePackageName(spec.package || spec.bins?.[0] || spec.id);

  const linuxCommands = fallbackPkg ? [
    `sudo -n apt-get update && sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y ${fallbackPkg}`,
    `sudo -n dnf install -y ${fallbackPkg}`,
    `sudo -n yum install -y ${fallbackPkg}`,
    `sudo -n pacman -S --noconfirm ${fallbackPkg}`,
    `sudo -n zypper install -y ${fallbackPkg}`,
    `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${fallbackPkg}`,
    `dnf install -y ${fallbackPkg}`,
    `yum install -y ${fallbackPkg}`,
    `pacman -S --noconfirm ${fallbackPkg}`,
    `zypper install -y ${fallbackPkg}`,
  ] : [];

  switch (kind) {
    case 'brew':
      return brewFormula ? ['brew install ' + brewFormula] : [];
    case 'go':
      // go install requires a module path — `go install github.com/.../cmd/foo@latest`
      if (goModule && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*@[a-z0-9v._-]+$/.test(goModule)) {
        return [`go install ${goModule}`];
      }
      return [];
    case 'uv':
      return nodePkg ? [`uv tool install ${nodePkg}`] : [];
    case 'node':
    case 'npm':
      return nodePkg ? [`npm install -g --ignore-scripts ${nodePkg}`] : [];
    case 'pnpm':
      return nodePkg ? [`pnpm add -g ${nodePkg}`] : [];
    case 'yarn':
      return nodePkg ? [`yarn global add ${nodePkg}`] : [];
    case 'winget':
      return fallbackPkg ? [
        `winget install --id ${fallbackPkg} -e --accept-source-agreements --accept-package-agreements --disable-interactivity`,
        `winget install ${fallbackPkg} --accept-source-agreements --accept-package-agreements --disable-interactivity`,
      ] : [];
    case 'choco':
    case 'chocolatey':
      return fallbackPkg ? [`choco install ${fallbackPkg} -y`] : [];
    case 'scoop':
      return fallbackPkg ? [`scoop install ${fallbackPkg}`] : [];
    case 'apt':
    case 'apt-get':
    case 'dnf':
    case 'yum':
    case 'pacman':
    case 'zypper':
      return linuxCommands;
    case 'pip':
      return fallbackPkg ? [`pip install ${fallbackPkg}`, `pip3 install ${fallbackPkg}`] : [];
    case 'cargo':
      return fallbackPkg ? [`cargo install ${fallbackPkg}`] : [];
    case 'auto':
    default:
      if (process.platform === 'win32') {
        return fallbackPkg ? [
          `winget install --id ${fallbackPkg} -e --accept-source-agreements --accept-package-agreements --disable-interactivity`,
          `choco install ${fallbackPkg} -y`,
          `scoop install ${fallbackPkg}`,
          `npm install -g --ignore-scripts ${fallbackPkg}`,
        ] : [];
      }
      if (process.platform === 'darwin') {
        return brewFormula ? [`brew install ${brewFormula}`, ...(nodePkg ? [`npm install -g --ignore-scripts ${nodePkg}`] : [])] : [];
      }
      return [...linuxCommands, ...(nodePkg ? [`npm install -g --ignore-scripts ${nodePkg}`] : [])];
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
  runSpawnAsync: (cmd: string, args: string[], timeoutMs?: number) => Promise<string>;
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

      // Patch missing.bins using our verified-bins persistence.
      // OpenClaw checks binaries with limited PATH; we use enhanced PATH.
      const verifiedBins = loadVerifiedBins(deps.home);
      report.skills = patchMissingBins(report.skills, verifiedBins);

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

      // OpenClaw CLI strips formula/module/package from install specs (only keeps id/kind/label/bins).
      // Read the actual SKILL.md to recover the full install spec with correct package names.
      // Without this, `brew install op` runs instead of `brew install 1password-cli`.
      if (parsed.filePath && Array.isArray(parsed.install) && parsed.install.length > 0) {
        try {
          const skillMd = fs.readFileSync(parsed.filePath, 'utf8');
          const fullSpecs = parseInstallSpecsFromSkillMd(skillMd);
          console.log(`[skill:local-info] ${name}: parsed ${fullSpecs.length} install specs from SKILL.md`);
          if (fullSpecs.length > 0) {
            // Merge full specs back by matching id+kind
            parsed.install = parsed.install.map((cliSpec: any) => {
              const full = fullSpecs.find((f: any) => f.id === cliSpec.id && f.kind === cliSpec.kind);
              if (full) {
                console.log(`[skill:local-info] ${name}: merged spec id=${cliSpec.id} kind=${cliSpec.kind} formula=${full.formula || '-'} module=${full.module || '-'}`);
              }
              return full ? { ...cliSpec, ...full } : cliSpec;
            });
          }
        } catch (mergeErr) {
          console.warn(`[skill:local-info] ${name}: SKILL.md merge failed:`, mergeErr);
        }
      }

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
  // Second arg is optional skillName — when provided, we read the SKILL.md directly
  // to get the REAL install specs (with formula/module/package) instead of relying
  // on the stripped specs from OpenClaw CLI.
  ipcMain.handle('skill:install-deps', async (_e, installSpecs: unknown, skillName?: string) => {
    let specs = Array.isArray(installSpecs) ? installSpecs as SkillInstallSpec[] : [];

    // PRIMARY PATH: if skillName is provided, read SKILL.md for authoritative install specs.
    // This bypasses all the broken chain of stripped CLI specs → frontend → back to IPC.
    if (skillName && typeof skillName === 'string') {
      try {
        const raw = await deps.runAsync(`openclaw skills info ${skillName} --json`, 30000);
        const parsed = JSON.parse(extractJsonPayload(raw));
        if (parsed.filePath && fs.existsSync(parsed.filePath)) {
          const fullSpecs = parseInstallSpecsFromSkillMd(fs.readFileSync(parsed.filePath, 'utf8'));
          if (fullSpecs.length > 0) {
            specs = fullSpecs as SkillInstallSpec[];
            console.log(`[skill:install-deps] using SKILL.md specs for ${skillName}:`, specs.map((s: any) => `${s.kind}:${s.formula || s.module || s.package || '?'}`).join(', '));
          }
        }
      } catch (err) {
        console.warn(`[skill:install-deps] SKILL.md lookup failed for ${skillName}:`, err);
      }
    }

    if (specs.length === 0) {
      return { success: false, error: 'No dependency install specs provided' };
    }

    for (const s of specs) {
      console.log(`[skill:install-deps] spec: kind=${s.kind} formula=${s.formula || '-'} module=${s.module || '-'} package=${s.package || '-'} bins=${(s.bins || []).join(',')}`);
    }

    const failures: Array<{ id: string; label: string; error: string }> = [];
    const installed: Array<{ id: string; label: string; command: string }> = [];

    const isCommandAvailable = async (binary: string) => {
      if (!binary) return false;
      try {
        // Use array args to prevent injection from binary name.
        // 'which' is a real binary (/usr/bin/which), unlike 'command' which is a shell builtin.
        const probe = process.platform === 'win32' ? 'where' : 'which';
        await deps.runSpawnAsync(probe, [binary], 5000);
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

    // After successful install, verify target binaries actually exist via enhanced PATH.
    // The install command may exit 0 but install the wrong package (e.g., `brew install grizzly`
    // installs Grafana's `grr`, not Bear Notes' `grizzly`). We must verify the actual binary.
    sendProgress('verifying', 'dependencies installed');
    const verifiedBins = loadVerifiedBins(deps.home);
    const verifiedList: string[] = [];
    const unverifiedList: string[] = [];
    for (const spec of specs) {
      const targetBins = spec.bins || [];
      for (const bin of targetBins) {
        if (await isCommandAvailable(bin)) {
          let binPath: string | undefined;
          try {
            const probe = process.platform === 'win32' ? 'where' : 'which';
            binPath = (await deps.runSpawnAsync(probe, [bin], 5000)).split(/\r?\n/)[0]?.trim();
          } catch {}
          verifiedBins[bin] = { verifiedAt: Date.now(), path: binPath };
          verifiedList.push(bin);
        } else {
          unverifiedList.push(bin);
        }
      }
    }
    if (verifiedList.length > 0) {
      saveVerifiedBins(deps.home, verifiedBins);
    }

    return {
      success: true,
      installed,
      verified: verifiedList,
      unverified: unverifiedList,
    };
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