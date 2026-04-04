import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readJsonFileWithBomMock = vi.hoisted(() => vi.fn());
const fsReadFileSyncMock = vi.hoisted(() => vi.fn());
const wsInstances = vi.hoisted(() => [] as any[]);

vi.mock('os', () => ({
  homedir: () => 'C:\\Users\\test',
}));

vi.mock('fs', () => ({
  readFileSync: fsReadFileSyncMock,
}));

vi.mock('../../electron/json-file', () => ({
  readJsonFileWithBom: readJsonFileWithBomMock,
}));

vi.mock('ws', () => {
  const { EventEmitter } = require('events');

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = MockWebSocket.OPEN;
    url: string;
    options: Record<string, unknown>;
    sent: string[] = [];

    constructor(url: string, options: Record<string, unknown>) {
      super();
      this.url = url;
      this.options = options;
      wsInstances.push(this);
    }

    send(payload: string) {
      this.sent.push(payload);
    }

    close() {
      this.readyState = 3;
    }
  }

  return { WebSocket: MockWebSocket };
});

import { GatewayClient } from '../../electron/gateway-ws';

describe('GatewayClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    wsInstances.length = 0;
    readJsonFileWithBomMock.mockReset();
    fsReadFileSyncMock.mockReset();

    readJsonFileWithBomMock.mockReturnValue({
      gateway: {
        port: 18789,
        auth: {
          token: 'test-gateway-token',
        },
      },
    });

    fsReadFileSyncMock.mockImplementation((filePath: string) => {
      if (String(filePath).endsWith('device.json')) {
        throw new Error('ENOENT');
      }
      throw new Error(`Unexpected fs.readFileSync(${String(filePath)})`);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects over 127.0.0.1 loopback origin and forwards gateway auth token', async () => {
    const client = new GatewayClient();
    const connectPromise = client.connect();

    expect(wsInstances).toHaveLength(1);
    const ws = wsInstances[0];
    expect(ws.url).toBe('ws://127.0.0.1:18789');
    expect(ws.options).toMatchObject({
      headers: {
        Origin: 'http://127.0.0.1:18789',
      },
    });

    ws.emit('open');
    await vi.advanceTimersByTimeAsync(3100);

    expect(ws.sent).toHaveLength(1);
    const request = JSON.parse(ws.sent[0]);
    expect(request.method).toBe('connect');
    expect(request.params.auth).toEqual({ token: 'test-gateway-token' });
    expect(request.params.client.id).toBe('openclaw-control-ui');

    ws.emit('message', Buffer.from(JSON.stringify({
      type: 'res',
      id: 'rpc-1',
      ok: true,
      payload: {
        type: 'hello-ok',
        server: {
          connId: 'conn-1',
        },
      },
    })));

    await expect(connectPromise).resolves.toBeUndefined();
    expect(client.isConnected).toBe(true);
  });
});