import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { ipcMain } from 'electron';
import type { GatewayClient } from '../gateway-ws';

type ChatSendOptions = {
  thinkingLevel?: string;
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

export function registerChatHandlers(deps: {
  sendToRenderer: (channel: string, payload: any) => void;
  ensureGatewayRunning: () => Promise<{ ok: boolean; error?: string }>;
  getGatewayWs: () => Promise<GatewayClient>;
  getConnectedGatewayWs: () => GatewayClient | null;
  callMcpStrict: (toolName: string, args: Record<string, any>) => Promise<any>;
  getEnhancedPath: () => string;
  wrapWindowsCommand: (command: string) => string;
  stripAnsi: (output: string) => string;
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

    const gatewayReady = await deps.ensureGatewayRunning();
    if (!gatewayReady.ok) {
      return { success: false, text: '', error: gatewayReady.error || 'Gateway failed to start. Please check Settings → Gateway and try again.' };
    }

    const sid = sessionId || `ac-${Date.now()}`;

    let fullMessage = message;
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
      fullMessage = `[Current project directory: ${requestedWorkspace}] (use this as base for relative file paths)\n${fullMessage}`;
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
        const preview = JSON.stringify(evt?.payload || evt).slice(0, 800);
        send('chat:debug', `[gw:${eventName}] ${preview}`);

        if (eventName.endsWith('.approval.requested')) {
          const request = evt?.payload?.request || {};
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
      });

      await chatDone;

      ws.removeListener('event:chat', chatEventHandler);
      ws.removeListener('gateway-event', allEventsHandler);

      const text = fullResponseText.trim() || '';
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
        return chatSendViaCli(message, sid, options, send, deps);
      }
      return { success: false, text: '', error: errorMsg, sessionId: sid };
    }
  });
}

async function chatSendViaCli(
  message: string,
  sid: string,
  options: ChatSendOptions | undefined,
  send: (channel: string, payload: any) => void,
  deps: {
    getEnhancedPath: () => string;
    wrapWindowsCommand: (command: string) => string;
    stripAnsi: (output: string) => string;
  },
): Promise<any> {
  return new Promise((resolve) => {
    let stdout = '';
    const thinkingFlag = options?.thinkingLevel && options.thinkingLevel !== 'off'
      ? ` --thinking ${options.thinkingLevel}` : '';
    const agentFlag = options?.agentId && options.agentId !== 'main' ? ` --agent "${options.agentId}"` : '';
    const escapedMsg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\\$').replace(/`/g, '\\`');
    const command = `openclaw agent --session-id "${sid}" -m "${escapedMsg}" --verbose on${thinkingFlag}${agentFlag}`;
    const enhancedPath = deps.getEnhancedPath();
    const child = process.platform === 'win32'
      ? spawn(deps.wrapWindowsCommand(command), [], { cwd: os.homedir(), shell: 'cmd.exe', env: { ...process.env, PATH: enhancedPath, NO_COLOR: '1', FORCE_COLOR: '0' } })
      : spawn('/bin/bash', ['--norc', '--noprofile', '-c', `export PATH="${enhancedPath}"; ${command}`], { cwd: os.homedir(), env: { ...process.env, PATH: enhancedPath } });

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