/**
 * Register/unregister the Awareness local daemon as a system auto-start service.
 *
 * - macOS: ~/Library/LaunchAgents/com.awareness.local-daemon.plist
 * - Windows: schtasks scheduled task (runs at user logon)
 * - Linux: ~/.config/systemd/user/awareness-daemon.service
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

const LABEL = 'com.awareness.local-daemon';
const WIN_TASK_NAME = 'AwarenessLocalDaemon';

function findNpxPath(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function getDaemonArgs(homedir: string): string[] {
  const projectDir = path.join(homedir, '.openclaw');
  return ['-y', '@awareness-sdk/local@latest', 'start', '--port', '37800', '--project', projectDir, '--background'];
}

// ── macOS LaunchAgent ──────────────────────────────────────────────────────

function getMacPlistPath(): string {
  return path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

function generateMacPlist(npxPath: string, daemonArgs: string[]): string {
  const args = daemonArgs.map(a => `    <string>${a}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${npxPath}</string>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/awareness-daemon-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/awareness-daemon-stderr.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:${os.homedir()}/.npm-global/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>`;
}

async function enableMac(): Promise<void> {
  const plistPath = getMacPlistPath();
  const dir = path.dirname(plistPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const npxPath = findNpxPath();
  const daemonArgs = getDaemonArgs(os.homedir());
  fs.writeFileSync(plistPath, generateMacPlist(npxPath, daemonArgs), 'utf-8');

  // Load the agent (ignore error if already loaded)
  await runCommand('launchctl', ['load', '-w', plistPath]);
}

async function disableMac(): Promise<void> {
  const plistPath = getMacPlistPath();
  if (fs.existsSync(plistPath)) {
    await runCommand('launchctl', ['unload', '-w', plistPath]).catch(() => {});
    fs.unlinkSync(plistPath);
  }
}

function isEnabledMac(): boolean {
  return fs.existsSync(getMacPlistPath());
}

// ── Windows Scheduled Task ─────────────────────────────────────────────────

async function enableWindows(): Promise<void> {
  const npxPath = findNpxPath();
  const daemonArgs = getDaemonArgs(os.homedir());
  const fullCommand = `${npxPath} ${daemonArgs.join(' ')}`;

  await runCommand('schtasks', [
    '/Create', '/F',
    '/TN', WIN_TASK_NAME,
    '/SC', 'ONLOGON',
    '/TR', fullCommand,
    '/RL', 'LIMITED',
  ]);
}

async function disableWindows(): Promise<void> {
  await runCommand('schtasks', ['/Delete', '/TN', WIN_TASK_NAME, '/F']).catch(() => {});
}

async function isEnabledWindows(): Promise<boolean> {
  try {
    await runCommand('schtasks', ['/Query', '/TN', WIN_TASK_NAME]);
    return true;
  } catch {
    return false;
  }
}

// ── Linux systemd user service ─────────────────────────────────────────────

function getLinuxServicePath(): string {
  return path.join(os.homedir(), '.config', 'systemd', 'user', 'awareness-daemon.service');
}

function generateLinuxService(npxPath: string, daemonArgs: string[]): string {
  return `[Unit]
Description=Awareness Local Memory Daemon
After=network.target

[Service]
Type=simple
ExecStart=${npxPath} ${daemonArgs.join(' ')}
Restart=on-failure
RestartSec=10
Environment=PATH=/usr/local/bin:${os.homedir()}/.npm-global/bin:/usr/bin:/bin:${os.homedir()}/.nvm/versions/node/current/bin

[Install]
WantedBy=default.target
`;
}

async function enableLinux(): Promise<void> {
  const servicePath = getLinuxServicePath();
  const dir = path.dirname(servicePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const npxPath = findNpxPath();
  const daemonArgs = getDaemonArgs(os.homedir());
  fs.writeFileSync(servicePath, generateLinuxService(npxPath, daemonArgs), 'utf-8');

  await runCommand('systemctl', ['--user', 'daemon-reload']);
  await runCommand('systemctl', ['--user', 'enable', 'awareness-daemon.service']);
}

async function disableLinux(): Promise<void> {
  await runCommand('systemctl', ['--user', 'disable', 'awareness-daemon.service']).catch(() => {});
  const servicePath = getLinuxServicePath();
  if (fs.existsSync(servicePath)) fs.unlinkSync(servicePath);
  await runCommand('systemctl', ['--user', 'daemon-reload']).catch(() => {});
}

function isEnabledLinux(): boolean {
  return fs.existsSync(getLinuxServicePath());
}

// ── Platform dispatch ──────────────────────────────────────────────────────

export async function enableDaemonAutostart(): Promise<{ success: boolean; error?: string }> {
  try {
    switch (process.platform) {
      case 'darwin': await enableMac(); break;
      case 'win32': await enableWindows(); break;
      case 'linux': await enableLinux(); break;
      default: return { success: false, error: `Unsupported platform: ${process.platform}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function disableDaemonAutostart(): Promise<{ success: boolean; error?: string }> {
  try {
    switch (process.platform) {
      case 'darwin': await disableMac(); break;
      case 'win32': await disableWindows(); break;
      case 'linux': await disableLinux(); break;
      default: return { success: false, error: `Unsupported platform: ${process.platform}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) };
  }
}

export async function isDaemonAutostartEnabled(): Promise<boolean> {
  switch (process.platform) {
    case 'darwin': return isEnabledMac();
    case 'win32': return isEnabledWindows();
    case 'linux': return isEnabledLinux();
    default: return false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function runCommand(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}
