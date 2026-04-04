import http from 'http';

export function callMcp(toolName: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve) => {
    const req = http.request('http://127.0.0.1:37800/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid JSON' }); }
      });
    });
    req.on('error', (err) => resolve({ error: String(err) }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.write(JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }));
    req.end();
  });
}

export function callMcpStrict(toolName: string, args: Record<string, any>): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request('http://127.0.0.1:37800/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          if (result?.error) {
            reject(new Error(typeof result.error === 'string' ? result.error : JSON.stringify(result.error)));
          } else {
            resolve(result);
          }
        } catch {
          reject(new Error('Invalid JSON from daemon'));
        }
      });
    });
    req.on('error', (err) => reject(new Error(`Daemon connection failed: ${err.message}`)));
    req.on('timeout', () => { req.destroy(); reject(new Error('Daemon request timed out')); });
    req.write(JSON.stringify({
      jsonrpc: '2.0', id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }));
    req.end();
  });
}

export type MemoryEventQueryOptions = {
  limit?: number;
  offset?: number;
  search?: string;
  type?: string;
  agent_role?: string;
  source?: string;
  source_exclude?: string;
};

export function fetchMemoryEvents(opts: MemoryEventQueryOptions): Promise<any> {
  const limit = opts?.limit || 50;
  const offset = opts?.offset || 0;
  const search = opts?.search || '';
  const typeFilter = opts?.type || '';
  const agentRoleFilter = opts?.agent_role || '';
  const sourceFilter = opts?.source || '';
  const sourceExclude = opts?.source_exclude || '';

  let endpoint: string;
  if (search) {
    const params = new URLSearchParams({ q: search, limit: String(limit) });
    if (typeFilter) params.set('type', typeFilter);
    if (agentRoleFilter) params.set('agent_role', agentRoleFilter);
    endpoint = `http://127.0.0.1:37800/api/v1/memories/search?${params.toString()}`;
  } else {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (typeFilter) params.set('type', typeFilter);
    if (agentRoleFilter) params.set('agent_role', agentRoleFilter);
    if (sourceFilter) params.set('source', sourceFilter);
    if (sourceExclude) params.set('source_exclude', sourceExclude);
    endpoint = `http://127.0.0.1:37800/api/v1/memories?${params.toString()}`;
  }

  return new Promise((resolve) => {
    const req = http.request(endpoint, { method: 'GET', timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid JSON' }); }
      });
    });
    req.on('error', (err: Error) => resolve({ error: String(err) }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.end();
  });
}

export function fetchKnowledgeCards(opts: { category?: string; limit?: number } = {}): Promise<any> {
  const params = new URLSearchParams();
  if (opts.category) params.set('category', opts.category);
  if (opts.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  const endpoint = `http://127.0.0.1:37800/api/v1/knowledge${qs ? `?${qs}` : ''}`;

  return new Promise((resolve) => {
    const req = http.request(endpoint, { method: 'GET', timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid JSON' }); }
      });
    });
    req.on('error', (err: Error) => resolve({ error: String(err) }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.end();
  });
}

export function fetchCardEvolution(cardId: string): Promise<any> {
  return new Promise((resolve) => {
    const req = http.request(`http://127.0.0.1:37800/api/v1/knowledge/${encodeURIComponent(cardId)}/evolution`, {
      method: 'GET', timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid JSON' }); }
      });
    });
    req.on('error', (err: Error) => resolve({ error: String(err) }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.end();
  });
}

export function checkMemoryHealth(): Promise<any> {
  return new Promise((resolve) => {
    const req = http.request('http://127.0.0.1:37800/healthz', { method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ error: 'Invalid JSON' }); }
      });
    });
    req.on('error', () => resolve({ error: 'Not running' }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'Timeout' }); });
    req.end();
  });
}