/**
 * Awareness plugin installation and configuration
 */

import { execSync } from 'node:child_process';

export async function installPlugin(env) {
  if (env.hasAwarenessPlugin) {
    console.log('✅ Awareness plugin already installed, skipping...\n');
    return;
  }

  console.log('🧠 Installing Awareness memory plugin...\n');

  try {
    execSync('openclaw plugins install @awareness-sdk/openclaw-memory', {
      encoding: 'utf8',
      timeout: 60000,
      stdio: 'pipe',
    });
    console.log('✅ Awareness memory plugin installed!\n');
  } catch {
    // Fallback: install via ClawHub skill
    console.log('  Trying ClawHub skill install...');
    try {
      execSync('npx clawhub@latest install awareness-memory --force', {
        encoding: 'utf8',
        timeout: 60000,
        stdio: 'pipe',
      });
      console.log('✅ Awareness memory skill installed via ClawHub!\n');
    } catch (err) {
      throw new Error(
        `Failed to install Awareness plugin.\n` +
        `  Please install manually: openclaw plugins install @awareness-sdk/openclaw-memory\n` +
        `  Error: ${err.message}`
      );
    }
  }
}
