import { describe, expect, it } from 'vitest';

import { extractJsonPayload, parseJsonShellOutput } from '../../electron/openclaw-shell-output';

describe('openclaw-shell-output', () => {
  it('extracts JSON object after warning lines', () => {
    const output = '[warn] config mismatch\n{"ok":true,"items":[]}';

    expect(extractJsonPayload(output)).toBe('{"ok":true,"items":[]}');
    expect(parseJsonShellOutput<{ ok: boolean }>(output)).toMatchObject({ ok: true });
  });

  it('extracts JSON array after bracketed log lines', () => {
    const output = '[plugins] Registered awareness-memory\n[{"id":"telegram","status":"linked"}]';

    expect(parseJsonShellOutput<Array<{ id: string }>>(output)).toEqual([
      { id: 'telegram', status: 'linked' },
    ]);
  });

  it('returns null when no valid JSON payload exists', () => {
    expect(extractJsonPayload('[warn] still loading plugins')).toBeNull();
    expect(parseJsonShellOutput('[warn] still loading plugins')).toBeNull();
  });
});