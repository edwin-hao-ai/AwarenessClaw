/**
 * Shared app config store — persists to localStorage + syncs to openclaw.json via IPC
 */

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'awareness-claw-config';

export interface AppConfig {
  // Model
  providerKey: string;
  modelId: string;
  apiKey: string;
  baseUrl: string;
  // Memory
  autoRecall: boolean;
  autoCapture: boolean;
  recallLimit: number;
  memoryMode: 'local' | 'cloud';
  // Appearance
  language: string;
  theme: 'dark' | 'light' | 'system';
  // System
  autoUpdate: boolean;
  autoStart: boolean;
}

const DEFAULT_CONFIG: AppConfig = {
  providerKey: '',
  modelId: '',
  apiKey: '',
  baseUrl: '',
  autoRecall: true,
  autoCapture: true,
  recallLimit: 8,
  memoryMode: 'local',
  language: 'zh',
  theme: 'dark',
  autoUpdate: true,
  autoStart: false,
};

function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

function saveConfig(config: AppConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

/** Sync relevant settings to ~/.openclaw/openclaw.json */
async function syncToOpenClaw(config: AppConfig, providers: ModelProviderDef[]) {
  if (!window.electronAPI) return;

  const provider = providers.find((p) => p.key === config.providerKey);
  if (!provider) return;

  const openclawConfig: Record<string, any> = {
    // Tell OpenClaw to trust our plugin (suppress plugins.allow warning)
    plugins: {
      allow: ['openclaw-memory'],
    },
  };

  if (config.modelId) {
    const finalBaseUrl = config.baseUrl || provider.baseUrl;
    openclawConfig.models = {
      providers: {
        [config.providerKey]: {
          baseUrl: finalBaseUrl,
          ...(config.apiKey ? { apiKey: config.apiKey } : {}),
          ...(provider.apiType ? { api: provider.apiType } : {}),
          models: provider.models.map((m) => ({
            id: m.id,
            name: m.label.split('（')[0].split('(')[0].trim(),
            reasoning: false,
            input: ['text'],
          })),
        },
      },
    };
    openclawConfig.agents = {
      defaults: {
        model: { primary: `${config.providerKey}/${config.modelId}` },
      },
    };
  }

  await window.electronAPI.saveConfig(openclawConfig);
}

// React hook
export function useAppConfig() {
  const [config, setConfigState] = useState<AppConfig>(loadConfig);

  const updateConfig = useCallback((partial: Partial<AppConfig>) => {
    setConfigState((prev) => {
      const next = { ...prev, ...partial };
      saveConfig(next);
      return next;
    });
  }, []);

  const syncConfig = useCallback((providers: ModelProviderDef[]) => {
    syncToOpenClaw(loadConfig(), providers);
  }, []);

  return { config, updateConfig, syncConfig };
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
