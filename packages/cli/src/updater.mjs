/**
 * Version checker — detects available updates for OpenClaw and Awareness plugin
 */

import { execSync } from 'node:child_process';

export async function checkUpdates() {
  try {
    const local = execSync('openclaw --version', { encoding: 'utf8', timeout: 5000 }).trim();
    const latest = execSync('npm view openclaw version', { encoding: 'utf8', timeout: 10000 }).trim();

    if (local !== latest) {
      console.log(`💡 OpenClaw update available: ${local} → ${latest}`);
      console.log(`   Run: openclaw upgrade\n`);
    }
  } catch { /* update check is best-effort */ }
}
