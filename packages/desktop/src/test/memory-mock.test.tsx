import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import Memory from '../pages/Memory';

describe('Memory page daemon connection states', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
  });

  it('shows Start Daemon button when daemon is not connected', async () => {
    // Default mock: memoryCheckHealth returns error
    await act(async () => { render(<Memory />); });
    await waitFor(() => {
      expect(screen.getByText('Start Daemon')).toBeInTheDocument();
      expect(screen.getByText(/daemon is not running|守护进程未运行/i)).toBeInTheDocument();
    });
  });

  it('shows real cards without daemon offline state when daemon returns data', async () => {
    const origApi = (window as any).electronAPI;
    (window as any).electronAPI = {
      ...origApi,
      memoryCheckHealth: () => Promise.resolve({
        status: 'ok', version: '0.4.1', search_mode: 'hybrid',
        stats: { totalMemories: 5, totalKnowledge: 1, totalTasks: 0, totalSessions: 2 },
      }),
      memoryGetCards: () => Promise.resolve({
        result: {
          content: [{
            text: JSON.stringify({
              knowledge_cards: [
                { id: '1', category: 'decision', title: 'Real card', summary: 'Real data' },
              ],
            }),
          }],
        },
      }),
      memoryGetEvents: () => Promise.resolve({ items: [], total: 0 }),
    };

    await act(async () => { render(<Memory />); });
    // Switch to knowledge tab to see cards
    await waitFor(() => expect(screen.getAllByText(/Knowledge Cards/).length).toBeGreaterThan(0));
    await act(async () => { screen.getAllByText(/Knowledge Cards/)[0].click(); });
    await waitFor(() => {
      expect(screen.getByText('Real card')).toBeInTheDocument();
      expect(screen.queryByText('Start Daemon')).not.toBeInTheDocument();
    });

    (window as any).electronAPI = origApi;
  });
});
