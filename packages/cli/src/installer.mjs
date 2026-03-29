/**
 * OpenClaw installer — downloads and installs OpenClaw using official scripts
 */

import { execSync } from 'node:child_process';

const INSTALL_URLS = {
  darwin: 'https://openclaw.ai/install.sh',
  linux: 'https://openclaw.ai/install.sh',
  win32: 'https://openclaw.ai/install.ps1',
};

const NPM_MIRRORS = [
  null, // default registry
  'https://registry.npmmirror.com',
  'https://mirrors.huaweicloud.com/repository/npm/',
];

export async function installOpenClaw(env) {
  console.log('\n📦 Installing OpenClaw...\n');

  // Try npm global install first (works cross-platform)
  for (const mirror of NPM_MIRRORS) {
    try {
      const registryFlag = mirror ? ` --registry=${mirror}` : '';
      console.log(`  Trying${mirror ? ` (mirror: ${mirror})` : ' (default registry)'}...`);
      execSync(`npm install -g openclaw${registryFlag}`, {
        encoding: 'utf8',
        timeout: 120000,
        stdio: 'pipe',
      });
      console.log('✅ OpenClaw installed successfully!\n');
      return;
    } catch {
      continue;
    }
  }

  // Fallback: official install script
  const scriptUrl = INSTALL_URLS[env.os];
  if (!scriptUrl) {
    throw new Error(`Unsupported platform: ${env.os}. Please install OpenClaw manually.`);
  }

  try {
    if (env.os === 'win32') {
      execSync(`powershell -Command "irm ${scriptUrl} | iex"`, {
        encoding: 'utf8',
        timeout: 180000,
        stdio: 'inherit',
      });
    } else {
      execSync(`curl -fsSL ${scriptUrl} | bash`, {
        encoding: 'utf8',
        timeout: 180000,
        stdio: 'inherit',
      });
    }
    console.log('✅ OpenClaw installed successfully!\n');
  } catch (err) {
    throw new Error(
      `Failed to install OpenClaw. Please install manually:\n` +
      `  https://docs.openclaw.ai/install\n` +
      `  Error: ${err.message}`
    );
  }
}
