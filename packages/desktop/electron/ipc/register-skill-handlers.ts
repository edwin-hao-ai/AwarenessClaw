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

type InstallCommandPlan = {
  command: string;
  binary: string;
  manager: string;
  packageName?: string;
  source: 'declared' | 'alias' | 'search';
  note?: string;
};

type PackageAlias = {
  manager: string;
  packageName: string;
  note?: string;
};

const INSTALL_PACKAGE_ALIASES: Record<string, Partial<Record<'all' | NodeJS.Platform, PackageAlias[]>>> = {
  op: {
    win32: [{ manager: 'winget', packageName: 'AgileBits.1Password.CLI', note: 'Matched op to 1Password CLI on winget.' }],
    darwin: [{ manager: 'brew', packageName: '1password-cli', note: 'Matched op to the Homebrew 1password-cli formula.' }],
  },
  ffmpeg: {
    win32: [{ manager: 'winget', packageName: 'BtbN.FFmpeg.GPL', note: 'Matched ffmpeg to a Windows winget package.' }],
    all: [{ manager: 'choco', packageName: 'ffmpeg' }, { manager: 'scoop', packageName: 'ffmpeg' }],
  },
  camsnap: {
    darwin: [{ manager: 'brew', packageName: 'steipete/tap/camsnap', note: 'Matched camsnap to the published Homebrew tap formula.' }],
  },
};

function sanitizePackageName(input?: string) {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[A-Za-z0-9@._/:+-]+$/.test(trimmed)) return null;
  return trimmed;
}

function buildInstallCommandsForManager(manager: string, packageName?: string) {
  const safePackageName = sanitizePackageName(packageName);
  if (!safePackageName) return [];

  switch ((manager || '').toLowerCase()) {
    case 'brew':
      return [`brew install ${safePackageName}`];
    case 'winget':
      return [
        `winget install --id ${safePackageName} -e --accept-source-agreements --accept-package-agreements --disable-interactivity`,
        `winget install ${safePackageName} --accept-source-agreements --accept-package-agreements --disable-interactivity`,
      ];
    case 'choco':
    case 'chocolatey':
      return [`choco install ${safePackageName} -y`];
    case 'scoop':
      return [`scoop install ${safePackageName}`];
    case 'npm':
    case 'node':
      return [`npm install -g --ignore-scripts ${safePackageName}`];
    case 'pnpm':
      return [`pnpm add -g ${safePackageName}`];
    case 'yarn':
      return [`yarn global add ${safePackageName}`];
    case 'pip':
      return [`pip install ${safePackageName}`, `pip3 install ${safePackageName}`];
    case 'cargo':
      return [`cargo install ${safePackageName}`];
    case 'uv':
      return [`uv tool install ${safePackageName}`];
    case 'apt':
    case 'apt-get':
      return [
        `sudo -n apt-get update && sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y ${safePackageName}`,
        `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${safePackageName}`,
      ];
    case 'dnf':
      return [`sudo -n dnf install -y ${safePackageName}`, `dnf install -y ${safePackageName}`];
    case 'yum':
      return [`sudo -n yum install -y ${safePackageName}`, `yum install -y ${safePackageName}`];
    case 'pacman':
      return [`sudo -n pacman -S --noconfirm ${safePackageName}`, `pacman -S --noconfirm ${safePackageName}`];
    case 'zypper':
      return [`sudo -n zypper install -y ${safePackageName}`, `zypper install -y ${safePackageName}`];
    default:
      return [];
  }
}

function createInstallPlans(
  commands: string[],
  source: InstallCommandPlan['source'],
  manager?: string,
  packageName?: string,
  note?: string,
) {
  return commands.map((command) => ({
    command,
    binary: extractPrimaryBinary(command),
    manager: manager || extractPrimaryBinary(command),
    packageName,
    source,
    note,
  } satisfies InstallCommandPlan));
}

function dedupeInstallPlans(plans: InstallCommandPlan[]) {
  const seen = new Set<string>();
  return plans.filter((plan) => {
    const key = `${plan.binary}::${plan.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectInstallSearchTerms(spec: SkillInstallSpec) {
  const terms = new Set<string>();
  for (const bin of spec.bins || []) {
    const safeBin = sanitizePackageName(bin);
    if (safeBin && !safeBin.includes('/') && !safeBin.includes('@')) terms.add(safeBin);
  }
  for (const candidate of [spec.package, spec.id]) {
    const safeCandidate = sanitizePackageName(candidate);
    if (safeCandidate && !safeCandidate.includes('/') && !safeCandidate.includes('@')) terms.add(safeCandidate);
  }
  return [...terms];
}

function getPackageAliases(term: string) {
  const entry = INSTALL_PACKAGE_ALIASES[term.toLowerCase()];
  if (!entry) return [];
  return [...(entry.all || []), ...(entry[process.platform] || [])];
}

export function parseWingetSearchIds(output: string) {
  const lines = stripAnsi(output).split(/\r?\n/);
  const ids: string[] = [];
  let inTable = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('Failed when searching source')) continue;
    if (/^-{5,}$/.test(trimmed)) {
      inTable = true;
      continue;
    }
    if (!inTable || /^name\s+/i.test(trimmed)) continue;

    const parts = line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 4) continue;

    const source = parts[parts.length - 1]?.toLowerCase();
    const id = parts[1];
    if (source !== 'winget' && source !== 'msstore') continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) continue;
    ids.push(id);
  }

  return [...new Set(ids)];
}

function rankWingetPackageIds(ids: string[], term: string) {
  const loweredTerm = term.toLowerCase();
  const score = (id: string) => {
    const loweredId = id.toLowerCase();
    let value = 0;
    if (loweredId === loweredTerm) value += 20;
    if (loweredId.endsWith(`.${loweredTerm}`)) value += 16;
    if (loweredId.includes(loweredTerm)) value += 8;
    if (!loweredId.includes('.shared')) value += 2;
    if (!/\.\d/.test(loweredId)) value += 1;
    return value - (id.length / 100);
  };
  return [...ids].sort((left, right) => score(right) - score(left));
}

async function searchWingetPackageIds(
  term: string,
  runSpawnAsync: (cmd: string, args: string[], timeoutMs?: number) => Promise<string>,
) {
  const searchVariants: string[][] = [
    ['search', '--command', term, '--accept-source-agreements', '--disable-interactivity'],
    ['search', '--query', term, '--exact', '--accept-source-agreements', '--disable-interactivity'],
  ];

  for (const args of searchVariants) {
    try {
      const output = await runSpawnAsync('winget', args, 20000);
      const ids = parseWingetSearchIds(output);
      if (ids.length > 0) return rankWingetPackageIds(ids, term);
    } catch {}
  }

  return [];
}

async function buildResolvedInstallPlans(
  spec: SkillInstallSpec,
  deps: { runSpawnAsync: (cmd: string, args: string[], timeoutMs?: number) => Promise<string> },
  sendProgress: (stage: string, detail?: string) => void,
  isCommandAvailable: (binary: string) => Promise<boolean>,
) {
  const searchTerms = collectInstallSearchTerms(spec);
  const plans: InstallCommandPlan[] = [];

  for (const term of searchTerms) {
    for (const alias of getPackageAliases(term)) {
      plans.push(
        ...createInstallPlans(
          buildInstallCommandsForManager(alias.manager, alias.packageName),
          'alias',
          alias.manager,
          alias.packageName,
          alias.note,
        ),
      );
    }
  }

  if (process.platform === 'win32' && searchTerms.length > 0 && await isCommandAvailable('winget')) {
    for (const term of searchTerms.slice(0, 3)) {
      sendProgress('matching', `Searching Windows packages for ${term}...`);
      const ids = await searchWingetPackageIds(term, deps.runSpawnAsync);
      for (const id of ids.slice(0, 3)) {
        plans.push(
          ...createInstallPlans(
            buildInstallCommandsForManager('winget', id),
            'search',
            'winget',
            id,
            `Matched ${term} to ${id}.`,
          ),
        );
      }
    }
  }

  plans.push(...createInstallPlans(buildInstallCommands(spec), 'declared'));
  return dedupeInstallPlans(plans);
}

export function buildAutoInstallSpecsFromMissingBins(
  missingBins: string[] | undefined,
  attemptedBins: Iterable<string> = [],
) {
  const attempted = new Set([...attemptedBins].map((bin) => bin.trim()));
  return (missingBins || [])
    .filter((bin) => typeof bin === 'string')
    .map((bin) => bin.trim())
    .filter((bin) => bin && !attempted.has(bin))
    .map((bin, index) => ({
      id: `auto-${bin}-${index}`,
      kind: 'auto',
      label: `Install ${bin}`,
      bins: [bin],
      package: bin,
    } satisfies SkillInstallSpec));
}

function buildNoInstallerMessage(spec: SkillInstallSpec, plans: InstallCommandPlan[]) {
  const target = spec.bins?.[0] || spec.package || spec.formula || spec.id || 'dependency';
  const checkedManagers = [...new Set(plans.map((plan) => plan.manager).filter(Boolean))];

  if (process.platform === 'win32') {
    if ((spec.kind || '').toLowerCase() === 'brew') {
      return `No Windows package matched ${target}. This skill only declares a Homebrew install, and automatic matching did not find a winget, Chocolatey, Scoop, or npm package.`;
    }
    return `No Windows package matched ${target}. Checked ${checkedManagers.length > 0 ? checkedManagers.join(', ') : 'winget, Chocolatey, Scoop, npm'}.`;
  }
  if (process.platform === 'linux') {
    return `No Linux package matched ${target}. Checked ${checkedManagers.length > 0 ? checkedManagers.join(', ') : 'apt, dnf, yum, pacman, zypper, npm'}.`;
  }
  return `No compatible installer matched ${target}. Try the Install Guide for manual setup.`;
}

async function loadLocalSkillInfo(
  name: string,
  deps: { readShellOutputAsync: (cmd: string, timeoutMs?: number) => Promise<string | null> },
) {
  const raw = await deps.readShellOutputAsync(`openclaw skills info ${name} --json`, 30000);
  if (!raw) throw new Error('No output from openclaw skills info');
  const parsed = JSON.parse(extractJsonPayload(raw));

  if (parsed.filePath && Array.isArray(parsed.install) && parsed.install.length > 0) {
    try {
      const skillMd = fs.readFileSync(parsed.filePath, 'utf8');
      const fullSpecs = parseInstallSpecsFromSkillMd(skillMd);
      console.log(`[skill:local-info] ${name}: parsed ${fullSpecs.length} install specs from SKILL.md`);
      if (fullSpecs.length > 0) {
        parsed.install = parsed.install.map((cliSpec: any) => {
          const full = fullSpecs.find((item: any) => item.id === cliSpec.id && item.kind === cliSpec.kind);
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

  return parsed;
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
    case 'brew': {
      if (!brewFormula) return [];
      const brewCmd = ['brew install ' + brewFormula];
      // On non-macOS, brew likely doesn't exist — add platform-native fallbacks
      // using the binary name (bins[0]) since brew formula names don't work with winget/apt
      if (process.platform === 'win32' && fallbackPkg) {
        return [...brewCmd,
          `winget install --id ${fallbackPkg} -e --accept-source-agreements --accept-package-agreements --disable-interactivity`,
          `choco install ${fallbackPkg} -y`,
          `scoop install ${fallbackPkg}`,
          `npm install -g --ignore-scripts ${fallbackPkg}`,
        ];
      }
      if (process.platform === 'linux' && fallbackPkg) {
        return [...brewCmd, ...linuxCommands, `npm install -g --ignore-scripts ${fallbackPkg}`];
      }
      return brewCmd;
    }
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
  const ownerHandle = detail?.owner?.handle || detail?.owner?.displayName || '';
  const slug = detail?.skill?.slug || '';
  return {
    slug,
    name: detail?.skill?.displayName || slug,
    displayName: detail?.skill?.displayName || slug,
    description: detail?.skill?.summary || '',
    summary: detail?.skill?.summary || '',
    owner: ownerHandle,
    version: detail?.latestVersion?.version,
    readme: detail?.version?.readme || '',
    skillMd: detail?.version?.skillMd || '',
    // OS compatibility from ClawHub metadata (dynamically parsed from SKILL.md)
    supportedOs: Array.isArray(detail?.metadata?.os) ? detail.metadata.os as string[] : null,
    // ClawHub page URL for install guide / usage docs
    clawhubUrl: ownerHandle && slug ? `https://clawhub.ai/${ownerHandle}/${slug}` : null,
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
  runAsyncWithProgress: (cmd: string, timeoutMs: number, onLine: (line: string, stream: 'stdout' | 'stderr') => void) => Promise<string>;
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

      // OpenClaw checks binaries with its own limited PATH and may report false negatives.
      // We re-check every missing binary using our enhanced PATH (covers Homebrew, npm-global,
      // nvm, fnm, Windows AppData, etc.) and patch the results.
      const verifiedBins = loadVerifiedBins(deps.home);
      const allMissingBins = new Set<string>();
      for (const skill of report.skills) {
        for (const bin of skill.missing?.bins || []) allMissingBins.add(bin);
      }
      // Live-check all missing binaries via enhanced PATH
      for (const bin of allMissingBins) {
        if (verifiedBins[bin]) continue; // already verified
        try {
          const probe = process.platform === 'win32' ? 'where' : 'which';
          await deps.runSpawnAsync(probe, [bin], 3000);
          verifiedBins[bin] = { verifiedAt: Date.now() };
        } catch {} // genuinely missing
      }
      if (Object.keys(verifiedBins).length > 0) {
        saveVerifiedBins(deps.home, verifiedBins);
      }
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
      // ClawHub /skills listing endpoint returns empty (API change since ~2026-03).
      // Workaround: use /search with broad queries to discover popular skills.
      const queries = ['coding', 'memory', 'tool', 'web', 'git', 'docker'];
      const seen = new Set<string>();
      const allItems: any[] = [];
      await Promise.all(queries.map(async (q) => {
        try {
          const res = await fetchJson(`${clawhubApi}/search?q=${encodeURIComponent(q)}&limit=10`);
          for (const item of (res?.results || [])) {
            if (item.slug && !seen.has(item.slug)) {
              seen.add(item.slug);
              allItems.push(item);
            }
          }
        } catch {}
      }));
      // Sort by score descending
      allItems.sort((a, b) => (b.score || 0) - (a.score || 0));
      return {
        success: true,
        skills: allItems.slice(0, 60).map((item: any) => ({
          slug: item.slug,
          name: item.displayName || item.slug,
          displayName: item.displayName || item.slug,
          description: item.summary || '',
          summary: item.summary || '',
          version: item.version,
          score: item.score,
        })),
        nextCursor: null,
      };
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
  // CRITICAL: use readShellOutputAsync — OpenClaw outputs JSON to stderr, not stdout.
  ipcMain.handle('skill:local-info', async (_e, name: string) => {
    try {
      const parsed = await loadLocalSkillInfo(name, deps);
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

  // Install skill dependencies (brew/go/uv/node).
  // Second arg is optional skillName (slug) — used to read SKILL.md for correct install specs.
  ipcMain.handle('skill:install-deps', async (_e, installSpecs: unknown, skillName?: string) => {
    sendProgress('matching', 'Checking install instructions...');
    const frontendSpecs = Array.isArray(installSpecs) ? installSpecs as SkillInstallSpec[] : [];
    let specs: SkillInstallSpec[] = [];

    // Try to read SKILL.md for authoritative install specs (with formula/module/package).
    // CRITICAL: use readShellOutputAsync, NOT runAsync — OpenClaw outputs JSON to stderr,
    // and runAsync only captures stdout on exit code 0 → empty string → parse fails.
    if (skillName && typeof skillName === 'string') {
      try {
        const parsed = await loadLocalSkillInfo(skillName, deps);
        if (Array.isArray(parsed.install) && parsed.install.length > 0) {
          specs = parsed.install as SkillInstallSpec[];
          console.log(`[skill:install-deps] using SKILL.md specs for ${skillName}:`, specs.map((s: any) => `${s.kind}:${s.formula || s.module || s.package || '?'}`).join(', '));
        }
      } catch (err) {
        console.warn(`[skill:install-deps] SKILL.md lookup failed for ${skillName}:`, err);
      }
    }

    // Fallback: use frontend-provided specs if SKILL.md lookup didn't produce results
    if (specs.length === 0 && frontendSpecs.length > 0) {
      specs = frontendSpecs;
      console.log(`[skill:install-deps] using frontend specs (SKILL.md unavailable)`);
    }

    if (specs.length === 0) {
      return { success: false, error: 'No dependency install specs provided' };
    }

    for (const s of specs) {
      console.log(`[skill:install-deps] spec: kind=${s.kind} formula=${s.formula || '-'} module=${s.module || '-'} package=${s.package || '-'} bins=${(s.bins || []).join(',')}`);
    }

    const failures: Array<{ id: string; label: string; error: string }> = [];
    const installed: Array<{ id: string; label: string; command: string }> = [];
    const trackedBins = new Set<string>();

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

    // Pre-check: detect required package managers and auto-install brew if missing (macOS only)
    const neededManagers = new Set(specs.map((s: SkillInstallSpec) => (s.kind || 'auto').toLowerCase()));
    if (neededManagers.has('brew') || neededManagers.has('auto')) {
      if (!(await isCommandAvailable('brew'))) {
        if (process.platform === 'darwin') {
          // Auto-install Homebrew on macOS (non-interactive)
          sendProgress('installing', 'Installing Homebrew (first time only)...');
          try {
            await deps.runAsyncWithProgress(
              'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
              600000, // 10 min timeout for brew install
              (line: string) => {
                const t = line.trim();
                if (t && (t.startsWith('==>') || t.includes('Installing') || t.includes('Downloading'))) {
                  sendProgress('installing', `Homebrew: ${t.slice(0, 100)}`);
                }
              },
            );
            console.log('[skill:install-deps] Homebrew installed successfully');
          } catch (brewErr: any) {
            console.warn('[skill:install-deps] Homebrew install failed:', brewErr?.message?.slice(0, 200));
          }
        } else {
          // No brew on Windows/Linux — will fall through to npm/winget/apt fallback
          console.log('[skill:install-deps] brew not available on this platform, trying alternatives');
        }
      }
    }

    const pendingSpecs = [...specs];
    const attemptedSpecKeys = new Set<string>();
    let followupRounds = 0;

    const queueRemainingMissingBins = async () => {
      if (!skillName || followupRounds >= 2 || failures.length > 0) return false;
      try {
        const latestInfo = await loadLocalSkillInfo(skillName, deps);
        const extraSpecs = buildAutoInstallSpecsFromMissingBins(latestInfo?.missing?.bins, trackedBins);
        if (extraSpecs.length === 0) return false;
        followupRounds += 1;
        sendProgress('matching', `Checking remaining requirements: ${extraSpecs.map((spec) => spec.bins?.[0] || spec.id).join(', ')}`);
        for (const extraSpec of extraSpecs) {
          pendingSpecs.push(extraSpec);
        }
        return true;
      } catch (err) {
        console.warn(`[skill:install-deps] follow-up missing bin check failed for ${skillName}:`, err);
        return false;
      }
    };

    while (true) {
      if (pendingSpecs.length === 0) {
        const queuedMore = await queueRemainingMissingBins();
        if (!queuedMore) break;
      }

      const spec = pendingSpecs.shift();
      if (!spec) continue;

      const specKey = `${spec.kind}:${spec.formula || spec.module || spec.package || (spec.bins || []).join(',') || spec.id}`;
      if (attemptedSpecKeys.has(specKey)) continue;
      attemptedSpecKeys.add(specKey);

      for (const bin of spec.bins || []) {
        trackedBins.add(bin);
      }

      const plans = await buildResolvedInstallPlans(spec, deps, sendProgress, isCommandAvailable);
      if (plans.length === 0) {
        failures.push({
          id: spec.id || 'unknown',
          label: spec.label || spec.id || 'unknown',
          error: buildNoInstallerMessage(spec, plans),
        });
        continue;
      }

      let ok = false;
      let lastError = '';

      for (const plan of plans) {
        const binary = plan.binary;
        if (!(await isCommandAvailable(binary))) {
          continue;
        }

        sendProgress('installing', (plan.note || spec.label || spec.id || plan.packageName || binary).slice(0, 120));

        // Prepend env vars to speed up and clean output:
        // - HOMEBREW_NO_AUTO_UPDATE=1: skip brew auto-update (saves 30-60s)
        // - HOMEBREW_NO_ENV_HINTS=1: suppress env hint noise
        // - HOMEBREW_NO_INSTALL_CLEANUP=1: skip post-install cleanup
        const envPrefix = binary === 'brew'
          ? 'HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_ENV_HINTS=1 HOMEBREW_NO_INSTALL_CLEANUP=1 '
          : '';
        const fullCommand = envPrefix + plan.command;

        try {
          let lastProgressLine = '';
          await deps.runAsyncWithProgress(fullCommand, 300000, (line: string) => {
            const trimmed = line.trim();
            if (trimmed && trimmed !== lastProgressLine) {
              lastProgressLine = trimmed;
              if (trimmed.startsWith('==>') || trimmed.startsWith('✔') || trimmed.startsWith('🍺')
                  || trimmed.includes('Downloading') || trimmed.includes('Installing')
                  || trimmed.includes('Linking') || trimmed.includes('added')
                  || trimmed.includes('npm warn') || trimmed.includes('go: downloading')
                  || trimmed.includes('Found ') || trimmed.includes('Successfully installed')
                  || trimmed.includes('Installer hash verified')) {
                sendProgress('installing', trimmed.slice(0, 120));
              }
            }
          });
          installed.push({
            id: spec.id || binary,
            label: plan.packageName ? `${spec.label || spec.id || binary} -> ${plan.packageName}` : (spec.label || spec.id || binary),
            command: fullCommand,
          });
          ok = true;
          break;
        } catch (err: any) {
          lastError = err?.message?.slice(0, 300) || 'Install command failed';
        }
      }

      if (!ok) {
        let friendlyError = lastError || buildNoInstallerMessage(spec, plans);
        const errorLines = lastError.split('\n').filter((line: string) =>
          line.trim().startsWith('Error:') || line.trim().startsWith('fatal:') || line.trim().startsWith('npm ERR!'));
        if (errorLines.length > 0) {
          friendlyError = errorLines.join(' ').slice(0, 300);
        }

        if (friendlyError.includes('Command Line Tools') || friendlyError.includes('xcode-select')) {
          friendlyError = process.platform === 'darwin'
            ? 'Xcode Command Line Tools need updating. Open Terminal and run: xcode-select --install'
            : friendlyError;
        } else if (friendlyError.includes('SSL_ERROR') || friendlyError.includes('curl') || friendlyError.includes('Failed to download')) {
          friendlyError = 'Network error during download. Please check your internet connection and try again.';
        } else if (friendlyError.includes('Permission denied') || friendlyError.includes('EACCES')) {
          friendlyError = 'Permission denied. Try running the install command manually in Terminal.';
        } else if (friendlyError.includes('timed out')) {
          friendlyError = 'Installation timed out. Your network may be slow — try again or install manually.';
        } else if (friendlyError.includes('No available formula') || friendlyError.includes('not found')) {
          friendlyError = 'Package not found in package manager. Try the Install Guide for manual instructions.';
        } else if (friendlyError.includes('No available installer') || friendlyError === lastError || !lastError) {
          friendlyError = buildNoInstallerMessage(spec, plans);
        }

        failures.push({
          id: spec.id || 'unknown',
          label: spec.label || spec.id || 'unknown',
          error: friendlyError,
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
    const verifiedList = new Set<string>();
    const unverifiedList = new Set<string>();
    for (const bin of trackedBins) {
      if (await isCommandAvailable(bin)) {
        let binPath: string | undefined;
        try {
          const probe = process.platform === 'win32' ? 'where' : 'which';
          binPath = (await deps.runSpawnAsync(probe, [bin], 5000)).split(/\r?\n/)[0]?.trim();
        } catch {}
        verifiedBins[bin] = { verifiedAt: Date.now(), path: binPath };
        verifiedList.add(bin);
      } else {
        unverifiedList.add(bin);
      }
    }
    if (verifiedList.size > 0) {
      saveVerifiedBins(deps.home, verifiedBins);
    }

    return {
      success: true,
      installed,
      verified: [...verifiedList],
      unverified: [...unverifiedList],
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