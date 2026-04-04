import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import type { GatewayClient } from '../gateway-ws';
import { getExecApprovalSettings } from '../openclaw-config';
import { readJsonFileWithBom } from '../json-file';
import { buildMemoryInitArgs } from '../memory-protocol';

type ChatSendOptions = {
  thinkingLevel?: string;
  reasoningDisplay?: string;
  model?: string;
  files?: string[];
  workspacePath?: string;
  agentId?: string;
};

type MemoryCapturePolicy = {
  autoCapture: boolean;
  blockedSources: string[];
};

let activeChatChild: ReturnType<typeof spawn> | null = null;
let awarenessInitCompatibilityMode = false;
let lastAwarenessInitCompatibilityError = '';

const CHAT_TIMEOUT_MS = 120000;
const MCP_MEMORY_BOOTSTRAP_TIMEOUT_MS = 2500;
const MEMORY_BOOTSTRAP_MAX_CHARS = 4000;

function normalizeDesktopRole(role: unknown): 'user' | 'assistant' {
  return role === 'user' ? 'user' : 'assistant';
}

function normalizeContentBlocks(message: any): any[] {
  return Array.isArray(message?.content)
    ? message.content.filter((block: any) => block && typeof block === 'object')
    : [];
}

function extractAssistantText(message: any): string {
  if (!message) return '';
  if (Array.isArray(message.content)) {
    return message.content
      .map((contentBlock: any) => contentBlock?.type === 'text' ? (contentBlock.text || '') : '')
      .join('');
  }
  if (typeof message.content === 'string') {
    return message.content;
  }
  return '';
}

function extractAssistantThinking(message: any): string {
  if (!message) return '';
  if (Array.isArray(message.content)) {
    const parts = message.content
      .map((contentBlock: any) => {
        if (contentBlock?.type === 'thinking') return contentBlock.thinking || contentBlock.text || '';
        if (contentBlock?.type === 'reasoning') return contentBlock.reasoning || contentBlock.text || '';
        return '';
      })
      .filter((part: string) => Boolean(part?.trim()));
    if (parts.length > 0) return parts.join('\n');
  }
  if (typeof message.content === 'string' && message.content.startsWith('Reasoning:')) {
    return message.content.replace(/^Reasoning:\s*/, '').trim();
  }
  return '';
}

function truncateDetail(text: string, maxChars = 600): string {
  if (!Number.isFinite(maxChars) || maxChars <= 0) return text;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function extractToolDetail(value: unknown, maxChars = 10000): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? truncateDetail(trimmed, maxChars) : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractToolDetail(entry, maxChars))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? truncateDetail(parts.join('\n'), maxChars) : undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const directKeys = ['text', 'output', 'stdout', 'stderr', 'message', 'detail', 'summary'];
    for (const key of directKeys) {
      const extracted = extractToolDetail(record[key], maxChars);
      if (extracted) return extracted;
    }
    if (Array.isArray(record.content)) {
      const contentParts = (record.content as unknown[])
        .map((entry) => {
          if (entry && typeof entry === 'object') {
            const block = entry as Record<string, unknown>;
            return extractToolDetail(block.text ?? block.content ?? block.output, maxChars);
          }
          return extractToolDetail(entry, maxChars);
        })
        .filter((entry): entry is string => Boolean(entry));
      if (contentParts.length > 0) return truncateDetail(contentParts.join('\n'), maxChars);
    }
    try {
      return truncateDetail(JSON.stringify(record), maxChars);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function extractToolArgs(block: Record<string, unknown>): unknown {
  return block.input ?? block.arguments ?? block.args ?? {};
}

function extractToolOutput(block: Record<string, unknown>): string | undefined {
  if (Array.isArray(block.content)) {
    const contentText = extractToolDetail(block.content, Number.POSITIVE_INFINITY);
    if (contentText) return contentText;
  }
  return extractToolDetail(block.result ?? block.output ?? block.stdout ?? block.stderr ?? block.text ?? block.message, Number.POSITIVE_INFINITY);
}

function buildToolCallsFromBlocks(contentBlocks: any[]): Array<Record<string, unknown>> {
  const toolCalls = new Map<string, Record<string, unknown>>();
  for (const rawBlock of contentBlocks) {
    const block = rawBlock as Record<string, unknown>;
    const type = String(block.type || '');
    if (type === 'tool_use' || type === 'toolcall' || type === 'tool_call') {
      const toolId = String(block.id || block.toolCallId || `tool-${toolCalls.size + 1}`);
      const args = extractToolArgs(block);
      toolCalls.set(toolId, {
        id: toolId,
        name: String(block.name || 'tool'),
        status: 'running',
        timestamp: Date.now(),
        detail: extractToolDetail(args, Number.POSITIVE_INFINITY),
        args,
      });
      continue;
    }

    if (type === 'tool_result' || type === 'toolresult' || type === 'tool_result_block') {
      const toolId = String(block.tool_use_id || block.toolCallId || block.id || `tool-result-${toolCalls.size + 1}`);
      const existing = toolCalls.get(toolId);
      toolCalls.set(toolId, {
        id: toolId,
        name: String(block.name || existing?.name || 'tool'),
        status: block.is_error || block.isError ? 'failed' : 'completed',
        timestamp: Date.now(),
        detail: existing?.detail,
        args: existing?.args,
        output: extractToolOutput(block),
      });
    }
  }

  return [...toolCalls.values()];
}

function buildDesktopMessage(msg: any) {
  const contentBlocks = normalizeContentBlocks(msg);
  const toolCalls = buildToolCallsFromBlocks(contentBlocks);
  return {
    id: msg.__openclaw?.id || `gw-${msg.timestamp || Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    role: normalizeDesktopRole(msg.role),
    content: extractAssistantText(msg),
    timestamp: msg.timestamp || Date.now(),
    model: msg.model,
    thinking: extractAssistantThinking(msg) || undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    contentBlocks: contentBlocks.length > 0 ? contentBlocks : undefined,
  };
}

function mergeToolResultIntoAssistantMessage(
  assistantMessage: Record<string, any>,
  block: Record<string, unknown>,
) {
  const toolId = String(block.tool_use_id || block.toolCallId || block.id || '');
  if (!toolId) return;

  const existingToolCalls = Array.isArray(assistantMessage.toolCalls) ? assistantMessage.toolCalls : [];
  const output = extractToolOutput(block);
  const nextToolCalls = existingToolCalls.map((toolCall: Record<string, unknown>) => (
    toolCall.id === toolId
      ? {
          ...toolCall,
          status: block.is_error || block.isError ? 'failed' : 'completed',
          output: output || toolCall.output,
        }
      : toolCall
  ));
  assistantMessage.toolCalls = nextToolCalls;
  assistantMessage.contentBlocks = [
    ...(Array.isArray(assistantMessage.contentBlocks) ? assistantMessage.contentBlocks : []),
    block,
  ];
}

function buildDesktopHistory(rawMessages: any[]): Array<Record<string, any>> {
  const desktopMessages: Array<Record<string, any>> = [];
  const assistantMessageByToolId = new Map<string, Record<string, any>>();

  for (const rawMessage of rawMessages || []) {
    const desktopMessage = buildDesktopMessage(rawMessage);
    const contentBlocks = normalizeContentBlocks(rawMessage);
    const toolResultBlocks = contentBlocks.filter((block: any) => {
      const type = String(block?.type || '');
      return type === 'tool_result' || type === 'toolresult' || type === 'tool_result_block';
    });

    if (desktopMessage.role === 'assistant') {
      desktopMessages.push(desktopMessage);
      for (const toolCall of desktopMessage.toolCalls || []) {
        if (toolCall?.id) assistantMessageByToolId.set(String(toolCall.id), desktopMessage);
      }
      continue;
    }

    let mergedToolResultCount = 0;
    for (const block of toolResultBlocks) {
      const toolId = String(block.tool_use_id || block.toolCallId || block.id || '');
      const assistantMessage = assistantMessageByToolId.get(toolId);
      if (!assistantMessage) continue;
      mergeToolResultIntoAssistantMessage(assistantMessage, block);
      mergedToolResultCount += 1;
    }

    const hasOwnVisibleContent = Boolean(desktopMessage.content?.trim()) || Boolean(desktopMessage.thinking?.trim());
    const hasUnmergedBlocks = contentBlocks.length > mergedToolResultCount;
    if (hasOwnVisibleContent || hasUnmergedBlocks) {
      desktopMessages.push(desktopMessage);
    }
  }

  return desktopMessages;
}

function extractAssistantEventText(data: Record<string, unknown>): string | undefined {
  return extractToolDetail(
    data.thinking
    ?? data.reasoning
    ?? data.text
    ?? data.delta
    ?? data.content,
    Number.POSITIVE_INFINITY,
  );
}

type NormalizedAgentEvent = {
  stream: 'assistant' | 'tool' | 'lifecycle';
  phase?: string;
  runId?: unknown;
  sessionKey?: string;
  seq?: unknown;
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  text?: string;
  thinking?: string;
  raw?: unknown;
};

function normalizeAgentGatewayEvent(eventName: string, payload: any): NormalizedAgentEvent | null {
  if (!payload || typeof payload !== 'object') return null;

  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const sessionKey = typeof payload?.sessionKey === 'string'
    ? payload.sessionKey
    : typeof data?.sessionKey === 'string'
      ? data.sessionKey
      : '';

  if (typeof payload?.stream === 'string') {
    if (payload.stream === 'tool') {
      const toolCallId = typeof data?.toolCallId === 'string' ? data.toolCallId : '';
      const toolName = typeof data?.name === 'string'
        ? data.name
        : typeof data?.tool === 'string'
          ? data.tool
          : undefined;
      return {
        stream: 'tool',
        phase: typeof data?.phase === 'string' ? data.phase : '',
        runId: payload?.runId,
        sessionKey,
        seq: payload?.seq,
        toolCallId,
        toolName,
        args: data?.args,
        partialResult: data?.partialResult,
        result: data?.result,
        isError: Boolean(data?.isError),
        raw: data,
      };
    }

    if (payload.stream === 'assistant') {
      const assistantText = extractAssistantEventText(data);
      if (!assistantText) return null;
      const isThinking = Boolean(data?.thinking || data?.reasoning)
        || (typeof data?.phase === 'string' && data.phase === 'thinking');
      return {
        stream: 'assistant',
        phase: isThinking ? 'thinking' : 'text',
        runId: payload?.runId,
        sessionKey,
        seq: payload?.seq,
        text: !isThinking && typeof data?.text === 'string' ? data.text : assistantText,
        thinking: isThinking ? assistantText : undefined,
        raw: data,
      };
    }

    if (payload.stream === 'lifecycle') {
      return {
        stream: 'lifecycle',
        phase: typeof data?.phase === 'string' ? data.phase : '',
        runId: payload?.runId,
        sessionKey,
        seq: payload?.seq,
        raw: data,
      };
    }
  }

  const nestedEvent = typeof payload?.event === 'string' ? payload.event : '';

  if (eventName === 'agent:assistant') {
    const assistantText = extractAssistantEventText(data);
    if (!assistantText) return null;
    const isThinking = Boolean(data?.thinking || data?.reasoning)
      || (typeof data?.phase === 'string' && data.phase === 'thinking');
    return {
      stream: 'assistant',
      phase: isThinking ? 'thinking' : 'text',
      runId: payload?.runId,
      sessionKey,
      seq: payload?.seq,
      text: !isThinking && typeof data?.text === 'string' ? data.text : assistantText,
      thinking: isThinking ? assistantText : undefined,
      raw: data,
    };
  }

  if (eventName === 'agent:lifecycle') {
    return {
      stream: 'lifecycle',
      phase: nestedEvent || (typeof data?.phase === 'string' ? data.phase : ''),
      runId: payload?.runId,
      sessionKey,
      seq: payload?.seq,
      raw: payload,
    };
  }

  if (eventName === 'agent:tool' || nestedEvent === 'tool.call' || nestedEvent === 'tool.output') {
    const toolCallId = typeof data?.toolCallId === 'string'
      ? data.toolCallId
      : typeof data?.id === 'string'
        ? data.id
        : '';
    const toolName = typeof data?.name === 'string'
      ? data.name
      : typeof data?.tool === 'string'
        ? data.tool
        : undefined;
    const phase = nestedEvent === 'tool.call'
      ? 'start'
      : data?.partialResult != null || data?.delta != null || data?.chunk != null
        ? 'update'
        : 'result';
    return {
      stream: 'tool',
      phase,
      runId: payload?.runId,
      sessionKey,
      seq: payload?.seq,
      toolCallId,
      toolName,
      args: data?.args ?? data?.input ?? data?.arguments,
      partialResult: data?.partialResult ?? data?.delta ?? data?.chunk,
      result: data?.result ?? data?.output ?? data?.stdout ?? data?.stderr ?? data?.content,
      isError: Boolean(data?.isError || data?.error),
      raw: payload,
    };
  }

  if (eventName === 'agent' && nestedEvent) {
    if (nestedEvent.startsWith('agent.')) {
      return {
        stream: 'lifecycle',
        phase: nestedEvent,
        runId: payload?.runId,
        sessionKey,
        seq: payload?.seq,
        raw: payload,
      };
    }
  }

}

function getHostOsLabel(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'Windows';
  if (platform === 'darwin') return 'macOS';
  return 'Linux';
}

function looksLikePathReference(text: string): boolean {
  return /[a-zA-Z]:\\|\\\\|\/[A-Za-z0-9._-]|\.[A-Za-z0-9]{1,8}\b/.test(text);
}

function looksLikeFilesystemMutationRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  const hasMutationVerb = /(create|write|save|edit|modify|update|append|rename|move|delete|remove|overwrite|mkdir|touch|生成|写入|保存|创建|新建|编辑|修改|更新|追加|重命名|移动|删除|移除|覆盖)/i.test(trimmed);
  if (!hasMutationVerb) return false;

  const hasFilesystemContext = /(file|folder|directory|path|txt|md|json|csv|docx?|log|文件|文件夹|目录|路径|文档|文本)/i.test(trimmed);
  return hasFilesystemContext || looksLikePathReference(trimmed);
}

function looksLikeSuccessfulFilesystemMutationResponse(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/(did not|didn't|unable|can't|cannot|could not|failed|not able|was not|were not|没能|无法|不能|失败|未能|未成功)/i.test(trimmed)) {
    return false;
  }

  const hasSuccessVerb = /(saved|created|wrote|written|updated|edited|renamed|deleted|removed|moved|overwritten|placed|put|保存|创建|写入|写好|写好了|更新|修改|重命名|删除|移除|移动|放在|放到|已保存|已创建|已写入|已更新)/i.test(trimmed);
  if (!hasSuccessVerb) return false;

  const hasFilesystemContext = /(file|folder|directory|path|txt|md|json|csv|docx?|log|文件|文件夹|目录|路径|文档|文本)/i.test(trimmed);
  return hasFilesystemContext || looksLikePathReference(trimmed);
}

function looksLikeWebOperationRequest(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(https?:\/\/|\bwww\.|\burl\b|\bwebsite\b|\bweb ?page\b|\bbrowser\b|\bbrowse\b|\bweb\b|\bsearch\b|\bfetch\b|\bdownload\b|网页|网站|浏览|搜索|抓取|下载)/i.test(trimmed);
}

function looksLikeSpecialUseIpWebBlock(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(private\s*[,/ ]\s*internal\s*[,/ ]\s*(or\s+)?special-use\s+ip|private\/internal\/special-use\s+ip|special-use\s+ip\s+address)/i.test(trimmed);
}

function extractFirstHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s)\]"'>]+/i);
  return match?.[0] || null;
}

function hasMeaningfulAgentText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^no response$/i.test(trimmed)) return false;
  if (/^blocked$/i.test(trimmed)) return false;
  return true;
}

function looksLikeAwarenessInitCompatibilityError(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /schema must be object or boolean/i.test(trimmed);
}

function parseMcpTextPayload(mcpResponse: any) {
  const textPayload = mcpResponse?.result?.content?.[0]?.text;
  if (!textPayload || typeof textPayload !== 'string') return {};
  try {
    return JSON.parse(textPayload);
  } catch {
    return {};
  }
}

function buildAwarenessInitSkipInstruction(errorDetail?: string): string {
  const summary = errorDetail ? `Latest compatibility failure: ${truncateDetail(errorDetail, 240)}` : '';
  return [
    '[Awareness memory compatibility note]',
    'Desktop has already detected that awareness_init can fail in the current OpenClaw wrapper path.',
    'Do not call awareness_init for this turn unless the user explicitly asks you to refresh memory bootstrap state.',
    'Continue with the main task even if Awareness memory bootstrap is unavailable.',
    'If you need targeted memory, use awareness_recall or awareness_lookup instead of awareness_init.',
    summary,
  ].filter(Boolean).join('\n');
}

function buildDesktopMemoryBootstrapSummary(memoryPayload: Record<string, any>): string {
  const renderedContext = typeof memoryPayload?.rendered_context === 'string'
    ? memoryPayload.rendered_context.trim()
    : '';
  if (renderedContext) {
    return truncateDetail(renderedContext, MEMORY_BOOTSTRAP_MAX_CHARS);
  }

  const sections: string[] = [];
  const knowledgeCards = Array.isArray(memoryPayload?.knowledge_cards)
    ? memoryPayload.knowledge_cards.slice(0, 5)
    : [];
  if (knowledgeCards.length > 0) {
    sections.push([
      'Knowledge cards:',
      ...knowledgeCards.map((card: any) => `- ${String(card?.title || card?.summary || card?.content || '').trim()}`),
    ].join('\n'));
  }

  const openTasks = Array.isArray(memoryPayload?.open_tasks)
    ? memoryPayload.open_tasks.slice(0, 5)
    : [];
  if (openTasks.length > 0) {
    sections.push([
      'Open tasks:',
      ...openTasks.map((task: any) => `- ${String(task?.title || task?.summary || task?.content || '').trim()}`),
    ].join('\n'));
  }

  const recentSessions = Array.isArray(memoryPayload?.recent_sessions)
    ? memoryPayload.recent_sessions.slice(0, 3)
    : [];
  if (recentSessions.length > 0) {
    sections.push([
      'Recent sessions:',
      ...recentSessions.map((entry: any) => `- ${String(entry?.summary || entry?.title || entry?.content || '').trim()}`),
    ].join('\n'));
  }

  return truncateDetail(sections.filter(Boolean).join('\n\n'), MEMORY_BOOTSTRAP_MAX_CHARS);
}

function buildDesktopMemoryBootstrapSection(memoryPayload: Record<string, any>, compatibilityError?: string): string {
  const contextSummary = buildDesktopMemoryBootstrapSummary(memoryPayload);
  const sections = [
    compatibilityError ? buildAwarenessInitSkipInstruction(compatibilityError) : '',
    [
      '[Awareness memory bootstrap loaded by Desktop]',
      'Desktop already loaded the current Awareness memory context for this turn.',
      'Treat the block below as the result of awareness_init and do not call awareness_init again on this turn.',
      'If more memory is needed, use awareness_recall or awareness_lookup instead.',
      contextSummary,
    ].filter(Boolean).join('\n'),
  ].filter(Boolean);
  return sections.join('\n\n');
}

function buildAwarenessInitCompatibilityRetryPrompt(runtimeMessage: string, failureDetail: string): string {
  return [
    '[Automatic compatibility retry]',
    'Previous attempt hit the known Awareness memory bootstrap compatibility failure in awareness_init.',
    'Do not call awareness_init on this retry.',
    'Continue with the main task directly. If memory is needed, rely on the preloaded desktop memory context already present in the runtime metadata or use awareness_recall / awareness_lookup instead.',
    `Compatibility failure: ${truncateDetail(failureDetail, 400)}`,
    '',
    '[Original runtime message]',
    runtimeMessage,
  ].join('\n');
}

function shouldRetryAfterAwarenessInitFailure(originalRequest: string, finalText: string): boolean {
  if (looksLikeWebOperationRequest(originalRequest) || looksLikeFilesystemMutationRequest(originalRequest)) {
    return true;
  }

  const trimmed = finalText.trim();
  if (!trimmed) return true;
  if (/^BROWSER_UNAVAILABLE$/i.test(trimmed)) return true;
  if (/^INIT_FAILED$/i.test(trimmed)) return true;
  if (/^No response$/i.test(trimmed)) return true;
  return false;
}

async function tryBuildDesktopMemoryBootstrapSection(
  callMcpStrict: (toolName: string, args: Record<string, any>, timeoutMs?: number) => Promise<any>,
  userMessage: string,
): Promise<string> {
  const mcpResponse = await callMcpStrict(
    'awareness_init',
    buildMemoryInitArgs(userMessage),
    MCP_MEMORY_BOOTSTRAP_TIMEOUT_MS,
  );
  const memoryPayload = parseMcpTextPayload(mcpResponse);
  return buildDesktopMemoryBootstrapSection(memoryPayload, awarenessInitCompatibilityMode ? lastAwarenessInitCompatibilityError : undefined);
}

function getMemoryCapturePolicy(homeDir: string): MemoryCapturePolicy {
  const defaultPolicy: MemoryCapturePolicy = { autoCapture: true, blockedSources: [] };

  try {
    const configPath = path.join(homeDir, '.openclaw', 'openclaw.json');
    const config = readJsonFileWithBom<Record<string, any>>(configPath) || {};
    const memoryConfig = config?.plugins?.entries?.['openclaw-memory']?.config || {};

    const blockedSources = Array.isArray(memoryConfig?.blockedSources)
      ? memoryConfig.blockedSources.filter((item: unknown): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
      : [];

    return {
      autoCapture: memoryConfig?.autoCapture !== false,
      blockedSources,
    };
  } catch {
    return defaultPolicy;
  }
}

function buildWebCompatibilityRetryPrompt(originalRequest: string, blockedResponse: string): string {
  const targetUrl = extractFirstHttpUrl(originalRequest);
  const urlHint = targetUrl ? `Target public URL: ${targetUrl}` : '';

  return `[Automatic compatibility retry]
Previous attempt was blocked because web_fetch/browser treated the resolved address as private/internal/special-use (common with VPN DNS hijack/split routing).

Retry this request without using web_fetch or browser.
- Use web_search for discovery when needed.
- For public URL retrieval, use exec-based HTTP commands.
- On Windows, prefer Invoke-WebRequest with -UseBasicParsing.
- On macOS/Linux, prefer curl -L.
- If the user requested download/save, verify file existence and size after writing.

${urlHint}
Original request:
${originalRequest}

Previous blocked response:
${blockedResponse}`;
}

export function registerChatHandlers(deps: {
  sendToRenderer: (channel: string, payload: any) => void;
  ensureGatewayRunning: () => Promise<{ ok: boolean; error?: string }>;
  prepareGatewayForChat?: () => Promise<{ ok: boolean; error?: string }>;
  prepareCliFallback?: () => Promise<void>;
  getGatewayWs: () => Promise<GatewayClient>;
  getConnectedGatewayWs: () => GatewayClient | null;
  callMcpStrict: (toolName: string, args: Record<string, any>, timeoutMs?: number) => Promise<any>;
  getEnhancedPath: () => string;
  runSpawn?: (cmd: string, args: string[], opts?: Record<string, unknown>) => ReturnType<typeof spawn>;
  wrapWindowsCommand: (command: string) => string;
  stripAnsi: (output: string) => string;
  spawnChatProcess?: typeof spawn;
  readMemoryCapturePolicy?: () => MemoryCapturePolicy;
}) {
  ipcMain.handle('chat:abort', async (_e: any, sessionKey?: string) => {
    const connectedGatewayWs = deps.getConnectedGatewayWs();
    if (connectedGatewayWs?.isConnected && sessionKey) {
      try {
        await connectedGatewayWs.chatAbort(sessionKey);
        return { success: true };
      } catch {
        // Fall through to CLI kill.
      }
    }

    if (activeChatChild) {
      try { activeChatChild.kill('SIGTERM'); } catch { /* already dead */ }
      activeChatChild = null;
      return { success: true };
    }

    return { success: false, error: 'No active chat' };
  });

  ipcMain.handle('chat:approve', async (_e: any, sessionKey: string, approvalRequestId: string, decision?: 'allow-once') => {
    if (!sessionKey || !approvalRequestId) {
      return { success: false, error: 'Missing approval context' };
    }

    try {
      const ws = await deps.getGatewayWs();
      const command = `/approve ${approvalRequestId} ${decision || 'allow-once'}`;
      await ws.chatSend(sessionKey, command);
      return { success: true, command };
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) };
    }
  });

  // Load chat history from Gateway for a given session.
  // Falls back gracefully — returns empty if Gateway is unavailable.
  ipcMain.handle('chat:load-history', async (_e: any, sessionId: string) => {
    const gw = deps.getConnectedGatewayWs();
    if (!gw?.isConnected || !sessionId) {
      return { success: false, messages: [], error: 'Gateway not connected' };
    }
    try {
      const raw = await gw.chatHistory(sessionId);
      if (!raw || raw.length === 0) {
        return { success: true, messages: [] };
      }
      const messages = buildDesktopHistory(raw || []);
      return { success: true, messages };
    } catch (err: any) {
      return { success: false, messages: [], error: err?.message || String(err) };
    }
  });

  ipcMain.handle('chat:send', async (_e: any, message: string, sessionId?: string, options?: ChatSendOptions) => {
    const send = (channel: string, payload: any) => {
      deps.sendToRenderer(channel, payload);
    };

    // Agent routing is done via the session key format, not a separate agentId param.
    // Gateway session keys: agent:<agentId>:main (operator), agent:<agentId>:webchat:<id> (desktop).
    // When a non-main agent is selected, prefix the session key so Gateway routes to the right agent.
    const agentId = options?.agentId || 'main';
    const rawSid = sessionId || `ac-${Date.now()}`;
    const sid = agentId !== 'main'
      ? `agent:${agentId}:webchat:${rawSid}`
      : rawSid;

    let fullMessage = message;
    const shouldPreloadDesktopMemory = awarenessInitCompatibilityMode
      || looksLikeWebOperationRequest(message)
      || looksLikeFilesystemMutationRequest(message);

    if (shouldPreloadDesktopMemory) {
      try {
        const memoryBootstrapSection = await tryBuildDesktopMemoryBootstrapSection(deps.callMcpStrict, message);
        if (memoryBootstrapSection.trim()) {
          fullMessage = `${memoryBootstrapSection}\n\n${fullMessage}`;
        }
      } catch (memoryBootstrapErr: any) {
        const detail = memoryBootstrapErr?.message || String(memoryBootstrapErr);
        if (awarenessInitCompatibilityMode) {
          fullMessage = `${buildAwarenessInitSkipInstruction(detail)}\n\n${fullMessage}`;
        }
      }
    } else if (awarenessInitCompatibilityMode) {
      fullMessage = `${buildAwarenessInitSkipInstruction(lastAwarenessInitCompatibilityError)}\n\n${fullMessage}`;
    }

    // Bootstrap dual mechanism:
    // 1. Primary: OpenClaw Gateway injects AGENTS.md into system prompt, which instructs
    //    the LLM to read BOOTSTRAP.md and follow it. This is the native mechanism.
    // 2. Fallback: If BOOTSTRAP.md still exists when a non-main agent sends its FIRST
    //    message in this desktop session, we inject the content as a safety net for
    //    smaller models that may not follow AGENTS.md instructions reliably.
    //    After injection, we delete BOOTSTRAP.md to prevent re-triggering.
    if (agentId !== 'main') {
      try {
        const slug = agentId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const flatWs = path.join(os.homedir(), '.openclaw', `workspace-${slug}`);
        const nestedWs = path.join(os.homedir(), '.openclaw', 'workspaces', slug);
        const agentWs = path.join(os.homedir(), '.openclaw', 'agents', slug, 'agent');
        for (const dir of [flatWs, nestedWs, agentWs]) {
          const bp = path.join(dir, 'BOOTSTRAP.md');
          if (fs.existsSync(bp)) {
            const bootstrapContent = fs.readFileSync(bp, 'utf-8').trim();
            if (bootstrapContent) {
              fullMessage = `[BOOTSTRAP — First Run Ritual]\nThis is your first conversation. Follow the bootstrap instructions below to get to know your user, then update IDENTITY.md, USER.md, and SOUL.md with what you learn.\n\n${bootstrapContent}\n\n[User's first message]\n${message}`;
              // Delete from all locations after injection — one-time only
              for (const d of [flatWs, nestedWs, agentWs]) {
                try { const f = path.join(d, 'BOOTSTRAP.md'); if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignore */ }
              }
            }
            break;
          }
        }
      } catch { /* ignore */ }
    }

    const homeDir = os.homedir();
    const desktopDir = path.join(homeDir, 'Desktop');
    const documentsDir = path.join(homeDir, 'Documents');
    const downloadsDir = path.join(homeDir, 'Downloads');
    const hostOsLabel = getHostOsLabel(process.platform);
    const hostApprovals = getExecApprovalSettings(homeDir, options?.agentId || 'main');
    fullMessage = `[Local machine context] You are running inside the AwarenessClaw Desktop app on the user's own computer. When the user asks about local files or folders on this machine, do not answer with a generic safety/privacy refusal. Use the available tools (especially exec/read/write/edit when appropriate) to inspect or modify the local filesystem if the request is allowed by the current host approval policy. Common ${hostOsLabel} folders for this user are: home=${homeDir}, desktop=${desktopDir}, documents=${documentsDir}, downloads=${downloadsDir}. If the user says "桌面", "desktop", or "我的桌面", resolve that to ${desktopDir}. If the user asks what files are there, inspect the directory first and report the actual result. For any local filesystem claim, do not guess. Never claim a file or folder change succeeded unless a tool result confirms it. After creating, editing, renaming, or deleting files/folders, run a follow-up verification step (for example list the directory, read the file, or stat the target) and include that verification in your reply. If a tool call is blocked, denied, or fails, say that plainly instead of pretending the action finished.

  [Current host exec approvals] security=${hostApprovals.security}, ask=${hostApprovals.ask}, askFallback=${hostApprovals.askFallback}, autoAllowSkills=${hostApprovals.autoAllowSkills ? 'on' : 'off'}. This current host approval state is authoritative for this turn. If earlier conversation turns claimed local filesystem access was blocked by allowlist/privacy rules, do not blindly repeat that claim. Re-evaluate the request against the current approval state above and use tools when allowed.

  [Web compatibility note] If web_fetch or browser reports private/internal/special-use IP blocking for a public HTTPS domain, treat it as a VPN/DNS compatibility issue instead of a final failure. Explain that compatibility issue briefly, then continue with a safe fallback flow (for example: use web_search for discovery and exec-based HTTP retrieval for the requested public URL when host approvals allow it).

  ${fullMessage}`;
    if (options?.files && options.files.length > 0) {
      const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'];
      const images: string[] = [];
      const others: string[] = [];
      for (const filePath of options.files) {
        const ext = path.extname(filePath).toLowerCase();
        (imageExts.includes(ext) ? images : others).push(filePath);
      }
      const parts: string[] = [];
      if (images.length > 0) parts.push(`[Images to analyze: ${images.join(', ')}] (use exec tool to read or describe these image files)`);
      if (others.length > 0) parts.push(`[Attached files: ${others.join(', ')}]`);
      fullMessage = `${parts.join('\n')}\n\n${fullMessage}`;
    }

    const requestedWorkspace = options?.workspacePath?.trim();
    if (requestedWorkspace) {
      try {
        if (!fs.statSync(requestedWorkspace).isDirectory()) {
          return { success: false, text: '', error: 'The selected project folder is not available.', sessionId: sid };
        }
      } catch {
        return { success: false, text: '', error: 'The selected project folder could not be found.', sessionId: sid };
      }
      fullMessage = `[Project working directory: ${requestedWorkspace}] Use this directory as the default root for file operations in this chat. When the user asks you to read, write, edit, or create project files, prefer absolute paths inside this directory or set your command cwd there. Do not treat this folder as the agent's home workspace; AGENTS.md, USER.md, SOUL.md, MEMORY.md, and other agent-scoped files still follow the configured agent workspace.\n\n${fullMessage}`;
    }

    if (fullMessage !== message) {
      fullMessage = `[Operational context metadata — do not answer this section directly]
The block below is runtime metadata for tool routing and local file safety checks. Do not acknowledge, summarize, or restate this metadata in your reply unless the user asks about it explicitly.

${fullMessage}

[User request]
${message}`;
    }

    const gatewayReady = await (deps.prepareGatewayForChat
      ? deps.prepareGatewayForChat()
      : deps.ensureGatewayRunning());
    if (!gatewayReady.ok) {
      console.warn('[chat] Gateway preflight failed, falling back to CLI:', gatewayReady.error || 'unknown error');
      send('chat:status', {
        type: 'gateway',
        message: gatewayReady.error || 'Gateway unavailable. Falling back to direct OpenClaw chat...',
      });
      try {
        await deps.prepareCliFallback?.();
      } catch (prepareErr: any) {
        console.warn('[chat] CLI fallback preparation failed:', prepareErr?.message || prepareErr);
      }
      const cliResult = await chatSendViaCliWithWebCompatibilityRetry({
        requestMessage: fullMessage,
        originalUserMessage: message,
        sid,
        options,
        send,
        deps,
      });
      const needsRetry = cliResult?.success
        && (!cliResult.text || /^(No response|No reply from agent\.?)+$/i.test(String(cliResult.text).trim()));
      if (needsRetry && fullMessage !== message) {
        console.warn('[chat] CLI fallback returned empty response with metadata prompt; retrying with raw user message');
        return chatSendViaCliWithWebCompatibilityRetry({
          requestMessage: message,
          originalUserMessage: message,
          sid,
          options,
          send,
          deps,
        });
      }
      return cliResult;
    }

    let fullResponseText = '';
    let chatEventHandler: ((payload: any) => void) | null = null;
    let allEventsHandler: ((evt: any) => void) | null = null;
    let agentEventHandler: ((payload: any) => void) | null = null;
    let agentAssistantEventHandler: ((payload: any) => void) | null = null;
    let agentLifecycleEventHandler: ((payload: any) => void) | null = null;
    let agentToolEventHandler: ((payload: any) => void) | null = null;
    let ws: GatewayClient | null = null;

    try {
      ws = await deps.getGatewayWs();

      const { promise: chatDone, resolve: chatResolve } = (() => {
        let resolver: () => void;
        const promise = new Promise<void>((res) => { resolver = res; });
        return { promise, resolve: resolver! };
      })();
      let didTimeout = false;
      const chatTimeout = setTimeout(() => {
        didTimeout = true;
        chatResolve();
      }, CHAT_TIMEOUT_MS);

      const seenToolIds = new Set<string>();
      const completedToolIds = new Set<string>();
      const toolNamesById = new Map<string, string>();
      let lastThinkingText = '';
      let pendingApprovalRequestId = '';
      let pendingApprovalCommand = '';
      let pendingApprovalDetail = '';
      let sawAssistantDelta = false;
      let sawAssistantTextDelta = false;
      let sawAssistantNonTextDelta = false;
      let sawToolBlocks = false;
      let sawCompletedToolResult = false;
      let sawThinkingBlocks = false;
      let sawFinalState = false;
      let finalAssistantText = '';
      let finalAssistantContentTypes: string[] = [];
      let awarenessInitCompatibilityIssue = false;
      let awarenessInitFailureDetail = '';

      const noteAwarenessInitCompatibilityIssue = (toolName: string | undefined, detail: string | undefined) => {
        if (toolName !== 'awareness_init') return;
        const normalizedDetail = String(detail || '').trim();
        if (!looksLikeAwarenessInitCompatibilityError(normalizedDetail)) return;
        awarenessInitCompatibilityIssue = true;
        awarenessInitFailureDetail = normalizedDetail || 'schema must be object or boolean';
        awarenessInitCompatibilityMode = true;
        lastAwarenessInitCompatibilityError = awarenessInitFailureDetail;
      };

      const processAssistantContentBlocks = (blocks: any[]) => {
        for (const block of blocks) {
          if (block.type === 'tool_use') {
            sawToolBlocks = true;
            const toolId = block.id || `tc-${Date.now()}`;
            toolNamesById.set(toolId, block.name || 'tool');
            send('chat:event', {
              stream: 'tool',
              phase: 'start',
              toolCallId: toolId,
              toolName: block.name || 'tool',
              args: extractToolArgs(block),
              raw: block,
            });
            if (!seenToolIds.has(toolId)) {
              seenToolIds.add(toolId);
              send('chat:status', {
                type: 'tool_call',
                tool: block.name || 'tool',
                toolStatus: 'running',
                toolId,
                detail: extractToolDetail(extractToolArgs(block)),
              });
            }
            continue;
          }

          if (block.type === 'tool_result') {
            sawToolBlocks = true;
            sawCompletedToolResult = true;
            const toolId = block.tool_use_id || '';
            const toolName = toolNamesById.get(toolId) || block.name || 'tool';
            const toolOutput = extractToolOutput(block);
            noteAwarenessInitCompatibilityIssue(toolName, toolOutput);
            send('chat:event', {
              stream: 'tool',
              phase: 'result',
              toolCallId: toolId,
              toolName,
              result: block.content ?? block.result ?? block,
              isError: Boolean(block.is_error || block.isError),
              raw: block,
            });
            if (toolId && !completedToolIds.has(toolId)) {
              completedToolIds.add(toolId);
              send('chat:status', {
                type: 'tool_update',
                toolId,
                toolStatus: block.is_error || block.isError ? 'failed' : 'completed',
                detail: toolOutput,
              });
            }
            continue;
          }

          if (block.type === 'thinking' || block.type === 'reasoning') {
            sawThinkingBlocks = true;
            const text = block.thinking || block.reasoning || block.text || '';
            if (text && text !== lastThinkingText) {
              lastThinkingText = text;
              send('chat:event', {
                stream: 'assistant',
                phase: 'thinking',
                thinking: text,
                raw: block,
              });
              send('chat:status', { type: 'thinking' });
              send('chat:thinking', text);
            }
          }
        }
      };

      const handleNormalizedAgentEvent = (eventName: string, payload: any) => {
        const normalizedAgentEvent = normalizeAgentGatewayEvent(eventName, payload);
        if (!normalizedAgentEvent) return;

        const sessionKey = normalizedAgentEvent.sessionKey || '';
        if (sessionKey && sessionKey !== sid) return;

        if (normalizedAgentEvent.stream === 'tool') {
          sawToolBlocks = true;
          const toolId = normalizedAgentEvent.toolCallId || '';
          const toolName = normalizedAgentEvent.toolName || (toolId ? toolNamesById.get(toolId) : undefined) || 'tool';
          if (toolId) toolNamesById.set(toolId, toolName);
          send('chat:event', {
            stream: 'tool',
            phase: normalizedAgentEvent.phase || '',
            runId: normalizedAgentEvent.runId,
            sessionKey,
            seq: normalizedAgentEvent.seq,
            toolCallId: toolId,
            toolName,
            args: normalizedAgentEvent.args,
            partialResult: normalizedAgentEvent.partialResult,
            result: normalizedAgentEvent.result,
            isError: Boolean(normalizedAgentEvent.isError),
            raw: normalizedAgentEvent.raw,
          });

          if (!toolId) return;
          if (normalizedAgentEvent.phase === 'start') {
            send('chat:status', {
              type: 'tool_call',
              tool: toolName,
              toolStatus: 'running',
              toolId,
              detail: extractToolDetail(normalizedAgentEvent.args),
            });
            return;
          }

          if (normalizedAgentEvent.phase === 'update') {
            send('chat:status', {
              type: 'tool_update',
              toolId,
              toolStatus: 'running',
              detail: extractToolDetail(normalizedAgentEvent.partialResult),
            });
            return;
          }

          if (normalizedAgentEvent.phase === 'result') {
            sawCompletedToolResult = true;
            noteAwarenessInitCompatibilityIssue(toolName, extractToolDetail(normalizedAgentEvent.result));
            send('chat:status', {
              type: 'tool_update',
              toolId,
              toolStatus: normalizedAgentEvent.isError ? 'failed' : 'completed',
              detail: extractToolDetail(normalizedAgentEvent.result),
            });
            return;
          }
        }

        if (normalizedAgentEvent.stream === 'assistant') {
          const assistantText = normalizedAgentEvent.thinking || normalizedAgentEvent.text || '';
          if (!assistantText) return;
          send('chat:event', {
            stream: 'assistant',
            phase: normalizedAgentEvent.phase || 'text',
            runId: normalizedAgentEvent.runId,
            sessionKey,
            seq: normalizedAgentEvent.seq,
            text: normalizedAgentEvent.text,
            thinking: normalizedAgentEvent.thinking,
            raw: normalizedAgentEvent.raw,
          });
          if (normalizedAgentEvent.phase === 'thinking' && assistantText !== lastThinkingText) {
            lastThinkingText = assistantText;
            send('chat:status', { type: 'thinking' });
            send('chat:thinking', assistantText);
          }
          return;
        }

        if (normalizedAgentEvent.stream === 'lifecycle') {
          send('chat:event', {
            stream: 'lifecycle',
            phase: normalizedAgentEvent.phase || '',
            runId: normalizedAgentEvent.runId,
            sessionKey,
            seq: normalizedAgentEvent.seq,
            raw: normalizedAgentEvent.raw,
          });
        }
      };

      allEventsHandler = (evt: any) => {
        const eventName = evt?.event || 'unknown';
        const payload = evt?.payload || evt;
        const preview = JSON.stringify(payload).slice(0, 800);
        send('chat:debug', `[gw:${eventName}] ${preview}`);

        if (eventName.endsWith('.approval.requested')) {
          const request = payload?.request || {};
          const toolName = eventName.replace(/\.approval\.requested$/, '') || request.tool || 'tool';
          const detailParts: string[] = [];
          if (request.command) detailParts.push(String(request.command));
          if (request.cwd) detailParts.push(`cwd: ${request.cwd}`);
          const requestId = request.id || `approval-${toolName}-${Date.now()}`;
          const approvalCommand = `/approve ${requestId} allow-once`;
          pendingApprovalRequestId = requestId;
          pendingApprovalCommand = approvalCommand;
          pendingApprovalDetail = detailParts.join(' | ') || 'Waiting for approval';
          send('chat:status', {
            type: 'tool_approval',
            tool: toolName,
            toolStatus: 'awaiting_approval',
            toolId: requestId,
            approvalRequestId: requestId,
            approvalCommand,
            detail: pendingApprovalDetail,
          });
        }
      };
      ws.on('gateway-event', allEventsHandler);

      agentEventHandler = (payload: any) => handleNormalizedAgentEvent('agent', payload);
      agentAssistantEventHandler = (payload: any) => handleNormalizedAgentEvent('agent:assistant', payload);
      agentLifecycleEventHandler = (payload: any) => handleNormalizedAgentEvent('agent:lifecycle', payload);
      agentToolEventHandler = (payload: any) => handleNormalizedAgentEvent('agent:tool', payload);

      ws.on('event:agent', agentEventHandler);
      ws.on('event:agent:assistant', agentAssistantEventHandler);
      ws.on('event:agent:lifecycle', agentLifecycleEventHandler);
      ws.on('event:agent:tool', agentToolEventHandler);

      chatEventHandler = (payload: any) => {
        if (!payload) return;
        const payloadSession = payload.sessionKey || payload.key || '';
        if (payloadSession && !payloadSession.endsWith(sid) && payloadSession !== sid) return;

        const state = payload.state;
        const msg = payload.message;

        if (state === 'delta' && msg && msg.role === 'assistant') {
          sawAssistantDelta = true;
          let textContent = extractAssistantText(msg);
          if (Array.isArray(msg.content)) {
            finalAssistantContentTypes = msg.content.map((contentBlock: any) => String(contentBlock?.type || typeof contentBlock));
            sawAssistantNonTextDelta = msg.content.some((contentBlock: any) => contentBlock?.type && contentBlock.type !== 'text');
          }

          if (textContent && textContent.length > fullResponseText.length) {
            const newChunk = textContent.slice(fullResponseText.length);
            fullResponseText = textContent;
            sawAssistantTextDelta = true;
            send('chat:stream', newChunk);
            send('chat:status', { type: 'generating' });
          }

          if (Array.isArray(msg.content)) processAssistantContentBlocks(msg.content);

          if (typeof msg.content === 'string' && msg.content.startsWith('Reasoning:')) {
            const reasoningText = msg.content.replace(/^Reasoning:\s*/, '');
            if (reasoningText && reasoningText !== lastThinkingText) {
              lastThinkingText = reasoningText;
              fullResponseText = fullResponseText.replace(msg.content, '').trim();
              send('chat:thinking', reasoningText);
              send('chat:status', { type: 'thinking' });
            }
          }
        } else if (state === 'final') {
          sawFinalState = true;
          if (msg && msg.role === 'assistant') {
            finalAssistantText = extractAssistantText(msg).trim();
            if (Array.isArray(msg.content)) {
              finalAssistantContentTypes = msg.content.map((contentBlock: any) => String(contentBlock?.type || typeof contentBlock));
              processAssistantContentBlocks(msg.content);
            } else if (typeof msg.content === 'string') {
              finalAssistantContentTypes = ['string'];
            }
          }
          clearTimeout(chatTimeout);
          chatResolve();
        } else if (state === 'aborted' || state === 'error') {
          send('chat:status', { type: 'error' });
          clearTimeout(chatTimeout);
          chatResolve();
        }
      };

      ws.on('event:chat', chatEventHandler);
      send('chat:status', { type: 'thinking' });

      await ws.chatSend(sid, fullMessage, {
        thinking: options?.thinkingLevel && options.thinkingLevel !== 'off' ? options.thinkingLevel : undefined,
        verbose: 'full',
        reasoning: options?.reasoningDisplay && options.reasoningDisplay !== 'off' ? options.reasoningDisplay : 'on',
      });

      await chatDone;

      ws.removeListener('event:chat', chatEventHandler);
      ws.removeListener('gateway-event', allEventsHandler);
      if (agentEventHandler) ws.removeListener('event:agent', agentEventHandler);
      if (agentAssistantEventHandler) ws.removeListener('event:agent:assistant', agentAssistantEventHandler);
      if (agentLifecycleEventHandler) ws.removeListener('event:agent:lifecycle', agentLifecycleEventHandler);
      if (agentToolEventHandler) ws.removeListener('event:agent:tool', agentToolEventHandler);

      let finalText = fullResponseText.trim() || finalAssistantText || '';
      let shouldFlagUnverifiedLocalFileOperation = looksLikeFilesystemMutationRequest(message)
        && looksLikeSuccessfulFilesystemMutationResponse(finalText)
        && !pendingApprovalRequestId
        && !sawCompletedToolResult;
      if (looksLikeAwarenessInitCompatibilityError(finalText)) {
        awarenessInitCompatibilityIssue = true;
        awarenessInitFailureDetail = finalText;
        awarenessInitCompatibilityMode = true;
        lastAwarenessInitCompatibilityError = finalText;
      }
      let shouldFlagVpnDnsCompatibilityIssue = looksLikeWebOperationRequest(message)
        && looksLikeSpecialUseIpWebBlock(finalText);
      let preferResultText = false;
      let usedCliCompatibilityRetry = false;

      if (shouldFlagUnverifiedLocalFileOperation) {
        console.warn('[chat] Assistant claimed a local filesystem mutation succeeded without any completed tool result', {
          sessionId: sid,
          responsePreview: finalText.slice(0, 200),
          sawToolBlocks,
          sawCompletedToolResult,
        });
      }

      if (awarenessInitCompatibilityIssue && !pendingApprovalRequestId && shouldRetryAfterAwarenessInitFailure(message, finalText)) {
        console.warn('[chat] Awareness memory bootstrap compatibility issue detected; retrying without awareness_init', {
          sessionId: sid,
          responsePreview: finalText.slice(0, 200),
          detail: awarenessInitFailureDetail,
        });

        send('chat:status', {
          type: 'gateway',
          message: 'Detected Awareness memory compatibility mode. Retrying without awareness_init...',
        });

        try {
          await deps.prepareCliFallback?.();
        } catch (prepareErr: any) {
          console.warn('[chat] CLI compatibility retry preparation failed:', prepareErr?.message || prepareErr);
        }

        const retryPrompt = buildAwarenessInitCompatibilityRetryPrompt(
          fullMessage,
          awarenessInitFailureDetail || finalText,
        );
        const retryResult = await chatSendViaCliWithWebCompatibilityRetry({
          requestMessage: retryPrompt,
          originalUserMessage: message,
          sid,
          options,
          send,
          deps,
        });
        usedCliCompatibilityRetry = true;

        if (!retryResult?.success) {
          send('chat:stream-end', {});
        }

        const retryText = String(retryResult?.text || '').trim();
        if (retryResult?.success && hasMeaningfulAgentText(retryText)) {
          finalText = retryText;
          shouldFlagUnverifiedLocalFileOperation = Boolean(retryResult?.unverifiedLocalFileOperation);
          shouldFlagVpnDnsCompatibilityIssue = Boolean(retryResult?.vpnDnsCompatibilityIssue);
          preferResultText = true;
          send('chat:status', {
            type: 'gateway',
            message: 'Continued without awareness_init successfully.',
          });
        }
      }

      if (shouldFlagVpnDnsCompatibilityIssue) {
        console.warn('[chat] Web tool response indicates VPN/DNS special-use IP compatibility issue', {
          sessionId: sid,
          responsePreview: finalText.slice(0, 200),
        });

        if (!pendingApprovalRequestId) {
          send('chat:status', {
            type: 'gateway',
            message: 'Detected VPN/DNS compatibility mode. Retrying with exec-based web access...',
          });
          try {
            await deps.prepareCliFallback?.();
          } catch (prepareErr: any) {
            console.warn('[chat] CLI compatibility retry preparation failed:', prepareErr?.message || prepareErr);
          }

          const retryPrompt = buildWebCompatibilityRetryPrompt(message, finalText);
          const retryResult = await chatSendViaCli(retryPrompt, sid, options, send, deps);
          usedCliCompatibilityRetry = true;

          if (!retryResult?.success) {
            send('chat:stream-end', {});
          }

          const retryText = String(retryResult?.text || '').trim();
          if (retryResult?.success && hasMeaningfulAgentText(retryText)) {
            finalText = retryText;
            shouldFlagUnverifiedLocalFileOperation = Boolean(retryResult?.unverifiedLocalFileOperation);
            shouldFlagVpnDnsCompatibilityIssue = Boolean(retryResult?.vpnDnsCompatibilityIssue);
            preferResultText = true;

            if (!shouldFlagVpnDnsCompatibilityIssue) {
              send('chat:status', {
                type: 'gateway',
                message: 'Web compatibility fallback succeeded.',
              });
            }
          }
        }
      }

      if (!usedCliCompatibilityRetry) {
        send('chat:stream-end', {});
      }

      if (!finalText && !pendingApprovalRequestId) {
        const diagnostic = {
          sessionId: sid,
          didTimeout,
          sawFinalState,
          sawAssistantDelta,
          sawAssistantTextDelta,
          sawAssistantNonTextDelta,
          sawToolBlocks,
          sawThinkingBlocks,
          finalAssistantTextPreview: finalAssistantText ? finalAssistantText.slice(0, 160) : '',
          finalAssistantContentTypes,
        };

        if (didTimeout) {
          console.warn('[chat] No response before desktop timeout; likely OpenClaw/Gateway stalled upstream', diagnostic);
        } else if (!sawAssistantTextDelta && finalAssistantText) {
          console.warn('[chat] Desktop received assistant text only in the final event and would misclassify it as No response', diagnostic);
        } else if (sawFinalState && !sawAssistantDelta && !finalAssistantText) {
          console.warn('[chat] OpenClaw/Gateway completed the run with an empty assistant response', diagnostic);
        } else if (sawAssistantDelta && !sawAssistantTextDelta && (sawAssistantNonTextDelta || sawToolBlocks || sawThinkingBlocks)) {
          console.warn('[chat] OpenClaw/Gateway returned assistant activity without text output', diagnostic);
        } else {
          console.warn('[chat] Empty response could not be classified cleanly', diagnostic);
        }
      }

      const memoryCapturePolicy = deps.readMemoryCapturePolicy?.() || getMemoryCapturePolicy(os.homedir());
      const blockedSources = new Set(
        (memoryCapturePolicy.blockedSources || []).map((item) => item.trim().toLowerCase()).filter(Boolean),
      );
      const shouldAutoCaptureDesktopMemory = memoryCapturePolicy.autoCapture !== false
        && !blockedSources.has('desktop');

      if (finalText && !shouldFlagUnverifiedLocalFileOperation && shouldAutoCaptureDesktopMemory) {
        const memoryToolId = `memory-save-${Date.now()}`;
        send('chat:status', {
          type: 'tool_call',
          tool: 'awareness_record',
          toolStatus: 'saving',
          toolId: memoryToolId,
          detail: 'Save this turn to Awareness memory',
        });

        deps.callMcpStrict('awareness_record', {
          action: 'remember',
          content: `Request: ${message}\nResult: ${finalText}`,
          event_type: 'turn_brief',
          source: 'desktop',
        }).then((result) => {
          const parsed = parseMcpTextPayload(result);
          if (parsed?.error) {
            throw new Error(parsed.error);
          }
          send('chat:status', {
            type: 'tool_update',
            toolId: memoryToolId,
            toolStatus: 'completed',
            detail: parsed?.filepath || 'Saved to Awareness memory',
          });
        }).catch((err) => {
          console.warn('[chat] Memory record failed:', err.message);
          send('chat:status', {
            type: 'tool_update',
            toolId: memoryToolId,
            toolStatus: 'failed',
            detail: err.message,
          });
          send('chat:memory-warning', {
            type: 'record-failed',
            message: err.message,
          });
        });
      }

      if (!finalText && pendingApprovalRequestId) {
        return {
          success: true,
          text: '',
          sessionId: sid,
          awaitingApproval: true,
          approvalRequestId: pendingApprovalRequestId,
          approvalCommand: pendingApprovalCommand,
          approvalDetail: pendingApprovalDetail,
        };
      }

      return {
        success: true,
        text: finalText || 'No response',
        sessionId: sid,
        unverifiedLocalFileOperation: shouldFlagUnverifiedLocalFileOperation || undefined,
        vpnDnsCompatibilityIssue: shouldFlagVpnDnsCompatibilityIssue || undefined,
        preferResultText: preferResultText || undefined,
      };
    } catch (err: any) {
      if (ws) {
        if (chatEventHandler) ws.removeListener('event:chat', chatEventHandler);
        if (allEventsHandler) ws.removeListener('gateway-event', allEventsHandler);
        if (agentEventHandler) ws.removeListener('event:agent', agentEventHandler);
        if (agentAssistantEventHandler) ws.removeListener('event:agent:assistant', agentAssistantEventHandler);
        if (agentLifecycleEventHandler) ws.removeListener('event:agent:lifecycle', agentLifecycleEventHandler);
        if (agentToolEventHandler) ws.removeListener('event:agent:tool', agentToolEventHandler);
      }
      send('chat:stream-end', {});
      const errorMsg = err?.message || String(err);
      if (errorMsg.includes('WebSocket') || errorMsg.includes('connect') || errorMsg.includes('timed out')) {
        console.warn('[chat] WebSocket failed, falling back to CLI:', errorMsg);
        try {
          await deps.prepareCliFallback?.();
        } catch (prepareErr: any) {
          console.warn('[chat] CLI fallback preparation failed:', prepareErr?.message || prepareErr);
        }
        const cliResult = await chatSendViaCliWithWebCompatibilityRetry({
          requestMessage: fullMessage,
          originalUserMessage: message,
          sid,
          options,
          send,
          deps,
        });
        const needsRetry = cliResult?.success
          && (!cliResult.text || /^(No response|No reply from agent\.?)+$/i.test(String(cliResult.text).trim()));
        if (needsRetry && fullMessage !== message) {
          console.warn('[chat] CLI fallback returned empty response with metadata prompt; retrying with raw user message');
          return chatSendViaCliWithWebCompatibilityRetry({
            requestMessage: message,
            originalUserMessage: message,
            sid,
            options,
            send,
            deps,
          });
        }
        return cliResult;
      }
      return { success: false, text: '', error: errorMsg, sessionId: sid };
    }
  });
}

async function chatSendViaCliWithWebCompatibilityRetry(params: {
  requestMessage: string;
  originalUserMessage: string;
  sid: string;
  options: ChatSendOptions | undefined;
  send: (channel: string, payload: any) => void;
  deps: {
    getEnhancedPath: () => string;
    runSpawn?: (cmd: string, args: string[], opts?: Record<string, unknown>) => ReturnType<typeof spawn>;
    wrapWindowsCommand: (command: string) => string;
    stripAnsi: (output: string) => string;
    spawnChatProcess?: typeof spawn;
  };
}): Promise<any> {
  const { requestMessage, originalUserMessage, sid, options, send, deps } = params;
  const first = await chatSendViaCli(requestMessage, sid, options, send, deps);

  if (!first?.vpnDnsCompatibilityIssue) {
    return first;
  }

  send('chat:status', {
    type: 'gateway',
    message: 'Detected VPN/DNS compatibility mode. Retrying with exec-based web access...',
  });

  const retryPrompt = buildWebCompatibilityRetryPrompt(
    originalUserMessage || requestMessage,
    String(first?.text || ''),
  );
  const retry = await chatSendViaCli(retryPrompt, sid, options, send, deps);
  if (!retry?.success) {
    send('chat:stream-end', {});
  }
  const retryText = String(retry?.text || '').trim();

  if (retry?.success && hasMeaningfulAgentText(retryText)) {
    return {
      ...retry,
      preferResultText: true,
    };
  }

  return first;
}

async function chatSendViaCli(
  requestMessage: string,
  sid: string,
  options: ChatSendOptions | undefined,
  send: (channel: string, payload: any) => void,
  deps: {
    getEnhancedPath: () => string;
    runSpawn?: (cmd: string, args: string[], opts?: Record<string, unknown>) => ReturnType<typeof spawn>;
    wrapWindowsCommand: (command: string) => string;
    stripAnsi: (output: string) => string;
    spawnChatProcess?: typeof spawn;
  },
): Promise<any> {
  return new Promise((resolve) => {
    const collectedLines: string[] = [];
    let stdoutRemainder = '';
    let stderrRemainder = '';
    const thinkingFlag = options?.thinkingLevel && options.thinkingLevel !== 'off'
      ? ` --thinking ${options.thinkingLevel}` : '';
    const agentFlag = options?.agentId && options.agentId !== 'main' ? ` --agent "${options.agentId}"` : '';
    const escapedMsg = requestMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\\$').replace(/`/g, '\\`');
    // Note: openclaw CLI does not support --reasoning flag; reasoning is controlled via
    // openclaw.json agents.defaults.reasoningDefault (set in syncToOpenClaw)
    const command = `openclaw agent --session-id "${sid}" -m "${escapedMsg}" --verbose full${thinkingFlag}${agentFlag}`;
    const openclawArgs = ['agent', '--session-id', sid, '-m', requestMessage, '--verbose', 'full'];
    if (options?.thinkingLevel && options.thinkingLevel !== 'off') {
      openclawArgs.push('--thinking', options.thinkingLevel);
    }
    if (options?.agentId && options.agentId !== 'main') {
      openclawArgs.push('--agent', options.agentId);
    }
    const cwd = options?.workspacePath || os.homedir();
    const spawnChatProcess = deps.spawnChatProcess || spawn;
    const child = deps.runSpawn
      ? deps.runSpawn('openclaw', openclawArgs, { cwd, stdio: 'pipe', windowsHide: true })
      : (() => {
          const enhancedPath = deps.getEnhancedPath();
          return process.platform === 'win32'
            ? spawnChatProcess(deps.wrapWindowsCommand(command), [], { cwd, shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' } })
            : spawnChatProcess('/bin/bash', ['--norc', '--noprofile', '-c', `export PATH="${enhancedPath}"; ${command}`], { cwd, env: { ...process.env, PATH: enhancedPath } });
        })();

    const isNoiseLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return true;
      if (trimmed.startsWith('[')) return true;
      if (trimmed.startsWith('Config')) return true;
      if (trimmed.startsWith('Registered')) return true;
      if (trimmed.includes('plugin')) return true;
      if (/^gateway connect failed:/i.test(trimmed)) return true;
      if (/^Gateway agent failed; falling back to embedded:/i.test(trimmed)) return true;
      if (/^Gateway target:/i.test(trimmed)) return true;
      if (/^Source:/i.test(trimmed)) return true;
      if (/^Bind:/i.test(trimmed)) return true;
      if (/^Config:\s+/i.test(trimmed)) return true;
      return false;
    };

    const flushChunk = (chunk: string, fromStderr: boolean) => {
      const normalized = deps.stripAnsi(chunk).replace(/\r/g, '');
      const current = fromStderr ? stderrRemainder : stdoutRemainder;
      const merged = `${current}${normalized}`;
      const lines = merged.split('\n');
      const trailing = lines.pop() ?? '';
      if (fromStderr) stderrRemainder = trailing;
      else stdoutRemainder = trailing;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!isNoiseLine(trimmed)) {
          collectedLines.push(trimmed);
          send('chat:stream', `${trimmed}\n`);
        }
      }
    };

    const flushRemainder = (fromStderr: boolean) => {
      const line = (fromStderr ? stderrRemainder : stdoutRemainder).trim();
      if (fromStderr) stderrRemainder = '';
      else stdoutRemainder = '';
      if (!line) return;
      if (!isNoiseLine(line)) {
        collectedLines.push(line);
        send('chat:stream', `${line}\n`);
      }
    };

    activeChatChild = child;
    child.stdout?.on('data', (data: Buffer) => {
      flushChunk(data.toString(), false);
    });
    child.stderr?.on('data', (data: Buffer) => {
      flushChunk(data.toString(), true);
    });
    child.on('exit', () => {
      activeChatChild = null;
      flushRemainder(false);
      flushRemainder(true);
      send('chat:stream-end', {});
      const clean = collectedLines.join('\n').trim();
      const shouldFlagUnverifiedLocalFileOperation = looksLikeFilesystemMutationRequest(requestMessage)
        && looksLikeSuccessfulFilesystemMutationResponse(clean);
      const shouldFlagVpnDnsCompatibilityIssue = looksLikeWebOperationRequest(requestMessage)
        && looksLikeSpecialUseIpWebBlock(clean);
      if (shouldFlagUnverifiedLocalFileOperation) {
        console.warn('[chat] CLI fallback produced an unverified local filesystem success claim', {
          sessionId: sid,
          responsePreview: clean.slice(0, 200),
        });
      }
      if (shouldFlagVpnDnsCompatibilityIssue) {
        console.warn('[chat] CLI fallback indicates VPN/DNS special-use IP compatibility issue', {
          sessionId: sid,
          responsePreview: clean.slice(0, 200),
        });
      }
      resolve({
        success: true,
        text: clean || 'No response',
        sessionId: sid,
        unverifiedLocalFileOperation: shouldFlagUnverifiedLocalFileOperation || undefined,
        vpnDnsCompatibilityIssue: shouldFlagVpnDnsCompatibilityIssue || undefined,
      });
    });
    child.on('error', (err) => resolve({ success: false, error: String(err), sessionId: sid }));
    setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ success: false, error: 'Response timeout', sessionId: sid });
    }, CHAT_TIMEOUT_MS);
  });
}