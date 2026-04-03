import fs from 'fs';

export function stripUtf8Bom(input: string): string {
  return input.charCodeAt(0) === 0xFEFF ? input.slice(1) : input;
}

export function parseJsonWithBom<T = any>(input: string): T {
  return JSON.parse(stripUtf8Bom(input)) as T;
}

export function readJsonFileWithBom<T = any>(filePath: string): T {
  return parseJsonWithBom<T>(fs.readFileSync(filePath, 'utf8'));
}
