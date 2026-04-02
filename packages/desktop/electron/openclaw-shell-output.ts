export function extractJsonPayload(output: string | null): string | null {
  if (!output) return null;

  const objectStart = output.indexOf('{');
  const arrayStart = output.indexOf('[');
  const starts = [objectStart, arrayStart].filter((index) => index >= 0).sort((a, b) => a - b);
  const jsonStart = starts[0];

  if (jsonStart === undefined) return null;
  return output.slice(jsonStart);
}

export function parseJsonShellOutput<T = any>(output: string | null): T | null {
  const payload = extractJsonPayload(output);
  if (!payload) return null;

  try {
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}