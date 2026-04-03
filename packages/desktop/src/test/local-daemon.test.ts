import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

import { startLocalDaemonDetached } from '../../electron/local-daemon';

function createChild(outcome: 'spawn' | 'error', errorCode = 'ENOENT') {
  const child = new EventEmitter() as EventEmitter & {
    unref: ReturnType<typeof vi.fn>;
    removeListener: EventEmitter['removeListener'];
  };

  child.unref = vi.fn();

  queueMicrotask(() => {
    if (outcome === 'spawn') {
      child.emit('spawn');
      return;
    }

    const err = new Error('spawn failed') as Error & { code?: string };
    err.code = errorCode;
    child.emit('error', err);
  });

  return child;
}

describe('startLocalDaemonDetached', () => {
  it('uses the bundled npm CLI first on Windows', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runSpawn = vi.fn((cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return createChild('spawn');
    });

    await startLocalDaemonDetached({
      homedir: 'C:/Users/tester',
      resolveBundledCache: () => null,
      getBundledNpmBin: (binName) => binName === 'npx' ? 'C:/npm/bin/npx-cli.js' : null,
      runSpawn,
      getEnhancedPath: () => 'C:/node',
    });

    if (process.platform === 'win32') {
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toBe('node');
      expect(calls[0]?.args[0]).toBe('C:/npm/bin/npx-cli.js');
      expect(calls[0]?.args).toContain('@awareness-sdk/local@latest');
      return;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('npx');
  });

  it('falls back to cmd.exe npx on Windows when bundled npm CLI is unavailable', async () => {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    const runSpawn = vi.fn((cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      return createChild('spawn');
    });

    await startLocalDaemonDetached({
      homedir: 'C:/Users/tester',
      resolveBundledCache: () => null,
      getBundledNpmBin: () => null,
      runSpawn,
      getEnhancedPath: () => 'C:/node',
    });

    if (process.platform === 'win32') {
      expect(calls).toHaveLength(1);
      expect(calls[0]?.cmd).toBe('cmd.exe');
      expect(calls[0]?.args.slice(0, 3)).toEqual(['/d', '/c', 'npx']);
      return;
    }

    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe('npx');
  });
});