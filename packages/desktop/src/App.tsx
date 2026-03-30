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

    const ensureRuntime = async () => {
      if (!window.electronAPI?.startupEnsureRuntime) {
        if (!cancelled) setRuntimeReady(true);
        return;
      }

      const result = await window.electronAPI.startupEnsureRuntime();
      if (cancelled) return;

      if (!result.ok && result.needsSetup) {
        localStorage.setItem('awareness-claw-setup-done', 'false');
        setSetupComplete(false);
        setRuntimeReady(true);
        return;
      }

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

        <main className="flex-1 overflow-y-auto">
          {currentPage === 'chat' && <Dashboard />}
          {currentPage === 'memory' && <Memory />}
          {currentPage === 'channels' && <Channels />}
          {currentPage === 'skills' && <Skills />}
          {currentPage === 'automation' && <Automation />}
          {currentPage === 'agents' && <Agents />}
          {currentPage === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
