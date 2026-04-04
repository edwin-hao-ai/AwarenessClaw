import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { getExecApprovalSettings, hasExplicitExecApprovalConfig } from '../../electron/openclaw-config';

describe('openclaw-config exec approvals', () => {
  let tempHome = '';

  afterEach(() => {
    if (tempHome) {
      fs.rmSync(tempHome, { recursive: true, force: true });
      tempHome = '';
    }
  });

  it('preserves allowlist host approval mode from exec-approvals.json', () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-claw-'));
    const openclawDir = path.join(tempHome, '.openclaw');
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(path.join(openclawDir, 'exec-approvals.json'), JSON.stringify({
      version: 1,
      defaults: {
        security: 'allowlist',
        ask: 'always',
        askFallback: 'allowlist',
      },
      agents: {
        main: {
          allowlist: [
            { pattern: 'dir *' },
          ],
        },
      },
    }, null, 2));

    expect(getExecApprovalSettings(tempHome)).toMatchObject({
      security: 'allowlist',
      ask: 'always',
      askFallback: 'allowlist',
      allowlist: [{ pattern: 'dir *' }],
    });
    expect(hasExplicitExecApprovalConfig(tempHome)).toBe(true);
  });

  it('treats missing or empty exec approvals files as no explicit host exec config', () => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'awareness-claw-'));

    expect(hasExplicitExecApprovalConfig(tempHome)).toBe(false);

    const openclawDir = path.join(tempHome, '.openclaw');
    fs.mkdirSync(openclawDir, { recursive: true });
    fs.writeFileSync(path.join(openclawDir, 'exec-approvals.json'), JSON.stringify({ version: 1 }, null, 2));

    expect(hasExplicitExecApprovalConfig(tempHome)).toBe(false);
  });
});