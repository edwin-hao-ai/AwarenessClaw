/**
 * Local Awareness daemon management
 */

import { spawn } from 'node:child_process';
import { get } from 'node:http';

const DAEMON_PORT = 37800;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const HEALTH_URL = `${DAEMON_URL}/healthz`;
const MAX_WAIT_MS = 15000;
const POLL_INTERVAL_MS = 500;

export async function startDaemon() {
  // Check if already running
  if (await isDaemonReady()) {
    console.log('✅ Awareness daemon already running\n');
    return;
  }

  console.log('🚀 Starting Awareness local daemon...');

  const child = spawn('npx', ['@awareness-sdk/local', 'start'], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, AWARENESS_PORT: String(DAEMON_PORT) },
  });
  child.unref();
}

export async function waitForDaemon() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    if (await isDaemonReady()) {
      console.log('✅ Awareness daemon ready!\n');
      return;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.warn('⚠️  Daemon not responding yet, continuing anyway...\n');
}

function isDaemonReady() {
  return new Promise((resolve) => {
    const req = get(HEALTH_URL, { timeout: 2000 }, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
