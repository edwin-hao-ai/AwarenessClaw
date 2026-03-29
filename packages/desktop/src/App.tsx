import { useState, useEffect } from 'react';
import SetupWizard from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Memory from './pages/Memory';
import Channels from './pages/Channels';
import Models from './pages/Models';
import Skills from './pages/Skills';
import Automation from './pages/Automation';
import Settings from './pages/Settings';
import Sidebar, { type Page } from './components/Sidebar';
import UpdateBanner from './components/UpdateBanner';
import logoUrl from './assets/logo.png';

export default function App() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [currentPage, setCurrentPage] = useState<Page>('chat');

  useEffect(() => {
    const done = localStorage.getItem('awareness-claw-setup-done');
    setSetupComplete(done === 'true');
  }, []);

  const handleSetupComplete = () => {
    localStorage.setItem('awareness-claw-setup-done', 'true');
    setSetupComplete(true);
  };

  if (setupComplete === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <img src={logoUrl} alt="" className="w-10 h-10 animate-pulse-soft" />
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
          {currentPage === 'settings' && <Settings />}
        </main>
      </div>
    </div>
  );
}
