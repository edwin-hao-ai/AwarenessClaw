import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import type { GatewayClient } from '../gateway-ws';
import { getExecApprovalSettings } from '../openclaw-config';

type ChatSendOptions = {
  thinkingLevel?: string;
  reasoningDisplay?: string;
  model?: string;
  files?: string[];
  workspacePath?: string;
  agentId?: string;
};

let activeChatChild: ReturnType<typeof spawn> | null = null;

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

function truncateDetail(text: string, maxChars = 600): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

function extractToolDetail(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? truncateDetail(trimmed) : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractToolDetail(entry))
      .filter((entry): entry is string => Boolean(entry));
    return parts.length > 0 ? truncateDetail(parts.join('\n')) : undefined;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const directKeys = ['text', 'output', 'stdout', 'stderr', 'message', 'detail', 'summary'];
    for (const key of directKeys) {
      const extracted = extractToolDetail(record[key]);
      if (extracted) return extracted;
    }
    if (Array.isArray(record.content)) {
      const contentParts = (record.content as unknown[])
        .map((entry) => {
          if (entry && typeof entry === 'object') {
            const block = entry as Record<string, unknown>;
            return extractToolDetail(block.text ?? block.content ?? block.output);
          }
          return extractToolDetail(entry);
        })
        .filter((entry): entry is string => Boolean(entry));
      if (contentParts.length > 0) return truncateDetail(contentParts.join('\n'));
    }
    try {
      return truncateDetail(JSON.stringify(record));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function registerChatHandlers(deps: {
  sendToRenderer: (channel: string, payload: any) => void;
  ensureGatewayRunning: () => Promise<{ ok: boolean; error?: string }>;
  prepareGatewayForChat?: () => Promise<{ ok: boolean; error?: string }>;
  prepareCliFallback?: () => Promise<void>;
  getGatewayWs: () => Promise<GatewayClient>;
  getConnectedGatewayWs: () => GatewayClient | null;
  callMcpStrict: (toolName: string, args: Record<string, any>) => Promise<any>;
  getEnhancedPath: () => string;
  wrapWindowsCommand: (command: string) => string;
  stripAnsi: (output: string) => string;
  spawnChatProcess?: typeof spawn;
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

  ipcMain.handle('chat:send', async (_e: any, message: string, sessionId?: string, options?: ChatSendOptions) => {
    const send = (channel: string, payload: any) => {
      deps.sendToRenderer(channel, payload);
    };

    const sid = sessionId || `ac-${Date.now()}`;

    let fullMessage = message;
    const homeDir = os.homedir();
    const desktopDir = path.join(homeDir, 'Desktop');
    const documentsDir = path.join(homeDir, 'Documents');
    const downloadsDir = path.join(homeDir, 'Downloads');
    const hostApprovals = getExecApprovalSettings(homeDir, options?.agentId || 'main');
    fullMessage = `[Local machine context] You are running inside the AwarenessClaw Desktop app on the user's own computer. When the user asks about local files or folders on this machine, do not answer with a generic safety/privacy refusal. Use the available tools (especially exec/read/write/edit when appropriate) to inspect or modify the local filesystem if the request is allowed by the current host approval policy. Common macOS folders for this user are: home=${homeDir}, desktop=${desktopDir}, documents=${documentsDir}, downloads=${downloadsDir}. If the user says "桌面", "desktop", or "我的桌面", resolve that to ${desktopDir}. If the user asks what files are there, inspect the directory first and report the actual result.

  [Current host exec approvals] security=${hostApprovals.security}, ask=${hostApprovals.ask}, askFallback=${hostApprovals.askFallback}, autoAllowSkills=${hostApprovals.autoAllowSkills ? 'on' : 'off'}. This current host approval state is authoritative for this turn. If earlier conversation turns claimed local filesystem access was blocked by allowlist/privacy rules, do not blindly repeat that claim. Re-evaluate the request against the current approval state above and use tools when allowed.

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
      fullMessage = `${parts.join('\n')}\n\n${message}`;
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
      return chatSendViaCli(fullMessage, sid, options, send, deps);
    }

    let fullResponseText = '';
    let chatEventHandler: ((payload: any) => void) | null = null;
    let allEventsHandler: ((evt: any) => void) | null = null;
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
      }, 120000);

      const seenToolIds = new Set<string>();
      const completedToolIds = new Set<string>();
      let lastThinkingText = '';
      let pendingApprovalRequestId = '';
      let pendingApprovalCommand = '';
      let pendingApprovalDetail = '';
      let sawAssistantDelta = false;
      let sawAssistantTextDelta = false;
      let sawAssistantNonTextDelta = false;
      let sawToolBlocks = false;
      let sawThinkingBlocks = false;
      let sawFinalState = false;
      let finalAssistantText = '';
      let finalAssistantContentTypes: string[] = [];

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

        if (eventName === 'agent') {
          const sessionKey = typeof payload?.sessionKey === 'string' ? payload.sessionKey : '';
          if (sessionKey && sessionKey !== sid) return;

          if (payload?.stream === 'tool') {
            const data = payload?.data || {};
            const phase = typeof data.phase === 'string' ? data.phase : '';
            const toolName = typeof data.name === 'string' ? data.name : 'tool';
            const toolId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
            if (!toolId) return;

            if (phase === 'start') {
              send('chat:status', {
                type: 'tool_call',
                tool: toolName,
                toolStatus: 'running',
                toolId,
                detail: extractToolDetail(data.args),
              });
              return;
            }

            if (phase === 'update') {
              send('chat:status', {
                type: 'tool_update',
                toolId,
                toolStatus: 'running',
                detail: extractToolDetail(data.partialResult),
              });
              return;
            }

            if (phase === 'result') {
              send('chat:status', {
                type: 'tool_update',
                toolId,
                toolStatus: data.isError ? 'failed' : 'completed',
                detail: extractToolDetail(data.result),
              });
            }
          }
        }
      };
      ws.on('gateway-event', allEventsHandler);

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

          if (Array.isArray(msg.content)) {
            for (const block of msg.content) {
              if (block.type === 'tool_use') {
                sawToolBlocks = true;
                const toolId = block.id || `tc-${Date.now()}`;
                if (!seenToolIds.has(toolId)) {
                  seenToolIds.add(toolId);
                  send('chat:status', { type: 'tool_call', tool: block.name || 'tool', toolStatus: 'running', toolId });
                }
              } else if (block.type === 'tool_result') {
                sawToolBlocks = true;
                const toolId = block.tool_use_id || '';
                if (toolId && !completedToolIds.has(toolId)) {
                  completedToolIds.add(toolId);
                  send('chat:status', { type: 'tool_update', toolId, toolStatus: 'completed' });
                }
              } else if (block.type === 'thinking' || block.type === 'reasoning') {
                sawThinkingBlocks = true;
                const text = block.thinking || block.reasoning || block.text || '';
                if (text && text !== lastThinkingText) {
                  lastThinkingText = text;
                  send('chat:status', { type: 'thinking' });
                  send('chat:thinking', text);
                }
              }
            }
          }

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
        agentId: options?.agentId && options.agentId !== 'main' ? options.agentId : undefined,
      });

      await chatDone;

      ws.removeListener('event:chat', chatEventHandler);
      ws.removeListener('gateway-event', allEventsHandler);

      const text = fullResponseText.trim() || finalAssistantText || '';
      send('chat:stream-end', {});

      if (!text && !pendingApprovalRequestId) {
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

      const parseMcpTextPayload = (mcpResponse: any) => {
        const textPayload = mcpResponse?.result?.content?.[0]?.text;
        if (!textPayload || typeof textPayload !== 'string') return {};
        try {
          return JSON.parse(textPayload);
        } catch {
          return {};
        }
      };

      if (text) {
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
          content: `Request: ${message}\nResult: ${text}`,
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

      if (!text && pendingApprovalRequestId) {
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

      return { success: true, text: text || 'No response', sessionId: sid };
    } catch (err: any) {
      if (ws) {
        if (chatEventHandler) ws.removeListener('event:chat', chatEventHandler);
        if (allEventsHandler) ws.removeListener('gateway-event', allEventsHandler);
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
        return chatSendViaCli(fullMessage, sid, options, send, deps);
      }
      return { success: false, text: '', error: errorMsg, sessionId: sid };
    }
  });
}

async function chatSendViaCli(
  requestMessage: string,
  sid: string,
  options: ChatSendOptions | undefined,
  send: (channel: string, payload: any) => void,
  deps: {
    getEnhancedPath: () => string;
    wrapWindowsCommand: (command: string) => string;
    stripAnsi: (output: string) => string;
    spawnChatProcess?: typeof spawn;
  },
): Promise<any> {
  return new Promise((resolve) => {
    let stdout = '';
    const thinkingFlag = options?.thinkingLevel && options.thinkingLevel !== 'off'
      ? ` --thinking ${options.thinkingLevel}` : '';
    const agentFlag = options?.agentId && options.agentId !== 'main' ? ` --agent "${options.agentId}"` : '';
    const escapedMsg = requestMessage.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\\$').replace(/`/g, '\\`');
    // Note: openclaw CLI does not support --reasoning flag; reasoning is controlled via
    // openclaw.json agents.defaults.reasoningDefault (set in syncToOpenClaw)
    const command = `openclaw agent --session-id "${sid}" -m "${escapedMsg}" --verbose full${thinkingFlag}${agentFlag}`;
    const enhancedPath = deps.getEnhancedPath();
    const spawnChatProcess = deps.spawnChatProcess || spawn;
    const child = process.platform === 'win32'
      ? spawnChatProcess(deps.wrapWindowsCommand(command), [], { cwd: options?.workspacePath || os.homedir(), shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' } })
      : spawnChatProcess('/bin/bash', ['--norc', '--noprofile', '-c', `export PATH="${enhancedPath}"; ${command}`], { cwd: options?.workspacePath || os.homedir(), env: { ...process.env, PATH: enhancedPath } });

    activeChatChild = child;
    child.stdout?.on('data', (data: Buffer) => {
      const chunk = deps.stripAnsi(data.toString()).replace(/\r/g, '');
      stdout += chunk;
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('[') && !trimmed.startsWith('Config') && !trimmed.startsWith('Registered') && !trimmed.includes('plugin')) {
          send('chat:stream', `${trimmed}\n`);
        }
      }
    });
    child.stderr?.on('data', () => {});
    child.on('exit', () => {
      activeChatChild = null;
      send('chat:stream-end', {});
      const clean = stdout.split('\n').filter((line) => line.trim() && !line.trim().startsWith('[') && !line.includes('Config') && !line.includes('plugin')).join('\n').trim();
      resolve({ success: true, text: clean || 'No response', sessionId: sid });
    });
    child.on('error', (err) => resolve({ success: false, error: String(err), sessionId: sid }));
    setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ success: false, error: 'Response timeout', sessionId: sid });
    }, 120000);
  });
}