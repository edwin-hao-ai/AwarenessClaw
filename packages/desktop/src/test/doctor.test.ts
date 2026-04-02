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

  it('treats command path health as fixed when managed runtime exists', async () => {
    const home = createTempHome();
    const managedEntry = path.join(home, '.awareness-claw', 'openclaw-runtime', 'lib', 'node_modules', 'openclaw', 'openclaw.mjs');
    fs.mkdirSync(path.dirname(managedEntry), { recursive: true });
    fs.writeFileSync(managedEntry, '');

    const { doctor } = createDoctorWithMocks(home);
    const report = await doctor.runChecks(['openclaw-command-health']);
    expect(report.checks[0]).toMatchObject({
      status: 'pass',
      message: 'AwarenessClaw is pinned to its managed OpenClaw runtime',
    });
  });

  it('offers auto-fix for duplicate command paths on macOS', async () => {
    const home = createTempHome();
    const { doctor } = createDoctorWithMocks(home);
    const report = await doctor.runChecks(['openclaw-command-health']);

    expect(report.checks[0]).toMatchObject({
      status: 'warn',
      fixable: 'auto',
      fixDescription: 'Install and pin the AwarenessClaw managed OpenClaw runtime',
    });
  });

  it('installs managed OpenClaw runtime when repairing duplicate command paths on macOS', async () => {
    const home = createTempHome();
    const shellRun = vi.fn(async () => 'installed');
    const { doctor } = createDoctorWithMocks(home, { shellRun });

    const result = await doctor.runFix('openclaw-command-health');

    expect(result).toMatchObject({
      success: true,
      message: 'AwarenessClaw is now pinned to its managed OpenClaw runtime',
    });
    expect(shellRun).toHaveBeenCalledWith(expect.stringContaining('npm install -g --prefix'), 120000);
    expect(shellRun).toHaveBeenCalledWith(expect.stringContaining('openclaw@latest'), 120000);
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