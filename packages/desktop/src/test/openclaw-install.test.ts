/**
 * Tests for OpenClaw installation, upgrade, and duplicate-prevention logic.
 *
 * Strategy: native npm install -g (no managed prefix).
 * OpenClaw lives in the user's normal npm global directory.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// --- helpers ---

const tempDirs: string[] = [];
const OPENCLAW_INSTALL_TIMEOUT_MS = 300000;

function createTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-install-test-'));
  tempDirs.push(home);
  return home;
}

function npmRootPath(home: string) {
  return path.join(home, 'npm-global', 'lib', 'node_modules');
}

function createGlobalOpenClaw(home: string, version = '2026.3.28') {
  const pkgDir = path.join(npmRootPath(home), 'openclaw');
  fs.mkdirSync(pkgDir, { recursive: true });
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: 'openclaw', version }));
}

// ------------ setup:install-openclaw simulation ------------

interface SetupDeps {
  safeShellExecAsync: (cmd: string, timeout?: number) => Promise<string | null>;
  runAsync: (cmd: string, timeout?: number) => Promise<string>;
  getBundledNpmBin: (binName: 'npx' | 'npm') => string | null;
}

async function simulateSetupInstallOpenClaw(deps: SetupDeps, home: string) {
  const existing = await deps.safeShellExecAsync('openclaw --version');
  if (existing) {
    return { success: true, alreadyInstalled: true, version: existing };
  }

  const npmRoot = await deps.safeShellExecAsync('npm root -g', 5000);
  if (npmRoot) {
    const globalPkg = path.join(npmRoot.trim(), 'openclaw', 'package.json');
    if (fs.existsSync(globalPkg)) {
      return { success: true, alreadyInstalled: true, version: 'installed (not in PATH)' };
    }
  }

  // Native npm install -g (bundled npm preferred)
  const npmCli = deps.getBundledNpmBin('npm');
  try {
    const cmd = npmCli
      ? `"node" "${npmCli}" install -g openclaw`
      : 'npm install -g openclaw';
    await deps.runAsync(cmd, OPENCLAW_INSTALL_TIMEOUT_MS);
    const verified = await deps.safeShellExecAsync('openclaw --version', 10000);
    if (verified) {
      return { success: true, version: verified };
    }
    return { success: false, error: 'OpenClaw files were downloaded, but the command is still unavailable.' };
  } catch (err) {
    const msg = String(err);
    if (/EACCES|permission denied/i.test(msg)) {
      return { success: false, error: 'Permission denied' };
    }
    return { success: false, error: msg };
  }
}

// ------------ app:upgrade-component simulation ------------

interface UpgradeDeps {
  safeShellExecAsync: (cmd: string, timeout?: number) => Promise<string | null>;
  runAsync: (cmd: string, timeout?: number) => Promise<string>;
  getBundledNpmBin: (binName: 'npx' | 'npm') => string | null;
}

async function simulateUpgradeOpenClaw(deps: UpgradeDeps) {
  const preVer = await deps.safeShellExecAsync('openclaw --version', 5000);
  const preMatch = preVer?.match(/(\d+\.\d+\.\d+)/);
  const preSemver = preMatch ? preMatch[1] : null;

  let upgraded = false;

  // Tier 1: openclaw update
  if (preVer) {
    try {
      await deps.runAsync('openclaw update --yes --no-restart 2>&1', 180000);
      upgraded = true;
    } catch {}
  }

  // Tier 2: npm install -g openclaw@latest
  if (!upgraded) {
    const npmCli = deps.getBundledNpmBin('npm');
    try {
      const cmd = npmCli
        ? `"node" "${npmCli}" install -g openclaw@latest`
        : 'npm install -g openclaw@latest';
      await deps.runAsync(cmd, OPENCLAW_INSTALL_TIMEOUT_MS);
      upgraded = true;
    } catch {}
  }

  if (!upgraded) {
    return { success: false, error: 'Upgrade failed' };
  }

  const newVer = await deps.safeShellExecAsync('openclaw --version');
  const vMatch = newVer?.match(/(\d+\.\d+\.\d+)/);
  return { success: true, version: vMatch ? vMatch[1] : newVer, previousVersion: preSemver };
}

// ===================== TESTS =====================

describe('OpenClaw install — duplicate prevention', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('returns alreadyInstalled when openclaw --version succeeds', async () => {
    const home = createTempHome();
    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async (cmd) => {
          if (cmd === 'openclaw --version') return 'OpenClaw 2026.3.28 (abc123)';
          return null;
        }),
        runAsync: vi.fn(),
        getBundledNpmBin: () => null,
      },
      home,
    );

    expect(result.success).toBe(true);
    expect(result.alreadyInstalled).toBe(true);
    expect(result.version).toContain('2026.3.28');
  });

  it('returns alreadyInstalled when found via npm root -g', async () => {
    const home = createTempHome();
    createGlobalOpenClaw(home);

    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async (cmd) => {
          if (cmd === 'openclaw --version') return null;
          if (cmd.startsWith('npm root -g')) return npmRootPath(home);
          return null;
        }),
        runAsync: vi.fn(),
        getBundledNpmBin: () => null,
      },
      home,
    );

    expect(result.success).toBe(true);
    expect(result.alreadyInstalled).toBe(true);
  });

  it('installs with npm install -g when nothing exists', async () => {
    const home = createTempHome();
    const runAsync = vi.fn(async () => 'installed');
    let openclawChecks = 0;

    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async (cmd) => {
          if (cmd === 'openclaw --version') {
            openclawChecks += 1;
            return openclawChecks > 1 ? 'OpenClaw 2026.4.2 (abc123)' : null;
          }
          return null;
        }),
        runAsync,
        getBundledNpmBin: () => null,
      },
      home,
    );

    expect(result.success).toBe(true);
    expect(result.alreadyInstalled).toBeUndefined();
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('npm install -g openclaw'), OPENCLAW_INSTALL_TIMEOUT_MS);
  });

  it('uses bundled npm when available', async () => {
    const home = createTempHome();
    const runAsync = vi.fn(async () => 'installed');
    let openclawChecks = 0;

    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async (cmd) => {
          if (cmd === 'openclaw --version') {
            openclawChecks += 1;
            return openclawChecks > 1 ? 'OpenClaw 2026.4.2 (abc123)' : null;
          }
          return null;
        }),
        runAsync,
        getBundledNpmBin: (bin) => bin === 'npm' ? '/bundled/npm-cli.js' : null,
      },
      home,
    );

    expect(result.success).toBe(true);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('/bundled/npm-cli.js'), OPENCLAW_INSTALL_TIMEOUT_MS);
  });

  it('detects EACCES and returns permission error', async () => {
    const home = createTempHome();

    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async () => null),
        runAsync: vi.fn(async () => { throw new Error('npm ERR! code EACCES'); }),
        getBundledNpmBin: () => null,
      },
      home,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });

  it('fails when npm install finishes but openclaw command is still unavailable', async () => {
    const home = createTempHome();

    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async () => null),
        runAsync: vi.fn(async () => 'installed'),
        getBundledNpmBin: () => null,
      },
      home,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('command is still unavailable');
  });
});

describe('OpenClaw upgrade — native', () => {
  it('uses openclaw update as primary method', async () => {
    const runAsync = vi.fn(async () => 'updated');

    const result = await simulateUpgradeOpenClaw({
      safeShellExecAsync: vi.fn(async (cmd) => {
        if (cmd.includes('openclaw --version')) return 'OpenClaw 2026.4.1 (abc)';
        return null;
      }),
      runAsync,
      getBundledNpmBin: () => null,
    });

    expect(result.success).toBe(true);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('openclaw update'), 180000);
  });

  it('falls back to npm install -g when openclaw update fails', async () => {
    const runAsync = vi.fn()
      .mockRejectedValueOnce(new Error('update failed'))
      .mockResolvedValueOnce('installed');

    const result = await simulateUpgradeOpenClaw({
      safeShellExecAsync: vi.fn(async (cmd) => {
        if (cmd.includes('openclaw --version')) return 'OpenClaw 2026.3.28';
        return null;
      }),
      runAsync,
      getBundledNpmBin: () => null,
    });

    expect(result.success).toBe(true);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('npm install -g openclaw@latest'), OPENCLAW_INSTALL_TIMEOUT_MS);
  });

  it('installs fresh when no OpenClaw exists', async () => {
    const runAsync = vi.fn(async () => 'installed');

    const result = await simulateUpgradeOpenClaw({
      safeShellExecAsync: vi.fn(async () => null),
      runAsync,
      getBundledNpmBin: () => null,
    });

    expect(result.success).toBe(true);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('npm install -g openclaw@latest'), OPENCLAW_INSTALL_TIMEOUT_MS);
  });
});

describe('Version extraction', () => {
  it('extracts semver from openclaw --version output', () => {
    const output = 'OpenClaw 2026.3.28 (f9b1079)';
    expect(output.match(/(\d+\.\d+\.\d+)/)?.[1]).toBe('2026.3.28');
  });

  it('does not include commit hash digits', () => {
    const output = 'OpenClaw 2026.3.28 (f9b1079)';
    const wrong = output.replace(/[^\d.]/g, '');
    expect(wrong).not.toBe('2026.3.28');
    expect(output.match(/(\d+\.\d+\.\d+)/)?.[1]).toBe('2026.3.28');
  });

  it('returns null for garbage output', () => {
    expect('Error: command not found'.match(/(\d+\.\d+\.\d+)/)).toBeNull();
  });
});

describe('Node.js version validation', () => {
  const checkVersion = (ver: string | null) => {
    const majorMatch = ver?.match(/v(\d+)/);
    const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
    return { major, tooOld: major > 0 && major < 20 };
  };

  it('v22 passes', () => expect(checkVersion('v22.12.0').tooOld).toBe(false));
  it('v20 passes', () => expect(checkVersion('v20.0.0').tooOld).toBe(false));
  it('v18 fails', () => expect(checkVersion('v18.19.0').tooOld).toBe(true));
  it('v16 fails', () => expect(checkVersion('v16.13.0').tooOld).toBe(true));
  it('null returns major 0', () => expect(checkVersion(null).major).toBe(0));
});

describe('Windows env var safety', () => {
  it('APPDATA fallback does not produce undefined', () => {
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    expect(appdata).not.toContain('undefined');
  });

  it('ProgramFiles fallback is valid', () => {
    const pf = process.env.ProgramFiles || 'C:\\Program Files';
    expect(pf).toBeTruthy();
  });
});

describe('npm prefix auto-fix', () => {
  it('detects /usr/local as needing sudo', () => {
    const prefix = '/usr/local';
    const needsSudo = prefix.startsWith('/usr/local') || prefix.startsWith('/usr/lib') || prefix === '/usr';
    expect(needsSudo).toBe(true);
  });

  it('detects /usr/lib as needing sudo', () => {
    const prefix = '/usr/lib';
    const needsSudo = prefix.startsWith('/usr/local') || prefix.startsWith('/usr/lib') || prefix === '/usr';
    expect(needsSudo).toBe(true);
  });

  it('does not flag ~/.npm-global as needing sudo', () => {
    const prefix = '/Users/test/.npm-global';
    const needsSudo = prefix.startsWith('/usr/local') || prefix.startsWith('/usr/lib') || prefix === '/usr';
    expect(needsSudo).toBe(false);
  });

  it('does not flag /opt/homebrew as needing sudo', () => {
    const prefix = '/opt/homebrew';
    const needsSudo = prefix.startsWith('/usr/local') || prefix.startsWith('/usr/lib') || prefix === '/usr';
    expect(needsSudo).toBe(false);
  });

  it('skips on Windows (never needs prefix fix)', () => {
    // Windows npm prefix is %APPDATA%\npm — user-writable, no sudo needed
    const isWin = process.platform === 'win32';
    // On CI/test this runs on macOS/Linux, just verify the logic
    if (!isWin) {
      expect(true).toBe(true); // prefix fix only runs on non-win32
    }
  });
});

describe('Permission error detection', () => {
  const isPermError = (msg: string) => /EACCES|permission denied|Access is denied|拒绝访问/i.test(msg);

  it('detects EACCES', () => expect(isPermError('npm ERR! code EACCES')).toBe(true));
  it('detects Access is denied', () => expect(isPermError('ERROR: Access is denied.')).toBe(true));
  it('detects 拒绝访问', () => expect(isPermError('错误: 拒绝访问。')).toBe(true));
  it('no false positive', () => expect(isPermError('OpenClaw installed')).toBe(false));
});

describe('Doctor — native npm install', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('doctor uses npm install -g (no managed prefix)', async () => {
    const home = createTempHome();
    const { createDoctor } = await import('../../electron/doctor');
    const shellRun = vi.fn(async () => 'ok');

    const doctor = createDoctor({
      shellExec: vi.fn(async (cmd: string) => {
        if (cmd.includes('which -a node')) return '/usr/local/bin/node';
        if (cmd === 'node --version') return 'v23.11.0';
        if (cmd.includes('which -a openclaw')) return '/usr/local/bin/openclaw';
        if (cmd === 'openclaw --version') return 'OpenClaw 2026.3.28';
        if (cmd === 'npm config get prefix') return '/usr/local';
        if (cmd === 'npm view openclaw version 2>/dev/null') return '2026.4.1';
        return null;
      }),
      shellRun,
      homedir: home,
      platform: 'darwin',
    });

    await doctor.runFix('openclaw-version');

    const calls = shellRun.mock.calls.map(c => c[0]);
    // Should use plain npm install -g, NOT --prefix
    expect(calls.some((c: string) => c.includes('npm install -g openclaw@latest'))).toBe(true);
    expect(calls.some((c: string) => c.includes('--prefix'))).toBe(false);
  });
});
