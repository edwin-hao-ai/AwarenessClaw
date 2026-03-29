/**
 * Environment detection — OS, architecture, Node.js, OpenClaw, existing config
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, platform, arch } from 'node:os';

export async function detectEnvironment() {
  const os = platform();
  const cpuArch = arch();
  const home = homedir();

  const env = {
    os,
    arch: cpuArch,
    home,
    nodeVersion: process.version,
    openclawInstalled: false,
    openclawVersion: null,
    openclawConfigPath: join(home, '.openclaw', 'openclaw.json'),
    awarenessConfigPath: join(home, '.awareness', 'credentials.json'),
    hasExistingConfig: false,
    hasAwarenessPlugin: false,
  };

  // Detect OpenClaw
  try {
    const version = execSync('openclaw --version', { encoding: 'utf8', timeout: 5000 }).trim();
    env.openclawInstalled = true;
    env.openclawVersion = version;
    console.log(`✅ OpenClaw detected: ${version}`);
  } catch {
    console.log('📦 OpenClaw not found, will install...');
  }

  // Check existing config
  if (existsSync(env.openclawConfigPath)) {
    env.hasExistingConfig = true;
    try {
      const config = JSON.parse(readFileSync(env.openclawConfigPath, 'utf8'));
      if (config?.plugins?.['openclaw-memory']) {
        env.hasAwarenessPlugin = true;
        console.log('✅ Awareness plugin already configured');
      }
    } catch { /* ignore parse errors */ }
  }

  return env;
}
