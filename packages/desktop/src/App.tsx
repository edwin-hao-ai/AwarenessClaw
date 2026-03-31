import { useState, useEffect } from 'react';
import SetupWizard from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Memory from './pages/Memory';
import Channels from './pages/Channels';
import Models from './pages/Models';
import Skills from './pages/Skills';
import Automation from './pages/Automation';
import Agents from './pages/Agents';
import Settings from './pages/Settings';
import Sidebar, { type Page } from './components/Sidebar';
import UpdateBanner from './components/UpdateBanner';
import { useAppConfig } from './lib/store';
import logoUrl from './assets/logo.png';

function estimateStartupProgress(message: string) {
  const text = message.toLowerCase();
  if (text.includes('checking')) return 10;
  if (text.includes('repairing')) return 45;
  if (text.includes('everything looks good')) return 85;
  if (text.includes('finalizing')) return 92;
  return 18;
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

export default function App() {
  const { config } = useAppConfig();
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
    if (setupComplete !== true) {
      setRuntimeReady(setupComplete === false ? true : null);
      return;
    }

    let cancelled = false;
    setRuntimeReady(null);
    setStartupMessage('Checking your installation...');
    setStartupProgress(10);

    const ensureRuntime = async () => {
      if (!window.electronAPI?.startupEnsureRuntime) {
        if (!cancelled) {
          setStartupProgress(100);
          setRuntimeReady(true);
        }
        return;
      }

      const result = await window.electronAPI.startupEnsureRuntime();
      if (cancelled) return;

      if (!result.ok && result.needsSetup) {
        localStorage.setItem('awareness-claw-setup-done', 'false');
        setSetupComplete(false);
        setStartupProgress(100);
        setRuntimeReady(true);
        return;
      }

      setStartupMessage('Startup complete');
      setStartupProgress(100);
      setRuntimeReady(true);
    };

    ensureRuntime();
    return () => { cancelled = true; };
  }, [setupComplete]);

  const handleSetupComplete = () => {
    localStorage.setItem('awareness-claw-setup-done', 'true');
    setSetupComplete(true);
  };

  if (setupComplete === null || runtimeReady === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900 px-6">
        <div className="max-w-md text-center space-y-4">
          <img src={logoUrl} alt="" className="w-12 h-12 animate-pulse-soft mx-auto" />
          <div>
            <h1 className="text-base font-semibold text-slate-100">Starting AwarenessClaw</h1>
            <p className="text-sm text-slate-400 mt-2">{startupMessage}</p>
          </div>
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-slate-800 ring-1 ring-slate-700/80">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-blue-500 to-cyan-400 transition-all duration-500 ease-out"
                style={{ width: `${Math.max(8, Math.min(100, startupProgress))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.16em] text-slate-500">
              <span>Startup progress</span>
              <span>{Math.round(Math.max(8, Math.min(100, startupProgress)))}%</span>
            </div>
          </div>
          <p className="text-xs text-slate-500">First launch or auto-repair can take a little longer while the app checks OpenClaw, Gateway, and memory services.</p>
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
            <Dashboard isActive={currentPage === 'chat'} />
          </div>
          {currentPage === 'memory' && <div className="h-full overflow-y-auto"><Memory /></div>}
          {currentPage === 'channels' && <div className="h-full overflow-y-auto"><Channels /></div>}
          {currentPage === 'skills' && <div className="h-full overflow-y-auto"><Skills /></div>}
          {currentPage === 'automation' && <div className="h-full overflow-y-auto"><Automation /></div>}
          {currentPage === 'agents' && <div className="h-full overflow-y-auto"><Agents /></div>}
          {currentPage === 'settings' && <div className="h-full overflow-y-auto"><Settings /></div>}
        </main>
      </div>
    </div>
  );
}
