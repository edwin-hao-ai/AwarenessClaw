import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAppConfig, MODEL_PROVIDERS } from '../lib/store';

const STORAGE_KEY = 'awareness-claw-config';

describe('Config sync (useAppConfig)', () => {
  beforeEach(() => {
    localStorage.clear();
    // Set a known baseline
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ language: 'en', autoRecall: true }));
  });

  it('updateConfig({ language: "zh" }) persists to localStorage', () => {
    const { result } = renderHook(() => useAppConfig());

    act(() => {
      result.current.updateConfig({ language: 'zh' });
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.language).toBe('zh');
  });

  it('updateConfig({ autoRecall: false }) is reflected when re-reading config', () => {
    const { result } = renderHook(() => useAppConfig());

    act(() => {
      result.current.updateConfig({ autoRecall: false });
    });

    expect(result.current.config.autoRecall).toBe(false);

    // Also verify localStorage
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored.autoRecall).toBe(false);
  });

  it('dispatches CustomEvent "awareness-config-changed" on updateConfig', () => {
    const handler = vi.fn();
    window.addEventListener('awareness-config-changed', handler);

    const { result } = renderHook(() => useAppConfig());

    act(() => {
      result.current.updateConfig({ language: 'ja' });
    });

    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener('awareness-config-changed', handler);
  });

  it('migrates legacy current provider credentials into providerProfiles', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      language: 'en',
      providerKey: 'qwen-portal',
      modelId: 'qwen-turbo-latest',
      apiKey: 'legacy-key',
      baseUrl: 'https://legacy.example/v1',
    }));

    const { result } = renderHook(() => useAppConfig());

    expect(result.current.config.providerProfiles['qwen-portal']).toBeDefined();
    expect(result.current.config.providerProfiles['qwen-portal'].apiKey).toBe('legacy-key');
    expect(result.current.config.providerProfiles['qwen-portal'].baseUrl).toBe('https://legacy.example/v1');
  });

  it('restores saved provider credentials when switching across providers', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      language: 'en',
      providerKey: 'qwen-portal',
      modelId: 'qwen-turbo-latest',
      providerProfiles: {
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com/v1',
          models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
        },
      },
    }));

    const { result } = renderHook(() => useAppConfig());

    act(() => {
      result.current.saveProviderConfig({
        providerKey: 'qwen-portal',
        modelId: 'qwen-plus-latest',
        apiKey: 'qwen-key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      }, MODEL_PROVIDERS);
    });

    act(() => {
      result.current.selectModel('openai', 'gpt-4o', MODEL_PROVIDERS);
    });

    expect(result.current.config.providerKey).toBe('openai');
    expect(result.current.config.modelId).toBe('gpt-4o');
    expect(result.current.config.apiKey).toBe('openai-key');
    expect(result.current.config.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('syncConfig writes all saved provider profiles into openclaw payload', async () => {
    const saveConfigMock = vi.fn().mockResolvedValue({ success: true });
    (window as any).electronAPI = {
      ...(window as any).electronAPI,
      saveConfig: saveConfigMock,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      language: 'en',
      providerKey: 'qwen-portal',
      modelId: 'qwen-turbo-latest',
      providerProfiles: {
        'qwen-portal': {
          apiKey: 'qwen-key',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          models: [{ id: 'qwen-turbo-latest', label: 'Qwen Turbo' }],
        },
        openai: {
          apiKey: 'openai-key',
          baseUrl: 'https://api.openai.com/v1',
          models: [{ id: 'gpt-4o', label: 'GPT-4o' }],
        },
      },
    }));

    const { result } = renderHook(() => useAppConfig());

    await act(async () => {
      await result.current.syncConfig(MODEL_PROVIDERS);
    });

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    const payload = saveConfigMock.mock.calls[0][0];
    expect(payload.plugins.allow).toEqual(expect.arrayContaining(['openclaw-memory', 'browser']));
    expect(payload.models.providers['qwen-portal']).toBeDefined();
    expect(payload.models.providers.openai).toBeDefined();
    expect(payload.models.providers.openai.apiKey).toBe('openai-key');
    expect(payload.agents.defaults.model.primary).toBe('qwen-portal/qwen-turbo-latest');
  });
});
