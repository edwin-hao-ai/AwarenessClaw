import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import Memory from '../pages/Memory';

/** Helper: create a connected daemon mock with custom overrides */
function connectedDaemonApi(overrides: Record<string, any> = {}) {
  const origAPI = (window as any).electronAPI;
  return {
    ...origAPI,
    memoryCheckHealth: () => Promise.resolve({
      status: 'ok', version: '0.4.1', search_mode: 'hybrid',
      stats: { totalMemories: 5, totalKnowledge: 1, totalTasks: 0, totalSessions: 2 },
    }),
    memoryGetEvents: () => Promise.resolve({ items: [], total: 0 }),
    ...overrides,
  };
}

describe('Memory Page — Daily Summary', () => {
  let origAPI: any;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
    origAPI = (window as any).electronAPI;
  });

  afterEach(() => {
    (window as any).electronAPI = origAPI;
  });

  it('shows Daily Summary when memoryGetDailySummary returns data', async () => {
    (window as any).electronAPI = connectedDaemonApi({
      memoryGetCards: () => Promise.resolve({
        result: { content: [{ text: JSON.stringify({ knowledge_cards: [
          { id: 'k1', category: 'decision', title: 'Use PostgreSQL', summary: 'Chose PG for pgvector' },
        ] }) }] },
      }),
      memoryGetDailySummary: () => Promise.resolve({
        cards: { result: { content: [{ text: JSON.stringify({ knowledge_cards: [
          { category: 'decision', title: 'Test decision', summary: 'Test' },
        ] }) }] } },
        tasks: { result: { content: [{ text: JSON.stringify({ action_items: [{ title: 'Task 1' }] }) }] } },
      }),
    });

    await act(async () => { render(<Memory />); });
    // Switch to knowledge tab to see Daily Summary
    await waitFor(() => expect(screen.getByText(/Knowledge Cards/)).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText(/Knowledge Cards/)); });

    await waitFor(() => {
      expect(screen.getByText('Daily Summary')).toBeInTheDocument();
    });
    expect(screen.getByText('Test decision')).toBeInTheDocument();
    expect(screen.getByText(/open tasks/)).toBeInTheDocument();
  });

  it('does not show Daily Summary when memoryGetDailySummary returns empty data', async () => {
    (window as any).electronAPI = connectedDaemonApi({
      memoryGetCards: () => Promise.resolve({
        result: { content: [{ text: JSON.stringify({ knowledge_cards: [
          { id: 'k1', category: 'insight', title: 'Some insight', summary: 'Detail' },
        ] }) }] },
      }),
      memoryGetDailySummary: () => Promise.resolve({
        cards: { result: { content: [{ text: JSON.stringify({ knowledge_cards: [] }) }] } },
        tasks: { result: { content: [{ text: JSON.stringify({ action_items: [] }) }] } },
      }),
    });

    await act(async () => { render(<Memory />); });
    await waitFor(() => expect(screen.getByText(/Knowledge Cards/)).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText(/Knowledge Cards/)); });

    await waitFor(() => {
      expect(screen.getByText('Some insight')).toBeInTheDocument();
    });
    expect(screen.queryByText('Daily Summary')).not.toBeInTheDocument();
  });

  it('does not show Daily Summary when daemon is offline', async () => {
    // Default mock: daemon not connected → shows Start Daemon, no Daily Summary
    await act(async () => { render(<Memory />); });
    await waitFor(() => {
      expect(screen.getByText('Start Daemon')).toBeInTheDocument();
    });
    expect(screen.queryByText('Daily Summary')).not.toBeInTheDocument();
  });
});
