/**
 * Interactive model configuration — provider selection + API key input
 */

import { createInterface } from 'node:readline';

const PROVIDERS = [
  { name: 'DeepSeek', key: 'deepseek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { name: 'OpenAI', key: 'openai', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
  { name: 'Anthropic', key: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001'] },
  { name: 'Zhipu (智谱)', key: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-plus', 'glm-4-flash'] },
  { name: 'Moonshot (月之暗面)', key: 'moonshot', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-auto'] },
  { name: 'Alibaba (通义千问)', key: 'alibaba', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-max', 'qwen-plus'] },
  { name: 'Ollama (Local)', key: 'ollama', baseUrl: 'http://localhost:11434/v1', models: ['llama3.1', 'qwen2.5', 'deepseek-r1'], noApiKey: true },
  { name: 'Custom Provider', key: 'custom', baseUrl: '', models: [] },
];

export async function configureModel() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((r) => rl.question(q, r));

  console.log('🤖 Model Configuration\n');
  console.log('  Select your AI model provider:\n');

  PROVIDERS.forEach((p, i) => {
    console.log(`    ${i + 1}. ${p.name}`);
  });

  const choice = parseInt(await ask('\n  Enter number (1-8): '), 10) - 1;
  const provider = PROVIDERS[Math.max(0, Math.min(choice, PROVIDERS.length - 1))];

  let baseUrl = provider.baseUrl;
  let apiKey = '';
  let model = provider.models[0] || '';

  // Custom provider
  if (provider.key === 'custom') {
    baseUrl = await ask('  Base URL: ');
    model = await ask('  Model name: ');
  }

  // API Key (skip for Ollama)
  if (!provider.noApiKey) {
    apiKey = await ask(`  ${provider.name} API Key: `);
  }

  // Model selection (if multiple)
  if (provider.models.length > 1) {
    console.log(`\n  Available models:`);
    provider.models.forEach((m, i) => console.log(`    ${i + 1}. ${m}`));
    const modelChoice = parseInt(await ask('  Select model: '), 10) - 1;
    model = provider.models[Math.max(0, Math.min(modelChoice, provider.models.length - 1))];
  }

  rl.close();

  console.log(`\n✅ Model configured: ${provider.name} / ${model}\n`);

  return {
    provider: provider.key,
    baseUrl,
    apiKey,
    model,
  };
}
