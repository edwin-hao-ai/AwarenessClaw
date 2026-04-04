import { describe, expect, it } from 'vitest';
import { buildDynamicSectionsFromSchema, setValueAtPath } from '../lib/openclaw-capabilities';
import { mergeDesktopOpenClawConfig } from '../../electron/desktop-openclaw-config';

describe('openclaw capability schema helpers', () => {
  it('builds dynamic web-search fields from OpenClaw schema', () => {
    const schema = {
      properties: {
        tools: {
          properties: {
            web: {
              properties: {
                search: {
                  type: 'object',
                  properties: {
                    enabled: { type: 'boolean' },
                    provider: { type: 'string', enum: ['brave', 'gemini', 'grok', 'kimi', 'perplexity', 'firecrawl', 'exa', 'tavily', 'duckduckgo', 'ollama-web-search', 'browser'] },
                    apiKey: { anyOf: [{ type: 'string' }, { type: 'object' }] },
                    maxResults: { type: 'integer', maximum: 20 },
                  },
                },
              },
            },
          },
        },
      },
    };

    const sections = buildDynamicSectionsFromSchema(schema, 'tools.web', {
      search: { provider: 'brave' },
    });

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Web Search');
    expect(sections[0].fields.map((field) => field.path)).toEqual([
      'tools.web.search.enabled',
      'tools.web.search.provider',
      'tools.web.search.apiKey',
      'tools.web.search.maxResults',
    ]);
    expect(sections[0].fields[1].type).toBe('select');
    expect(sections[0].fields[2].type).toBe('password');
    expect(sections[0].fields.find((field) => field.path === 'tools.web.search.provider')?.prominence).toBe('primary');
    expect(sections[0].fields.find((field) => field.path === 'tools.web.search.apiKey')?.prominence).toBe('primary');
    expect(sections[0].fields.find((field) => field.path === 'tools.web.search.enabled')?.prominence).toBe('advanced');
  });

  it('writes nested values immutably for schema-driven forms', () => {
    const next = setValueAtPath({ search: { provider: 'brave' } }, 'search.maxResults', 8);
    expect(next).toEqual({ search: { provider: 'brave', maxResults: 8 } });
  });
});

describe('desktop openclaw config merge', () => {
  it('merges nested tools.web config without dropping existing search fields', () => {
    const merged = mergeDesktopOpenClawConfig(
      {
        tools: {
          profile: 'coding',
          web: {
            search: {
              provider: 'brave',
              maxResults: 5,
            },
          },
        },
      },
      {
        tools: {
          web: {
            search: {
              apiKey: 'secret',
            },
          },
        },
      },
      '/tmp',
    );

    expect(merged.tools.web.search).toEqual({
      provider: 'brave',
      maxResults: 5,
      apiKey: 'secret',
    });
  });
});