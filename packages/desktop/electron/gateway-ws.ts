/**
 * Gateway WebSocket Client
 *
 * Persistent WebSocket connection to the OpenClaw Gateway for:
 * - Non-blocking chat.send (immediate runId return)
 * - Real-time streaming via chat/agent events
 * - RPC-based chat.abort (graceful stop)
 * - chat.history for session sync
 * - sessions.list for channel session discovery
 * - Real-time event subscription for channel messages
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { WebSocket } from 'ws';
import { readJsonFileWithBom } from './json-file';

const HOME = os.homedir();

interface DeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

interface GatewayConfig {
  port: number;
  token: string;
}

interface RpcResponse {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: any;
  error?: { code: string; message: string; details?: any };
}

interface GatewayEvent {
  type: 'event';
  event: string;
  payload: any;
  seq?: number;
}

type GatewayMessage = RpcResponse | GatewayEvent | { type: string; [key: string]: any };

/**
 * Read gateway config from openclaw.json
 */
function readGatewayConfig(): GatewayConfig {
  try {
    const configPath = path.join(HOME, '.openclaw', 'openclaw.json');
    const config = readJsonFileWithBom<Record<string, any>>(configPath);
    const gw = config.gateway || {};
    return {
      port: gw.port || Number(process.env.OPENCLAW_GATEWAY_PORT) || 18789,
      token: String(process.env.OPENCLAW_GATEWAY_TOKEN || gw.auth?.token || '').trim(),
    };
  } catch {
    return { port: 18789, token: '' };
  }
}

/**
 * Load device identity for Gateway auth (Ed25519 keypair).
 */
function loadDeviceIdentity(): DeviceIdentity | null {
  try {
    const identityPath = path.join(HOME, '.openclaw', 'identity', 'device.json');
    const data = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
    if (data.deviceId && data.publicKeyPem && data.privateKeyPem) return data;
    return null;
  } catch {
    return null;
  }
}

/**
 * Build V3 device auth signature payload and sign it.
 */
function signDeviceAuth(
  identity: DeviceIdentity,
  nonce: string,
  config: GatewayConfig,
  clientId: string,
  clientMode: string,
  role: string,
  scopes: string[],
): { signature: string; signedAt: number } {
  const signedAt = Date.now();
  const payload = [
    'v3',
    identity.deviceId,
    clientId,
    clientMode,
    role,
    scopes.join(','),
    String(signedAt),
    config.token,
    nonce,
    process.platform,
    '', // deviceFamily
  ].join('|');
  const privateKey = crypto.createPrivateKey(identity.privateKeyPem);
  const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), privateKey);
  return { signature: sig.toString('base64url'), signedAt };
}

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private connected = false;
  private connId = '';
  private pendingRpc = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private rpcCounter = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private config: GatewayConfig = { port: 18789, token: '' };
  private destroyed = false;

  private static readonly CLIENT_ID = 'openclaw-control-ui';
  private static readonly CLIENT_MODE = 'ui';
  private static readonly ROLE = 'operator';
  private static readonly SCOPES = ['operator.admin', 'operator.write', 'operator.read'];

  /** Connect to Gateway with device identity auth. Resolves when hello-ok received. */
  async connect(): Promise<void> {
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) return;

    this.config = readGatewayConfig();
    const identity = loadDeviceIdentity();
    const url = `ws://127.0.0.1:${this.config.port}`;
    const origin = `http://127.0.0.1:${this.config.port}`;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url, { headers: { Origin: origin } });
      } catch (err) {
        return reject(new Error(`WebSocket creation failed: ${err}`));
      }

      const connectTimeout = setTimeout(() => {
        this.ws?.close();
        reject(new Error('Gateway connection timed out'));
      }, 10000);

      let challengeNonce: string | null = null;

      const onHandshakeMessage = (data: Buffer | string) => {
        try {
          const msg: GatewayMessage = JSON.parse(data.toString());

          // Capture challenge nonce for device identity signing
          if (msg.type === 'event' && (msg as GatewayEvent).event === 'connect.challenge') {
            challengeNonce = (msg as GatewayEvent).payload?.nonce || null;
            return;
          }

          if (msg.type === 'res') {
            const res = msg as RpcResponse;
            if (res.ok && res.payload?.type === 'hello-ok') {
              clearTimeout(connectTimeout);
              this.connected = true;
              this.connId = res.payload.server?.connId || '';
              this.ws!.removeListener('message', onHandshakeMessage);
              this.setupListeners();
              resolve();
            } else {
              clearTimeout(connectTimeout);
              reject(new Error(res.error?.message || 'Gateway connect failed'));
            }
          }
        } catch {
          // Ignore parse errors during handshake
        }
      };

      this.ws.on('open', () => {
        this.ws!.on('message', onHandshakeMessage);

        // Wait briefly for challenge nonce, then send connect with device identity
        const sendConnect = () => {
          const connectParams: any = {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: GatewayClient.CLIENT_ID,
              version: '1.0.0',
              platform: process.platform,
              mode: GatewayClient.CLIENT_MODE,
              displayName: 'AwarenessClaw Desktop',
            },
            role: GatewayClient.ROLE,
            scopes: GatewayClient.SCOPES,
          };

          // Add device identity if available and challenge nonce received
          if (identity && challengeNonce) {
            const { signature, signedAt } = signDeviceAuth(
              identity, challengeNonce, this.config,
              GatewayClient.CLIENT_ID, GatewayClient.CLIENT_MODE,
              GatewayClient.ROLE, GatewayClient.SCOPES,
            );
            connectParams.device = {
              id: identity.deviceId,
              publicKey: identity.publicKeyPem,
              signature,
              signedAt,
              nonce: challengeNonce,
            };
          }

          if (this.config.token) {
            connectParams.auth = { token: this.config.token };
          }

          this.ws!.send(JSON.stringify({
            type: 'req',
            id: this.nextId(),
            method: 'connect',
            params: connectParams,
          }));
        };

        // Challenge arrives as an event right after open — wait up to 3s for it.
        // Device identity auth REQUIRES the challenge nonce; without it, connect fails.
        const pollStart = Date.now();
        const poll = setInterval(() => {
          if (challengeNonce) {
            clearInterval(poll);
            sendConnect();
          } else if (Date.now() - pollStart > 3000) {
            // No challenge received — send connect without device identity (will likely fail,
            // but lets the error propagate to the caller instead of hanging)
            clearInterval(poll);
            sendConnect();
          }
        }, 50);
      });

      this.ws.on('error', (err) => {
        clearTimeout(connectTimeout);
        reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.emit('disconnected');
        if (!this.destroyed) this.scheduleReconnect();
      });
    });
  }

  private setupListeners() {
    if (!this.ws) return;

    this.ws.on('message', (data: Buffer | string) => {
      try {
        const msg: GatewayMessage = JSON.parse(data.toString());

        if (msg.type === 'res') {
          const res = msg as RpcResponse;
          const pending = this.pendingRpc.get(res.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRpc.delete(res.id);
            if (res.ok) pending.resolve(res.payload);
            else pending.reject(new Error(res.error?.message || 'RPC failed'));
          }
        } else if (msg.type === 'event') {
          const evt = msg as GatewayEvent;
          // Emit typed events for chat/agent streaming
          this.emit('gateway-event', evt);
          this.emit(`event:${evt.event}`, evt.payload);
        }
      } catch {
        // Ignore malformed messages
      }
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.destroyed) return;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try { await this.connect(); } catch { /* will retry on next call */ }
    }, 3000);
  }

  private nextId(): string {
    return `rpc-${++this.rpcCounter}-${Date.now()}`;
  }

  /** Send an RPC request and wait for response. */
  async rpc(method: string, params: any = {}, timeoutMs = 30000): Promise<any> {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const id = this.nextId();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRpc.delete(id);
        reject(new Error(`RPC ${method} timed out`));
      }, timeoutMs);

      this.pendingRpc.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ type: 'req', id, method, params }));
    });
  }

  /** Patch session-level settings (e.g. reasoningLevel, verboseLevel). */
  async sessionPatch(sessionKey: string, patch: Record<string, any>): Promise<any> {
    return this.rpc('sessions.patch', { key: sessionKey, ...patch }, 10000);
  }

  /** Send a chat message (non-blocking — Gateway queues if agent is busy). */
  async chatSend(sessionKey: string, text: string, options?: {
    thinking?: string;
    verbose?: string;
    reasoning?: string;
    attachments?: any[];
    agentId?: string;
  }): Promise<any> {
    // reasoning is set via sessions.patch (not chat.send, which has additionalProperties: false)
    if (options?.reasoning) {
      try { await this.sessionPatch(sessionKey, { reasoningLevel: options.reasoning }); } catch { /* best-effort */ }
    }
    if (options?.verbose) {
      try { await this.sessionPatch(sessionKey, { verboseLevel: options.verbose }); } catch { /* best-effort */ }
    }

    const params: any = {
      sessionKey,
      message: text,
      idempotencyKey: `ac-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    };
    if (options?.thinking) params.thinking = options.thinking;
    if (options?.attachments?.length) params.attachments = options.attachments;
    if (options?.agentId) params.agentId = options.agentId;
    // chat.send uses 120s timeout (agent may take a while with tool calls)
    return this.rpc('chat.send', params, 120000);
  }

  /** Abort the current run for a session. */
  async chatAbort(sessionKey: string, runId?: string): Promise<void> {
    await this.rpc('chat.abort', { sessionKey, ...(runId ? { runId } : {}) });
  }

  /** Get chat history for a session. */
  async chatHistory(sessionKey: string): Promise<any[]> {
    const result = await this.rpc('chat.history', { sessionKey });
    return result?.messages || [];
  }

  /** List all gateway sessions (includes channel sessions). */
  async sessionsList(): Promise<any> {
    return this.rpc('sessions.list', {}, 10000);
  }

  /** Get gateway health/status. */
  async status(): Promise<any> {
    return this.rpc('status', {}, 5000);
  }

  /** Clean up and close connection. */
  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const [, pending] of this.pendingRpc) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Client destroyed'));
    }
    this.pendingRpc.clear();
    this.ws?.close();
    this.ws = null;
    this.connected = false;
  }

  get isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }
}
