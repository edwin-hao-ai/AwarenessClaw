import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppConfig, useDynamicProviders } from '../lib/store';

type CloudAuthStep = 'init' | 'loading' | 'waiting' | 'select' | 'done' | 'error';
type CloudMemory = { id: string; name: string };

export function useMemorySettings() {
  const { config, updateConfig, syncConfig } = useAppConfig();
  const { providers } = useDynamicProviders();
  const [showCloudAuth, setShowCloudAuth] = useState(false);
  const [cloudAuthStep, setCloudAuthStep] = useState<CloudAuthStep>('init');
  const [cloudUserCode, setCloudUserCode] = useState('');
  const [cloudVerifyUrl, setCloudVerifyUrl] = useState('');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [cloudMemories, setCloudMemories] = useState<CloudMemory[]>([]);
  const [cloudMode, setCloudMode] = useState<string>('local');
  const cloudPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const api = window.electronAPI as any;

  const syncMemoryConfig = useCallback((partial: Record<string, unknown>) => {
    updateConfig(partial as any);
    void syncConfig(providers);
  }, [providers, syncConfig, updateConfig]);

  useEffect(() => {
    api?.cloudStatus?.().then((res: any) => {
      if (res?.success) setCloudMode(res.mode || 'local');
    }).catch(() => {});
  }, [api]);

  useEffect(() => {
    return () => {
      if (cloudPollRef.current) clearTimeout(cloudPollRef.current);
    };
  }, []);

  const startCloudAuth = useCallback(async () => {
    if (!api?.cloudAuthStart) return;
    setCloudAuthStep('loading');
    const res = await api.cloudAuthStart();
    if (!res?.success || !res.device_code) {
      setCloudAuthStep('error');
      return;
    }

    setCloudUserCode(res.user_code);
    setCloudVerifyUrl(`${res.verification_uri}?code=${res.user_code}`);
    setCloudAuthStep('waiting');

    const expiresIn = (res.expires_in || 600) * 1000;
    const startTime = Date.now();
    const deviceCode = res.device_code;

    if (cloudPollRef.current) clearTimeout(cloudPollRef.current);

    const doPoll = async () => {
      if (Date.now() - startTime > expiresIn) return;
      try {
        const poll = await api.cloudAuthPoll(deviceCode);
        if (poll?.api_key) {
          setCloudApiKey(poll.api_key);
          const memRes = await api.cloudListMemories(poll.api_key);
          const memories = memRes?.memories || [];
          if (memories.length <= 1) {
            const memoryId = memories[0]?.id || '';
            await api.cloudConnect(poll.api_key, memoryId);
            setCloudMode('hybrid');
            syncMemoryConfig({ memoryMode: 'cloud' });
            setCloudAuthStep('done');
          } else {
            setCloudMemories(memories);
            setCloudAuthStep('select');
          }
          return;
        }

        if (poll?.status === 'expired' || poll?.status === 'denied') {
          setCloudAuthStep('error');
          return;
        }
      } catch {
        // Retry until timeout.
      }

      cloudPollRef.current = setTimeout(doPoll, 5000);
    };

    cloudPollRef.current = setTimeout(doPoll, 1000);
  }, [api, syncMemoryConfig]);

  const openCloudAuth = useCallback(() => {
    setShowCloudAuth(true);
    setCloudAuthStep('init');
    setTimeout(() => {
      void startCloudAuth();
    }, 100);
  }, [startCloudAuth]);

  const closeCloudAuth = useCallback(() => {
    setShowCloudAuth(false);
    if (cloudPollRef.current) clearTimeout(cloudPollRef.current);
  }, []);

  const selectCloudMemory = useCallback(async (memoryId: string) => {
    if (!api?.cloudConnect) return;
    await api.cloudConnect(cloudApiKey, memoryId);
    setCloudMode('hybrid');
    syncMemoryConfig({ memoryMode: 'cloud' });
    setCloudAuthStep('done');
  }, [api, cloudApiKey, syncMemoryConfig]);

  const disconnectCloud = useCallback(async () => {
    if (!api?.cloudDisconnect) return;
    await api.cloudDisconnect();
    setCloudMode('local');
    syncMemoryConfig({ memoryMode: 'local' });
  }, [api, syncMemoryConfig]);

  const selectMemoryMode = useCallback((mode: 'local' | 'cloud') => {
    syncMemoryConfig({ memoryMode: mode });
    if (mode === 'cloud' && cloudMode !== 'hybrid' && cloudMode !== 'cloud') {
      openCloudAuth();
    }
  }, [cloudMode, openCloudAuth, syncMemoryConfig]);

  const toggleMemoryOption = useCallback((key: 'autoCapture' | 'autoRecall', value: boolean) => {
    syncMemoryConfig({ [key]: value });
  }, [syncMemoryConfig]);

  const setRecallLimit = useCallback((value: number) => {
    syncMemoryConfig({ recallLimit: value });
  }, [syncMemoryConfig]);

  const setBlockedSourceAllowed = useCallback((id: string, nextAllowed: boolean) => {
    const blocked = config.memoryBlockedSources || [];
    const next = nextAllowed
      ? blocked.filter((source: string) => source !== id)
      : [...blocked, id];
    syncMemoryConfig({ memoryBlockedSources: next });
  }, [config.memoryBlockedSources, syncMemoryConfig]);

  const clearAllMemories = useCallback(async (confirmText: string, successText: string, failedText: string) => {
    if (!confirm(confirmText)) return;
    try {
      const response = await fetch('http://127.0.0.1:37800/api/v1/knowledge/cleanup', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patterns: ['.*'] }),
      });
      alert(response.ok ? successText : failedText);
    } catch {
      alert(failedText);
    }
  }, []);

  return {
    config,
    cloudMode,
    showCloudAuth,
    cloudAuthStep,
    cloudUserCode,
    cloudVerifyUrl,
    cloudMemories,
    setCloudAuthStep,
    openCloudAuth,
    closeCloudAuth,
    startCloudAuth,
    selectCloudMemory,
    disconnectCloud,
    selectMemoryMode,
    toggleMemoryOption,
    setRecallLimit,
    setBlockedSourceAllowed,
    clearAllMemories,
  };
}