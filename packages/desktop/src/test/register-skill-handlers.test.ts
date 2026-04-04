import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handleMock, sendMock } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  sendMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: handleMock,
  },
  BrowserWindow: {
    getAllWindows: () => [{ webContents: { send: sendMock } }],
  },
}));

import {
  buildAutoInstallSpecsFromMissingBins,
  parseWingetSearchIds,
  registerSkillHandlers,
} from '../../electron/ipc/register-skill-handlers';

function getInstallDepsHandler() {
  const match = handleMock.mock.calls.find(([channel]) => channel === 'skill:install-deps');
  if (!match) throw new Error('skill:install-deps handler not registered');
  return match[1] as (event: unknown, installSpecs: unknown, skillName?: string) => Promise<any>;
}

describe('registerSkillHandlers helpers', () => {
  beforeEach(() => {
    handleMock.mockReset();
    sendMock.mockReset();
  });

  it('parses winget ids from command search output', () => {
    const output = `
Failed when searching source; results will not be included: msstore
Name                  Id                          Version  Match        Source
-----------------------------------------------------------------------------
1Password CLI         AgileBits.1Password.CLI     2.33.1   Command: op  winget
  AWS Copilot CLI       Amazon.CopilotCLI           1.34.1   Command: copilot  winget
`;

    expect(parseWingetSearchIds(output)).toEqual([
      'AgileBits.1Password.CLI',
      'Amazon.CopilotCLI',
    ]);
  });

  it('creates fallback auto-install specs only for bins not attempted yet', () => {
    expect(buildAutoInstallSpecsFromMissingBins(['op', 'ffmpeg'], ['op'])).toEqual([
      {
        id: 'auto-ffmpeg-0',
        kind: 'auto',
        label: 'Install ffmpeg',
        bins: ['ffmpeg'],
        package: 'ffmpeg',
      },
    ]);
  });

  it.skipIf(process.platform !== 'win32')('auto-matches Windows package ids via winget command search', async () => {
    let installedOp = false;
    const runSpawnAsync = vi.fn(async (cmd: string, args: string[]) => {
      if (cmd === 'where') {
        const target = args[0];
        if (target === 'winget') return 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe';
        if (target === 'npm') return 'C:\\Program Files\\nodejs\\npm.cmd';
        if (target === 'op') {
          if (installedOp) return 'C:\\Users\\test\\AppData\\Local\\Microsoft\\WinGet\\Links\\op.exe';
          throw new Error('not found');
        }
        throw new Error(`missing ${target}`);
      }

      if (cmd === 'winget' && args[0] === 'search') {
        return `
Name                  Id                          Version  Match        Source
-----------------------------------------------------------------------------
1Password CLI         AgileBits.1Password.CLI     2.33.1   Command: op  winget
`;
      }

      throw new Error(`unexpected spawn: ${cmd} ${args.join(' ')}`);
    });

    const runAsyncWithProgress = vi.fn(async (command: string, _timeoutMs: number, onLine: (line: string, stream: 'stdout' | 'stderr') => void) => {
      expect(command).toContain('AgileBits.1Password.CLI');
      installedOp = true;
      onLine('Found 1Password CLI [AgileBits.1Password.CLI] Version 2.33.1', 'stdout');
      onLine('Successfully installed', 'stdout');
      return 'Successfully installed';
    });

    registerSkillHandlers({
      home: process.env.TEMP || process.env.TMP || 'C:/Temp',
      runAsync: vi.fn(async () => ''),
      runAsyncWithProgress,
      runSpawnAsync,
      readShellOutputAsync: vi.fn(async () => null),
    });

    const handler = getInstallDepsHandler();
    const result = await handler({}, [{ id: 'auto-op', kind: 'auto', label: 'Install op', bins: ['op'], package: 'op' }]);

    expect(result).toMatchObject({ success: true });
    expect(result.verified).toContain('op');
    expect(runAsyncWithProgress).toHaveBeenCalledWith(
      expect.stringContaining('AgileBits.1Password.CLI'),
      300000,
      expect.any(Function),
    );
    expect(sendMock).toHaveBeenCalledWith('skill:install-progress', expect.objectContaining({ stage: 'matching' }));
  });
});