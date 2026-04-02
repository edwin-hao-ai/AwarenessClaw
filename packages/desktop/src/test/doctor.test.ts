import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDoctor } from '../../electron/doctor';

const tempDirs: string[] = [];

function createTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'awarenessclaw-doctor-'));
  tempDirs.push(home);
  return home;
}

function createDoctorWithMocks(home: string, overrides?: {
  shellExec?: (cmd: string, timeout?: number) => Promise<string | null>;
  shellRun?: (cmd: string, timeout?: number) => Promise<string>;
  platform?: NodeJS.Platform;
}) {
  const shellExec = overrides?.shellExec || (async (cmd: string) => {
    if (cmd.includes('which -a node')) return '/usr/local/bin/node';
    if (cmd === 'node --version') return 'v23.11.0';
    if (cmd.includes('which -a openclaw')) return '/usr/local/bin/openclaw\n/opt/homebrew/bin/openclaw';
    if (cmd === 'openclaw --version') return 'OpenClaw 2026.3.31 (abcd123)';
    if (cmd === 'npm config get prefix') return '/usr/local';
    if (cmd.includes('openclaw agents bindings --json')) return '[]';
    return null;
  });

  const shellRun = overrides?.shellRun || vi.fn(async () => 'ok');

  return {
    doctor: createDoctor({
      shellExec,
      shellRun,
      homedir: home,
      platform: overrides?.platform || 'darwin',
    }),
    shellRun,
  };
}

describe('doctor', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('warns about duplicate command paths on macOS', async () => {
    const home = createTempHome();
    const { doctor } = createDoctorWithMocks(home);
    const report = await doctor.runChecks(['openclaw-command-health']);

    expect(report.checks[0]).toMatchObject({
      status: 'warn',
      fixable: 'auto',
    });
  });

  it('reinstalls OpenClaw when repairing duplicate command paths on macOS', async () => {
    const home = createTempHome();
    const shellRun = vi.fn(async () => 'installed');
    const { doctor } = createDoctorWithMocks(home, { shellRun });

    const result = await doctor.runFix('openclaw-command-health');

    expect(result).toMatchObject({ success: true });
    // Should use native npm install -g (no --prefix)
    const calls = shellRun.mock.calls.map((c: any) => c[0]);
    expect(calls.some((c: string) => c.includes('npm install -g') && c.includes('openclaw@latest'))).toBe(true);
    expect(calls.some((c: string) => c.includes('--prefix'))).toBe(false);
  });

  it('binds only channels that are still unbound', async () => {
    const home = createTempHome();
    const configDir = path.join(home, '.openclaw');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'openclaw.json'), JSON.stringify({
      channels: {
        telegram: { enabled: true },
        whatsapp: { enabled: true },
      },
    }));

    const shellRun = vi.fn(async () => 'bound');
    const shellExec = vi.fn(async (cmd: string) => {
      if (cmd.includes('which -a node')) return '/usr/local/bin/node';
      if (cmd === 'node --version') return 'v23.11.0';
      if (cmd.includes('which -a openclaw')) return '/usr/local/bin/openclaw';
      if (cmd === 'openclaw --version') return 'OpenClaw 2026.3.31 (abcd123)';
      if (cmd === 'npm config get prefix') return '/usr/local';
      if (cmd.includes('openclaw agents bindings --json')) {
        return JSON.stringify([{ match: { channel: 'telegram' } }]);
      }
      return null;
    });

    const { doctor } = createDoctorWithMocks(home, { shellExec, shellRun });
    const result = await doctor.runFix('channel-bindings');

    expect(result).toMatchObject({ success: true, message: 'Bound 1 channel(s) to main agent' });
    expect(shellRun).toHaveBeenCalledTimes(1);
    expect(shellRun).toHaveBeenCalledWith('openclaw agents bind --agent main --bind "whatsapp" 2>&1', 10000);
  });
});