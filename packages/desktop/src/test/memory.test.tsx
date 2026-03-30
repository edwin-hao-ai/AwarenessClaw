import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import Memory from '../pages/Memory';

/** Helper: make memoryCheckHealth return daemon-connected */
function mockDaemonConnected() {
  (window as any).electronAPI = {
    ...(window as any).electronAPI,
    memoryCheckHealth: () => Promise.resolve({
      status: 'ok', version: '0.4.1', search_mode: 'hybrid',
      stats: { totalMemories: 10, totalKnowledge: 3, totalTasks: 0, totalSessions: 5 },
    }),
    memoryGetCards: () => Promise.resolve({
      result: { content: [{ text: JSON.stringify({ knowledge_cards: [
        { id: '1', category: 'decision', title: 'Use PostgreSQL', summary: 'Chose PostgreSQL for pgvector.' },
      ] }) }] },
    }),
    memoryGetEvents: () => Promise.resolve({
      items: [{ id: 'mem1', type: 'turn_summary', title: 'Event one', source: 'claude-code', created_at: '2026-03-30T10:00:00Z' }],
      total: 1, limit: 50, offset: 0,
    }),
  };
}

describe('Memory Page', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
  });

  it('renders memory page header', async () => {
    await act(async () => { render(<Memory />); });
    const headers = screen.getAllByText(/Memory/);
    expect(headers.length).toBeGreaterThan(0);
  });

  it('renders search input', async () => {
    await act(async () => { render(<Memory />); });
    expect(screen.getByPlaceholderText(/Search|search/)).toBeInTheDocument();
  });

  it('shows Start Daemon button when daemon is offline', async () => {
    await act(async () => { render(<Memory />); });
    await waitFor(() => expect(screen.getByText('Start Daemon')).toBeInTheDocument());
  });

  it('renders refresh button', async () => {
    await act(async () => { render(<Memory />); });
    expect(screen.getByText(/Refresh/)).toBeInTheDocument();
  });

  it('shows category filter on knowledge tab when connected', async () => {
    mockDaemonConnected();
    await act(async () => { render(<Memory />); });
    // Switch to knowledge tab
    await waitFor(() => expect(screen.getByText(/Knowledge Cards/)).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText(/Knowledge Cards/)); });
    expect(screen.getByText(/All/)).toBeInTheDocument();
  });

  it('renders Memory Architecture info toggle when connected', async () => {
    mockDaemonConnected();
    await act(async () => { render(<Memory />); });
    await waitFor(() => expect(screen.getByText('Memory Architecture')).toBeInTheDocument());
  });

  it('expands Memory Architecture details on click', async () => {
    mockDaemonConnected();
    await act(async () => { render(<Memory />); });
    await waitFor(() => expect(screen.getByText('Memory Architecture')).toBeInTheDocument());
    const toggle = screen.getByText('Memory Architecture');
    await act(async () => { fireEvent.click(toggle); });
    expect(screen.getByText('Awareness Memory')).toBeInTheDocument();
    expect(screen.getByText('OpenClaw Local')).toBeInTheDocument();
  });
});
