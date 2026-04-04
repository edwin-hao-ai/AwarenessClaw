import fs from 'fs';
import os from 'os';
import path from 'path';

export type SelfImprovementEntryType = 'learning' | 'error' | 'feature';
export type SelfImprovementPriority = 'low' | 'medium' | 'high' | 'critical';
export type SelfImprovementArea = 'frontend' | 'backend' | 'infra' | 'tests' | 'docs' | 'config';

export type SelfImprovementLogInput = {
  type: SelfImprovementEntryType;
  summary: string;
  details?: string;
  suggestedAction?: string;
  area?: SelfImprovementArea;
  priority?: SelfImprovementPriority;
  category?: 'correction' | 'insight' | 'knowledge_gap' | 'best_practice';
  commandName?: string;
  source?: string;
  relatedFiles?: string[];
  tags?: string[];
  complexity?: 'simple' | 'medium' | 'complex';
  frequency?: 'first_time' | 'recurring';
  userContext?: string;
  workspacePath?: string;
  homeDir?: string;
  agentId?: string;
};

export type SelfImprovementStatus = {
  rootDir: string;
  learningsDir: string;
  pendingCount: number;
  highPriorityPendingCount: number;
};

const LEARNINGS_HEADER = '# Learnings\n\nCorrections, insights, and knowledge gaps captured during development.\n\n**Categories**: correction | insight | knowledge_gap | best_practice\n\n---\n';
const ERRORS_HEADER = '# Errors\n\nCommand failures and integration errors.\n\n---\n';
const FEATURE_REQUESTS_HEADER = '# Feature Requests\n\nCapabilities requested by users.\n\n---\n';

type EntryFileName = 'LEARNINGS.md' | 'ERRORS.md' | 'FEATURE_REQUESTS.md';

function toAgentSlug(agentId: string): string {
  return agentId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'main';
}

function resolveWorkspaceRoot(homeDir: string, agentId = 'main'): string {
  const normalizedAgent = (agentId || 'main').trim().toLowerCase();
  if (normalizedAgent === 'main' || normalizedAgent === 'default') {
    return path.join(homeDir, '.openclaw', 'workspace');
  }

  const slug = toAgentSlug(normalizedAgent);
  const candidates = [
    path.join(homeDir, '.openclaw', `workspace-${slug}`),
    path.join(homeDir, '.openclaw', 'workspaces', slug),
    path.join(homeDir, '.openclaw', 'agents', slug, 'agent'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function trimText(input?: string, fallback = 'N/A'): string {
  const text = String(input || '').replace(/\r\n/g, '\n').trim();
  return text || fallback;
}

function listText(values?: string[]): string {
  if (!Array.isArray(values) || values.length === 0) return 'n/a';
  const cleaned = values.map((value) => String(value || '').trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned.join(', ') : 'n/a';
}

function formatSequence(value: number): string {
  return String(Math.max(value, 1)).padStart(3, '0');
}

function getDateStamp(now: Date): string {
  return [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
}

function getTypePrefix(type: SelfImprovementEntryType): 'LRN' | 'ERR' | 'FEAT' {
  if (type === 'error') return 'ERR';
  if (type === 'feature') return 'FEAT';
  return 'LRN';
}

function nextSequence(fileContent: string, prefix: 'LRN' | 'ERR' | 'FEAT', dateStamp: string): number {
  const matcher = new RegExp(`\\[${prefix}-${dateStamp}-(\\d{3})\\]`, 'g');
  let maxFound = 0;
  let match: RegExpExecArray | null = null;
  while (true) {
    match = matcher.exec(fileContent);
    if (!match) break;
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > maxFound) {
      maxFound = parsed;
    }
  }
  return maxFound + 1;
}

function buildLearningEntry(id: string, nowIso: string, input: SelfImprovementLogInput): string {
  const category = input.category || 'insight';
  const priority = input.priority || 'medium';
  const area = input.area || 'docs';
  const summary = trimText(input.summary);
  const details = trimText(input.details, summary);
  const suggestedAction = trimText(input.suggestedAction, 'Capture this learning in project guidance if it recurs.');
  const source = trimText(input.source, 'desktop');
  const relatedFiles = listText(input.relatedFiles);
  const tags = listText(input.tags);

  return [
    `## [${id}] ${category}`,
    '',
    `**Logged**: ${nowIso}`,
    `**Priority**: ${priority}`,
    '**Status**: pending',
    `**Area**: ${area}`,
    '',
    '### Summary',
    summary,
    '',
    '### Details',
    details,
    '',
    '### Suggested Action',
    suggestedAction,
    '',
    '### Metadata',
    `- Source: ${source}`,
    `- Related Files: ${relatedFiles}`,
    `- Tags: ${tags}`,
    '',
    '---',
  ].join('\n');
}

function buildErrorEntry(id: string, nowIso: string, input: SelfImprovementLogInput): string {
  const priority = input.priority || 'high';
  const area = input.area || 'backend';
  const summary = trimText(input.summary);
  const errorText = trimText(input.details, summary);
  const suggestedFix = trimText(input.suggestedAction, 'Retry with diagnostics and capture the exact failing step.');
  const commandName = trimText(input.commandName, 'desktop_operation');
  const source = trimText(input.source, 'desktop');
  const relatedFiles = listText(input.relatedFiles);

  return [
    `## [${id}] ${commandName}`,
    '',
    `**Logged**: ${nowIso}`,
    `**Priority**: ${priority}`,
    '**Status**: pending',
    `**Area**: ${area}`,
    '',
    '### Summary',
    summary,
    '',
    '### Error',
    errorText,
    '',
    '### Context',
    `- Source: ${source}`,
    '- Repro step: see session timeline in Memory tab',
    '',
    '### Suggested Fix',
    suggestedFix,
    '',
    '### Metadata',
    '- Reproducible: unknown',
    `- Related Files: ${relatedFiles}`,
    '',
    '---',
  ].join('\n');
}

function buildFeatureEntry(id: string, nowIso: string, input: SelfImprovementLogInput): string {
  const priority = input.priority || 'medium';
  const area = input.area || 'frontend';
  const summary = trimText(input.summary);
  const userContext = trimText(input.userContext, trimText(input.details, 'Requested during desktop usage flow.'));
  const complexity = input.complexity || 'medium';
  const suggestedImplementation = trimText(input.suggestedAction, 'Design a minimal UX-first flow and validate it with end-to-end tests.');
  const frequency = input.frequency || 'first_time';

  return [
    `## [${id}] ${summary.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'requested_capability'}`,
    '',
    `**Logged**: ${nowIso}`,
    `**Priority**: ${priority}`,
    '**Status**: pending',
    `**Area**: ${area}`,
    '',
    '### Requested Capability',
    summary,
    '',
    '### User Context',
    userContext,
    '',
    '### Complexity Estimate',
    complexity,
    '',
    '### Suggested Implementation',
    suggestedImplementation,
    '',
    '### Metadata',
    `- Frequency: ${frequency}`,
    '- Related Features: memory',
    '',
    '---',
  ].join('\n');
}

async function ensureFileIfMissing(filePath: string, initialContent: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return false;
  } catch {
    await fs.promises.writeFile(filePath, initialContent, 'utf8');
    return true;
  }
}

export async function ensureSelfImprovementScaffold(params?: {
  homeDir?: string;
  agentId?: string;
  workspacePath?: string;
}): Promise<{
  rootDir: string;
  learningsDir: string;
  createdFiles: string[];
}> {
  const homeDir = params?.homeDir || os.homedir();
  const rootDir = (params?.workspacePath || '').trim() || resolveWorkspaceRoot(homeDir, params?.agentId || 'main');
  const learningsDir = path.join(rootDir, '.learnings');

  await fs.promises.mkdir(learningsDir, { recursive: true });

  const createdFiles: string[] = [];
  const targets: Array<[EntryFileName, string]> = [
    ['LEARNINGS.md', LEARNINGS_HEADER],
    ['ERRORS.md', ERRORS_HEADER],
    ['FEATURE_REQUESTS.md', FEATURE_REQUESTS_HEADER],
  ];

  for (const [fileName, header] of targets) {
    const targetPath = path.join(learningsDir, fileName);
    if (await ensureFileIfMissing(targetPath, header)) {
      createdFiles.push(targetPath);
    }
  }

  return { rootDir, learningsDir, createdFiles };
}

export async function appendSelfImprovementEntry(input: SelfImprovementLogInput): Promise<{
  id: string;
  filePath: string;
  rootDir: string;
  learningsDir: string;
}> {
  const { rootDir, learningsDir } = await ensureSelfImprovementScaffold({
    homeDir: input.homeDir,
    agentId: input.agentId,
    workspacePath: input.workspacePath,
  });

  const now = new Date();
  const nowIso = now.toISOString();
  const dateStamp = getDateStamp(now);
  const prefix = getTypePrefix(input.type);

  const targetFileName: EntryFileName = input.type === 'error'
    ? 'ERRORS.md'
    : input.type === 'feature'
      ? 'FEATURE_REQUESTS.md'
      : 'LEARNINGS.md';

  const filePath = path.join(learningsDir, targetFileName);
  const existing = await fs.promises.readFile(filePath, 'utf8');
  const sequence = formatSequence(nextSequence(existing, prefix, dateStamp));
  const id = `${prefix}-${dateStamp}-${sequence}`;

  const entry = input.type === 'error'
    ? buildErrorEntry(id, nowIso, input)
    : input.type === 'feature'
      ? buildFeatureEntry(id, nowIso, input)
      : buildLearningEntry(id, nowIso, input);

  const needsSeparator = existing.trim().length > 0 && !existing.endsWith('\n\n');
  await fs.promises.appendFile(filePath, `${needsSeparator ? '\n' : ''}${entry}\n`, 'utf8');

  return { id, filePath, rootDir, learningsDir };
}

function countMatches(source: string, pattern: RegExp): number {
  const matches = source.match(pattern);
  return matches ? matches.length : 0;
}

function countHighPriorityPending(source: string): number {
  const blocks = source.split(/\n## \[/g);
  return blocks.reduce((count, block) => {
    if (!/\*\*Status\*\*:\s*pending\b/i.test(block)) return count;
    if (!/\*\*Priority\*\*:\s*(high|critical)\b/i.test(block)) return count;
    return count + 1;
  }, 0);
}

export async function getSelfImprovementStatus(params?: {
  homeDir?: string;
  agentId?: string;
  workspacePath?: string;
}): Promise<SelfImprovementStatus> {
  const { rootDir, learningsDir } = await ensureSelfImprovementScaffold(params);
  const files = [
    path.join(learningsDir, 'LEARNINGS.md'),
    path.join(learningsDir, 'ERRORS.md'),
    path.join(learningsDir, 'FEATURE_REQUESTS.md'),
  ];

  let pendingCount = 0;
  let highPriorityPendingCount = 0;

  for (const filePath of files) {
    let content = '';
    try {
      content = await fs.promises.readFile(filePath, 'utf8');
    } catch {
      continue;
    }
    pendingCount += countMatches(content, /\*\*Status\*\*:\s*pending\b/gi);
    highPriorityPendingCount += countHighPriorityPending(content);
  }

  return {
    rootDir,
    learningsDir,
    pendingCount,
    highPriorityPendingCount,
  };
}
