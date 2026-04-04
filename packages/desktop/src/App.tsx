import { useState, useEffect } from 'react';
import SetupWizard from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Memory from './pages/Memory';
import Channels from './pages/Channels';
import Models from './pages/Models';
import Skills from './pages/Skills';
import Automation from './pages/Automation';
import Agents from './pages/Agents';
import TaskCenter from './pages/TaskCenter';
import Settings from './pages/Settings';
import Sidebar, { type Page } from './components/Sidebar';
import UpdateBanner from './components/UpdateBanner';
import { useAppConfig } from './lib/store';
import { useI18n } from './lib/i18n';
import logoUrl from './assets/logo.png';

const SETUP_COMPLETED_AT_KEY = 'awareness-claw-setup-completed-at';
const POST_SETUP_RUNTIME_GRACE_MS = 3 * 60 * 1000;

function estimateStartupProgress(message: string) {
  const text = message.toLowerCase();
  if (text.includes('checking')) return 10;
  if (text.includes('repairing')) return 45;
  if (text.includes('gateway access')) return 96;
  if (text.includes('everything looks good')) return 85;
  if (text.includes('finalizing')) return 92;
  return 18;
}

function translateStartupMessage(message: string, t: (key: string, fallback?: string) => string) {
  const exactMap: Record<string, string> = {
    'Preparing AwarenessClaw...': 'startup.preparing',
    'Checking your installation...': 'startup.checking',
    'Finishing setup...': 'startup.finishing',
    'Startup complete': 'startup.complete',
    'Waiting for the local service to finish starting...': 'startup.waitingForLocalService',
    'Everything looks good. Finalizing startup...': 'startup.everythingLooksGood',
    'Finalizing startup...': 'startup.finalizing',
    'Local service is still warming up...': 'startup.localServiceWarming',
    'Preparing local Gateway access...': 'startup.preparingGatewayAccess',
    'Approving local Gateway device access...': 'startup.approvingGatewayAccess',
    'Local Gateway access is ready.': 'startup.gatewayAccessReady',
  };

  const mappedKey = exactMap[message];
  if (mappedKey) return t(mappedKey, message);

  const repairingMatch = message.match(/^Repairing\s+(.+)\.\.\.$/);
  if (repairingMatch) {
    return t('startup.repairingCheck', 'Repairing {0}...').replace('{0}', repairingMatch[1]);
  }

  return message;
}

/** Apply theme to document root */
function useThemeEffect(theme: 'dark' | 'light' | 'system') {
  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (isDark: boolean) => {
      root.classList.toggle('dark', isDark);
      root.classList.toggle('light', !isDark);
      root.style.colorScheme = isDark ? 'dark' : 'light';
    };

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mq.matches);
      const handler = (e: MediaQueryListEvent) => applyTheme(e.matches);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    } else {
      applyTheme(theme === 'dark');
    }
  }, [theme]);
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
}

function isZoomInKey(event: KeyboardEvent): boolean {
  const key = event.key;
  const withModifier = event.ctrlKey || event.metaKey;
  if (withModifier) {
    return key === '+' || key === '=' || key === 'Add' || key === 'NumpadAdd';
  }
  return key === '+' || key === 'NumpadAdd';
}

function isZoomOutKey(event: KeyboardEvent): boolean {
  const key = event.key;
  const withModifier = event.ctrlKey || event.metaKey;
  if (withModifier) {
    return key === '-' || key === '_' || key === 'Subtract' || key === 'NumpadSubtract';
  }
  return key === '-' || key === 'NumpadSubtract';
}

export default function App() {
  const { config } = useAppConfig();
  const { t } = useI18n();
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [runtimeReady, setRuntimeReady] = useState<boolean | null>(null);
  const [startupMessage, setStartupMessage] = useState('Preparing AwarenessClaw...');
  const [startupProgress, setStartupProgress] = useState(8);
  const [currentPage, setCurrentPage] = useState<Page>('chat');

  // Apply theme switching
  useThemeEffect(config.theme || 'dark');

  useEffect(() => {
    const done = localStorage.getItem('awareness-claw-setup-done');
    setSetupComplete(done === 'true');
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onStartupStatus) return;
    window.electronAPI.onStartupStatus((status) => {
      if (status?.message) setStartupMessage(status.message);
      if (typeof status?.progress === 'number') setStartupProgress(status.progress);
      else if (status?.message) setStartupProgress(estimateStartupProgress(status.message));
    });
  }, []);

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (!window.electronAPI) return;
      if (isEditableElement(event.target)) return;

      if (isZoomInKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        await window.electronAPI.appZoomIn?.();
        return;
      }

      if (isZoomOutKey(event)) {
        event.preventDefault();
        event.stopPropagation();
        await window.electronAPI.appZoomOut?.();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === '0') {
        event.preventDefault();
        event.stopPropagation();
        await window.electronAPI.appZoomReset?.();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (setupComplete !== true) {
      setRuntimeReady(setupComplete === false ? true : null);
      return;
    }

    let cancelled = false;
    setRuntimeReady(null);
    setStartupMessage('Checking your installation...');
    setStartupProgress(10);

    const recentSetupCompletedAt = Number(localStorage.getItem(SETUP_COMPLETED_AT_KEY) || '0');
    const recentlyCompletedSetup = recentSetupCompletedAt > 0
      && Date.now() - recentSetupCompletedAt < POST_SETUP_RUNTIME_GRACE_MS;
    if (recentlyCompletedSetup) {
      setStartupMessage('Finishing setup...');
      setStartupProgress(18);
    }

    const ensureRuntime = async () => {
      if (!window.electronAPI?.startupEnsureRuntime) {
        if (!cancelled) {
          setStartupProgress(100);
          setRuntimeReady(true);
        }
        return;
      }

      try {
        const result = await window.electronAPI.startupEnsureRuntime();
        if (cancelled) return;

        if (!result.ok && result.needsSetup) {
          localStorage.setItem('awareness-claw-setup-done', 'false');
          setSetupComplete(false);
          setStartupProgress(100);
          setRuntimeReady(true);
          return;
        }
      } catch (err) {
        console.warn('[startup] Runtime check failed:', err);
        // Don't block app launch — user can still use the app and fix via Settings
      }

      if (!cancelled) {
        localStorage.removeItem(SETUP_COMPLETED_AT_KEY);
        setStartupMessage('Startup complete');
        setStartupProgress(100);
        setRuntimeReady(true);
      }
    };

    ensureRuntime();
    return () => { cancelled = true; };
  }, [setupComplete]);

  const handleSetupComplete = () => {
    localStorage.setItem(SETUP_COMPLETED_AT_KEY, String(Date.now()));
    localStorage.setItem('awareness-claw-setup-done', 'true');
    setSetupComplete(true);
  };

  if (setupComplete === null || runtimeReady === null) {
    const startupMessageText = translateStartupMessage(startupMessage, t);
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 px-6">
        <div className="max-w-md text-center space-y-4">
          <img src={logoUrl} alt="" className="w-12 h-12 animate-pulse-soft mx-auto" />
          <div>
            <h1 className="text-base font-semibold text-slate-100">{t('startup.title', 'Starting AwarenessClaw')}</h1>
            <p className="text-sm text-slate-400 mt-2">{startupMessageText}</p>
          </div>
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700/80">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-400 transition-all duration-500 ease-out"
                style={{ width: `${Math.max(8, Math.min(100, startupProgress))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
              <span>{t('startup.progress', 'Startup progress')}</span>
              <span>{Math.round(Math.max(8, Math.min(100, startupProgress)))}%</span>
            </div>
          </div>
          <p className="text-xs text-slate-500">{t('startup.hint', 'First launch or auto-repair can take a little longer while the app checks OpenClaw, Gateway, and memory services.')}</p>
        </div>
      </div>
    );
  }

  if (!setupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* macOS title bar drag region */}
      <div className="titlebar-drag fixed top-0 left-0 right-0 h-8 z-50" />

      {/* Update banner (weak reminder — top tooltip bar) */}
      <UpdateBanner />

      <div className="flex flex-1 overflow-hidden pt-8">
        <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />

        <main className="flex-1 overflow-hidden relative">
          {/* Dashboard is always mounted so in-flight chats survive tab switches */}
          <div className={`absolute inset-0 overflow-y-auto ${currentPage === 'chat' ? '' : 'hidden'}`}>
            <Dashboard isActive={currentPage === 'chat'} onNavigate={setCurrentPage} />
          </div>
          {currentPage === 'memory' && <div className="h-full overflow-y-auto"><Memory /></div>}
          {currentPage === 'channels' && <div className="h-full overflow-y-auto"><Channels /></div>}
          {currentPage === 'models' && <div className="h-full overflow-y-auto"><Models /></div>}
          {currentPage === 'skills' && <div className="h-full overflow-y-auto"><Skills /></div>}
          {currentPage === 'automation' && <div className="h-full overflow-y-auto"><Automation /></div>}
          {currentPage === 'agents' && <div className="h-full overflow-y-auto"><Agents onNavigate={setCurrentPage} /></div>}
          {currentPage === 'taskCenter' && <div className="h-full overflow-y-auto"><TaskCenter onNavigate={setCurrentPage} /></div>}
          {currentPage === 'settings' && <div className="h-full overflow-y-auto"><Settings /></div>}
        </main>
      </div>
    </div>
  );
}
