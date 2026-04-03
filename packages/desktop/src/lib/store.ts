/**
 * Shared app config store — persists to localStorage + syncs to openclaw.json via IPC
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'awareness-claw-config';

const DEFAULT_ALLOWED_TOOLS = [
  'exec',
  'awareness_init',
  'awareness_recall',
  'awareness_lookup',
  'awareness_record',
  'awareness_get_agent_prompt',
];

export interface ProviderStoredModel {
  id: string;
  label?: string;
  name?: string;
  reasoning?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  input?: string[];
}

export interface ProviderProfile {
  apiKey: string;
  baseUrl: string;
  apiType?: string;
  models: ProviderStoredModel[];
  name?: string;
  emoji?: string;
  tag?: string;
  desc?: string;
  needsKey?: boolean;
  lastSyncedAt?: string;
}

export interface AppConfig {
  // Model
  providerKey: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  providerProfiles: Record<string, ProviderProfile>;
  // Memory
  autoRecall: boolean;
  autoCapture: boolean;
  recallLimit: number;
  memoryMode: 'local' | 'cloud';
  // Privacy — which sources are allowed to save to memory (empty = all allowed)
  memoryBlockedSources: string[];
  // Token optimization
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high';
  // Reasoning display — controls whether the model's thinking process is shown to the user
  reasoningDisplay: 'off' | 'on' | 'stream';
  // Appearance
  language: string;
  theme: 'dark' | 'light' | 'system';
  // System
  autoUpdate: boolean;
  autoStart: boolean;
  // Onboarding
  bootstrapCompleted: boolean;
  // Agent selection
  selectedAgentId: string;
}

const DEFAULT_CONFIG: AppConfig = {
  providerKey: '',
  modelId: '',
  apiKey: '',
  baseUrl: '',
  providerProfiles: {},
  autoRecall: true,
  autoCapture: true,
  recallLimit: 8,
  memoryMode: 'local',
  memoryBlockedSources: [],
  thinkingLevel: 'low',
  reasoningDisplay: 'on',
  language: 'zh',
  theme: 'dark',
  autoUpdate: true,
  autoStart: false,
  bootstrapCompleted: false,
  selectedAgentId: 'main',
};

function normalizeStoredModels(models: unknown): ProviderStoredModel[] {
  if (!Array.isArray(models)) return [];
  return models
    .filter((item): item is Record<string, any> => !!item && typeof item === 'object' && typeof item.id === 'string')
    .map((item) => ({
      id: item.id,
      ...(typeof item.label === 'string' ? { label: item.label } : {}),
      ...(typeof item.name === 'string' ? { name: item.name } : {}),
      ...(typeof item.reasoning === 'boolean' ? { reasoning: item.reasoning } : {}),
      ...(typeof item.contextWindow === 'number' ? { contextWindow: item.contextWindow } : {}),
      ...(typeof item.maxTokens === 'number' ? { maxTokens: item.maxTokens } : {}),
      ...(Array.isArray(item.input) ? { input: item.input.filter((value: unknown): value is string => typeof value === 'string') } : {}),
    }));
}

function normalizeProviderProfiles(profiles: unknown): Record<string, ProviderProfile> {
  if (!profiles || typeof profiles !== 'object') return {};

  const normalized: Record<string, ProviderProfile> = {};
  for (const [key, value] of Object.entries(profiles as Record<string, any>)) {
    if (!value || typeof value !== 'object') continue;
    normalized[key] = {
      apiKey: typeof value.apiKey === 'string' ? value.apiKey : '',
      baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
      ...(typeof value.apiType === 'string' ? { apiType: value.apiType } : {}),
      models: normalizeStoredModels(value.models),
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
      ...(typeof value.emoji === 'string' ? { emoji: value.emoji } : {}),
      ...(typeof value.tag === 'string' ? { tag: value.tag } : {}),
      ...(typeof value.desc === 'string' ? { desc: value.desc } : {}),
      ...(typeof value.needsKey === 'boolean' ? { needsKey: value.needsKey } : {}),
      ...(typeof value.lastSyncedAt === 'string' ? { lastSyncedAt: value.lastSyncedAt } : {}),
    };
  }
  return normalized;
}

function normalizeConfig(raw: Partial<AppConfig>): AppConfig {
  const next: AppConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    providerProfiles: normalizeProviderProfiles(raw.providerProfiles),
  };

  if (next.providerKey) {
    const existing = next.providerProfiles[next.providerKey] || {
      apiKey: '',
      baseUrl: '',
      models: [],
    };

    next.providerProfiles[next.providerKey] = {
      ...existing,
      apiKey: next.apiKey || existing.apiKey || '',
      baseUrl: next.baseUrl || existing.baseUrl || '',
      models: existing.models || [],
      ...(existing.apiType ? { apiType: existing.apiType } : {}),
      ...(existing.name ? { name: existing.name } : {}),
      ...(existing.emoji ? { emoji: existing.emoji } : {}),
      ...(existing.tag ? { tag: existing.tag } : {}),
      ...(existing.desc ? { desc: existing.desc } : {}),
      ...(typeof existing.needsKey === 'boolean' ? { needsKey: existing.needsKey } : {}),
      ...(existing.lastSyncedAt ? { lastSyncedAt: existing.lastSyncedAt } : {}),
    };
  }

  return next;
}

export function getProviderProfile(config: AppConfig, providerKey: string): ProviderProfile {
  const existing = config.providerProfiles?.[providerKey] || {
    apiKey: '',
    baseUrl: '',
    models: [],
  };

  if (providerKey && providerKey === config.providerKey) {
    return {
      ...existing,
      apiKey: config.apiKey || existing.apiKey || '',
      baseUrl: config.baseUrl || existing.baseUrl || '',
      models: existing.models || [],
    };
  }

  return {
    apiKey: existing.apiKey || '',
    baseUrl: existing.baseUrl || '',
    models: existing.models || [],
    ...(existing.apiType ? { apiType: existing.apiType } : {}),
    ...(existing.name ? { name: existing.name } : {}),
    ...(existing.emoji ? { emoji: existing.emoji } : {}),
    ...(existing.tag ? { tag: existing.tag } : {}),
    ...(existing.desc ? { desc: existing.desc } : {}),
    ...(typeof existing.needsKey === 'boolean' ? { needsKey: existing.needsKey } : {}),
    ...(existing.lastSyncedAt ? { lastSyncedAt: existing.lastSyncedAt } : {}),
  };
}

export function hasProviderCredentials(config: AppConfig, providerKey: string, needsKey: boolean): boolean {
  if (!needsKey) return true;
  return !!getProviderProfile(config, providerKey).apiKey;
}

function mergeProviderProfile(
  config: AppConfig,
  providerKey: string,
  profile: Partial<ProviderProfile>,
): AppConfig {
  const existing = getProviderProfile(config, providerKey);
  return {
    ...config,
    providerProfiles: {
      ...config.providerProfiles,
      [providerKey]: {
        ...existing,
        ...profile,
        models: profile.models ? normalizeStoredModels(profile.models) : existing.models,
      },
    },
  };
}

function getFallbackModels(providerKey: string, providers: ModelProviderDef[]): ProviderStoredModel[] {
  const provider = providers.find((item) => item.key === providerKey);
  return (provider?.models || []).map((model) => ({
    id: model.id,
    label: model.label,
    name: model.label,
  }));
}

function selectProviderModel(
  config: AppConfig,
  providerKey: string,
  modelId: string,
  providers: ModelProviderDef[],
): AppConfig {
  const provider = providers.find((item) => item.key === providerKey);
  const profile = getProviderProfile(config, providerKey);
  const effectiveModelId = modelId
    || profile.models[0]?.id
    || provider?.models[0]?.id
    || '';

  return {
    ...config,
    providerKey,
    modelId: effectiveModelId,
    apiKey: profile.apiKey || '',
    baseUrl: profile.baseUrl || provider?.baseUrl || '',
  };
}

function saveProviderSelection(
  config: AppConfig,
  input: {
    providerKey: string;
    modelId: string;
    apiKey?: string;
    baseUrl?: string;
    models?: ProviderStoredModel[];
    apiType?: string;
    name?: string;
    needsKey?: boolean;
  },
  providers: ModelProviderDef[],
): AppConfig {
  const provider = providers.find((item) => item.key === input.providerKey);
  const nextProfile: Partial<ProviderProfile> = {
    ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
    ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
    ...(input.models ? { models: input.models } : {}),
    ...(input.apiType !== undefined ? { apiType: input.apiType } : provider?.apiType ? { apiType: provider.apiType } : {}),
    ...(input.name ? { name: input.name } : provider ? { name: provider.name } : {}),
    ...(typeof input.needsKey === 'boolean' ? { needsKey: input.needsKey } : provider ? { needsKey: provider.needsKey } : {}),
    lastSyncedAt: new Date().toISOString(),
  };

  const merged = mergeProviderProfile(config, input.providerKey, nextProfile);
  return selectProviderModel(merged, input.providerKey, input.modelId, providers);
}

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeConfig(JSON.parse(raw));
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: AppConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  // Notify all useAppConfig instances to re-read (fixes language switch not updating Sidebar)
  window.dispatchEvent(new CustomEvent('awareness-config-changed'));
}

/** Sync relevant settings to ~/.openclaw/openclaw.json */
async function syncToOpenClaw(config: AppConfig, providers: ModelProviderDef[]) {
  if (!window.electronAPI) return;

  const openclawConfig: Record<string, any> = {
    gateway: {
      mode: 'local',
      bind: 'loopback',
      port: 18789,
    },
    plugins: {
      allow: ['openclaw-memory'],
    },
    // Ensure coding profile (includes browser, file ops, exec, web tools) and Awareness tools
    tools: {
      profile: 'coding',
      alsoAllow: DEFAULT_ALLOWED_TOOLS,
    },
  };

  // Sync memory settings to plugin config (autoRecall, recallLimit, memoryMode)
  openclawConfig.plugins = {
    ...openclawConfig.plugins,
    slots: { memory: 'openclaw-memory' },
    entries: {
      'openclaw-memory': {
        enabled: true,
        config: {
          autoRecall: config.autoRecall,
          autoCapture: config.autoCapture,
          recallLimit: config.recallLimit,
          ...(config.memoryMode === 'local' ? { localUrl: 'http://127.0.0.1:37800' } : {}),
          ...(config.memoryBlockedSources?.length ? { blockedSources: config.memoryBlockedSources } : {}),
        },
      },
      'memory-core': { enabled: false },
      'memory-lancedb': { enabled: false },
    },
  };

  const providerKeys = new Set<string>([
    ...providers.map((provider) => provider.key),
    ...Object.keys(config.providerProfiles || {}),
  ]);

  const syncedProviders: Record<string, any> = {};

  for (const providerKey of providerKeys) {
    const provider = providers.find((item) => item.key === providerKey);
    const profile = getProviderProfile(config, providerKey);
    const effectiveBaseUrl = profile.baseUrl || provider?.baseUrl || '';
    const effectiveApiKey = profile.apiKey || '';
    const effectiveModels = (profile.models?.length ? profile.models : getFallbackModels(providerKey, providers))
      .map((model) => ({
        id: model.id,
        name: (model.name || model.label || model.id).split('（')[0].split('(')[0].trim(),
        ...(typeof model.reasoning === 'boolean' ? { reasoning: model.reasoning } : { reasoning: false }),
        ...(typeof model.contextWindow === 'number' ? { contextWindow: model.contextWindow } : {}),
        ...(typeof model.maxTokens === 'number' ? { maxTokens: model.maxTokens } : {}),
        input: Array.isArray(model.input) && model.input.length > 0 ? model.input : ['text'],
      }));

    if (!effectiveBaseUrl && effectiveModels.length === 0 && !effectiveApiKey) continue;

    syncedProviders[providerKey] = {
      ...(effectiveBaseUrl ? { baseUrl: effectiveBaseUrl } : {}),
      ...(effectiveApiKey ? { apiKey: effectiveApiKey } : {}),
      ...(profile.apiType || provider?.apiType ? { api: profile.apiType || provider?.apiType } : {}),
      ...(effectiveModels.length > 0 ? { models: effectiveModels } : {}),
    };
  }

  if (config.modelId) {
    openclawConfig.models = {
      providers: syncedProviders,
    };
    // reasoningDefault is per-agent (not allowed in agents.defaults), so set it on each agent in the list
    const reasoningDefault = config.reasoningDisplay && config.reasoningDisplay !== 'off' ? config.reasoningDisplay : 'on';
    openclawConfig.agents = {
      defaults: {
        model: { primary: `${config.providerKey}/${config.modelId}` },
        verboseDefault: 'full',
        thinkingDefault: config.thinkingLevel || 'low',
      },
      list: [
        { id: 'main', reasoningDefault },
      ],
    };
  }

  await window.electronAPI.saveConfig(openclawConfig);
}

// React hook — all instances share state via CustomEvent
export function useAppConfig() {
  const [config, setConfigState] = useState<AppConfig>(loadConfig);

  // Listen for config changes from other components (e.g. Settings → Sidebar language sync)
  useEffect(() => {
    const handler = () => setConfigState(loadConfig());
    window.addEventListener('awareness-config-changed', handler);
    return () => window.removeEventListener('awareness-config-changed', handler);
  }, []);

  const updateConfig = useCallback((partial: Partial<AppConfig>) => {
    setConfigState((prev) => {
      const next = normalizeConfig({ ...prev, ...partial });
      saveConfig(next);
      return next;
    });
  }, []);

  const syncConfig = useCallback(async (providers: ModelProviderDef[]) => {
    await syncToOpenClaw(loadConfig(), providers);
  }, []);

  const selectModel = useCallback((providerKey: string, modelId: string, providers: ModelProviderDef[]) => {
    setConfigState((prev) => {
      const next = selectProviderModel(normalizeConfig(prev), providerKey, modelId, providers);
      saveConfig(next);
      return next;
    });
  }, []);

  const saveProviderConfig = useCallback((input: {
    providerKey: string;
    modelId: string;
    apiKey?: string;
    baseUrl?: string;
    models?: ProviderStoredModel[];
    apiType?: string;
    name?: string;
    needsKey?: boolean;
  }, providers: ModelProviderDef[]) => {
    setConfigState((prev) => {
      const next = saveProviderSelection(normalizeConfig(prev), input, providers);
      saveConfig(next);
      return next;
    });
  }, []);

  return { config, updateConfig, syncConfig, selectModel, saveProviderConfig };
}

// Model provider definition (shared between Setup and Settings)
export interface ModelProviderDef {
  key: string;
  name: string;
  emoji: string;
  tag: string;
  desc: string;
  baseUrl: string;
  apiType?: string;
  models: { id: string; label: string }[];
  needsKey: boolean;
}

// All base URLs and model IDs verified from official documentation (2026-03)
export const MODEL_PROVIDERS: ModelProviderDef[] = [
  {
    key: 'qwen-portal', name: '通义千问 Qwen', emoji: '☁️', tag: '🆓 每模型100万免费',
    desc: '阿里云百炼，中文最强，多模态',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiType: 'openai-completions',
    models: [
      { id: 'qwen-turbo-latest', label: 'Qwen Turbo（最快最便宜）' },
      { id: 'qwen-plus-latest', label: 'Qwen Plus（均衡推荐）' },
      { id: 'qwen-max-latest', label: 'Qwen Max（最强）' },
      { id: 'qwen3-235b-a22b', label: 'Qwen3 235B（开源最强）' },
      { id: 'qwq-plus', label: 'QwQ Plus（深度推理）' },
      { id: 'qwen-long', label: 'Qwen Long（超长文本）' },
    ],
    needsKey: true,
  },
  {
    key: 'deepseek', name: 'DeepSeek', emoji: '🔬', tag: '🆓 免费额度',
    desc: '免费额度充足，推理能力强',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat（通用对话）' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner（深度推理）' },
    ],
    needsKey: true,
  },
  {
    key: 'openai', name: 'OpenAI', emoji: '⚡', tag: '全球最流行',
    desc: 'GPT 系列，需付费',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o（多模态旗舰）' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini（快速便宜）' },
      { id: 'o3-mini', label: 'o3-mini（推理增强）' },
    ],
    needsKey: true,
  },
  {
    key: 'anthropic', name: 'Claude', emoji: '🧠', tag: '超强推理',
    desc: 'Anthropic 出品，代码分析最强',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4（推荐）' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5（快速）' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4（最强）' },
    ],
    needsKey: true,
  },
  {
    key: 'zhipu', name: '智谱 AI', emoji: '🇨🇳', tag: '🆓 Flash 免费',
    desc: 'GLM 系列，Flash 模型完全免费',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
    models: [
      { id: 'glm-4-flash-250414', label: 'GLM-4 Flash（免费）' },
      { id: 'glm-4-plus', label: 'GLM-4 Plus（高性能）' },
      { id: 'glm-5', label: 'GLM-5（最新第五代）' },
    ],
    needsKey: true,
  },
  {
    key: 'moonshot', name: '月之暗面 Kimi', emoji: '🌙', tag: '超长上下文',
    desc: 'Kimi K2.5，256K 上下文',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: [
      { id: 'kimi-k2.5', label: 'Kimi K2.5（最新多模态）' },
      { id: 'moonshot-v1-auto', label: 'Moonshot V1 Auto' },
      { id: 'moonshot-v1-128k', label: 'Moonshot V1 128K' },
    ],
    needsKey: true,
  },
  {
    key: 'volcengine', name: '豆包 / 火山引擎', emoji: '🔥', tag: '字节跳动',
    desc: '豆包大模型，性价比高',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: [
      { id: 'doubao-1-5-pro-32k-250115', label: '豆包 1.5 Pro' },
      { id: 'doubao-1-5-thinking-pro-250415', label: '豆包 Thinking Pro' },
      { id: 'doubao-1-5-lite', label: '豆包 1.5 Lite（快速）' },
    ],
    needsKey: true,
  },
  {
    key: 'qianfan', name: '文心一言 / 千帆', emoji: '🏛️', tag: '百度',
    desc: 'ERNIE 系列',
    baseUrl: 'https://qianfan.baidubce.com/v2',
    models: [
      { id: 'ernie-4.0-8k', label: 'ERNIE 4.0 8K' },
      { id: 'ernie-speed-128k', label: 'ERNIE Speed 128K' },
    ],
    needsKey: true,
  },
  {
    key: 'minimax', name: 'MiniMax 海螺', emoji: '🐚', tag: '长上下文',
    desc: '204K 上下文',
    baseUrl: 'https://api.minimaxi.com/v1',
    models: [
      { id: 'MiniMax-M2.7', label: 'MiniMax M2.7（最新）' },
      { id: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
    ],
    needsKey: true,
  },
  {
    key: 'siliconflow', name: 'SiliconFlow', emoji: '🚀', tag: '🆓 $1 新用户',
    desc: '聚合多模型',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      { id: 'deepseek-v3-2', label: 'DeepSeek V3.2' },
      { id: 'deepseek-r1', label: 'DeepSeek R1' },
      { id: 'kimi-k2-instruct', label: 'Kimi K2' },
    ],
    needsKey: true,
  },
  {
    key: 'groq', name: 'Groq', emoji: '⚡', tag: '🆓 免费极速',
    desc: '最快推理，免费无需信用卡',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B（极速）' },
    ],
    needsKey: true,
  },
  {
    key: 'ollama', name: 'Ollama 本地', emoji: '🏠', tag: '完全离线免费',
    desc: '在你电脑上本地运行',
    baseUrl: 'http://localhost:11434/v1',
    models: [
      { id: 'qwen2.5:7b', label: 'Qwen 2.5 7B（推荐）' },
      { id: 'llama3.1:8b', label: 'Llama 3.1 8B' },
      { id: 'deepseek-r1:8b', label: 'DeepSeek R1 8B' },
    ],
    needsKey: false,
  },
];

/**
 * Hook to get merged providers: hardcoded MODEL_PROVIDERS + dynamic from openclaw.json.
 * Custom providers added via CLI appear under "Custom" section.
 * Models from openclaw.json override hardcoded model lists for known providers.
 */
export function useDynamicProviders(): { providers: ModelProviderDef[]; loading: boolean } {
  const [merged, setMerged] = useState<ModelProviderDef[]>(MODEL_PROVIDERS);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handler = () => setRefreshKey((value) => value + 1);
    window.addEventListener('awareness-config-changed', handler);
    return () => window.removeEventListener('awareness-config-changed', handler);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const localConfig = loadConfig();
      const hardcodedKeys = new Set(MODEL_PROVIDERS.map((provider) => provider.key));
      const dynamicMap = new Map<string, any>();

      for (const [key, profile] of Object.entries(localConfig.providerProfiles || {})) {
        dynamicMap.set(key, {
          key,
          baseUrl: profile.baseUrl,
          apiType: profile.apiType,
          hasApiKey: !!profile.apiKey,
          name: profile.name,
          needsKey: profile.needsKey,
          models: (profile.models || []).map((model) => ({
            id: model.id,
            name: model.name || model.label || model.id,
            reasoning: model.reasoning,
            contextWindow: model.contextWindow,
            maxTokens: model.maxTokens,
          })),
        });
      }

      if (window.electronAPI?.modelsReadProviders) {
        try {
          const res = await (window.electronAPI as any).modelsReadProviders();
          if (res?.success && Array.isArray(res.providers)) {
            for (const provider of res.providers) {
              const existing = dynamicMap.get(provider.key) || {};
              dynamicMap.set(provider.key, {
                ...provider,
                ...existing,
                models: existing.models?.length ? existing.models : (provider.models || []),
                hasApiKey: existing.hasApiKey || provider.hasApiKey,
                baseUrl: existing.baseUrl || provider.baseUrl || '',
                apiType: existing.apiType || provider.apiType,
              });
            }
          }
        } catch {
          // ignore openclaw read errors and fall back to local profiles
        }
      }

      const result = MODEL_PROVIDERS.map((hardcodedProvider) => {
        const dynamicProvider = dynamicMap.get(hardcodedProvider.key);
        if (!dynamicProvider) return hardcodedProvider;

        const hardcodedModelMap = new Map(hardcodedProvider.models.map((model) => [model.id, model.label]));
        const mergedModels = (dynamicProvider.models || []).map((model: any) => ({
          id: model.id,
          label: hardcodedModelMap.get(model.id) || model.label || model.name || model.id,
        }));

        for (const hardcodedModel of hardcodedProvider.models) {
          if (!mergedModels.some((model: any) => model.id === hardcodedModel.id)) {
            mergedModels.push(hardcodedModel);
          }
        }

        return {
          ...hardcodedProvider,
          name: dynamicProvider.name || hardcodedProvider.name,
          desc: dynamicProvider.baseUrl || hardcodedProvider.desc,
          baseUrl: dynamicProvider.baseUrl || hardcodedProvider.baseUrl,
          apiType: dynamicProvider.apiType || hardcodedProvider.apiType,
          models: mergedModels,
          needsKey: typeof dynamicProvider.needsKey === 'boolean' ? dynamicProvider.needsKey : hardcodedProvider.needsKey,
        };
      });

      for (const [key, dynamicProvider] of dynamicMap.entries()) {
        if (!hardcodedKeys.has(key)) {
          result.push({
            key,
            name: dynamicProvider.name || key,
            emoji: dynamicProvider.emoji || '🔌',
            tag: dynamicProvider.tag || 'Custom',
            desc: dynamicProvider.baseUrl || dynamicProvider.desc || 'Custom provider',
            baseUrl: dynamicProvider.baseUrl || '',
            apiType: dynamicProvider.apiType,
            models: (dynamicProvider.models || []).map((model: any) => ({
              id: model.id,
              label: model.label || model.name || model.id,
            })),
            needsKey: typeof dynamicProvider.needsKey === 'boolean' ? dynamicProvider.needsKey : true,
          });
        }
      }

      if (!cancelled) {
        setMerged(result);
        setLoading(false);
      }
    };

    setLoading(true);
    hydrate();

    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  return { providers: merged, loading };
}
