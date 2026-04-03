import { describe, expect, it } from 'vitest';

import { parseJsonWithBom, stripUtf8Bom } from '../../electron/json-file';

describe('json-file helpers', () => {
  it('strips UTF-8 BOM when present', () => {
    const input = '\uFEFF{"gateway":{"auth":{"token":"abc"}}}';
    const output = stripUtf8Bom(input);

    expect(output.startsWith('\uFEFF')).toBe(false);
    expect(output).toBe('{"gateway":{"auth":{"token":"abc"}}}');
  });

  it('parses JSON text that starts with BOM', () => {
    const input = '\uFEFF{"gateway":{"auth":{"token":"abc"}}}';
    const parsed = parseJsonWithBom<{ gateway: { auth: { token: string } } }>(input);

    expect(parsed.gateway.auth.token).toBe('abc');
  });
});
