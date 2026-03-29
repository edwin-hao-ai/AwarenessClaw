import { useState, useEffect } from 'react';
import SetupWizard from './pages/Setup';
import Dashboard from './pages/Dashboard';
import Memory from './pages/Memory';
import Channels from './pages/Channels';
import Models from './pages/Models';
import Skills from './pages/Skills';
import Settings from './pages/Settings';
import Sidebar from './components/Sidebar';

type Page = 'chat' | 'memory' | 'channels' | 'skills' | 'settings';

export default function App() {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [currentPage, setCurrentPage] = useState<Page>('chat');

  useEffect(() => {
    // Check if setup is already done
    const done = localStorage.getItem('awareness-claw-setup-done');
    setSetupComplete(done === 'true');
  }, []);

  const handleSetupComplete = () => {
    localStorage.setItem('awareness-claw-setup-done', 'true');
    setSetupComplete(true);
  };

  // Loading state
  if (setupComplete === null) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-900">
        <div className="animate-pulse-soft text-2xl">🧠</div>
      </div>
    );
  }

  // Setup wizard
  if (!setupComplete) {
    return <SetupWizard onComplete={handleSetupComplete} />;
  }

  // Main app
  return (
    <div className="h-screen flex overflow-hidden">
      {/* macOS title bar drag region */}
      <div className="titlebar-drag fixed top-0 left-0 right-0 h-8 z-50" />

      <Sidebar currentPage={currentPage} onNavigate={setCurrentPage} />

      <main className="flex-1 overflow-y-auto pt-8">
        {currentPage === 'chat' && <Dashboard />}
        {currentPage === 'memory' && <Memory />}
        {currentPage === 'channels' && <Channels />}
        {currentPage === 'skills' && <Skills />}
        {currentPage === 'settings' && <Settings />}
      </main>
    </div>
  );
}
