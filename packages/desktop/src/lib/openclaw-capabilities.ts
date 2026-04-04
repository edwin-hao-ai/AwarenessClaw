export interface DynamicConfigOption {
  value: string;
  label: string;
}

export interface DynamicConfigField {
  key: string;
  path: string;
  label: string;
  description?: string;
  type: 'boolean' | 'number' | 'text' | 'password' | 'select';
  options?: DynamicConfigOption[];
  group?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string | number | boolean;
  prominence?: 'primary' | 'advanced';
}

export interface DynamicConfigSection {
  key: string;
  title: string;
  description?: string;
  fields: DynamicConfigField[];
  defaultExpanded?: boolean;
}

type JsonSchemaNode = Record<string, any>;

const SECTION_META: Record<string, { title: string; description?: string; order?: number }> = {
  search: {
    title: 'Web Search',
    description: 'Most users only need to pick a search provider and add a credential if that provider requires one.',
    order: 1,
  },
  fetch: {
    title: 'Page Fetch',
    description: 'Leave this alone unless you need to tune how OpenClaw reads webpages.',
    order: 2,
  },
};

const FIELD_META: Record<string, { label: string; description?: string; order?: number; options?: DynamicConfigOption[] }> = {
  'tools.web.search.enabled': { label: 'Enable web search', order: 1 },
  'tools.web.search.provider': {
    label: 'Search provider',
    description: 'Choose the provider OpenClaw uses for web search.',
    order: 2,
    // No hardcoded options — dynamically populated from OpenClaw config schema enum.
    // PROVIDER_LABELS below provide friendly display names for known providers.
  },
  'tools.web.search.apiKey': {
    label: 'API key',
    description: 'Used for providers that require an API key, such as Brave or Perplexity.',
    order: 3,
  },
  'tools.web.search.maxResults': { label: 'Max results', order: 4 },
  'tools.web.search.timeoutSeconds': { label: 'Timeout (seconds)', order: 5 },
  'tools.web.search.cacheTtlMinutes': { label: 'Cache TTL (minutes)', order: 6 },
  'tools.web.fetch.enabled': { label: 'Enable fetch tool', order: 1 },
  'tools.web.fetch.maxChars': { label: 'Max characters', order: 2 },
  'tools.web.fetch.maxCharsCap': { label: 'Hard cap characters', order: 3 },
  'tools.web.fetch.maxResponseBytes': { label: 'Max response bytes', order: 4 },
  'tools.web.fetch.timeoutSeconds': { label: 'Timeout (seconds)', order: 5 },
  'tools.web.fetch.cacheTtlMinutes': { label: 'Cache TTL (minutes)', order: 6 },
  'tools.web.fetch.maxRedirects': { label: 'Max redirects', order: 7 },
  'tools.web.fetch.userAgent': { label: 'User agent', order: 8 },
  'tools.web.fetch.readability': { label: 'Enable readability cleanup', order: 9 },
  'tools.web.fetch.firecrawl.enabled': { label: 'Enable Firecrawl fallback', order: 10 },
  'tools.web.fetch.firecrawl.apiKey': { label: 'Firecrawl API key', order: 11 },
  'tools.web.search.openaiCodex.enabled': { label: 'Enable OpenAI Codex mode', order: 20 },
  'tools.web.search.openaiCodex.mode': { label: 'OpenAI Codex mode', order: 21 },
  'tools.web.search.openaiCodex.contextSize': { label: 'Context size', order: 22 },
};

const PRIMARY_FIELDS = new Set([
  'tools.web.search.provider',
  'tools.web.search.apiKey',
]);

const SKIP_PATHS = new Set([
  'tools.web.search.openaiCodex.allowedDomains',
  'tools.web.search.openaiCodex.userLocation',
]);

/** Friendly display labels for known OpenClaw search providers. */
const PROVIDER_LABELS: Record<string, string> = {
  brave: 'Brave Search',
  gemini: 'Gemini (Google)',
  grok: 'Grok (xAI)',
  kimi: 'Kimi (Moonshot)',
  perplexity: 'Perplexity',
  firecrawl: 'Firecrawl',
  exa: 'Exa',
  tavily: 'Tavily',
  duckduckgo: 'DuckDuckGo',
  'ollama-web-search': 'Ollama Web Search',
  browser: 'Browser (built-in)',
};

function titleize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getSchemaAtPath(schema: JsonSchemaNode, dotPath: string): JsonSchemaNode | null {
  return dotPath.split('.').reduce<JsonSchemaNode | null>((node, part) => {
    if (!node) return null;
    return node.properties?.[part] || null;
  }, schema);
}

function getEnumOptions(node: JsonSchemaNode): string[] {
  if (Array.isArray(node.enum)) return node.enum.filter((item) => typeof item === 'string');

  const candidates = [node.anyOf, node.oneOf]
    .filter(Array.isArray)
    .flat() as JsonSchemaNode[];

  return candidates
    .map((candidate) => candidate.const)
    .filter((value): value is string => typeof value === 'string');
}

function resolveFieldType(node: JsonSchemaNode, path: string): DynamicConfigField['type'] | null {
  if (FIELD_META[path]?.options?.length) return 'select';
  if (path.toLowerCase().includes('apikey')) return 'password';

  const schemaType = Array.isArray(node.type) ? node.type[0] : node.type;
  if (schemaType === 'boolean') return 'boolean';
  if (schemaType === 'integer' || schemaType === 'number') return 'number';

  const enumOptions = getEnumOptions(node);
  if (enumOptions.length > 0) return 'select';

  if (schemaType === 'string') return 'text';

  const anyOf = [...(node.anyOf || []), ...(node.oneOf || [])] as JsonSchemaNode[];
  if (anyOf.some((candidate) => candidate.type === 'string')) {
    if (path.toLowerCase().includes('apikey')) return 'password';
    return 'text';
  }

  return null;
}

function sortFields(fields: DynamicConfigField[]) {
  return [...fields].sort((left, right) => {
    const leftMeta = FIELD_META[left.path]?.order ?? 999;
    const rightMeta = FIELD_META[right.path]?.order ?? 999;
    if (leftMeta !== rightMeta) return leftMeta - rightMeta;
    return left.label.localeCompare(right.label);
  });
}

function appendCurrentOption(options: DynamicConfigOption[], currentValue: unknown) {
  if (typeof currentValue !== 'string' || !currentValue.trim()) return options;
  if (options.some((option) => option.value === currentValue)) return options;
  return [...options, { value: currentValue, label: currentValue }];
}

function buildFieldList(
  node: JsonSchemaNode,
  basePath: string,
  groupLabel: string | undefined,
  currentValue: any,
): DynamicConfigField[] {
  const fields: DynamicConfigField[] = [];

  for (const [key, child] of Object.entries(node.properties || {})) {
    const childPath = `${basePath}.${key}`;
    if (SKIP_PATHS.has(childPath)) continue;

    const childNode = child as JsonSchemaNode;
    if (childNode && typeof childNode === 'object' && childNode.type === 'object' && childNode.properties) {
      const nextGroup = groupLabel || titleize(key);
      if (basePath.split('.').length <= 3) {
        fields.push(...buildFieldList(childNode, childPath, titleize(key), currentValue?.[key]));
      } else {
        fields.push(...buildFieldList(childNode, childPath, nextGroup, currentValue?.[key]));
      }
      continue;
    }

    const fieldType = resolveFieldType(childNode, childPath);
    if (!fieldType) continue;

    const meta = FIELD_META[childPath];
    const enumOptions = getEnumOptions(child as JsonSchemaNode).map((value) => ({
      value,
      label: PROVIDER_LABELS[value] || titleize(value),
    }));
    // Schema enum takes priority; fall back to meta?.options only when schema has none.
    const rawOptions = enumOptions.length > 0 ? enumOptions : (meta?.options || []);
    const options = fieldType === 'select'
      ? appendCurrentOption(rawOptions, currentValue?.[key])
      : undefined;

    fields.push({
      key: childPath,
      path: childPath,
      label: meta?.label || titleize(key),
      description: meta?.description,
      type: fieldType,
      options,
      group: groupLabel,
      min: typeof (child as JsonSchemaNode).minimum === 'number'
        ? (child as JsonSchemaNode).minimum
        : typeof (child as JsonSchemaNode).exclusiveMinimum === 'number'
          ? (child as JsonSchemaNode).exclusiveMinimum
          : undefined,
      max: typeof (child as JsonSchemaNode).maximum === 'number' ? (child as JsonSchemaNode).maximum : undefined,
      step: (child as JsonSchemaNode).type === 'integer' ? 1 : undefined,
      defaultValue: ['string', 'number', 'boolean'].includes(typeof (child as JsonSchemaNode).default)
        ? (child as JsonSchemaNode).default
        : undefined,
      prominence: PRIMARY_FIELDS.has(childPath) ? 'primary' : 'advanced',
    });
  }

  return sortFields(fields);
}

export function buildDynamicSectionsFromSchema(
  schema: JsonSchemaNode,
  dotPath: string,
  currentValue: Record<string, any> = {},
): DynamicConfigSection[] {
  const root = getSchemaAtPath(schema, dotPath);
  if (!root?.properties) return [];

  return Object.entries(root.properties)
    .map(([key, child]) => {
      const meta = SECTION_META[key] || { title: titleize(key), order: 999 };
      const childPath = `${dotPath}.${key}`;
      return {
        key,
        title: meta.title,
        description: meta.description,
        order: meta.order ?? 999,
        fields: buildFieldList(child as JsonSchemaNode, childPath, undefined, currentValue?.[key] || {}),
        defaultExpanded: false,
      };
    })
    .filter((section) => section.fields.length > 0)
    .sort((left, right) => left.order - right.order)
    .map(({ order: _order, ...section }) => section);
}

export function getValueAtPath(value: Record<string, any>, dotPath: string): any {
  return dotPath.split('.').reduce((current, part) => current?.[part], value);
}

export function setValueAtPath(value: Record<string, any>, dotPath: string, nextValue: any): Record<string, any> {
  const parts = dotPath.split('.');
  const clone = JSON.parse(JSON.stringify(value || {}));
  let cursor = clone;

  for (let index = 0; index < parts.length - 1; index += 1) {
    const part = parts[index];
    if (!cursor[part] || typeof cursor[part] !== 'object') cursor[part] = {};
    cursor = cursor[part];
  }

  const leaf = parts[parts.length - 1];
  if (nextValue === undefined || nextValue === '') {
    delete cursor[leaf];
  } else {
    cursor[leaf] = nextValue;
  }

  return clone;
}