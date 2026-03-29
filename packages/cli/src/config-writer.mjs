/**
 * Config writer — merges Awareness settings into OpenClaw config
 * Reuses logic from sdks/setup-cli/src/rules.mjs (syncOpenClawConfig)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

export async function writeConfig({ credentials = {}, modelConfig = {} }) {
  console.log('📝 Writing configuration...');

  mkdirSync(join(homedir(), '.openclaw'), { recursive: true });

  // Read existing config (preserve user's other settings)
  let config = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    } catch { /* start fresh if parse fails */ }
  }

  // Merge Awareness plugin config
  if (!config.plugins) config.plugins = {};
  config.plugins['openclaw-memory'] = {
    enabled: true,
    config: {
      apiKey: credentials.apiKey || '',
      memoryId: credentials.memoryId || '',
      baseUrl: 'https://awareness.market/api/v1',
      localUrl: 'http://localhost:37800',
      autoRecall: true,
      autoCapture: true,
      recallLimit: 8,
      embeddingLanguage: 'multilingual',
      ...(config.plugins?.['openclaw-memory']?.config || {}),
      // Override with new credentials if provided
      ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
      ...(credentials.memoryId ? { memoryId: credentials.memoryId } : {}),
    },
  };

  // Merge model config (if provided)
  if (modelConfig.model) {
    if (!config.models) config.models = {};
    config.models.primary = [{
      provider: modelConfig.provider,
      model: modelConfig.model,
      ...(modelConfig.baseUrl ? { baseUrl: modelConfig.baseUrl } : {}),
      ...(modelConfig.apiKey ? { apiKey: modelConfig.apiKey } : {}),
    }];
  }

  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`✅ Config saved to ${CONFIG_PATH}\n`);
}
