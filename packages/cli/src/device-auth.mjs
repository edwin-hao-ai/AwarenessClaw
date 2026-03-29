/**
 * Device authentication flow — browser-based OAuth for Awareness cloud
 */

import { get, request } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';

const API_BASE = 'https://awareness.market/api/v1';

export async function runDeviceAuth({ skip = false } = {}) {
  if (skip) {
    console.log('⏭️  Skipping cloud auth (local-only mode)\n');
    return {};
  }

  console.log('🔐 Connecting to Awareness cloud (optional)...');
  console.log('   Skip this step? Press Ctrl+C and re-run with --skip-auth\n');

  // Step 1: Init device auth
  const initRes = await httpPost(`${API_BASE}/auth/device/init`, {});
  const { device_code, user_code, verification_url } = initRes;

  console.log(`\n  📱 Open this URL in your browser:\n`);
  console.log(`     ${verification_url}\n`);
  console.log(`  🔑 Enter code: ${user_code}\n`);

  // Try to open browser automatically
  try {
    const openCmd = process.platform === 'darwin' ? 'open'
      : process.platform === 'win32' ? 'start'
      : 'xdg-open';
    execSync(`${openCmd} "${verification_url}"`, { stdio: 'ignore' });
  } catch { /* browser open is best-effort */ }

  // Step 2: Poll for approval
  console.log('  ⏳ Waiting for approval...');
  const credentials = await pollForApproval(device_code);

  // Step 3: Save credentials
  const credDir = join(homedir(), '.awareness');
  mkdirSync(credDir, { recursive: true });
  writeFileSync(
    join(credDir, 'credentials.json'),
    JSON.stringify(credentials, null, 2)
  );

  console.log('✅ Cloud authentication successful!\n');
  return credentials;
}

async function pollForApproval(deviceCode, maxAttempts = 60) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await httpPost(`${API_BASE}/auth/device/poll`, {
        device_code: deviceCode,
      });
      if (res.api_key) {
        return {
          apiKey: res.api_key,
          memoryId: res.memory_id,
          userId: res.user_id,
        };
      }
    } catch { /* keep polling */ }
  }
  throw new Error('Authentication timed out. Please try again.');
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);
    const req = request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch { reject(new Error(`Invalid response: ${chunks}`)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
