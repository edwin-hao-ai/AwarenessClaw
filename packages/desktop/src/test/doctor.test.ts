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

  it('treats npm-global package as installed even if the shell shim is missing', async () => {
    const home = createTempHome();
    const npmRoot = path.join(home, 'npm-global', 'lib', 'node_modules');
    const openclawDir = path.join(npmRoot, 'openclaw');
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(path.join(openclawDir, 'package.json'), JSON.stringify({ name: 'openclaw', version: '2026.4.2' }));

    const shellExec = vi.fn(async (cmd: string) => {
      if (cmd.includes('which -a node')) return '/usr/local/bin/node';
      if (cmd === 'node --version') return 'v23.11.0';
      if (cmd.includes('which -a openclaw')) return null;
      if (cmd === 'openclaw --version') return 'OpenClaw 2026.4.2';
      if (cmd === 'npm root -g') return npmRoot;
      if (cmd === 'npm config get prefix') return '/usr/local';
      if (cmd.includes('openclaw agents bindings --json')) return '[]';
      return null;
    });

    const { doctor } = createDoctorWithMocks(home, { shellExec });
    const report = await doctor.runChecks(['openclaw-installed', 'openclaw-command-health']);

    expect(report.checks[0]).toMatchObject({ status: 'pass' });
    expect(report.checks[1]).toMatchObject({ status: 'warn', fixable: 'auto' });
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
    expect(shellRun).toHaveBeenCalledWith('openclaw agents bind --agent main --bind "whatsapp" 2>&1', 30000);
  });

  it('repairs telegram routing when channel is unknown before rebinding', async () => {
    const home = createTempHome();
    const configDir = path.join(home, '.openclaw');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'openclaw.json'), JSON.stringify({
      channels: {
        telegram: { enabled: true },
      },
    }));

    let bindAttempts = 0;
    const shellRun = vi.fn(async (cmd: string) => {
      if (cmd.startsWith('openclaw agents bind --agent main --bind "telegram"')) {
        bindAttempts += 1;
        if (bindAttempts === 1) throw new Error('Unknown channel: telegram');
      }
      return 'ok';
    });

    const shellExec = vi.fn(async (cmd: string) => {
      if (cmd.includes('which -a node')) return '/usr/local/bin/node';
      if (cmd === 'node --version') return 'v23.11.0';
      if (cmd.includes('which -a openclaw')) return '/usr/local/bin/openclaw';
      if (cmd === 'openclaw --version') return 'OpenClaw 2026.3.31 (abcd123)';
      if (cmd === 'npm config get prefix') return '/usr/local';
      if (cmd.includes('openclaw agents bindings --json')) return JSON.stringify([]);
      return null;
    });

    const { doctor } = createDoctorWithMocks(home, { shellExec, shellRun });
    const result = await doctor.runFix('channel-bindings');

    expect(result).toMatchObject({ success: true });
    expect(result.message).toContain('repaired: telegram');
    const calls = shellRun.mock.calls.map((c: any) => c[0]);
    expect(calls).toContain('openclaw plugins install "@openclaw/telegram" 2>&1');
    expect(calls).toContain('openclaw channels add --channel telegram 2>&1');
    expect(calls).toContain('openclaw gateway restart 2>&1');
    expect(bindAttempts).toBe(2);
  });
});