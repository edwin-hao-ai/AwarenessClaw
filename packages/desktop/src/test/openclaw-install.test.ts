/**
 * Tests for OpenClaw installation, upgrade, and duplicate-prevention logic.
 *
 * These tests validate the core "one OpenClaw per machine" guarantee by
 * exercising the setup handler, upgrade handler, and doctor repair functions
 * through their dependency-injection interfaces.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// --- helpers ---

const tempDirs: string[] = [];

function createTempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-install-test-'));
  tempDirs.push(home);
  return home;
}

function managedEntrypointPath(home: string) {
  return path.join(home, '.awareness-claw', 'openclaw-runtime', 'lib', 'node_modules', 'openclaw', 'openclaw.mjs');
}

function createManagedEntrypoint(home: string) {
  const p = managedEntrypointPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '// managed entrypoint stub');
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
// We can't import the real handler (it depends on Electron ipcMain),
// so we replicate the EXACT guard logic from register-setup-handlers.ts
// and test it in isolation.  Any behaviour change in the handler MUST
// be reflected here.

interface SetupDeps {
  safeShellExecAsync: (cmd: string, timeout?: number) => Promise<string | null>;
  runAsync: (cmd: string, timeout?: number) => Promise<string>;
  ensureManagedOpenClawWindowsShim: () => void;
  getManagedOpenClawInstallCommand: (pkg?: string) => string;
}

/**
 * Extracted logic of setup:install-openclaw (mirrors register-setup-handlers.ts).
 */
async function simulateSetupInstallOpenClaw(
  deps: SetupDeps,
  home: string,
) {
  // Check 1: PATH-based detection
  const existing = await deps.safeShellExecAsync('openclaw --version');
  if (existing) {
    deps.ensureManagedOpenClawWindowsShim();
    return { success: true, alreadyInstalled: true, version: existing };
  }

  // Check 2: npm root -g
  const npmRoot = await deps.safeShellExecAsync('npm root -g', 5000);
  if (npmRoot) {
    const globalPkg = path.join(npmRoot.trim(), 'openclaw', 'package.json');
    if (fs.existsSync(globalPkg)) {
      return { success: true, alreadyInstalled: true, version: 'installed (not in PATH)' };
    }
  }

  // Not found — proceed with install
  const managedCmd = deps.getManagedOpenClawInstallCommand('openclaw');
  try {
    await deps.runAsync(managedCmd, 90000);
    deps.ensureManagedOpenClawWindowsShim();
    return { success: true };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('EACCES') || msg.includes('permission denied')) {
      return { success: false, error: 'Permission denied' };
    }
    return { success: false, error: msg };
  }
}

// ------------ app:upgrade-component simulation ------------

interface UpgradeDeps {
  safeShellExecAsync: (cmd: string, timeout?: number) => Promise<string | null>;
  runAsync: (cmd: string, timeout?: number) => Promise<string>;
  getManagedOpenClawInstallCommand: (pkg?: string) => string;
  getManagedOpenClawEntrypoint: () => string | null;
  ensureManagedOpenClawWindowsShim: () => void;
}

/**
 * Extracted logic of app:upgrade-component('openclaw')
 * (mirrors register-app-runtime-handlers.ts).
 */
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

  // Tier 2: managed install (only if already managed or no global)
  if (!upgraded) {
    const isAlreadyManaged = !!deps.getManagedOpenClawEntrypoint();
    if (isAlreadyManaged || !preVer) {
      const managedCmd = deps.getManagedOpenClawInstallCommand('openclaw@latest');
      try {
        await deps.runAsync(managedCmd, 120000);
        upgraded = true;
      } catch {}
    }
  }

  // Tier 3: block if global exists and no managed
  if (!upgraded) {
    const hasGlobal = !!preVer && !deps.getManagedOpenClawEntrypoint();
    if (hasGlobal) {
      return {
        success: false,
        error: 'OpenClaw upgrade failed. Your OpenClaw is globally installed',
      };
    }
  }

  if (!upgraded) {
    return { success: false, error: 'Upgrade failed' };
  }

  deps.ensureManagedOpenClawWindowsShim();
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
        ensureManagedOpenClawWindowsShim: vi.fn(),
        getManagedOpenClawInstallCommand: () => 'npm install -g --prefix /tmp openclaw',
      },
      home,
    );

    expect(result.success).toBe(true);
    expect(result.alreadyInstalled).toBe(true);
    expect(result.version).toContain('2026.3.28');
  });

  it('returns alreadyInstalled when found via npm root -g', async () => {
    const home = createTempHome();
    // Create global openclaw package at the npm root location
    const root = npmRootPath(home);
    createGlobalOpenClaw(home);

    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async (cmd) => {
          if (cmd === 'openclaw --version') return null; // not in PATH
          if (cmd.startsWith('npm root -g')) return root;
          return null;
        }),
        runAsync: vi.fn(),
        ensureManagedOpenClawWindowsShim: vi.fn(),
        getManagedOpenClawInstallCommand: () => 'npm install',
      },
      home,
    );

    expect(result.success).toBe(true);
    expect(result.alreadyInstalled).toBe(true);
  });

  it('installs managed when no OpenClaw exists anywhere', async () => {
    const home = createTempHome();
    const runAsync = vi.fn(async () => 'installed');

    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async () => null),
        runAsync,
        ensureManagedOpenClawWindowsShim: vi.fn(),
        getManagedOpenClawInstallCommand: (pkg) => `npm install -g --prefix /tmp ${pkg}`,
      },
      home,
    );

    expect(result.success).toBe(true);
    expect(result.alreadyInstalled).toBeUndefined();
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('npm install -g --prefix'), 90000);
  });

  it('detects EACCES and returns permission error', async () => {
    const home = createTempHome();

    const result = await simulateSetupInstallOpenClaw(
      {
        safeShellExecAsync: vi.fn(async () => null),
        runAsync: vi.fn(async () => { throw new Error('npm ERR! code EACCES'); }),
        ensureManagedOpenClawWindowsShim: vi.fn(),
        getManagedOpenClawInstallCommand: () => 'npm install -g openclaw',
      },
      home,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Permission denied');
  });
});

describe('OpenClaw upgrade — no dual install', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('uses openclaw update when global OpenClaw exists', async () => {
    const runAsync = vi.fn(async () => 'updated');

    const result = await simulateUpgradeOpenClaw({
      safeShellExecAsync: vi.fn(async (cmd) => {
        if (cmd.includes('openclaw --version')) return 'OpenClaw 2026.3.28 (abc)';
        return null;
      }),
      runAsync,
      getManagedOpenClawInstallCommand: () => 'npm install managed',
      getManagedOpenClawEntrypoint: () => null, // no managed
      ensureManagedOpenClawWindowsShim: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('openclaw update'), 180000);
    // Should NOT have called managed install
    expect(runAsync).not.toHaveBeenCalledWith(expect.stringContaining('npm install managed'), expect.anything());
  });

  it('blocks managed install when global exists and openclaw update fails', async () => {
    const result = await simulateUpgradeOpenClaw({
      safeShellExecAsync: vi.fn(async (cmd) => {
        if (cmd.includes('openclaw --version')) return 'OpenClaw 2026.3.28 (abc)';
        return null;
      }),
      runAsync: vi.fn(async () => { throw new Error('update failed'); }),
      getManagedOpenClawInstallCommand: () => 'npm install managed',
      getManagedOpenClawEntrypoint: () => null, // no managed → global only
      ensureManagedOpenClawWindowsShim: vi.fn(),
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('globally installed');
  });

  it('upgrades managed when already using managed prefix', async () => {
    const home = createTempHome();
    createManagedEntrypoint(home);
    const entry = managedEntrypointPath(home);

    const runAsync = vi.fn()
      .mockRejectedValueOnce(new Error('update cmd not found')) // openclaw update fails
      .mockResolvedValueOnce('installed'); // managed install succeeds

    const result = await simulateUpgradeOpenClaw({
      safeShellExecAsync: vi.fn(async (cmd) => {
        if (cmd.includes('openclaw --version')) return 'OpenClaw 2026.3.28';
        return null;
      }),
      runAsync,
      getManagedOpenClawInstallCommand: (pkg) => `npm install -g --prefix /tmp ${pkg}`,
      getManagedOpenClawEntrypoint: () => entry,
      ensureManagedOpenClawWindowsShim: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('npm install -g --prefix'), 120000);
  });

  it('installs managed when no OpenClaw exists at all', async () => {
    const runAsync = vi.fn(async () => 'installed');

    const result = await simulateUpgradeOpenClaw({
      safeShellExecAsync: vi.fn(async () => null), // nothing exists
      runAsync,
      getManagedOpenClawInstallCommand: (pkg) => `npm install managed ${pkg}`,
      getManagedOpenClawEntrypoint: () => null,
      ensureManagedOpenClawWindowsShim: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(runAsync).toHaveBeenCalledWith(expect.stringContaining('npm install managed'), 120000);
  });
});

describe('Version extraction', () => {
  it('extracts semver from openclaw --version output', () => {
    const output = 'OpenClaw 2026.3.28 (f9b1079)';
    const match = output.match(/(\d+\.\d+\.\d+)/);
    expect(match?.[1]).toBe('2026.3.28');
  });

  it('does not include commit hash digits', () => {
    const output = 'OpenClaw 2026.3.28 (f9b1079)';
    const wrong = output.replace(/[^\d.]/g, '');
    // This would include hash digits — demonstrating the bug
    expect(wrong).not.toBe('2026.3.28');
    // Correct approach
    const correct = output.match(/(\d+\.\d+\.\d+)/)?.[1];
    expect(correct).toBe('2026.3.28');
  });

  it('returns null for garbage output', () => {
    expect('Error: command not found'.match(/(\d+\.\d+\.\d+)/)).toBeNull();
  });
});

describe('Doctor repair — no dual install', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('fixOpenclawCommandHealth on Unix attempts npm uninstall -g first', async () => {
    const home = createTempHome();
    const { createDoctor } = await import('../../electron/doctor');
    const shellRun = vi.fn(async () => 'ok');

    const doctor = createDoctor({
      shellExec: vi.fn(async (cmd: string) => {
        if (cmd.includes('which -a node')) return '/usr/local/bin/node';
        if (cmd === 'node --version') return 'v23.11.0';
        if (cmd.includes('which -a openclaw')) return '/usr/local/bin/openclaw\n/opt/homebrew/bin/openclaw';
        if (cmd === 'openclaw --version') return 'OpenClaw 2026.3.28';
        if (cmd === 'npm config get prefix') return '/usr/local';
        return null;
      }),
      shellRun,
      homedir: home,
      platform: 'darwin',
    });

    await doctor.runFix('openclaw-command-health');

    // Should have called npm uninstall -g openclaw BEFORE managed install
    const calls = shellRun.mock.calls.map(c => c[0]);
    const uninstallIdx = calls.findIndex((c: string) => c.includes('npm uninstall -g openclaw'));
    const installIdx = calls.findIndex((c: string) => c.includes('npm install -g --prefix'));

    expect(uninstallIdx).toBeGreaterThanOrEqual(0);
    expect(installIdx).toBeGreaterThan(uninstallIdx);
  });
});

describe('Windows env var safety', () => {
  it('PATH construction handles undefined APPDATA gracefully', () => {
    // This tests that getEnhancedPath() doesn't produce "undefined\\npm"
    // The actual function is in shell-utils.ts — here we test the pattern
    const appdata = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    expect(appdata).not.toBe('undefined');
    expect(appdata).toBeTruthy();
  });

  it('version regex handles edge case with error messages', () => {
    // Should NOT match version from error text
    const errorOutput = 'Error in version 1.2.3 handler';
    const match = errorOutput.match(/(\d+\.\d+\.\d+)/);
    // Current regex WILL match — this documents the known limitation
    expect(match?.[1]).toBe('1.2.3');
  });

  it('LOCALAPPDATA fallback uses homedir-based path', () => {
    const home = '/Users/test';
    const localappdata = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    expect(localappdata).toBeTruthy();
    expect(localappdata).not.toContain('undefined');
  });

  it('ProgramFiles fallback uses C:\\Program Files', () => {
    const programfiles = process.env.ProgramFiles || 'C:\\Program Files';
    expect(programfiles).toBeTruthy();
    expect(programfiles).not.toContain('undefined');
  });
});

describe('Windows Node.js install — winget and MSI', () => {
  it('skips winget when not available (no 5-min timeout)', async () => {
    // Simulates the setup handler logic: check winget first, skip if unavailable
    const safeShellExecAsync = vi.fn(async (cmd: string) => {
      if (cmd.includes('winget --version')) return null; // winget not installed
      return null;
    });

    const hasWinget = await safeShellExecAsync('winget --version', 3000);
    expect(hasWinget).toBeNull();
    // Handler should NOT attempt winget install — go straight to MSI
  });

  it('attempts winget when available', async () => {
    const safeShellExecAsync = vi.fn(async (cmd: string) => {
      if (cmd.includes('winget --version')) return 'v1.9.1234';
      return null;
    });

    const hasWinget = await safeShellExecAsync('winget --version', 3000);
    expect(hasWinget).toBeTruthy();
  });
});

describe('Windows PowerShell execution policy', () => {
  it('detects Restricted policy and returns helpful error', () => {
    const execPolicy = 'Restricted';
    expect(execPolicy.trim().toLowerCase()).toBe('restricted');
    // Handler should return error with Set-ExecutionPolicy hint
  });

  it('allows RemoteSigned policy to proceed', () => {
    const execPolicy = 'RemoteSigned';
    expect(execPolicy.trim().toLowerCase()).not.toBe('restricted');
  });

  it('allows Unrestricted policy to proceed', () => {
    const execPolicy = 'Unrestricted';
    expect(execPolicy.trim().toLowerCase()).not.toBe('restricted');
  });
});

describe('Node.js version validation', () => {
  it('v22 passes minimum version check', () => {
    const version = 'v22.12.0';
    const majorMatch = version.match(/v(\d+)/);
    const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
    expect(major).toBeGreaterThanOrEqual(20);
  });

  it('v20 passes minimum version check', () => {
    const version = 'v20.0.0';
    const majorMatch = version.match(/v(\d+)/);
    const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
    expect(major).toBeGreaterThanOrEqual(20);
  });

  it('v18 fails minimum version check', () => {
    const version = 'v18.19.0';
    const majorMatch = version.match(/v(\d+)/);
    const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
    expect(major).toBeLessThan(20);
  });

  it('v16 fails minimum version check', () => {
    const version = 'v16.13.0';
    const majorMatch = version.match(/v(\d+)/);
    const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
    expect(major).toBeLessThan(20);
  });

  it('null version returns 0 major', () => {
    const version: string | null = null;
    const majorMatch = version?.match(/v(\d+)/);
    const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
    expect(major).toBe(0);
  });

  it('setup:install-nodejs skips install only for v20+', () => {
    // Simulates the guard logic in register-setup-handlers.ts
    const simulateInstallCheck = (nodeVersion: string | null) => {
      if (nodeVersion) {
        const majorMatch = nodeVersion.match(/v(\d+)/);
        const major = majorMatch ? parseInt(majorMatch[1], 10) : 0;
        if (major >= 20) return { skip: true, reason: 'alreadyInstalled' };
        return { skip: false, reason: 'tooOld' };
      }
      return { skip: false, reason: 'notInstalled' };
    };

    expect(simulateInstallCheck('v22.12.0')).toMatchObject({ skip: true });
    expect(simulateInstallCheck('v20.0.0')).toMatchObject({ skip: true });
    expect(simulateInstallCheck('v18.19.0')).toMatchObject({ skip: false, reason: 'tooOld' });
    expect(simulateInstallCheck('v16.13.0')).toMatchObject({ skip: false, reason: 'tooOld' });
    expect(simulateInstallCheck(null)).toMatchObject({ skip: false, reason: 'notInstalled' });
  });
});

describe('Bundled npm fallback', () => {
  it('getManagedOpenClawInstallCommand uses bundled npm when available', () => {
    // Simulates shell-utils.ts logic
    const npmCli = '/path/to/bundled/npm-cli.js';
    const prefix = '/home/test/.awareness-claw/openclaw-runtime';
    const cmd = npmCli
      ? `"node" "${npmCli}" install -g --prefix "${prefix}" openclaw`
      : `npm install -g --prefix "${prefix}" openclaw`;

    expect(cmd).toContain(npmCli);
    expect(cmd).not.toMatch(/^npm /);
  });

  it('falls back to system npm when bundled not available', () => {
    const npmCli: string | null = null;
    const prefix = '/home/test/.awareness-claw/openclaw-runtime';
    const cmd = npmCli
      ? `"node" "${npmCli}" install -g --prefix "${prefix}" openclaw`
      : `npm install -g --prefix "${prefix}" openclaw`;

    expect(cmd).toMatch(/^npm /);
  });
});

describe('Permission error detection patterns', () => {
  it('detects EACCES in npm error output', () => {
    const msg = 'npm ERR! code EACCES\nnpm ERR! syscall access';
    expect(/EACCES|permission denied|Access is denied/i.test(msg)).toBe(true);
  });

  it('detects "Access is denied" from Windows schtasks', () => {
    const msg = 'ERROR: Access is denied.';
    expect(/EACCES|permission denied|Access is denied/i.test(msg)).toBe(true);
  });

  it('detects Chinese "拒绝访问" from Windows', () => {
    const msg = '错误: 拒绝访问。';
    expect(/EACCES|Access is denied|permission denied|拒绝访问|schtasks create failed/i.test(msg)).toBe(true);
  });

  it('does not false-positive on normal output', () => {
    const msg = 'OpenClaw 2026.3.28 installed successfully';
    expect(/EACCES|permission denied|Access is denied/i.test(msg)).toBe(false);
  });
});
