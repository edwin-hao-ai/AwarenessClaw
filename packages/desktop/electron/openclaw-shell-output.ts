export function extractJsonPayload(output: string | null): string | null {
  if (!output) return null;

  for (let index = 0; index < output.length; index += 1) {
    const char = output[index];
    if (char !== '{' && char !== '[') continue;

    const candidate = output.slice(index).trim();
    if (!candidate) continue;

    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Keep scanning. CLI logs often start with bracketed prefixes like [warn].
    }
  }

  return null;
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